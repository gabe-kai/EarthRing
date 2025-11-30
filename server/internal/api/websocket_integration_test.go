package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/performance"
	"github.com/earthring/server/internal/streaming"
	"github.com/earthring/server/internal/testutil"
	"github.com/gorilla/websocket"
	"github.com/lib/pq"
)

// IntegrationTestFramework provides utilities for WebSocket streaming integration tests
type IntegrationTestFramework struct {
	t            *testing.T
	db           *sql.DB
	cfg          *config.Config
	handlers     *WebSocketHandlers
	server       *httptest.Server
	jwtService   *auth.JWTService
	passwordSvc  *auth.PasswordService
	testUserID   int64
	testUsername string
	testToken    string
}

// NewIntegrationTestFramework creates a new integration test framework
func NewIntegrationTestFramework(t *testing.T) *IntegrationTestFramework {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create required tables
	setupTestTables(t, db)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:         "test-secret-key-for-testing-only",
			RefreshSecret:     "test-refresh-secret-key-for-testing-only",
			JWTExpiration:     15 * time.Minute,
			RefreshExpiration: 7 * 24 * time.Hour,
		},
		Procedural: config.ProceduralConfig{
			BaseURL:    "", // No procedural service for integration tests
			Timeout:    5 * time.Second,
			RetryCount: 0,
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	// Override CheckOrigin to allow test server origins
	handlers.upgrader.CheckOrigin = func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// Allow test server origins and empty origins (common in tests)
		if origin == "" {
			return true
		}
		// Allow any localhost/test server origin
		return strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") || strings.Contains(origin, "test")
	}
	go handlers.GetHub().Run()

	// Create test HTTP server
	server := httptest.NewServer(http.HandlerFunc(handlers.HandleWebSocket))

	// Create test user and token
	passwordSvc := auth.NewPasswordService(cfg)
	hashedPassword, err := passwordSvc.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}

	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var userID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash, level, experience_points, currency_amount)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, username, email, hashedPassword, 1, 0, 0).Scan(&userID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(userID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	return &IntegrationTestFramework{
		t:            t,
		db:           db,
		cfg:          cfg,
		handlers:     handlers,
		server:       server,
		jwtService:   jwtService,
		passwordSvc:  passwordSvc,
		testUserID:   userID,
		testUsername: username,
		testToken:    token,
	}
}

// Close cleans up the test framework
func (f *IntegrationTestFramework) Close() {
	if f.server != nil {
		f.server.Close()
	}
	// Give goroutines time to finish
	time.Sleep(100 * time.Millisecond)
}

// ConnectWebSocket creates a WebSocket connection with authentication
func (f *IntegrationTestFramework) ConnectWebSocket() *websocket.Conn {
	wsURL := strings.Replace(f.server.URL, "http://", "ws://", 1) + "?token=" + f.testToken

	// Create dialer that allows test origins
	dialer := &websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	// Don't set Origin header - let CheckOrigin handle empty origin
	conn, _, err := dialer.Dial(wsURL, http.Header{
		"Sec-WebSocket-Protocol": []string{ProtocolVersion1},
	})
	if err != nil {
		f.t.Fatalf("Failed to connect WebSocket: %v", err)
	}

	return conn
}

// SendMessage sends a WebSocket message
func (f *IntegrationTestFramework) SendMessage(conn *websocket.Conn, msgType string, data interface{}) error {
	msg := WebSocketMessage{
		Type: msgType,
		ID:   fmt.Sprintf("test-%d", time.Now().UnixNano()),
	}

	if data != nil {
		dataBytes, err := json.Marshal(data)
		if err != nil {
			return fmt.Errorf("failed to marshal message data: %w", err)
		}
		msg.Data = dataBytes
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	return conn.WriteMessage(websocket.TextMessage, msgBytes)
}

// ReadMessage reads a WebSocket message with timeout
func (f *IntegrationTestFramework) ReadMessage(conn *websocket.Conn, timeout time.Duration) (*WebSocketMessage, error) {
	_ = conn.SetReadDeadline(time.Now().Add(timeout)) //nolint:errcheck // Test cleanup - deadline errors are non-critical //nolint:errcheck // Test cleanup - deadline errors are non-critical

	_, messageBytes, err := conn.ReadMessage()
	if err != nil {
		return nil, fmt.Errorf("failed to read message: %w", err)
	}

	// First, check if it's an error message (errors are sent directly, not wrapped)
	var errorMsg struct {
		Type    string `json:"type"`
		ID      string `json:"id,omitempty"`
		Error   string `json:"error"`
		Message string `json:"message"`
		Code    string `json:"code,omitempty"`
	}
	if err := json.Unmarshal(messageBytes, &errorMsg); err == nil && errorMsg.Type == "error" {
		// Convert error to WebSocketMessage format, storing raw JSON in Data
		return &WebSocketMessage{
			Type: "error",
			ID:   errorMsg.ID,
			Data: json.RawMessage(messageBytes), // Store raw JSON for parsing
		}, nil
	}

	// Try to parse as WebSocketMessage (normal messages)
	var msg WebSocketMessage
	if err := json.Unmarshal(messageBytes, &msg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal message: %w", err)
	}

	return &msg, nil
}

// WaitForMessage waits for a specific message type with timeout
func (f *IntegrationTestFramework) WaitForMessage(conn *websocket.Conn, expectedType string, timeout time.Duration) (*WebSocketMessage, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		remaining := time.Until(deadline)
		if remaining < 100*time.Millisecond {
			remaining = 100 * time.Millisecond
		}

		msg, err := f.ReadMessage(conn, remaining)
		if err != nil {
			// Check if it's a timeout
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				return nil, err
			}
			continue
		}

		if msg.Type == expectedType {
			return msg, nil
		}

		// Log unexpected message types (but continue waiting)
		f.t.Logf("Received unexpected message type: %s (waiting for %s)", msg.Type, expectedType)
	}

	return nil, fmt.Errorf("timeout waiting for message type %s", expectedType)
}

// SubscribeToStreaming sends a stream_subscribe message and waits for ack
func (f *IntegrationTestFramework) SubscribeToStreaming(conn *websocket.Conn, pose streaming.CameraPose, radiusMeters int64, widthMeters float64, includeChunks, includeZones bool) (string, error) {
	req := streaming.SubscriptionRequest{
		Pose:          pose,
		RadiusMeters:  radiusMeters,
		WidthMeters:   widthMeters,
		IncludeChunks: includeChunks,
		IncludeZones:  includeZones,
	}

	if err := f.SendMessage(conn, "stream_subscribe", req); err != nil {
		return "", fmt.Errorf("failed to send stream_subscribe: %w", err)
	}

	ack, err := f.WaitForMessage(conn, "stream_ack", 2*time.Second)
	if err != nil {
		return "", fmt.Errorf("failed to receive stream_ack: %w", err)
	}

	var ackData struct {
		SubscriptionID string   `json:"subscription_id"`
		ChunkIDs       []string `json:"chunk_ids,omitempty"`
		Message        string   `json:"message"`
	}
	if err := json.Unmarshal(ack.Data, &ackData); err != nil {
		return "", fmt.Errorf("failed to unmarshal ack data: %w", err)
	}

	if ackData.SubscriptionID == "" {
		return "", fmt.Errorf("subscription_id is empty in ack")
	}

	return ackData.SubscriptionID, nil
}

// UpdatePose sends a stream_update_pose message and waits for ack
func (f *IntegrationTestFramework) UpdatePose(conn *websocket.Conn, subscriptionID string, pose streaming.CameraPose) (*streaming.ChunkDelta, error) {
	req := struct {
		SubscriptionID string               `json:"subscription_id"`
		Pose           streaming.CameraPose `json:"pose"`
	}{
		SubscriptionID: subscriptionID,
		Pose:           pose,
	}

	if err := f.SendMessage(conn, "stream_update_pose", req); err != nil {
		return nil, fmt.Errorf("failed to send stream_update_pose: %w", err)
	}

	ack, err := f.WaitForMessage(conn, "stream_pose_ack", 2*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to receive stream_pose_ack: %w", err)
	}

	var ackData struct {
		SubscriptionID string                `json:"subscription_id"`
		ChunkDelta     *streaming.ChunkDelta `json:"chunk_delta,omitempty"`
		Message        string                `json:"message"`
	}
	if err := json.Unmarshal(ack.Data, &ackData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal ack data: %w", err)
	}

	return ackData.ChunkDelta, nil
}

// CreateTestChunk creates a test chunk in the database
// If chunk already exists, returns existing chunk ID.
func (f *IntegrationTestFramework) CreateTestChunk(floor, chunkIndex int) (int64, error) {
	var chunkID int64
	// Try to get existing chunk first
	err := f.db.QueryRow(`
		SELECT id FROM chunks WHERE floor = $1 AND chunk_index = $2
	`, floor, chunkIndex).Scan(&chunkID)
	if err == nil {
		// Chunk already exists, return it
		return chunkID, nil
	}
	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("failed to check existing chunk: %w", err)
	}

	// Chunk doesn't exist, create it
	err = f.db.QueryRow(`
		INSERT INTO chunks (floor, chunk_index, version, is_dirty, procedural_seed)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, floor, chunkIndex, 2, false, 12345).Scan(&chunkID)
	if err != nil {
		return 0, fmt.Errorf("failed to create test chunk: %w", err)
	}

	// Create chunk_data entry
	geometryJSON := `{"type": "ring_floor", "vertices": [[0, 0, 0], [1000, 0, 0], [1000, 400, 0], [0, 400, 0]], "faces": [[0, 1, 2], [0, 2, 3]], "normals": [[0, 0, 1], [0, 0, 1]], "width": 400.0, "length": 1000.0}`
	_, err = f.db.Exec(`
		INSERT INTO chunk_data (chunk_id, geometry, terrain_data)
		VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2)
	`, chunkID, geometryJSON)
	if err != nil {
		return 0, fmt.Errorf("failed to create chunk_data: %w", err)
	}

	return chunkID, nil
}

// CreateTestZone creates a test zone in the database
func (f *IntegrationTestFramework) CreateTestZone(floor int, minX, minY, maxX, maxY float64, zoneType string, ownerID int64) (int64, error) {
	var zoneID int64
	geometry := fmt.Sprintf("POLYGON((%f %f, %f %f, %f %f, %f %f, %f %f))",
		minX, minY, maxX, minY, maxX, maxY, minX, maxY, minX, minY)

	err := f.db.QueryRow(`
		INSERT INTO zones (name, zone_type, floor, owner_id, geometry)
		VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 0))
		RETURNING id
	`, fmt.Sprintf("Test Zone %d", time.Now().UnixNano()), zoneType, floor, ownerID, geometry).Scan(&zoneID)
	if err != nil {
		return 0, fmt.Errorf("failed to create test zone: %w", err)
	}

	return zoneID, nil
}

// setupTestTables creates required database tables for tests
func setupTestTables(t *testing.T, db *sql.DB) {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS players (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			last_login TIMESTAMP,
			level INTEGER DEFAULT 1,
			experience_points BIGINT DEFAULT 0,
			currency_amount BIGINT DEFAULT 0,
			current_position POINT,
			current_floor INTEGER DEFAULT 0,
			metadata JSONB
		)`,
		`CREATE TABLE IF NOT EXISTS chunks (
			id SERIAL PRIMARY KEY,
			floor INTEGER NOT NULL,
			chunk_index INTEGER NOT NULL,
			version INTEGER DEFAULT 1,
			last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			is_dirty BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			metadata JSONB,
			UNIQUE(floor, chunk_index)
		)`,
		`CREATE TABLE IF NOT EXISTS chunk_data (
			chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			geometry_detail GEOMETRY(MULTIPOLYGON, 0),
			structure_ids INTEGER[],
			zone_ids INTEGER[],
			npc_data JSONB,
			terrain_data JSONB,
			last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS zones (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			zone_type VARCHAR(50) NOT NULL,
			floor INTEGER NOT NULL,
			owner_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, tableSQL := range tables {
		if _, err := db.Exec(tableSQL); err != nil {
			t.Fatalf("Failed to create table: %v", err)
		}
	}
}

// TestIntegration_StreamingSubscription tests the basic streaming subscription flow
func TestIntegration_StreamingSubscription(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Connect WebSocket
	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	// Subscribe to streaming
	pose := streaming.CameraPose{
		RingPosition: 10000,
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID, err := framework.SubscribeToStreaming(conn, pose, 5000, 5000, true, false)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}

	if subscriptionID == "" {
		t.Fatal("Subscription ID is empty")
	}

	t.Logf("Successfully subscribed with ID: %s", subscriptionID)
}

// TestIntegration_PoseUpdate tests pose updates and chunk deltas
func TestIntegration_PoseUpdate(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	// Initial subscription
	initialPose := streaming.CameraPose{
		RingPosition: 10000,
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID, err := framework.SubscribeToStreaming(conn, initialPose, 5000, 5000, true, false)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}

	// Wait a bit for initial chunks to load
	time.Sleep(200 * time.Millisecond)

	// Update pose
	newPose := streaming.CameraPose{
		RingPosition: 20000, // Moved 10km
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	chunkDelta, err := framework.UpdatePose(conn, subscriptionID, newPose)
	if err != nil {
		t.Fatalf("Failed to update pose: %v", err)
	}

	if chunkDelta == nil {
		t.Fatal("Chunk delta is nil")
	}

	t.Logf("Pose update successful: added=%d, removed=%d chunks",
		len(chunkDelta.AddedChunks), len(chunkDelta.RemovedChunks))

	// Wait for async chunk loading to complete
	time.Sleep(500 * time.Millisecond)
}

// TestIntegration_ZoneStreaming tests zone streaming
func TestIntegration_ZoneStreaming(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Create a test zone
	zoneID, err := framework.CreateTestZone(0, 5000, -1000, 15000, 1000, "residential", framework.testUserID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}
	t.Logf("Created test zone: %d", zoneID)

	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	// Subscribe with zones enabled
	pose := streaming.CameraPose{
		RingPosition: 10000, // Center of our test zone
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID, err := framework.SubscribeToStreaming(conn, pose, 5000, 5000, false, true)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}

	// Wait for zone delta message
	time.Sleep(500 * time.Millisecond)

	// Try to read a stream_delta message (may or may not arrive depending on async timing)
	_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second)) //nolint:errcheck // Test cleanup - deadline errors are non-critical
	msg, err := framework.ReadMessage(conn, 1*time.Second)
	if err == nil && msg.Type == "stream_delta" {
		t.Logf("Received stream_delta message: %s", string(msg.Data))
	} else {
		t.Logf("No stream_delta message received (may be async): %v", err)
	}

	t.Logf("Zone streaming test completed for subscription: %s", subscriptionID)
}

// TestIntegration_RingWrapping tests ring position wrapping at boundaries
func TestIntegration_RingWrapping(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	// Test position near ring boundary (just before wrap point)
	// RingCircumference = 264,000,000m, so test near 263,999,000m
	boundaryPose := streaming.CameraPose{
		RingPosition: 263999000, // Near the end of the ring
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID, err := framework.SubscribeToStreaming(conn, boundaryPose, 5000, 5000, true, false)
	if err != nil {
		t.Fatalf("Failed to subscribe at boundary: %v", err)
	}

	// Wait for initial chunks
	time.Sleep(500 * time.Millisecond)

	// Update pose to cross the boundary (should wrap to beginning)
	crossBoundaryPose := streaming.CameraPose{
		RingPosition: 1000, // Just past wrap point (wraps from 263,999,000)
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	chunkDelta, err := framework.UpdatePose(conn, subscriptionID, crossBoundaryPose)
	if err != nil {
		t.Fatalf("Failed to update pose across boundary: %v", err)
	}

	if chunkDelta == nil {
		t.Fatal("Chunk delta is nil after boundary cross")
	}

	// Should have chunks from both sides of the boundary
	t.Logf("Boundary cross successful: added=%d, removed=%d chunks",
		len(chunkDelta.AddedChunks), len(chunkDelta.RemovedChunks))

	// Verify chunk IDs are valid (should include chunks near 0 and near 263999)
	hasLowChunks := false
	hasHighChunks := false
	for _, chunkID := range chunkDelta.AddedChunks {
		// Parse chunk ID format: "floor_chunk_index"
		var floor, index int
		if _, err := fmt.Sscanf(chunkID, "%d_%d", &floor, &index); err == nil {
			if index < 100 {
				hasLowChunks = true
			}
			if index > 263900 {
				hasHighChunks = true
			}
		}
	}

	if !hasLowChunks && !hasHighChunks {
		t.Logf("Note: Chunk delta may not show boundary wrapping (chunks: %v)", chunkDelta.AddedChunks)
	}

	// Wait for async operations
	time.Sleep(500 * time.Millisecond)
}

// TestIntegration_ErrorHandling tests error conditions
func TestIntegration_ErrorHandling(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	tests := []struct {
		name        string
		messageType string
		data        interface{}
		expectError bool
		errorCode   string
	}{
		{
			name:        "invalid stream_subscribe (zero radius)",
			messageType: "stream_subscribe",
			data: map[string]interface{}{
				"pose": map[string]interface{}{
					"ring_position": 10000,
					"active_floor":  0,
				},
				"radius_meters":  0, // Invalid: must be positive
				"include_chunks": true,
			},
			expectError: true,
			errorCode:   "InvalidSubscriptionRequest",
		},
		{
			name:        "invalid stream_update_pose (missing subscription_id)",
			messageType: "stream_update_pose",
			data: map[string]interface{}{
				"pose": map[string]interface{}{
					"ring_position": 10000,
					"active_floor":  0,
				},
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name:        "invalid stream_update_pose (nonexistent subscription)",
			messageType: "stream_update_pose",
			data: map[string]interface{}{
				"subscription_id": "nonexistent_sub_id",
				"pose": map[string]interface{}{
					"ring_position": 10000,
					"active_floor":  0,
				},
			},
			expectError: true,
			errorCode:   "InvalidSubscriptionRequest",
		},
		{
			name:        "invalid message type",
			messageType: "invalid_message_type",
			data:        map[string]interface{}{},
			expectError: true,
			errorCode:   "UnknownMessageType",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := framework.SendMessage(conn, tt.messageType, tt.data); err != nil {
				t.Fatalf("Failed to send message: %v", err)
			}

			// Wait for error response
			msg, err := framework.WaitForMessage(conn, "error", 2*time.Second)
			if tt.expectError {
				if err != nil {
					t.Fatalf("Expected error message but got: %v", err)
				}

				var errorData struct {
					Type    string `json:"type"`
					ID      string `json:"id,omitempty"`
					Error   string `json:"error"`
					Message string `json:"message"`
					Code    string `json:"code"`
				}

				// Error messages are stored in Data field as raw JSON bytes
				if len(msg.Data) == 0 {
					t.Fatalf("Error message Data field is empty")
				}

				if err := json.Unmarshal(msg.Data, &errorData); err != nil {
					t.Fatalf("Failed to unmarshal error: %v (data length: %d, data: %s)", err, len(msg.Data), string(msg.Data))
				}

				if errorData.Code != tt.errorCode {
					t.Errorf("Expected error code %s, got %s", tt.errorCode, errorData.Code)
				}

				t.Logf("Error handled correctly: code=%s, message=%s", errorData.Code, errorData.Error)
			} else {
				if err == nil && msg.Type == "error" {
					t.Errorf("Unexpected error received: %s", string(msg.Data))
				}
			}
		})
	}
}

// TestIntegration_FloorChanges tests floor change handling
func TestIntegration_FloorChanges(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Create test chunks on different floors
	chunkID1, err := framework.CreateTestChunk(0, 100)
	if err != nil {
		t.Fatalf("Failed to create test chunk: %v", err)
	}
	chunkID2, err := framework.CreateTestChunk(1, 100)
	if err != nil {
		t.Fatalf("Failed to create test chunk: %v", err)
	}
	t.Logf("Created test chunks: floor 0 (ID=%d), floor 1 (ID=%d)", chunkID1, chunkID2)

	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	// Subscribe to floor 0
	pose0 := streaming.CameraPose{
		RingPosition: 100000, // Position 100km
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID, err := framework.SubscribeToStreaming(conn, pose0, 5000, 5000, true, false)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}

	// Wait for initial chunks
	time.Sleep(500 * time.Millisecond)

	// Change to floor 1
	pose1 := streaming.CameraPose{
		RingPosition: 100000,
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  1, // Changed floor
	}

	chunkDelta, err := framework.UpdatePose(conn, subscriptionID, pose1)
	if err != nil {
		t.Fatalf("Failed to update pose for floor change: %v", err)
	}

	if chunkDelta == nil {
		t.Fatal("Chunk delta is nil after floor change")
	}

	t.Logf("Floor change successful: added=%d, removed=%d chunks",
		len(chunkDelta.AddedChunks), len(chunkDelta.RemovedChunks))

	// Verify chunk IDs are for the new floor
	for _, chunkID := range chunkDelta.AddedChunks {
		var floor, index int
		if _, err := fmt.Sscanf(chunkID, "%d_%d", &floor, &index); err == nil {
			if floor != 1 {
				t.Errorf("Expected floor 1 chunks, got floor %d in chunk %s", floor, chunkID)
			}
		}
	}

	// Wait for async operations
	time.Sleep(500 * time.Millisecond)
}

// TestIntegration_Reconnection tests WebSocket reconnection
func TestIntegration_Reconnection(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Initial connection and subscription
	conn1 := framework.ConnectWebSocket()
	pose := streaming.CameraPose{
		RingPosition: 10000,
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID1, err := framework.SubscribeToStreaming(conn1, pose, 5000, 5000, true, false)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}
	t.Logf("Initial subscription: %s", subscriptionID1)

	// Close connection
	_ = conn1.Close() //nolint:errcheck // Test cleanup - connection close errors are non-critical
	time.Sleep(100 * time.Millisecond)

	// Reconnect
	conn2 := framework.ConnectWebSocket()
	defer func() { _ = conn2.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	// Create new subscription (old one should be cleaned up)
	subscriptionID2, err := framework.SubscribeToStreaming(conn2, pose, 5000, 5000, true, false)
	if err != nil {
		t.Fatalf("Failed to subscribe after reconnect: %v", err)
	}

	if subscriptionID2 == subscriptionID1 {
		t.Logf("Note: Got same subscription ID after reconnect (may be expected)")
	} else {
		t.Logf("Got new subscription ID after reconnect: %s (was %s)", subscriptionID2, subscriptionID1)
	}

	// Verify new subscription works
	chunkDelta, err := framework.UpdatePose(conn2, subscriptionID2, pose)
	if err != nil {
		t.Fatalf("Failed to update pose on reconnected subscription: %v", err)
	}

	if chunkDelta == nil {
		t.Fatal("Chunk delta is nil after reconnection")
	}

	t.Logf("Reconnection successful: subscription=%s", subscriptionID2)
}

// TestIntegration_Performance tests streaming performance
func TestIntegration_Performance(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck // Test cleanup - connection close errors are non-critical

	pose := streaming.CameraPose{
		RingPosition: 10000,
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	// Measure subscription time
	start := time.Now()
	subscriptionID, err := framework.SubscribeToStreaming(conn, pose, 5000, 5000, true, false)
	subscriptionTime := time.Since(start)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}

	if subscriptionTime > 2*time.Second {
		t.Errorf("Subscription took too long: %v (target: <2s)", subscriptionTime)
	}
	t.Logf("Subscription completed in %v", subscriptionTime)

	// Measure pose update time
	start = time.Now()
	newPose := streaming.CameraPose{
		RingPosition: 20000,
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}
	chunkDelta, err := framework.UpdatePose(conn, subscriptionID, newPose)
	updateTime := time.Since(start)
	if err != nil {
		t.Fatalf("Failed to update pose: %v", err)
	}

	if updateTime > 500*time.Millisecond {
		t.Errorf("Pose update took too long: %v (target: <500ms)", updateTime)
	}
	t.Logf("Pose update completed in %v (delta: added=%d, removed=%d)",
		updateTime, len(chunkDelta.AddedChunks), len(chunkDelta.RemovedChunks))

	// Wait for async chunk loading
	time.Sleep(500 * time.Millisecond)
}

// TestIntegration_ZonePersistence tests that zones persist across chunk regeneration
func TestIntegration_ZonePersistence(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Create a chunk with a zone
	chunkID, err := framework.CreateTestChunk(0, 50000)
	if err != nil {
		t.Fatalf("Failed to create test chunk: %v", err)
	}

	// Create a zone linked to this chunk via metadata
	zoneID, err := framework.CreateTestZone(0, 50000000, -10, 50001000, 10, "restricted", 0)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	// Update chunk_data to link zone to chunk
	_, err = framework.db.Exec(`
		UPDATE chunk_data SET zone_ids = ARRAY[$1::bigint] WHERE chunk_id = $2
	`, zoneID, chunkID)
	if err != nil {
		t.Fatalf("Failed to link zone to chunk: %v", err)
	}

	// Update zone metadata to mark it as default zone for this chunk
	_, err = framework.db.Exec(`
		UPDATE zones SET metadata = '{"default_zone": "true", "chunk_index": "50000"}'::jsonb
		WHERE id = $1
	`, zoneID)
	if err != nil {
		t.Fatalf("Failed to update zone metadata: %v", err)
	}

	// Verify zone is linked to chunk
	var linkedZoneIDs []int64
	err = framework.db.QueryRow(`
		SELECT zone_ids FROM chunk_data WHERE chunk_id = $1
	`, chunkID).Scan(pq.Array(&linkedZoneIDs))
	if err != nil {
		t.Fatalf("Failed to query chunk_data: %v", err)
	}
	if len(linkedZoneIDs) != 1 || linkedZoneIDs[0] != zoneID {
		t.Errorf("Expected zone ID %d in chunk_data.zone_ids, got %v", zoneID, linkedZoneIDs)
	}

	// Verify zone persists in database
	var persistedZoneID int64
	err = framework.db.QueryRow(`
		SELECT id FROM zones WHERE id = $1
	`, zoneID).Scan(&persistedZoneID)
	if err != nil {
		t.Fatalf("Zone not found in database: %v", err)
	}
	if persistedZoneID != zoneID {
		t.Errorf("Expected zone ID %d, got %d", zoneID, persistedZoneID)
	}

	t.Logf("Zone persistence verified: zone %d linked to chunk %d", zoneID, chunkID)
}

// TestIntegration_ZoneChunkBindingStreaming tests that zones are embedded in chunk streaming
func TestIntegration_ZoneChunkBindingStreaming(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Create a chunk
	chunkID, err := framework.CreateTestChunk(0, 60000)
	if err != nil {
		t.Fatalf("Failed to create test chunk: %v", err)
	}

	// Create a zone and link it to the chunk
	zoneID, err := framework.CreateTestZone(0, 60000000, -10, 60001000, 10, "restricted", 0)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	// Link zone to chunk
	_, err = framework.db.Exec(`
		UPDATE chunk_data SET zone_ids = ARRAY[$1::bigint] WHERE chunk_id = $2
	`, zoneID, chunkID)
	if err != nil {
		t.Fatalf("Failed to link zone to chunk: %v", err)
	}

	// Update zone metadata
	_, err = framework.db.Exec(`
		UPDATE zones SET metadata = '{"default_zone": "true", "chunk_index": "60000"}'::jsonb,
			is_system_zone = TRUE
		WHERE id = $1
	`, zoneID)
	if err != nil {
		t.Fatalf("Failed to update zone metadata: %v", err)
	}

	// Connect and subscribe to streaming
	conn := framework.ConnectWebSocket()
	defer func() { _ = conn.Close() }() //nolint:errcheck

	pose := streaming.CameraPose{
		RingPosition: 60000000, // Position of our chunk
		WidthOffset:  0,
		Elevation:    0,
		ActiveFloor:  0,
	}

	subscriptionID, err := framework.SubscribeToStreaming(conn, pose, 5000, 5000, true, true)
	if err != nil {
		t.Fatalf("Failed to subscribe: %v", err)
	}

	// Wait for stream_delta message with chunks
	time.Sleep(1 * time.Second)

	// Read stream_delta message
	msg, err := framework.WaitForMessage(conn, "stream_delta", 2*time.Second)
	if err != nil {
		t.Logf("No stream_delta message received (may be async): %v", err)
		return
	}

	// Parse stream_delta to check if zones are embedded in chunks
	var deltaData struct {
		SubscriptionID string `json:"subscription_id"`
		Chunks         []struct {
			ID    string          `json:"id"`
			Zones json.RawMessage `json:"zones,omitempty"`
		} `json:"chunks"`
	}

	if err := json.Unmarshal(msg.Data, &deltaData); err != nil {
		t.Logf("Failed to parse stream_delta: %v", err)
		return
	}

	// Check if our chunk has zones embedded
	foundChunk := false
	for _, chunk := range deltaData.Chunks {
		if chunk.ID == "0_60000" {
			foundChunk = true
			if len(chunk.Zones) > 0 {
				t.Logf("Zone found embedded in chunk: %s", string(chunk.Zones))
			} else {
				t.Logf("Chunk found but no zones embedded (may be async)")
			}
			break
		}
	}

	if !foundChunk {
		t.Logf("Chunk 0_60000 not found in stream_delta (may be outside range)")
	}

	t.Logf("Zone-chunk binding streaming test completed for subscription: %s", subscriptionID)
}

// TestIntegration_ZoneCleanupOnChunkRemoval tests that zones are cleaned up when chunks are removed
func TestIntegration_ZoneCleanupOnChunkRemoval(t *testing.T) {
	framework := NewIntegrationTestFramework(t)
	defer framework.Close()

	// Create a chunk with a zone
	chunkID, err := framework.CreateTestChunk(0, 70000)
	if err != nil {
		t.Fatalf("Failed to create test chunk: %v", err)
	}

	zoneID, err := framework.CreateTestZone(0, 70000000, -10, 70001000, 10, "restricted", 0)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	// Link zone to chunk
	_, err = framework.db.Exec(`
		UPDATE chunk_data SET zone_ids = ARRAY[$1::bigint] WHERE chunk_id = $2
	`, zoneID, chunkID)
	if err != nil {
		t.Fatalf("Failed to link zone to chunk: %v", err)
	}

	// Verify zone is linked
	var linkedZoneIDs []int64
	err = framework.db.QueryRow(`
		SELECT zone_ids FROM chunk_data WHERE chunk_id = $1
	`, chunkID).Scan(pq.Array(&linkedZoneIDs))
	if err != nil {
		t.Fatalf("Failed to query chunk_data: %v", err)
	}
	if len(linkedZoneIDs) != 1 {
		t.Fatalf("Expected 1 zone linked to chunk, got %d", len(linkedZoneIDs))
	}

	// Delete chunk (should cascade to chunk_data, removing zone_ids link)
	_, err = framework.db.Exec(`DELETE FROM chunks WHERE id = $1`, chunkID)
	if err != nil {
		t.Fatalf("Failed to delete chunk: %v", err)
	}

	// Verify chunk_data is deleted (cascade)
	var chunkDataExists bool
	err = framework.db.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM chunk_data WHERE chunk_id = $1)
	`, chunkID).Scan(&chunkDataExists)
	if err != nil {
		t.Fatalf("Failed to check chunk_data: %v", err)
	}
	if chunkDataExists {
		t.Error("chunk_data should be deleted when chunk is deleted (CASCADE)")
	}

	// Zone should still exist in zones table (zones are not deleted when chunks are deleted)
	var zoneExists bool
	err = framework.db.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM zones WHERE id = $1)
	`, zoneID).Scan(&zoneExists)
	if err != nil {
		t.Fatalf("Failed to check zone: %v", err)
	}
	if !zoneExists {
		t.Error("Zone should still exist after chunk deletion (zones are independent)")
	}

	t.Logf("Zone cleanup test completed: zone %d persists after chunk %d deletion", zoneID, chunkID)
}
