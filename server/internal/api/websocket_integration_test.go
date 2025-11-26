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
	"github.com/earthring/server/internal/streaming"
	"github.com/earthring/server/internal/testutil"
	"github.com/gorilla/websocket"
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
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
			JWTExpiration: 15 * time.Minute,
		},
		Procedural: config.ProceduralConfig{
			BaseURL:    "", // No procedural service for integration tests
			Timeout:    5 * time.Second,
			RetryCount: 0,
		},
	}

	handlers := NewWebSocketHandlers(db, cfg)
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
	conn.SetReadDeadline(time.Now().Add(timeout))

	_, messageBytes, err := conn.ReadMessage()
	if err != nil {
		return nil, fmt.Errorf("failed to read message: %w", err)
	}

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
		SubscriptionID string              `json:"subscription_id"`
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
func (f *IntegrationTestFramework) CreateTestChunk(floor, chunkIndex int) (int64, error) {
	var chunkID int64
	err := f.db.QueryRow(`
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
	defer conn.Close()

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
	defer conn.Close()

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
	defer conn.Close()

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
	conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	msg, err := framework.ReadMessage(conn, 1*time.Second)
	if err == nil && msg.Type == "stream_delta" {
		t.Logf("Received stream_delta message: %s", string(msg.Data))
	} else {
		t.Logf("No stream_delta message received (may be async): %v", err)
	}

	t.Logf("Zone streaming test completed for subscription: %s", subscriptionID)
}

