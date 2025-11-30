package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/database"
)

// ZoneHandlers manages HTTP handlers for zone management.
type ZoneHandlers struct {
	storage *database.ZoneStorage
	db      *sql.DB
	config  *config.Config
}

// NewZoneHandlers creates a new ZoneHandlers instance.
func NewZoneHandlers(db *sql.DB, cfg *config.Config) *ZoneHandlers {
	return &ZoneHandlers{
		storage: database.NewZoneStorage(db),
		db:      db,
		config:  cfg,
	}
}

type createZoneRequest struct {
	Name              string          `json:"name"`
	ZoneType          string          `json:"zone_type"`
	Floor             int             `json:"floor"`
	OwnerID           *int64          `json:"owner_id,omitempty"`
	Geometry          json.RawMessage `json:"geometry"`
	Properties        json.RawMessage `json:"properties,omitempty"`
	Metadata          json.RawMessage `json:"metadata,omitempty"`
	ConflictResolution *string        `json:"conflict_resolution,omitempty"` // "new_wins" or "existing_wins" (bulk resolution for all conflicts)
	ConflictResolutions map[string]string `json:"conflict_resolutions,omitempty"` // Per-zone resolutions: zone_id (as string) -> "new_wins" or "existing_wins"
}

type updateZoneRequest struct {
	Name       *string          `json:"name,omitempty"`
	ZoneType   *string          `json:"zone_type,omitempty"`
	Floor      *int             `json:"floor,omitempty"`
	OwnerID    *int64           `json:"owner_id,omitempty"`
	Geometry   *json.RawMessage `json:"geometry,omitempty"`
	Properties *json.RawMessage `json:"properties,omitempty"`
	Metadata   *json.RawMessage `json:"metadata,omitempty"`
}

type zoneResponse struct {
	ID           int64           `json:"id"`
	Name         string          `json:"name"`
	ZoneType     string          `json:"zone_type"`
	Floor        int             `json:"floor"`
	OwnerID      *int64          `json:"owner_id,omitempty"`
	IsSystemZone bool            `json:"is_system_zone"`
	Properties   json.RawMessage `json:"properties,omitempty"`
	Metadata     json.RawMessage `json:"metadata,omitempty"`
	Geometry     json.RawMessage `json:"geometry,omitempty"`
	Area         float64         `json:"area"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

// CreateZone handles POST /api/zones
func (h *ZoneHandlers) CreateZone(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	var req createZoneRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Default owner to authenticated user if not provided.
	ownerID := authUserID
	if req.OwnerID != nil {
		if *req.OwnerID != authUserID {
			respondWithError(w, http.StatusForbidden, "Cannot assign zone to another owner")
			return
		}
		ownerID = *req.OwnerID
	}

	// Check if this is a dezone operation (subtract from all overlapping zones)
	if req.ZoneType == "dezone" {
		// Dezone is special: it subtracts from any zone it overlaps, regardless of type
		// It doesn't create a zone itself - it's just used for subtraction
		updatedZones, err := h.storage.SubtractDezoneFromAllOverlapping(req.Floor, req.Geometry, authUserID)
		if err != nil {
			log.Printf("SubtractDezoneFromAllOverlapping error: %v", err)
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Return the list of updated zones
		responses := make([]zoneResponse, len(updatedZones))
		for i, zone := range updatedZones {
			responses[i] = *toZoneResponse(zone)
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"updated_zones": responses,
			"count":         len(updatedZones),
		})
		return
	}

	// Convert string keys to int64 keys for ConflictResolutions
	var conflictResolutions map[int64]string
	if req.ConflictResolutions != nil && len(req.ConflictResolutions) > 0 {
		conflictResolutions = make(map[int64]string)
		for zoneIDStr, resolution := range req.ConflictResolutions {
			zoneID, err := strconv.ParseInt(zoneIDStr, 10, 64)
			if err != nil {
				log.Printf("Invalid zone ID in conflict_resolutions: %s", zoneIDStr)
				continue
			}
			conflictResolutions[zoneID] = resolution
		}
	}

	input := &database.ZoneCreateInput{
		Name:              req.Name,
		ZoneType:          req.ZoneType,
		Floor:             req.Floor,
		OwnerID:           &ownerID,
		Geometry:          req.Geometry,
		Properties:        req.Properties,
		Metadata:          req.Metadata,
		ConflictResolution: req.ConflictResolution,
		ConflictResolutions: conflictResolutions,
	}

	result, err := h.storage.CreateZoneWithComponents(input)
	if err != nil {
		// Check if this is a conflict error that needs user resolution
		if conflictErr, ok := err.(*database.ZoneConflictError); ok {
			writeJSON(w, http.StatusConflict, map[string]interface{}{
				"error":         "zone_conflict",
				"message":       conflictErr.Error(),
				"conflicts":      conflictErr.Conflicts,
				"new_zone_type": conflictErr.NewZoneType,
			})
			return
		}
		log.Printf("CreateZoneWithComponents error: %v", err)
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Build response with both created and updated zones
	createdResponses := make([]zoneResponse, len(result.Created))
	for i, zone := range result.Created {
		createdResponses[i] = *toZoneResponse(zone)
	}

	updatedResponses := make([]zoneResponse, len(result.Updated))
	for i, zone := range result.Updated {
		updatedResponses[i] = *toZoneResponse(zone)
	}

	// If multiple zones were created (bisection) or zones were updated, return structured response
	if len(result.Created) > 1 || len(result.Updated) > 0 {
		response := map[string]interface{}{
			"zones": createdResponses,
			"count": len(createdResponses),
		}
		if len(result.Updated) > 0 {
			response["updated_zones"] = updatedResponses
			response["updated_count"] = len(updatedResponses)
		}
		writeJSON(w, http.StatusCreated, response)
		return
	}

	// Single zone created, no updates - return it directly for backward compatibility
	writeJSON(w, http.StatusCreated, toZoneResponse(result.Created[0]))
}

// GetZone handles GET /api/zones/{zone_id}
func (h *ZoneHandlers) GetZone(w http.ResponseWriter, r *http.Request) {
	zoneID, err := extractZoneID(r.URL.Path)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	zone, err := h.storage.GetZoneByID(zoneID)
	if err != nil {
		log.Printf("GetZone error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve zone")
		return
	}
	if zone == nil {
		respondWithError(w, http.StatusNotFound, "Zone not found")
		return
	}

	writeJSON(w, http.StatusOK, toZoneResponse(zone))
}

// UpdateZone handles PUT /api/zones/{zone_id}
func (h *ZoneHandlers) UpdateZone(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	zoneID, err := extractZoneID(r.URL.Path)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	existing, err := h.storage.GetZoneByID(zoneID)
	if err != nil {
		log.Printf("UpdateZone fetch error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve zone")
		return
	}
	if existing == nil {
		respondWithError(w, http.StatusNotFound, "Zone not found")
		return
	}

	if !canModifyZone(authUserID, existing) {
		respondWithError(w, http.StatusForbidden, "You do not have permission to modify this zone")
		return
	}

	var req updateZoneRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updateInput := database.ZoneUpdateInput{}

	if req.Name != nil {
		updateInput.Name = req.Name
	}
	if req.ZoneType != nil {
		updateInput.ZoneType = req.ZoneType
	}
	if req.Floor != nil {
		updateInput.Floor = req.Floor
	}
	if req.OwnerID != nil {
		if *req.OwnerID != authUserID {
			respondWithError(w, http.StatusForbidden, "Cannot transfer ownership")
			return
		}
		updateInput.OwnerID = req.OwnerID
		updateInput.OwnerIDSet = true
	}
	if req.Geometry != nil {
		updateInput.Geometry = req.Geometry
	}
	if req.Properties != nil {
		updateInput.Properties = req.Properties
	}
	if req.Metadata != nil {
		updateInput.Metadata = req.Metadata
	}

	updated, err := h.storage.UpdateZone(zoneID, updateInput)
	if err != nil {
		log.Printf("UpdateZone error: %v", err)
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toZoneResponse(updated))
}

// DeleteZone handles DELETE /api/zones/{zone_id}
func (h *ZoneHandlers) DeleteZone(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	zoneID, err := extractZoneID(r.URL.Path)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	existing, err := h.storage.GetZoneByID(zoneID)
	if err != nil {
		log.Printf("DeleteZone fetch error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve zone")
		return
	}
	if existing == nil {
		respondWithError(w, http.StatusNotFound, "Zone not found")
		return
	}
	if !canModifyZone(authUserID, existing) {
		respondWithError(w, http.StatusForbidden, "You do not have permission to delete this zone")
		return
	}

	if err := h.storage.DeleteZone(zoneID); err != nil {
		log.Printf("DeleteZone error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to delete zone")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListZonesByArea handles GET /api/zones/area?floor=&min_x=&min_y=&max_x=&max_y=
func (h *ZoneHandlers) ListZonesByArea(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(auth.UserIDKey).(int64); !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	query := r.URL.Query()
	floor, err := parseIntParam(query.Get("floor"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid floor parameter")
		return
	}

	minX, err := parseFloatParam(query.Get("min_x"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid min_x parameter")
		return
	}
	minY, err := parseFloatParam(query.Get("min_y"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid min_y parameter")
		return
	}
	maxX, err := parseFloatParam(query.Get("max_x"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid max_x parameter")
		return
	}
	maxY, err := parseFloatParam(query.Get("max_y"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid max_y parameter")
		return
	}

	zones, err := h.storage.ListZonesByArea(floor, minX, minY, maxX, maxY)
	if err != nil {
		log.Printf("ListZonesByArea error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to query zones")
		return
	}

	writeJSON(w, http.StatusOK, zonesToResponse(zones))
}

// ListZonesByOwner handles GET /api/zones/owner/{owner_id}
func (h *ZoneHandlers) ListZonesByOwner(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	ownerID, err := extractOwnerID(r.URL.Path)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if authUserID != ownerID {
		respondWithError(w, http.StatusForbidden, "You can only view your own zones")
		return
	}

	zones, err := h.storage.ListZonesByOwner(ownerID)
	if err != nil {
		log.Printf("ListZonesByOwner error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to query zones")
		return
	}

	writeJSON(w, http.StatusOK, zonesToResponse(zones))
}

// Helper functions

func extractZoneID(path string) (int64, error) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "zones" {
		return 0, fmt.Errorf("invalid path")
	}
	id, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid zone ID")
	}
	return id, nil
}

func extractOwnerID(path string) (int64, error) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "zones" || parts[2] != "owner" {
		return 0, fmt.Errorf("invalid path")
	}
	id, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid owner ID")
	}
	return id, nil
}

func parseIntParam(value string) (int, error) {
	if value == "" {
		return 0, fmt.Errorf("missing value")
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}

func parseFloatParam(value string) (float64, error) {
	if value == "" {
		return 0, fmt.Errorf("missing value")
	}
	return strconv.ParseFloat(value, 64)
}

func canModifyZone(userID int64, zone *database.Zone) bool {
	if zone.OwnerID == nil {
		return false
	}
	return *zone.OwnerID == userID
}

func toZoneResponse(zone *database.Zone) *zoneResponse {
	if zone == nil {
		return nil
	}
	return &zoneResponse{
		ID:           zone.ID,
		Name:         zone.Name,
		ZoneType:     zone.ZoneType,
		Floor:        zone.Floor,
		OwnerID:      zone.OwnerID,
		IsSystemZone: zone.IsSystemZone,
		Properties:   zone.Properties,
		Metadata:     zone.Metadata,
		Geometry:     zone.Geometry,
		Area:         zone.Area,
		CreatedAt:    zone.CreatedAt,
		UpdatedAt:    zone.UpdatedAt,
	}
}

func zonesToResponse(zones []database.Zone) []zoneResponse {
	responses := make([]zoneResponse, 0, len(zones))
	for _, zone := range zones {
		z := zone // copy
		resp := toZoneResponse(&z)
		if resp != nil {
			responses = append(responses, *resp)
		}
	}
	return responses
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}
