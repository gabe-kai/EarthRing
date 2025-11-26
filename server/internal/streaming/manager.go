package streaming

import (
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/earthring/server/internal/ringmap"
)

// Manager coordinates server-driven streaming subscriptions.
type Manager struct {
	mu            sync.RWMutex
	subscriptions map[string]*Subscription
}

// Subscription tracks an individual client's request window.
type Subscription struct {
	ID            string
	UserID        int64
	Request       SubscriptionRequest
	ChunkIDs      []string
	ZoneBoundingBox *ZoneBoundingBox // Track current zone query area
	ZoneIDs       []int64            // Track current zone IDs in subscription
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// ChunkDelta describes server-evaluated chunk changes for a subscription.
type ChunkDelta struct {
	SubscriptionID string
	AddedChunks    []string
	RemovedChunks  []string
	CurrentChunks  []string
}

// ZoneDelta describes server-evaluated zone changes for a subscription.
type ZoneDelta struct {
	SubscriptionID string
	AddedZoneIDs   []int64
	RemovedZoneIDs []int64
	CurrentZoneIDs []int64
}

// NewManager builds a streaming manager instance.
func NewManager() *Manager {
	return &Manager{
		subscriptions: make(map[string]*Subscription),
	}
}

// CameraPose describes the player's viewing position for streaming decisions.
type CameraPose struct {
	// Legacy coordinates (for backward compatibility)
	RingPosition int64   `json:"ring_position,omitempty"` // Absolute X position in meters (legacy)
	WidthOffset  float64 `json:"width_offset,omitempty"`  // Y offset (meters) (legacy)
	
	// New coordinate system (RingPolar)
	Theta        float64 `json:"theta,omitempty"`        // Angle around ring in radians (0 at Kongo Hub)
	R            float64 `json:"r,omitempty"`            // Radial offset from centerline in meters
	Z            float64 `json:"z,omitempty"`            // Vertical offset from equatorial plane in meters
	
	// Alternative: RingArc coordinates
	ArcLength    float64 `json:"arc_length,omitempty"`    // Arc length along ring in meters (0 at Kongo Hub)
	
	// Common fields
	Elevation    float64 `json:"elevation"`     // Camera height in meters
	ActiveFloor  int     `json:"active_floor"`  // Player-selected floor
}

// SubscriptionRequest is sent by clients to begin receiving streaming data.
type SubscriptionRequest struct {
	Pose          CameraPose `json:"pose"`
	RadiusMeters  int64      `json:"radius_meters"`  // Ring distance to include
	WidthMeters   float64    `json:"width_meters"`   // +/- width slice for zones (future use)
	IncludeChunks bool       `json:"include_chunks"` // Request chunk deltas
	IncludeZones  bool       `json:"include_zones"`  // Request zone deltas
}

// SubscriptionPlan captures the initial server response for a subscription.
type SubscriptionPlan struct {
	SubscriptionID string   `json:"subscription_id"`
	ChunkIDs       []string `json:"chunk_ids,omitempty"`
}

// PlanSubscription validates the request and registers the subscription plan.
func (m *Manager) PlanSubscription(userID int64, req SubscriptionRequest) (*SubscriptionPlan, error) {
	if req.RadiusMeters <= 0 {
		return nil, fmt.Errorf("radius_meters must be positive")
	}
	if req.RadiusMeters > ringmap.RingCircumference {
		return nil, fmt.Errorf("radius_meters cannot exceed %d", ringmap.RingCircumference)
	}
	if !req.IncludeChunks && !req.IncludeZones {
		return nil, fmt.Errorf("at least one of include_chunks/include_zones must be true")
	}

	chunkIDs := ComputeChunkWindow(req.Pose, req.RadiusMeters)
	subscriptionID := fmt.Sprintf("sub_%d_%d", req.Pose.ActiveFloor, time.Now().UnixNano())

	var zoneBBox *ZoneBoundingBox
	if req.IncludeZones {
		bbox := ComputeZoneBoundingBox(req.Pose, req.RadiusMeters, req.WidthMeters)
		zoneBBox = &bbox
	}

	subscription := &Subscription{
		ID:            subscriptionID,
		UserID:        userID,
		Request:       req,
		ChunkIDs:      chunkIDs,
		ZoneBoundingBox: zoneBBox,
		ZoneIDs:       []int64{}, // Will be populated when zones are loaded
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	m.mu.Lock()
	m.subscriptions[subscriptionID] = subscription
	m.mu.Unlock()

	return &SubscriptionPlan{
		SubscriptionID: subscriptionID,
		ChunkIDs:       chunkIDs,
	}, nil
}

// UpdatePose recomputes the subscription window and returns chunk deltas.
func (m *Manager) UpdatePose(userID int64, subscriptionID string, pose CameraPose) (*ChunkDelta, error) {
	if subscriptionID == "" {
		return nil, fmt.Errorf("subscription_id is required")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	subscription, ok := m.subscriptions[subscriptionID]
	if !ok {
		return nil, fmt.Errorf("subscription %s not found", subscriptionID)
	}
	if subscription.UserID != userID {
		return nil, fmt.Errorf("subscription %s does not belong to the current user", subscriptionID)
	}

	log.Printf("[Stream] UpdatePose: subscription=%s, pose.ArcLength=%.0f, pose.Theta=%.6f, pose.RingPosition=%d, floor=%d",
		subscriptionID, pose.ArcLength, pose.Theta, pose.RingPosition, pose.ActiveFloor)
	newChunkIDs := ComputeChunkWindow(pose, subscription.Request.RadiusMeters)
	log.Printf("[Stream] UpdatePose: old_chunks=%d, new_chunks=%d", len(subscription.ChunkIDs), len(newChunkIDs))
	added, removed := diffChunkSets(subscription.ChunkIDs, newChunkIDs)
	log.Printf("[Stream] UpdatePose: added=%d chunks, removed=%d chunks", len(added), len(removed))

	// Update zone bounding box if zones are included
	// Note: Zone delta computation requires zone storage access, so it's handled
	// in the websocket handler that has access to zoneStorage
	if subscription.Request.IncludeZones {
		newBBox := ComputeZoneBoundingBox(pose, subscription.Request.RadiusMeters, subscription.Request.WidthMeters)
		subscription.ZoneBoundingBox = &newBBox
		// ZoneIDs will be updated by ComputeZoneDelta when zones are loaded
	}

	subscription.ChunkIDs = newChunkIDs
	subscription.Request.Pose = pose
	subscription.UpdatedAt = time.Now()

	return &ChunkDelta{
		SubscriptionID: subscriptionID,
		AddedChunks:    added,
		RemovedChunks:  removed,
		CurrentChunks:  newChunkIDs,
	}, nil
}

// ComputeZoneDelta computes zone deltas by comparing current zone IDs with zones in the new bounding box.
// This requires zone storage access, so it's typically called from the websocket handler.
// Returns the delta and updates the subscription's ZoneIDs.
func (m *Manager) ComputeZoneDelta(subscriptionID string, newZoneIDs []int64) (*ZoneDelta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	subscription, ok := m.subscriptions[subscriptionID]
	if !ok {
		return nil, fmt.Errorf("subscription %s not found", subscriptionID)
	}

	added, removed := diffZoneSets(subscription.ZoneIDs, newZoneIDs)
	subscription.ZoneIDs = newZoneIDs
	subscription.UpdatedAt = time.Now()

	return &ZoneDelta{
		SubscriptionID: subscriptionID,
		AddedZoneIDs:   added,
		RemovedZoneIDs: removed,
		CurrentZoneIDs: newZoneIDs,
	}, nil
}

// GetSubscription retrieves a subscription by ID (for use by websocket handler).
func (m *Manager) GetSubscription(subscriptionID string) (*Subscription, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	subscription, ok := m.subscriptions[subscriptionID]
	if !ok {
		return nil, fmt.Errorf("subscription %s not found", subscriptionID)
	}
	return subscription, nil
}

// ComputeChunkWindow derives the chunk IDs close to the provided pose and radius.
// Supports both legacy (RingPosition) and new (RingPolar/RingArc) coordinate systems.
func ComputeChunkWindow(pose CameraPose, radiusMeters int64) []string {
	if radiusMeters <= 0 {
		return nil
	}

	var centerIndex int
	
	// Use new coordinate system if available (preferred)
	if pose.ArcLength != 0 || pose.Theta != 0 {
		// Use RingArc if available (more direct for chunk computation)
		if pose.ArcLength != 0 {
			arc := ringmap.RingArc{
				S: pose.ArcLength,
				R: pose.R,
				Z: pose.Z,
			}
			centerIndex = ringmap.RingArcToChunkIndex(arc)
			wrappedS := ringmap.WrapArcLength(pose.ArcLength)
			log.Printf("[Stream] ComputeChunkWindow: arc_length=%.0f (wrapped=%.0f), center_chunk=%d, chunk_radius=%d, floor=%d",
				pose.ArcLength, wrappedS, centerIndex, int(math.Ceil(float64(radiusMeters)/float64(ringmap.ChunkLength))), pose.ActiveFloor)
		} else if pose.Theta != 0 {
			// Use RingPolar (convert to chunk index via RingArc)
			polar := ringmap.RingPolar{
				Theta: pose.Theta,
				R:     pose.R,
				Z:     pose.Z,
			}
			centerIndex = ringmap.RingPolarToChunkIndex(polar)
			log.Printf("[Stream] ComputeChunkWindow: theta=%.4f, center_chunk=%d, chunk_radius=%d, floor=%d",
				pose.Theta, centerIndex, int(math.Ceil(float64(radiusMeters)/float64(ringmap.ChunkLength))), pose.ActiveFloor)
		}
	} else {
		// Fall back to legacy coordinate system
		centerIndex = ringmap.PositionToChunkIndex(pose.RingPosition)
		log.Printf("[Stream] ComputeChunkWindow: ring_position=%d, center_chunk=%d, chunk_radius=%d, floor=%d",
			pose.RingPosition, centerIndex, int(math.Ceil(float64(radiusMeters)/float64(ringmap.ChunkLength))), pose.ActiveFloor)
	}

	chunkRadius := int(math.Ceil(float64(radiusMeters) / float64(ringmap.ChunkLength)))

	seen := make(map[int]struct{})
	var chunkIDs []string

	for offset := -chunkRadius; offset <= chunkRadius; offset++ {
		idx := ringmap.WrapChunkIndex(centerIndex + offset)
		if _, exists := seen[idx]; exists {
			continue
		}
		seen[idx] = struct{}{}
		chunkID := fmt.Sprintf("%d_%d", pose.ActiveFloor, idx)
		chunkIDs = append(chunkIDs, chunkID)
	}

	if len(chunkIDs) > 0 {
		firstN := 10
		if len(chunkIDs) < firstN {
			firstN = len(chunkIDs)
		}
		log.Printf("[Stream] ComputeChunkWindow result: %d chunk IDs (first %d): %v", len(chunkIDs), firstN, chunkIDs[:firstN])
	} else {
		log.Printf("[Stream] ComputeChunkWindow result: 0 chunk IDs")
	}
	return chunkIDs
}

// ZoneBoundingBox represents the area to query for zones.
// Supports both legacy (X/Y) and new (theta/r or s/r) coordinate systems.
type ZoneBoundingBox struct {
	Floor int     // Active floor
	
	// Legacy coordinates (for backward compatibility)
	MinX  float64 // Minimum X (ring position)
	MinY  float64 // Minimum Y (width offset)
	MaxX  float64 // Maximum X (ring position)
	MaxY  float64 // Maximum Y (width offset)
	
	// New coordinate system (RingPolar)
	MinTheta float64 // Minimum theta (angle in radians)
	MaxTheta float64 // Maximum theta (angle in radians)
	MinR     float64 // Minimum r (radial offset)
	MaxR     float64 // Maximum r (radial offset)
	MinZ     float64 // Minimum z (vertical offset)
	MaxZ     float64 // Maximum z (vertical offset)
	
	// Alternative: RingArc coordinates
	MinS float64 // Minimum s (arc length)
	MaxS float64 // Maximum s (arc length)
}

// ComputeZoneBoundingBox calculates the bounding box for zone queries based on camera pose and radius.
// Handles ring wrapping correctly. Supports both legacy and new coordinate systems.
func ComputeZoneBoundingBox(pose CameraPose, radiusMeters int64, widthMeters float64) ZoneBoundingBox {
	bbox := ZoneBoundingBox{
		Floor: pose.ActiveFloor,
	}

	// Default width if not specified (applies to both legacy and new coordinates)
	if widthMeters <= 0 {
		widthMeters = 5000.0
	}
	
	// Use new coordinate system if available (preferred)
	if pose.ArcLength != 0 || pose.Theta != 0 {
		// Use RingArc if available (more direct for bounding box)
		if pose.ArcLength != 0 {
			wrappedS := ringmap.WrapArcLength(pose.ArcLength)
			bbox.MinS = wrappedS - float64(radiusMeters)
			bbox.MaxS = wrappedS + float64(radiusMeters)
			bbox.MinR = pose.R - widthMeters/2
			bbox.MaxR = pose.R + widthMeters/2
			bbox.MinZ = pose.Z - widthMeters/2
			bbox.MaxZ = pose.Z + widthMeters/2
		} else if pose.Theta != 0 {
			// Use RingPolar (convert to RingArc for bounding box)
			wrappedTheta := ringmap.WrapTheta(pose.Theta)
			// Convert theta range to arc length range
			arc := ringmap.RingPolarToRingArc(ringmap.RingPolar{
				Theta: wrappedTheta,
				R:     pose.R,
				Z:     pose.Z,
			})
			wrappedS := ringmap.WrapArcLength(arc.S)
			bbox.MinS = wrappedS - float64(radiusMeters)
			bbox.MaxS = wrappedS + float64(radiusMeters)
			bbox.MinR = pose.R - widthMeters/2
			bbox.MaxR = pose.R + widthMeters/2
			bbox.MinZ = pose.Z - widthMeters/2
			bbox.MaxZ = pose.Z + widthMeters/2
			
			// Also compute theta bounds for convenience
			thetaRadius := float64(radiusMeters) / ringmap.RingOrbitalRadius
			bbox.MinTheta = wrappedTheta - thetaRadius
			bbox.MaxTheta = wrappedTheta + thetaRadius
		}
	} else {
		// Fall back to legacy coordinate system
		// Wrap ring position to valid range
		wrappedX := float64(ringmap.WrapPosition(pose.RingPosition))

		// Calculate X bounds (ring position)
		bbox.MinX = wrappedX - float64(radiusMeters)
		bbox.MaxX = wrappedX + float64(radiusMeters)

		// Handle wrapping: if bounds extend beyond ring circumference, clamp to valid range
		// For zones, we'll query the full visible area and let PostGIS handle the intersection
		if bbox.MinX < 0 {
			bbox.MinX = 0
		}
		if bbox.MaxX > float64(ringmap.RingCircumference) {
			bbox.MaxX = float64(ringmap.RingCircumference)
		}

		// Calculate Y bounds (width offset)
		// Default width if not specified (5km should cover most zones)
		if widthMeters <= 0 {
			widthMeters = 5000.0
		}
		bbox.MinY = pose.WidthOffset - widthMeters/2
		bbox.MaxY = pose.WidthOffset + widthMeters/2

		// Clamp Y to reasonable bounds (zones shouldn't extend beyond ±2.5km from center)
		const maxWidth = 2500.0
		if bbox.MinY < -maxWidth {
			bbox.MinY = -maxWidth
		}
		if bbox.MaxY > maxWidth {
			bbox.MaxY = maxWidth
		}
	}
	
	// Handle wrapping for new coordinates (arc length)
	if bbox.MinS < 0 {
		bbox.MinS = ringmap.WrapArcLength(bbox.MinS)
	}
	if bbox.MaxS > float64(ringmap.RingCircumference) {
		bbox.MaxS = ringmap.WrapArcLength(bbox.MaxS)
	}
	
	// Clamp R and Z to reasonable bounds if using new coordinates
	if bbox.MinR != 0 || bbox.MaxR != 0 {
		const maxWidth = 2500.0
		if bbox.MinR < -maxWidth {
			bbox.MinR = -maxWidth
		}
		if bbox.MaxR > maxWidth {
			bbox.MaxR = maxWidth
		}
	}

	return bbox
}

func diffChunkSets(previous, next []string) (added []string, removed []string) {
	prevSet := make(map[string]struct{}, len(previous))
	nextSet := make(map[string]struct{}, len(next))

	for _, id := range previous {
		prevSet[id] = struct{}{}
	}
	for _, id := range next {
		nextSet[id] = struct{}{}
		if _, exists := prevSet[id]; !exists {
			added = append(added, id)
		}
	}
	for _, id := range previous {
		if _, exists := nextSet[id]; !exists {
			removed = append(removed, id)
		}
	}
	return
}

func diffZoneSets(previous, next []int64) (added []int64, removed []int64) {
	prevSet := make(map[int64]struct{}, len(previous))
	nextSet := make(map[int64]struct{}, len(next))

	for _, id := range previous {
		prevSet[id] = struct{}{}
	}
	for _, id := range next {
		nextSet[id] = struct{}{}
		if _, exists := prevSet[id]; !exists {
			added = append(added, id)
		}
	}
	for _, id := range previous {
		if _, exists := nextSet[id]; !exists {
			removed = append(removed, id)
		}
	}
	return
}
