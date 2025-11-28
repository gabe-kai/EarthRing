package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/compression"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/database"
	"github.com/earthring/server/internal/performance"
	"github.com/earthring/server/internal/procedural"
	"github.com/earthring/server/internal/ringmap"
	"github.com/earthring/server/internal/streaming"
	"github.com/gorilla/websocket"
)

const (
	// Supported WebSocket protocol versions
	ProtocolVersion1 = "earthring-v1"

	// Default ping interval (30 seconds)
	defaultPingInterval = 30 * time.Second

	// Pong wait timeout (60 seconds)
	pongWait = 60 * time.Second

	// Write timeout (10 seconds)
	writeTimeout = 10 * time.Second
)

// WebSocketConnection represents an active WebSocket connection
type WebSocketConnection struct {
	conn     *websocket.Conn
	userID   int64
	username string
	role     string
	version  string
	send     chan []byte
	hub      *WebSocketHub
}

// WebSocketHub manages all active WebSocket connections
type WebSocketHub struct {
	connections map[*WebSocketConnection]bool
	broadcast   chan []byte
	register    chan *WebSocketConnection
	unregister  chan *WebSocketConnection
	mu          sync.RWMutex
}

// WebSocketMessage represents a WebSocket message
type WebSocketMessage struct {
	Type string          `json:"type"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

// WebSocketError represents an error message sent over WebSocket
type WebSocketError struct {
	Type    string `json:"type"`
	ID      string `json:"id,omitempty"`
	Error   string `json:"error"`
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

// NewWebSocketHub creates a new WebSocket hub
func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		connections: make(map[*WebSocketConnection]bool),
		broadcast:   make(chan []byte, 256),
		register:    make(chan *WebSocketConnection),
		unregister:  make(chan *WebSocketConnection),
	}
}

// Run starts the hub's main loop
func (h *WebSocketHub) Run() {
	for {
		select {
		case conn := <-h.register:
			h.mu.Lock()
			h.connections[conn] = true
			h.mu.Unlock()
			log.Printf("WebSocket connection registered: user_id=%d, version=%s", conn.userID, conn.version)

		case conn := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.connections[conn]; ok {
				delete(h.connections, conn)
				close(conn.send)
			}
			h.mu.Unlock()
			log.Printf("WebSocket connection unregistered: user_id=%d", conn.userID)

		case message := <-h.broadcast:
			h.mu.RLock()
			for conn := range h.connections {
				select {
				case conn.send <- message:
				default:
					close(conn.send)
					delete(h.connections, conn)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all connected clients
func (h *WebSocketHub) Broadcast(message []byte) {
	h.broadcast <- message
}

// SendToUser sends a message to a specific user
func (h *WebSocketHub) SendToUser(userID int64, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for conn := range h.connections {
		if conn.userID == userID {
			select {
			case conn.send <- message:
			default:
				close(conn.send)
				delete(h.connections, conn)
			}
		}
	}
}

// WebSocketHandlers handles WebSocket connections
type WebSocketHandlers struct {
	hub              *WebSocketHub
	db               *sql.DB
	config           *config.Config
	jwtService       *auth.JWTService
	proceduralClient *procedural.ProceduralClient
	chunkStorage     *database.ChunkStorage
	zoneStorage      *database.ZoneStorage
	streamManager    *streaming.Manager
	profiler         *performance.Profiler
	upgrader         websocket.Upgrader
}

// NewWebSocketHandlers creates a new WebSocket handlers instance
func NewWebSocketHandlers(db *sql.DB, cfg *config.Config, profiler *performance.Profiler) *WebSocketHandlers {
	jwtService := auth.NewJWTService(cfg)
	proceduralClient := procedural.NewProceduralClient(cfg)
	chunkStorage := database.NewChunkStorage(db)

	// Get allowed origins from config or use defaults
	allowedOrigins := []string{
		"http://localhost:3000",
		"http://localhost:5173",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:5173",
	}

	return &WebSocketHandlers{
		hub:              NewWebSocketHub(),
		db:               db,
		config:           cfg,
		jwtService:       jwtService,
		proceduralClient: proceduralClient,
		chunkStorage:     chunkStorage,
		zoneStorage:      database.NewZoneStorage(db),
		streamManager:    streaming.NewManager(),
		profiler:         profiler,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				for _, allowed := range allowedOrigins {
					if origin == allowed {
						return true
					}
				}
				return false
			},
		},
	}
}

// HandleWebSocket handles WebSocket connection upgrades
func (h *WebSocketHandlers) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Authenticate the connection
	token, err := h.extractToken(r)
	if err != nil {
		log.Printf("WebSocket authentication failed: %v", err)
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	// Validate token
	claims, err := h.jwtService.ValidateAccessToken(token)
	if err != nil {
		log.Printf("WebSocket token validation failed: %v", err)
		http.Error(w, "Invalid token", http.StatusUnauthorized)
		return
	}

	// Negotiate protocol version
	requestedVersions := r.Header.Get("Sec-WebSocket-Protocol")
	selectedVersion := h.negotiateVersion(requestedVersions)
	if selectedVersion == "" {
		log.Printf("WebSocket version negotiation failed: requested=%s", requestedVersions)
		http.Error(w, "Unsupported protocol version", http.StatusBadRequest)
		return
	}

	// Set the selected protocol version in response headers
	responseHeaders := http.Header{}
	responseHeaders.Set("Sec-WebSocket-Protocol", selectedVersion)

	// Upgrade connection
	conn, err := h.upgrader.Upgrade(w, r, responseHeaders)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	// Create connection object
	wsConn := &WebSocketConnection{
		conn:     conn,
		userID:   claims.UserID,
		username: claims.Username,
		role:     claims.Role,
		version:  selectedVersion,
		send:     make(chan []byte, 256),
		hub:      h.hub,
	}

	// Register connection
	h.hub.register <- wsConn

	// Start connection handlers
	go wsConn.writePump()
	go wsConn.readPump(h)
}

// extractToken extracts JWT token from request (query param or header)
func (h *WebSocketHandlers) extractToken(r *http.Request) (string, error) {
	// Try query parameter first (common for WebSocket)
	token := r.URL.Query().Get("token")
	if token != "" {
		return token, nil
	}

	// Try Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && parts[0] == "Bearer" {
			return parts[1], nil
		}
	}

	return "", fmt.Errorf("missing authentication token")
}

// negotiateVersion selects the highest supported protocol version
func (h *WebSocketHandlers) negotiateVersion(requested string) string {
	if requested == "" {
		// Default to v1 if no version specified
		return ProtocolVersion1
	}

	// Parse requested versions (comma-separated)
	requestedVersions := strings.Split(requested, ",")
	for i := range requestedVersions {
		requestedVersions[i] = strings.TrimSpace(requestedVersions[i])
	}

	// Supported versions in order (highest first)
	supportedVersions := []string{ProtocolVersion1}

	// Find highest mutually supported version
	for _, supported := range supportedVersions {
		for _, requested := range requestedVersions {
			if requested == supported {
				return supported
			}
		}
	}

	return ""
}

// readPump handles incoming messages from the WebSocket connection
func (c *WebSocketConnection) readPump(handlers *WebSocketHandlers) {
	defer func() {
		c.hub.unregister <- c
		if err := c.conn.Close(); err != nil {
			log.Printf("Failed to close connection: %v", err)
		}
	}()

	if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		log.Printf("Failed to set read deadline: %v", err)
		return
	}
	c.conn.SetPongHandler(func(string) error {
		if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
			log.Printf("Failed to set read deadline in pong handler: %v", err)
			return err
		}
		return nil
	})

	for {
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Parse message
		var msg WebSocketMessage
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			c.sendError("invalid_message", "Invalid message format", "InvalidMessageFormat")
			continue
		}

		// Handle message based on type
		handlers.handleMessage(c, &msg)
	}
}

// writePump handles outgoing messages to the WebSocket connection
func (c *WebSocketConnection) writePump() {
	ticker := time.NewTicker(defaultPingInterval)
	defer func() {
		ticker.Stop()
		if err := c.conn.Close(); err != nil {
			log.Printf("Failed to close connection: %v", err)
		}
	}()

	for {
		select {
		case message, ok := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
				log.Printf("Failed to set write deadline: %v", err)
				return
			}
			if !ok {
				if err := c.conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
					log.Printf("Failed to write close message: %v", err)
				}
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			if _, err := w.Write(message); err != nil {
				if closeErr := w.Close(); closeErr != nil {
					log.Printf("Failed to close writer after write error: %v", closeErr)
				}
				return
			}

			// Send queued messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				if _, err := w.Write([]byte{'\n'}); err != nil {
					if closeErr := w.Close(); closeErr != nil {
						log.Printf("Failed to close writer after write error: %v", closeErr)
					}
					return
				}
				if _, err := w.Write(<-c.send); err != nil {
					if closeErr := w.Close(); closeErr != nil {
						log.Printf("Failed to close writer after write error: %v", closeErr)
					}
					return
				}
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
				log.Printf("Failed to set write deadline for ping: %v", err)
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// sendError sends an error message to the client
func (c *WebSocketConnection) sendError(id, errorMsg, code string) {
	errorResp := WebSocketError{
		Type:    "error",
		ID:      id,
		Error:   errorMsg,
		Message: errorMsg,
		Code:    code,
	}

	messageBytes, err := json.Marshal(errorResp)
	if err != nil {
		log.Printf("Failed to marshal error message: %v", err)
		return
	}

	select {
	case c.send <- messageBytes:
	default:
		log.Printf("Failed to send error message: channel full")
	}
}

// handleMessage routes messages to appropriate handlers
func (h *WebSocketHandlers) handleMessage(conn *WebSocketConnection, msg *WebSocketMessage) {
	switch msg.Type {
	case "ping":
		h.handlePing(conn, msg)
	case "player_move":
		h.handlePlayerMove(conn, msg)
	case "stream_subscribe":
		h.handleStreamSubscribe(conn, msg)
	case "stream_update_pose":
		h.handleStreamUpdatePose(conn, msg)
	default:
		conn.sendError(msg.ID, "Unknown message type", "UnknownMessageType")
	}
}

// handlePing responds to ping messages
func (h *WebSocketHandlers) handlePing(conn *WebSocketConnection, msg *WebSocketMessage) {
	response := WebSocketMessage{
		Type: "pong",
		ID:   msg.ID,
	}

	responseBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal pong response: %v", err)
		return
	}

	select {
	case conn.send <- responseBytes:
	default:
		log.Printf("Failed to send pong: channel full")
	}
}

// compressChunkGeometry compresses chunk geometry for transmission
func compressChunkGeometry(geometry interface{}) (interface{}, error) {
	if geometry == nil {
		return nil, nil
	}

	// Try to convert to *procedural.ChunkGeometry
	var chunkGeometry *procedural.ChunkGeometry

	switch geom := geometry.(type) {
	case *procedural.ChunkGeometry:
		chunkGeometry = geom
	case map[string]interface{}:
		// Convert map to ChunkGeometry (for database-loaded geometry)
		// This is a simplified conversion - in production we'd have better type handling
		// For now, we'll attempt to extract the necessary fields
		if geomType, ok := geom["type"].(string); ok && geomType == "ring_floor" {
			// Try to reconstruct ChunkGeometry from map
			// This is a basic implementation - we'd need proper JSON unmarshaling in production
			// For now, we'll compress what we can
			vertices, verticesOk := geom["vertices"].([]interface{})
			faces, facesOk := geom["faces"].([]interface{})

			if verticesOk && facesOk && vertices != nil && faces != nil {
				// Convert to proper types (simplified - would need full conversion in production)
				chunkGeometry = &procedural.ChunkGeometry{
					Type: geomType,
					// Note: Full conversion would require proper type assertions
					// For now, we'll skip compression for map types and compress only procedural types
				}
			}
		}
	}

	// Only compress if we have a proper ChunkGeometry
	if chunkGeometry == nil {
		// Return geometry as-is if we can't convert it
		return geometry, nil
	}

	// Compress the geometry
	compressedData, err := compression.CompressChunkGeometry(chunkGeometry)
	if err != nil {
		return nil, fmt.Errorf("failed to compress geometry: %w", err)
	}

	// Estimate uncompressed size (approximate)
	uncompressedSize := compression.EstimateUncompressedSize(chunkGeometry)

	// Format for transmission
	compressedGeometry, err := compression.FormatCompressedGeometry(compressedData, uncompressedSize)
	if err != nil {
		return nil, fmt.Errorf("failed to format compressed geometry: %w", err)
	}

	return compressedGeometry, nil
}

// ChunkData represents a single chunk in the chunk_data response
type ChunkData struct {
	ID         string         `json:"id"`                 // Format: "floor_chunk_index"
	Geometry   interface{}    `json:"geometry,omitempty"` // Geometry data (can be nil for empty chunks)
	Structures []interface{}  `json:"structures"`         // Array of structures (empty for Phase 1)
	Zones      []interface{}  `json:"zones"`              // Array of zones (empty for Phase 1)
	Metadata   *ChunkMetadata `json:"metadata,omitempty"` // Chunk metadata
}

// ChunkDataResponse represents the data payload for a chunk_data message
type ChunkDataResponse struct {
	Chunks []ChunkData `json:"chunks"`
}

// loadChunksForIDs loads chunk data for the given chunk IDs and LOD level.
// This is the server-side chunk processing pipeline that handles database lookup,
// generation, compression, and wrapping.
func (h *WebSocketHandlers) loadChunksForIDs(chunkIDs []string, lodLevel string) []ChunkData {
	if lodLevel == "" {
		lodLevel = "medium"
	}

	op := h.profiler.Start("chunk_loading")
	defer op.End()

	var chunks []ChunkData
	for _, chunkID := range chunkIDs {
		// Parse chunk ID format: "floor_chunk_index"
		chunkParts := strings.Split(chunkID, "_")
		if len(chunkParts) != 2 {
			log.Printf("Invalid chunk ID format: %s", chunkID)
			continue
		}

		floor, err := strconv.Atoi(chunkParts[0])
		if err != nil {
			log.Printf("Invalid floor in chunk ID %s: %v", chunkID, err)
			continue
		}

		chunkIndex, err := strconv.Atoi(chunkParts[1])
		if err != nil {
			log.Printf("Invalid chunk_index in chunk ID %s: %v", chunkID, err)
			continue
		}

		// Wrap chunk index to valid range (handles wrapping around ring)
		wrappedChunkIndex, err := ringmap.ValidateChunkIndex(chunkIndex)
		if err != nil {
			log.Printf("Chunk index %d cannot be wrapped: %v", chunkIndex, err)
			continue
		}

		// Use wrapped chunk index for all operations
		chunkIndex = wrappedChunkIndex

		// Check if chunk exists in database using storage layer
		storedMetadata, err := h.chunkStorage.GetChunkMetadata(floor, chunkIndex)
		var chunk ChunkData

		if err != nil {
			log.Printf("Error querying chunk %s: %v", chunkID, err)
			// Return empty chunk on database error
			chunk = ChunkData{
				ID:         chunkID,
				Geometry:   nil,
				Structures: []interface{}{},
				Zones:      []interface{}{},
				Metadata: &ChunkMetadata{
					ID:           chunkID,
					Floor:        floor,
					ChunkIndex:   chunkIndex,
					Version:      1,
					LastModified: time.Time{},
					IsDirty:      false,
				},
			}
		} else if storedMetadata == nil {
			// Chunk doesn't exist - generate it using procedural service
			genResponse, err := h.proceduralClient.GenerateChunk(floor, chunkIndex, lodLevel, nil)
			if err != nil {
				log.Printf("Failed to generate chunk %s: %v", chunkID, err)
				// Return empty chunk on generation failure
				chunk = ChunkData{
					ID:         chunkID,
					Geometry:   nil,
					Structures: []interface{}{},
					Zones:      []interface{}{},
					Metadata: &ChunkMetadata{
						ID:           chunkID,
						Floor:        floor,
						ChunkIndex:   chunkIndex,
						Version:      1,
						LastModified: time.Time{},
						IsDirty:      false,
					},
				}
			} else {
				// Store the generated chunk in the database
				if err := h.chunkStorage.StoreChunk(floor, chunkIndex, genResponse, nil); err != nil {
					log.Printf("Failed to store chunk %s: %v", chunkID, err)
				}

				// Convert procedural service response to chunk data
				chunk = ChunkData{
					ID:         chunkID,
					Geometry:   genResponse.Geometry,
					Structures: genResponse.Structures,
					Zones:      genResponse.Zones,
					Metadata: &ChunkMetadata{
						ID:           chunkID,
						Floor:        floor,
						ChunkIndex:   chunkIndex,
						Version:      genResponse.Chunk.Version,
						LastModified: time.Now(),
						IsDirty:      false,
					},
				}
			}
		} else {
			// Chunk exists in database - check if version is current
			if storedMetadata.Version < CurrentGeometryVersion {
				// Chunk is outdated - regenerate it
				log.Printf("Chunk %s has outdated version %d (current: %d), regenerating...", chunkID, storedMetadata.Version, CurrentGeometryVersion)
				genResponse, err := h.proceduralClient.GenerateChunk(floor, chunkIndex, lodLevel, nil)
				if err != nil {
					log.Printf("Failed to regenerate outdated chunk %s: %v", chunkID, err)
					// Fall back to loading old geometry if regeneration fails
					geometry, err := h.chunkStorage.ConvertPostGISToGeometry(storedMetadata.ID)
					if err != nil {
						log.Printf("Error loading geometry for chunk %s: %v", chunkID, err)
					}
					metadata := ChunkMetadata{
						ID:           chunkID,
						Floor:        storedMetadata.Floor,
						ChunkIndex:   storedMetadata.ChunkIndex,
						Version:      storedMetadata.Version,
						LastModified: storedMetadata.LastModified,
						IsDirty:      storedMetadata.IsDirty,
					}
					chunk = ChunkData{
						ID:         chunkID,
						Geometry:   geometry,
						Structures: []interface{}{},
						Zones:      []interface{}{},
						Metadata:   &metadata,
					}
				} else {
					// Store the regenerated chunk in the database
					if err := h.chunkStorage.StoreChunk(floor, chunkIndex, genResponse, nil); err != nil {
						log.Printf("Failed to store regenerated chunk %s: %v", chunkID, err)
					}
					// Convert procedural service response to chunk data
					chunk = ChunkData{
						ID:         chunkID,
						Geometry:   genResponse.Geometry,
						Structures: genResponse.Structures,
						Zones:      genResponse.Zones,
						Metadata: &ChunkMetadata{
							ID:           chunkID,
							Floor:        floor,
							ChunkIndex:   chunkIndex,
							Version:      genResponse.Chunk.Version,
							LastModified: time.Now(),
							IsDirty:      false,
						},
					}
				}
			} else {
				// Chunk version is current - load it from database
				geometry, err := h.chunkStorage.ConvertPostGISToGeometry(storedMetadata.ID)
				if err != nil {
					log.Printf("Error loading geometry for chunk %s: %v", chunkID, err)
				}

				metadata := ChunkMetadata{
					ID:           chunkID,
					Floor:        storedMetadata.Floor,
					ChunkIndex:   storedMetadata.ChunkIndex,
					Version:      storedMetadata.Version,
					LastModified: storedMetadata.LastModified,
					IsDirty:      storedMetadata.IsDirty,
				}

				chunk = ChunkData{
					ID:         chunkID,
					Geometry:   geometry,
					Structures: []interface{}{},
					Zones:      []interface{}{},
					Metadata:   &metadata,
				}
			}
		}

		// Compress geometry if present
		if chunk.Geometry != nil {
			if compressedGeom, ok := chunk.Geometry.(*compression.CompressedGeometry); ok {
				// Already compressed
				compressionRatio := float64(compressedGeom.UncompressedSize) / float64(compressedGeom.Size)
				log.Printf("Chunk %s geometry already compressed (size: %d bytes, ratio: %.2f:1)",
					chunkID, compressedGeom.Size, compressionRatio)
			} else {
				// Compress the geometry
				var chunkGeometry *procedural.ChunkGeometry
				switch geom := chunk.Geometry.(type) {
				case *procedural.ChunkGeometry:
					chunkGeometry = geom
				case map[string]interface{}:
					// Skip compression for map types (database-loaded geometry)
					log.Printf("Chunk %s geometry is map type, skipping compression", chunkID)
				default:
					log.Printf("Chunk %s geometry has unknown type, skipping compression", chunkID)
				}

				if chunkGeometry != nil {
					uncompressedSize := compression.EstimateUncompressedSize(chunkGeometry)
					compressedGeometry, err := compressChunkGeometry(chunk.Geometry)
					if err != nil {
						log.Printf("Failed to compress geometry for chunk %s: %v", chunkID, err)
					} else {
						if compressedGeom, ok := compressedGeometry.(*compression.CompressedGeometry); ok {
							compressionRatio := float64(compressedGeom.UncompressedSize) / float64(compressedGeom.Size)
							log.Printf("✓ Compressed chunk %s geometry: %d → %d bytes (%.2f:1 ratio, estimated uncompressed: %d bytes)",
								chunkID, compressedGeom.UncompressedSize, compressedGeom.Size, compressionRatio, uncompressedSize)
						} else {
							log.Printf("✓ Compressed chunk %s geometry (estimated uncompressed: %d bytes)", chunkID, uncompressedSize)
						}
						chunk.Geometry = compressedGeometry
					}
				}
			}
		}

		chunks = append(chunks, chunk)
	}

	return chunks
}

// sendChunkData sends chunk data to a WebSocket connection
func (h *WebSocketHandlers) sendChunkData(conn *WebSocketConnection, chunks []ChunkData, messageType string, messageID string) {
	response := WebSocketMessage{
		Type: messageType,
		ID:   messageID,
	}

	responseData := ChunkDataResponse{
		Chunks: chunks,
	}

	responseDataBytes, err := json.Marshal(responseData)
	if err != nil {
		log.Printf("Failed to marshal chunk data response: %v", err)
		return
	}

	response.Data = responseDataBytes

	responseBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal %s response: %v", messageType, err)
		return
	}

	select {
	case conn.send <- responseBytes:
	default:
		log.Printf("Failed to send %s: channel full", messageType)
	}
}

// handleStreamSubscribe registers a server-driven streaming subscription.
func (h *WebSocketHandlers) handleStreamSubscribe(conn *WebSocketConnection, msg *WebSocketMessage) {
	if h.streamManager == nil {
		conn.sendError(msg.ID, "Streaming manager unavailable", "InternalError")
		return
	}

	var req streaming.SubscriptionRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		conn.sendError(msg.ID, "Invalid stream_subscribe payload", "InvalidMessageFormat")
		return
	}

	log.Printf("[Stream] stream_subscribe received: user_id=%d, ring_position=%d, active_floor=%d, radius=%d, include_chunks=%v, include_zones=%v",
		conn.userID, req.Pose.RingPosition, req.Pose.ActiveFloor, req.RadiusMeters, req.IncludeChunks, req.IncludeZones)

	op := h.profiler.Start("stream_subscribe")
	plan, err := h.streamManager.PlanSubscription(conn.userID, req)
	op.End()
	if err != nil {
		log.Printf("[Stream] PlanSubscription failed: %v", err)
		conn.sendError(msg.ID, err.Error(), "InvalidSubscriptionRequest")
		return
	}

	log.Printf("[Stream] PlanSubscription success: subscription_id=%s, chunk_count=%d, chunk_ids=%v",
		plan.SubscriptionID, len(plan.ChunkIDs), plan.ChunkIDs)

	response := WebSocketMessage{
		Type: "stream_ack",
		ID:   msg.ID,
	}

	ackPayload := struct {
		SubscriptionID string   `json:"subscription_id"`
		ChunkIDs       []string `json:"chunk_ids,omitempty"`
		Message        string   `json:"message"`
	}{
		SubscriptionID: plan.SubscriptionID,
		ChunkIDs:       plan.ChunkIDs,
		Message:        "Streaming subscription registered. Chunk/zone deltas will be delivered in upcoming revisions.",
	}

	data, err := json.Marshal(ackPayload)
	if err != nil {
		log.Printf("Failed to marshal stream_ack payload: %v", err)
		conn.sendError(msg.ID, "Failed to prepare stream acknowledgement", "InternalError")
		return
	}

	response.Data = data
	bytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal stream_ack response: %v", err)
		conn.sendError(msg.ID, "Failed to prepare stream acknowledgement", "InternalError")
		return
	}

	select {
	case conn.send <- bytes:
	default:
		log.Printf("Failed to send stream_ack: channel full")
	}

	// Phase 2: Server-side chunk delivery - send initial chunks asynchronously
	if req.IncludeChunks && len(plan.ChunkIDs) > 0 {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Stream] Recovered from panic while sending chunks for subscription %s: %v", plan.SubscriptionID, r)
				}
			}()
			log.Printf("[Stream] Loading %d chunks for subscription %s: %v", len(plan.ChunkIDs), plan.SubscriptionID, plan.ChunkIDs)
			// Load chunks using server-side pipeline (database lookup, generation, compression)
			chunks := h.loadChunksForIDs(plan.ChunkIDs, "medium")
			log.Printf("[Stream] Loaded %d chunks (requested %d) for subscription %s", len(chunks), len(plan.ChunkIDs), plan.SubscriptionID)
			if len(chunks) > 0 {
				// Send chunks as stream_delta message (server-driven format)
				h.sendChunkData(conn, chunks, "stream_delta", "")
				log.Printf("[Stream] Sent %d initial chunks for subscription %s", len(chunks), plan.SubscriptionID)
			} else {
				log.Printf("[Stream] WARNING: No chunks loaded for subscription %s (requested %d chunk IDs)", plan.SubscriptionID, len(plan.ChunkIDs))
			}
		}()
	} else {
		log.Printf("[Stream] Skipping chunk delivery: include_chunks=%v, chunk_count=%d", req.IncludeChunks, len(plan.ChunkIDs))
	}

	// Phase 2: Server-side zone delivery - send initial zones asynchronously
	if req.IncludeZones {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Stream] Recovered from panic while sending zones for subscription %s: %v", plan.SubscriptionID, r)
				}
			}()
			// Compute bounding box for zone query
			bbox := streaming.ComputeZoneBoundingBox(req.Pose, req.RadiusMeters, req.WidthMeters)
			zones := h.loadZonesForArea(bbox, req.Pose)
			if len(zones) > 0 {
				// Extract zone IDs and update subscription
				zoneIDs := make([]int64, len(zones))
				for i, zone := range zones {
					zoneIDs[i] = zone.ID
				}
				// Update subscription with zone IDs (for delta computation)
				if delta, err := h.streamManager.ComputeZoneDelta(plan.SubscriptionID, zoneIDs); err != nil {
					log.Printf("Failed to update zone IDs in subscription: %v", err)
				} else if len(delta.AddedZoneIDs) > 0 {
					log.Printf("Initial zone subscription: %d zones added", len(delta.AddedZoneIDs))
				}

				// Send zones as stream_delta message (server-driven format)
				h.sendZoneData(conn, zones, "stream_delta", "")
				log.Printf("Sent %d initial zones for subscription %s", len(zones), plan.SubscriptionID)
			}
		}()
	}
}

// StreamUpdatePoseData represents the data payload for a stream_update_pose message
type StreamUpdatePoseData struct {
	SubscriptionID string               `json:"subscription_id"`
	Pose           streaming.CameraPose `json:"pose"`
}

// handleStreamUpdatePose handles pose update messages and sends zone/chunk deltas.
func (h *WebSocketHandlers) handleStreamUpdatePose(conn *WebSocketConnection, msg *WebSocketMessage) {
	if h.streamManager == nil {
		conn.sendError(msg.ID, "Streaming manager unavailable", "InternalError")
		return
	}

	var req StreamUpdatePoseData
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		conn.sendError(msg.ID, "Invalid stream_update_pose payload", "InvalidMessageFormat")
		return
	}

	if req.SubscriptionID == "" {
		conn.sendError(msg.ID, "subscription_id is required", "InvalidMessageFormat")
		return
	}

	log.Printf("[Stream] stream_update_pose received: user_id=%d, subscription_id=%s, ring_position=%d, arc_length=%.0f, theta=%.6f, r=%.2f, z=%.2f, active_floor=%d",
		conn.userID, req.SubscriptionID, req.Pose.RingPosition, req.Pose.ArcLength, req.Pose.Theta, req.Pose.R, req.Pose.Z, req.Pose.ActiveFloor)

	// Update pose and get chunk deltas
	op := h.profiler.Start("stream_update_pose")
	chunkDelta, err := h.streamManager.UpdatePose(conn.userID, req.SubscriptionID, req.Pose)
	op.End()
	if err != nil {
		log.Printf("[Stream] UpdatePose failed: %v", err)
		conn.sendError(msg.ID, err.Error(), "InvalidSubscriptionRequest")
		return
	}

	// Get subscription to check what's included
	subscription, err := h.streamManager.GetSubscription(req.SubscriptionID)
	if err != nil {
		log.Printf("[Stream] GetSubscription failed: %v", err)
		conn.sendError(msg.ID, err.Error(), "InvalidSubscriptionRequest")
		return
	}

	// Send chunk deltas if chunks are included and there are changes
	if subscription.Request.IncludeChunks {
		if len(chunkDelta.AddedChunks) > 0 || len(chunkDelta.RemovedChunks) > 0 {
			log.Printf("[Stream] Chunk delta: added=%d, removed=%d", len(chunkDelta.AddedChunks), len(chunkDelta.RemovedChunks))

			// Load and send added chunks
			if len(chunkDelta.AddedChunks) > 0 {
				go func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[Stream] Recovered from panic while sending chunk deltas for subscription %s: %v", req.SubscriptionID, r)
						}
					}()
					chunks := h.loadChunksForIDs(chunkDelta.AddedChunks, "medium")
					if len(chunks) > 0 {
						h.sendChunkData(conn, chunks, "stream_delta", "")
						log.Printf("[Stream] Sent %d added chunks for subscription %s", len(chunks), req.SubscriptionID)
					}
				}()
			}

			// Note: Removed chunks are communicated via the delta structure
			// The client should handle removal based on the delta message
			if len(chunkDelta.RemovedChunks) > 0 {
				log.Printf("[Stream] Chunks to remove: %v", chunkDelta.RemovedChunks)
			}
		}
	}

	// Handle zone deltas if zones are included
	if subscription.Request.IncludeZones && subscription.ZoneBoundingBox != nil {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Stream] Recovered from panic while updating zones for subscription %s: %v", req.SubscriptionID, r)
				}
			}()
			// Recompute bounding box (already updated in UpdatePose)
			bbox := *subscription.ZoneBoundingBox

			// Load zones for new bounding box
			op := h.profiler.Start("zone_query")
			zones := h.loadZonesForArea(bbox, req.Pose)
			op.End()

			// Extract zone IDs
			newZoneIDs := make([]int64, len(zones))
			for i, zone := range zones {
				newZoneIDs[i] = zone.ID
			}

			// Compute zone delta
			op = h.profiler.Start("delta_computation")
			zoneDelta, err := h.streamManager.ComputeZoneDelta(req.SubscriptionID, newZoneIDs)
			op.End()
			if err != nil {
				log.Printf("[Stream] ComputeZoneDelta failed: %v", err)
				return
			}

			// Send zone deltas if there are changes
			if len(zoneDelta.AddedZoneIDs) > 0 || len(zoneDelta.RemovedZoneIDs) > 0 {
				log.Printf("[Stream] Zone delta: added=%d, removed=%d", len(zoneDelta.AddedZoneIDs), len(zoneDelta.RemovedZoneIDs))

				// Load and send added zones
				if len(zoneDelta.AddedZoneIDs) > 0 {
					addedZones := make([]database.Zone, 0, len(zoneDelta.AddedZoneIDs))
					zoneMap := make(map[int64]database.Zone)
					for _, zone := range zones {
						zoneMap[zone.ID] = zone
					}
					for _, zoneID := range zoneDelta.AddedZoneIDs {
						if zone, ok := zoneMap[zoneID]; ok {
							addedZones = append(addedZones, zone)
						}
					}
					if len(addedZones) > 0 {
						h.sendZoneData(conn, addedZones, "stream_delta", "")
						log.Printf("[Stream] Sent %d added zones for subscription %s", len(addedZones), req.SubscriptionID)
					}
				}

				// Note: Removed zones are communicated via the delta structure
				if len(zoneDelta.RemovedZoneIDs) > 0 {
					log.Printf("[Stream] Zones to remove: %v", zoneDelta.RemovedZoneIDs)
				}
			}
		}()
	}

	// Send acknowledgment
	response := WebSocketMessage{
		Type: "stream_pose_ack",
		ID:   msg.ID,
	}

	ackPayload := struct {
		SubscriptionID string                `json:"subscription_id"`
		ChunkDelta     *streaming.ChunkDelta `json:"chunk_delta,omitempty"`
		Message        string                `json:"message"`
	}{
		SubscriptionID: req.SubscriptionID,
		ChunkDelta:     chunkDelta,
		Message:        "Pose updated. Zone deltas will be delivered asynchronously.",
	}

	data, err := json.Marshal(ackPayload)
	if err != nil {
		log.Printf("Failed to marshal stream_pose_ack payload: %v", err)
		conn.sendError(msg.ID, "Failed to prepare pose update acknowledgement", "InternalError")
		return
	}

	response.Data = data
	bytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal stream_pose_ack response: %v", err)
		conn.sendError(msg.ID, "Failed to prepare pose update acknowledgement", "InternalError")
		return
	}

	select {
	case conn.send <- bytes:
		log.Printf("[Stream] Sent stream_pose_ack for subscription %s", req.SubscriptionID)
	default:
		log.Printf("Failed to send stream_pose_ack: channel full")
	}
}

// loadZonesForArea loads zones for the given bounding box.
// This is the server-side zone processing pipeline that handles database lookup,
// active-floor filtering, and full-ring/system-zone retention.
// Supports both legacy and new coordinate systems.
func (h *WebSocketHandlers) loadZonesForArea(bbox streaming.ZoneBoundingBox, pose streaming.CameraPose) []database.Zone {
	if h.zoneStorage == nil {
		log.Printf("Zone storage unavailable")
		return nil
	}

	var zones []database.Zone
	var err error

	// Use new coordinate system if available (preferred)
	if bbox.MinS != 0 || bbox.MaxS != 0 || pose.ArcLength != 0 || pose.Theta != 0 {
		// Use RingArc coordinates
		if bbox.MinS != 0 || bbox.MaxS != 0 {
			zones, err = h.zoneStorage.ListZonesByRingArc(bbox.Floor, bbox.MinS, bbox.MinR, bbox.MinZ, bbox.MaxS, bbox.MaxR, bbox.MaxZ)
			if err != nil {
				log.Printf("Failed to load zones for RingArc area: %v", err)
				return nil
			}
			log.Printf("[Stream] Loaded %d zones for floor %d using RingArc coordinates (s: %.0f-%.0f, r: %.0f-%.0f)",
				len(zones), bbox.Floor, bbox.MinS, bbox.MaxS, bbox.MinR, bbox.MaxR)
		} else {
			// Convert RingPolar to RingArc for query
			// This is a fallback - should use RingArc directly when available
			log.Printf("[Stream] Warning: Using RingPolar coordinates, should use RingArc directly")
			// For now, fall back to legacy coordinates
			if bbox.MinX >= bbox.MaxX || bbox.MinY >= bbox.MaxY {
				log.Printf("Invalid zone bounding box: minX=%f, maxX=%f, minY=%f, maxY=%f", bbox.MinX, bbox.MaxX, bbox.MinY, bbox.MaxY)
				return nil
			}
			zones, err = h.zoneStorage.ListZonesByArea(bbox.Floor, bbox.MinX, bbox.MinY, bbox.MaxX, bbox.MaxY)
			if err != nil {
				log.Printf("Failed to load zones for RingPolar area: %v", err)
				return nil
			}
		}
	} else {
		// Use legacy coordinate system
		// Validate bounding box
		if bbox.MinX >= bbox.MaxX || bbox.MinY >= bbox.MaxY {
			log.Printf("Invalid zone bounding box: minX=%f, maxX=%f, minY=%f, maxY=%f", bbox.MinX, bbox.MaxX, bbox.MinY, bbox.MaxY)
			return nil
		}

		// Load zones from database using existing storage method
		zones, err = h.zoneStorage.ListZonesByArea(bbox.Floor, bbox.MinX, bbox.MinY, bbox.MaxX, bbox.MaxY)
		if err != nil {
			log.Printf("Failed to load zones for area: %v", err)
			return nil
		}
		log.Printf("[Stream] Loaded %d zones for floor %d using legacy coordinates (x: %.0f-%.0f, y: %.0f-%.0f)",
			len(zones), bbox.Floor, bbox.MinX, bbox.MaxX, bbox.MinY, bbox.MaxY)
	}

	return zones
}

// ZoneDataResponse represents the data payload for a zone_data or stream_delta message with zones.
type ZoneDataResponse struct {
	Zones []database.Zone `json:"zones"`
}

// sendZoneData sends zone data to a WebSocket connection.
func (h *WebSocketHandlers) sendZoneData(conn *WebSocketConnection, zones []database.Zone, messageType string, messageID string) {
	// Use recover to handle panics from closed channels (e.g., during test cleanup)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Failed to send %s: connection closed (panic: %v)", messageType, r)
		}
	}()
	response := WebSocketMessage{
		Type: messageType,
		ID:   messageID,
	}

	responseData := ZoneDataResponse{
		Zones: zones,
	}

	responseDataBytes, err := json.Marshal(responseData)
	if err != nil {
		log.Printf("Failed to marshal zone data response: %v", err)
		return
	}

	response.Data = responseDataBytes

	responseBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal %s response: %v", messageType, err)
		return
	}

	select {
	case conn.send <- responseBytes:
	default:
		log.Printf("Failed to send %s: channel full", messageType)
	}
}

// PlayerMoveData represents the data payload for a player_move message
type PlayerMoveData struct {
	Position Position `json:"position"`           // Ring position (X, Y)
	Floor    int      `json:"floor"`              // Floor level
	Rotation float64  `json:"rotation,omitempty"` // Optional rotation in degrees
}

// handlePlayerMove handles player movement updates
func (h *WebSocketHandlers) handlePlayerMove(conn *WebSocketConnection, msg *WebSocketMessage) {
	// Parse request data
	var moveData PlayerMoveData
	if err := json.Unmarshal(msg.Data, &moveData); err != nil {
		conn.sendError(msg.ID, "Invalid player_move format", "InvalidMessageFormat")
		return
	}

	// Validate and wrap position
	// X position wraps around the ring (0 to 264,000,000 meters)
	wrappedX := ringmap.ValidatePosition(int64(moveData.Position.X))
	moveData.Position.X = float64(wrappedX)

	// Validate floor range (-2 to 15 based on schema)
	if moveData.Floor < -2 || moveData.Floor > 15 {
		conn.sendError(msg.ID, "Invalid floor (must be -2 to 15)", "InvalidMessageFormat")
		return
	}

	// Update player position in database
	query := `
		UPDATE players
		SET current_position = POINT($1, $2),
		    current_floor = $3
		WHERE id = $4
		RETURNING id
	`
	var updatedID int64
	err := h.db.QueryRow(query, moveData.Position.X, moveData.Position.Y, moveData.Floor, conn.userID).Scan(&updatedID)
	if err == sql.ErrNoRows {
		conn.sendError(msg.ID, "Player not found", "NotFound")
		return
	}
	if err != nil {
		log.Printf("Failed to update player position: %v", err)
		conn.sendError(msg.ID, "Failed to update position", "InternalError")
		return
	}

	// Send acknowledgment
	response := WebSocketMessage{
		Type: "player_move_ack",
		ID:   msg.ID,
		Data: json.RawMessage(`{"success": true}`),
	}

	responseBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal player_move_ack: %v", err)
		return
	}

	select {
	case conn.send <- responseBytes:
	default:
		log.Printf("Failed to send player_move_ack: channel full")
	}

	// TODO: Broadcast player_moved message to other players in the same area
	// This will be implemented when we add spatial awareness/broadcasting
}

// GetHub returns the WebSocket hub (for use in other packages)
func (h *WebSocketHandlers) GetHub() *WebSocketHub {
	return h.hub
}
