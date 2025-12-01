package api

import (
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
	"github.com/earthring/server/internal/testutil"
	"github.com/gorilla/websocket"
)

func TestWebSocketHandlers_NewWebSocketHandlers(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(nil, cfg, profiler)
	if handlers == nil {
		t.Fatal("NewWebSocketHandlers returned nil")
	}

	if handlers.hub == nil {
		t.Error("WebSocket hub is nil")
	}

	if handlers.jwtService == nil {
		t.Error("JWT service is nil")
	}
}

func TestWebSocketHandlers_negotiateVersion(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(nil, cfg, profiler)

	tests := []struct {
		name      string
		requested string
		expected  string
	}{
		{"empty string defaults to v1", "", ProtocolVersion1},
		{"v1 requested", ProtocolVersion1, ProtocolVersion1},
		{"multiple versions", "earthring-v2, earthring-v1", ProtocolVersion1},
		{"unsupported version", "earthring-v99", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := handlers.negotiateVersion(tt.requested)
			if result != tt.expected {
				t.Errorf("negotiateVersion(%q) = %q, want %q", tt.requested, result, tt.expected)
			}
		})
	}
}

func TestWebSocketHub_Run(t *testing.T) {
	hub := NewWebSocketHub()

	// Start hub in goroutine
	go hub.Run()
	defer func() {
		// Give hub time to process any pending operations
		time.Sleep(10 * time.Millisecond)
	}()

	// Test that hub is running (can't easily test without a real connection)
	// This is a basic smoke test
	if hub.connections == nil {
		t.Error("Hub connections map is nil")
	}
}

func TestWebSocketHandlers_extractToken(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(nil, cfg, profiler)

	tests := []struct {
		name    string
		request *http.Request
		wantErr bool
	}{
		{
			name: "token in query parameter",
			request: func() *http.Request {
				req := httptest.NewRequest("GET", "/ws?token=test-token", nil)
				return req
			}(),
			wantErr: false,
		},
		{
			name: "token in Authorization header",
			request: func() *http.Request {
				req := httptest.NewRequest("GET", "/ws", nil)
				req.Header.Set("Authorization", "Bearer test-token")
				return req
			}(),
			wantErr: false,
		},
		{
			name:    "no token",
			request: httptest.NewRequest("GET", "/ws", nil),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := handlers.extractToken(tt.request)
			if (err != nil) != tt.wantErr {
				t.Errorf("extractToken() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && token == "" {
				t.Error("extractToken() returned empty token when error not expected")
			}
		})
	}
}

func TestWebSocketHub_Broadcast(t *testing.T) {
	hub := NewWebSocketHub()
	go hub.Run()
	defer func() {
		time.Sleep(10 * time.Millisecond)
	}()

	message := []byte(`{"type":"test","data":{}}`)
	hub.Broadcast(message)

	// Test passes if no panic occurs
}

func TestWebSocketHub_SendToUser(t *testing.T) {
	hub := NewWebSocketHub()
	go hub.Run()
	defer func() {
		time.Sleep(10 * time.Millisecond)
	}()

	message := []byte(`{"type":"test","data":{}}`)
	hub.SendToUser(123, message)

	// Test passes if no panic occurs (no connections, so nothing to send)
}

func TestWebSocketHandlers_HandleWebSocket_Authentication(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
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
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
			JWTExpiration: 15 * time.Minute, // Ensure token is valid
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash, level, experience_points, currency_amount)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, username, email, hashedPassword, 1, 0, 0).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	jwtService := auth.NewJWTService(cfg)
	_, err = jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Test: Missing token
	req := httptest.NewRequest("GET", "/ws", nil)
	w := httptest.NewRecorder()
	handlers.HandleWebSocket(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}

	// Test: Invalid token
	req = httptest.NewRequest("GET", "/ws?token=invalid-token", nil)
	w = httptest.NewRecorder()
	handlers.HandleWebSocket(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestWebSocketHandlers_HandleWebSocket_ExpiredTokenRateLimiting(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
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
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
			JWTExpiration: -1 * time.Hour, // Negative expiration to create expired tokens
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash, level, experience_points, currency_amount)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, username, email, hashedPassword, 1, 0, 0).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	jwtService := auth.NewJWTService(cfg)
	expiredToken, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate expired token: %v", err)
	}

	// Verify token is expired
	_, err = jwtService.ValidateAccessToken(expiredToken)
	if err == nil {
		t.Fatal("Expected token to be expired, but validation succeeded")
	}
	if !strings.Contains(err.Error(), "expired") && !strings.Contains(err.Error(), "Expired") {
		t.Fatalf("Expected expired token error, got: %v", err)
	}

	// Test: Multiple requests with expired token from same IP
	// The rate limiting should suppress log messages but still return 401
	clientIP := "192.168.1.100"
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", fmt.Sprintf("/ws?token=%s", expiredToken), nil)
		req.RemoteAddr = clientIP + ":12345"
		w := httptest.NewRecorder()
		handlers.HandleWebSocket(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("Request %d: Expected status 401, got %d", i+1, w.Code)
		}
	}

	// Test: Expired token from different IP should also return 401
	req := httptest.NewRequest("GET", fmt.Sprintf("/ws?token=%s", expiredToken), nil)
	req.RemoteAddr = "192.168.1.200:12345"
	w := httptest.NewRecorder()
	handlers.HandleWebSocket(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401 for different IP, got %d", w.Code)
	}
}

func TestWebSocketHandlers_HandleWebSocket_VersionNegotiation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
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
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
			JWTExpiration: 15 * time.Minute, // Ensure token is valid
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash, level, experience_points, currency_amount)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, username, email, hashedPassword, 1, 0, 0).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Test: Unsupported version (with valid token)
	req := httptest.NewRequest("GET", "/ws?token="+token, nil)
	req.Header.Set("Sec-WebSocket-Protocol", "earthring-v99")
	w := httptest.NewRecorder()
	handlers.HandleWebSocket(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for unsupported version, got %d", w.Code)
	}
}

func TestWebSocketHandlers_handleMessage(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create chunks table (needed for streaming message handling)
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS chunks (
			id SERIAL PRIMARY KEY,
			floor INTEGER NOT NULL,
			chunk_index INTEGER NOT NULL,
			version INTEGER DEFAULT 1,
			last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			is_dirty BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			metadata JSONB,
			UNIQUE(floor, chunk_index)
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunks table: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS chunk_data (
			chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			geometry_detail GEOMETRY(MULTIPOLYGON, 0),
			structure_ids INTEGER[],
			zone_ids INTEGER[],
			npc_data JSONB,
			terrain_data JSONB,
			last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunk_data table: %v", err)
	}

	// Create players table (needed for player_move message handling)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
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
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)

	// Create a mock connection
	conn := &WebSocketConnection{
		userID:   1,
		username: "testuser",
		role:     "player",
		version:  ProtocolVersion1,
		send:     make(chan []byte, 256),
		hub:      handlers.GetHub(),
	}

	tests := []struct {
		name    string
		message *WebSocketMessage
	}{
		{
			name: "ping message",
			message: &WebSocketMessage{
				Type: "ping",
				ID:   "test-id",
			},
		},
		{
			name: "player_move message",
			message: &WebSocketMessage{
				Type: "player_move",
				ID:   "req-124",
				Data: json.RawMessage(`{"position":{"x":100,"y":0},"floor":0}`),
			},
		},
		{
			name: "unknown message type",
			message: &WebSocketMessage{
				Type: "unknown_type",
				ID:   "req-125",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handlers.handleMessage(conn, tt.message)
			// Test passes if no panic occurs
		})
	}
}

func TestWebSocketHandlers_handlePing(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create chunks table (needed for WebSocket handlers initialization)
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS chunks (
			id SERIAL PRIMARY KEY,
			floor INTEGER NOT NULL,
			chunk_index INTEGER NOT NULL,
			version INTEGER DEFAULT 1,
			last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			is_dirty BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			metadata JSONB,
			UNIQUE(floor, chunk_index)
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunks table: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)

	conn := &WebSocketConnection{
		userID:   1,
		username: "testuser",
		role:     "player",
		version:  ProtocolVersion1,
		send:     make(chan []byte, 256),
		hub:      handlers.GetHub(),
	}

	msg := &WebSocketMessage{
		Type: "ping",
		ID:   "test-ping-id",
	}

	handlers.handlePing(conn, msg)

	// Check that pong response was sent
	select {
	case response := <-conn.send:
		var pongMsg WebSocketMessage
		if err := json.Unmarshal(response, &pongMsg); err != nil {
			t.Fatalf("Failed to unmarshal pong response: %v", err)
		}
		if pongMsg.Type != "pong" {
			t.Errorf("Expected pong message, got %s", pongMsg.Type)
		}
		if pongMsg.ID != msg.ID {
			t.Errorf("Expected pong ID %s, got %s", msg.ID, pongMsg.ID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("Timeout waiting for pong response")
	}
}

func TestWebSocketConnection_sendError(t *testing.T) {
	conn := &WebSocketConnection{
		send: make(chan []byte, 256),
	}

	conn.sendError("test-id", "Test error", "TestErrorCode")

	select {
	case response := <-conn.send:
		var errorMsg WebSocketError
		if err := json.Unmarshal(response, &errorMsg); err != nil {
			t.Fatalf("Failed to unmarshal error response: %v", err)
		}
		if errorMsg.Type != "error" {
			t.Errorf("Expected error type, got %s", errorMsg.Type)
		}
		if errorMsg.ID != "test-id" {
			t.Errorf("Expected error ID test-id, got %s", errorMsg.ID)
		}
		if errorMsg.Error != "Test error" {
			t.Errorf("Expected error message 'Test error', got %s", errorMsg.Error)
		}
		if errorMsg.Code != "TestErrorCode" {
			t.Errorf("Expected error code 'TestErrorCode', got %s", errorMsg.Code)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("Timeout waiting for error response")
	}
}

func TestWebSocketHandlers_HandleWebSocket_InvalidMessageFormat(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
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
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
			JWTExpiration: 15 * time.Minute, // Ensure token is valid
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash, level, experience_points, currency_amount)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, username, email, hashedPassword, 1, 0, 0).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create a WebSocket server
	server := httptest.NewServer(http.HandlerFunc(handlers.HandleWebSocket))
	defer server.Close()

	// Convert http:// to ws://
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "?token=" + token

	// Connect to WebSocket
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{
		"Sec-WebSocket-Protocol": []string{ProtocolVersion1},
	})
	if err != nil {
		t.Skipf("Skipping WebSocket test: failed to connect: %v", err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			t.Fatalf("Failed to close WebSocket connection: %v", err)
		}
	}()

	// Send invalid JSON message
	invalidJSON := []byte("not valid json")
	if err := conn.WriteMessage(websocket.TextMessage, invalidJSON); err != nil {
		t.Fatalf("Failed to write message: %v", err)
	}

	// Read error response
	_, messageBytes, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("Failed to read message: %v", err)
	}

	var errorMsg WebSocketError
	if err := json.Unmarshal(messageBytes, &errorMsg); err != nil {
		t.Fatalf("Failed to unmarshal error: %v", err)
	}

	if errorMsg.Type != "error" {
		t.Errorf("Expected error type, got %s", errorMsg.Type)
	}
	if errorMsg.Code != "InvalidMessageFormat" {
		t.Errorf("Expected InvalidMessageFormat code, got %s", errorMsg.Code)
	}
}

func TestWebSocketHub_RegisterUnregister(t *testing.T) {
	hub := NewWebSocketHub()
	go hub.Run()
	defer func() {
		time.Sleep(10 * time.Millisecond)
	}()

	// Create a mock connection
	conn := &WebSocketConnection{
		userID:   1,
		username: "testuser",
		version:  ProtocolVersion1,
		send:     make(chan []byte, 256),
		hub:      hub,
	}

	// Register connection
	hub.register <- conn
	time.Sleep(10 * time.Millisecond)

	// Verify connection is registered
	hub.mu.RLock()
	_, exists := hub.connections[conn]
	hub.mu.RUnlock()
	if !exists {
		t.Error("Connection was not registered")
	}

	// Unregister connection
	hub.unregister <- conn
	time.Sleep(10 * time.Millisecond)

	// Verify connection is unregistered
	hub.mu.RLock()
	_, exists = hub.connections[conn]
	hub.mu.RUnlock()
	if exists {
		t.Error("Connection was not unregistered")
	}
}

// TestWebSocketHandlers_handleChunkRequest removed - chunk_request handler is legacy and has been removed
// The entire test function has been removed as it tested the legacy chunk_request handler
//
//nolint:unused // Test function preserved for reference, starts with _ to prevent execution
func _TestWebSocketHandlers_handleChunkRequest_removed(t *testing.T) {
	// This test has been removed - chunk_request is legacy code
	t.Skip("chunk_request handler removed")

	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)

	// Create chunks table with full schema
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS chunks (
			id SERIAL PRIMARY KEY,
			floor INTEGER NOT NULL,
			chunk_index INTEGER NOT NULL,
			version INTEGER DEFAULT 1,
			last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			is_dirty BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			metadata JSONB,
			UNIQUE(floor, chunk_index)
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunks table: %v", err)
	}

	// Drop and recreate chunk_data table to ensure it has the correct schema
	_, err = db.Exec("DROP TABLE IF EXISTS chunk_data")
	if err != nil {
		t.Logf("Warning: failed to drop chunk_data table: %v", err)
	}
	// Create chunk_data table
	_, err = db.Exec(`
		CREATE TABLE chunk_data (
			chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			geometry_detail GEOMETRY(MULTIPOLYGON, 0),
			structure_ids INTEGER[],
			zone_ids INTEGER[],
			npc_data JSONB,
			terrain_data JSONB,
			last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunk_data table: %v", err)
	}

	// Create mock procedural service
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/chunks/generate" {
			t.Errorf("Expected path /api/v1/chunks/generate, got %s", r.URL.Path)
		}

		var req struct {
			Floor      int    `json:"floor"`
			ChunkIndex int    `json:"chunk_index"`
			LODLevel   string `json:"lod_level"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("Failed to decode request: %v", err)
		}

		// Return geometry for ring floor
		response := map[string]interface{}{
			"success": true,
			"chunk": map[string]interface{}{
				"chunk_id":    fmt.Sprintf("%d_%d", req.Floor, req.ChunkIndex),
				"floor":       req.Floor,
				"chunk_index": req.ChunkIndex,
				"width":       400.0,
				"version":     2,
			},
			"geometry": map[string]interface{}{
				"type":     "ring_floor",
				"vertices": [][]float64{{0, 0, 0}, {1000, 0, 0}, {1000, 400, 0}, {0, 400, 0}},
				"faces":    [][]int{{0, 1, 2}, {0, 2, 3}},
				"normals":  [][]float64{{0, 0, 1}, {0, 0, 1}},
				"width":    400.0,
				"length":   1000.0,
			},
			"structures": []interface{}{},
			"zones":      []interface{}{},
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Logf("Warning: failed to encode response: %v", err)
		}
	}))
	defer mockServer.Close()

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
		Procedural: config.ProceduralConfig{
			BaseURL:    mockServer.URL,
			Timeout:    5 * time.Second,
			RetryCount: 0,
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()
	defer func() {
		time.Sleep(10 * time.Millisecond)
	}()

	// Create a mock connection
	conn := &WebSocketConnection{
		userID:   1,
		username: "testuser",
		role:     "player",
		version:  ProtocolVersion1,
		send:     make(chan []byte, 256),
		hub:      handlers.GetHub(),
	}

	// Register connection
	handlers.GetHub().register <- conn
	time.Sleep(10 * time.Millisecond)

	tests := []struct {
		name           string
		message        *WebSocketMessage
		expectError    bool
		errorCode      string
		expectedChunks int
	}{
		{
			name: "valid chunk request",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-1",
				Data: json.RawMessage(`{"chunks":["0_12345","0_12346"]}`),
			},
			expectError:    false,
			expectedChunks: 2,
		},
		{
			name: "chunk request with LOD level",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-2",
				Data: json.RawMessage(`{"chunks":["0_100"],"lod_level":"high"}`),
			},
			expectError:    false,
			expectedChunks: 1,
		},
		{
			name: "empty chunks array",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-3",
				Data: json.RawMessage(`{"chunks":[]}`),
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name: "too many chunks",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-4",
				Data: json.RawMessage(`{"chunks":["0_1","0_2","0_3","0_4","0_5","0_6","0_7","0_8","0_9","0_10","0_11"]}`),
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name: "invalid LOD level",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-5",
				Data: json.RawMessage(`{"chunks":["0_100"],"lod_level":"invalid"}`),
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name: "invalid chunk request format",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-6",
				Data: json.RawMessage(`{"invalid":"data"}`),
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name: "invalid chunk ID format",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-7",
				Data: json.RawMessage(`{"chunks":["invalid"]}`),
			},
			expectError:    false, // Invalid chunks are skipped, not an error
			expectedChunks: 0,
		},
		{
			name: "chunk index wraps around ring (positive)",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-8",
				Data: json.RawMessage(`{"chunks":["0_300000"]}`),
			},
			expectError:    false, // Out of range chunks are wrapped (300000 % 264000 = 36000)
			expectedChunks: 1,
		},
		{
			name: "chunk index wraps around ring (negative)",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-9",
				Data: json.RawMessage(`{"chunks":["0_-1"]}`),
			},
			expectError:    false, // Negative chunks wrap to end of ring (263999)
			expectedChunks: 1,
		},
		{
			name: "chunk index wraps to zero",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-10",
				Data: json.RawMessage(`{"chunks":["0_264000"]}`),
			},
			expectError:    false, // Exactly at wrap boundary wraps to 0
			expectedChunks: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear send channel
			for len(conn.send) > 0 {
				<-conn.send
			}

			// NOTE: handleChunkRequest method removed - this test is skipped
			// handlers.handleChunkRequest(conn, tt.message)

			// Wait for response
			select {
			case responseBytes := <-conn.send:
				var response WebSocketMessage
				if err := json.Unmarshal(responseBytes, &response); err != nil {
					t.Fatalf("Failed to unmarshal response: %v", err)
				}

				if tt.expectError {
					// Should receive error message
					var errorMsg WebSocketError
					if err := json.Unmarshal(responseBytes, &errorMsg); err != nil {
						t.Fatalf("Failed to unmarshal error: %v", err)
					}
					if errorMsg.Type != "error" {
						t.Errorf("Expected error message, got type %s", response.Type)
					}
					if errorMsg.Code != tt.errorCode {
						t.Errorf("Expected error code %s, got %s", tt.errorCode, errorMsg.Code)
					}
					if errorMsg.ID != tt.message.ID {
						t.Errorf("Expected error ID %s, got %s", tt.message.ID, errorMsg.ID)
					}
				} else {
					// Should receive chunk_data message
					if response.Type != "chunk_data" {
						t.Errorf("Expected chunk_data message, got type %s", response.Type)
					}
					if response.ID != tt.message.ID {
						t.Errorf("Expected response ID %s, got %s", tt.message.ID, response.ID)
					}

					var chunkData ChunkDataResponse
					if err := json.Unmarshal(response.Data, &chunkData); err != nil {
						t.Fatalf("Failed to unmarshal chunk data: %v", err)
					}

					if len(chunkData.Chunks) != tt.expectedChunks {
						t.Errorf("Expected %d chunks, got %d", tt.expectedChunks, len(chunkData.Chunks))
					}
				}
			case <-time.After(1 * time.Second):
				if !tt.expectError {
					t.Error("Timeout waiting for response")
				}
			}
		})
	}

	// Unregister connection
	handlers.GetHub().unregister <- conn
	time.Sleep(10 * time.Millisecond)

	t.Run("auto-regenerates outdated chunks", func(t *testing.T) {
		// Clean up
		_, err := db.Exec("DELETE FROM chunk_data WHERE chunk_id IN (SELECT id FROM chunks WHERE floor = $1 AND chunk_index = $2)", 0, 12380)
		if err != nil {
			t.Logf("Warning: failed to delete chunk_data: %v", err)
		}
		_, err = db.Exec("DELETE FROM chunks WHERE floor = $1 AND chunk_index = $2", 0, 12380)
		if err != nil {
			t.Logf("Warning: failed to delete chunk: %v", err)
		}

		// Create a chunk with old version (version 1)
		var chunkID int64
		err = db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version, is_dirty)
			VALUES ($1, $2, $3, $4)
			RETURNING id
		`, 0, 12380, 1, false).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to create test chunk: %v", err)
		}

		// Store old geometry
		oldGeometryJSON := `{"type": "ring_floor", "vertices": [[0, -200, 0], [1000, -200, 0], [1000, 200, 0], [0, 200, 0]], "faces": [[0, 1, 2], [0, 2, 3]], "normals": [[0, 0, 1], [0, 0, 1]], "width": 400.0, "length": 1000.0}`
		_, err = db.Exec(`
			INSERT INTO chunk_data (chunk_id, geometry, terrain_data)
			VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2)
		`, chunkID, oldGeometryJSON)
		if err != nil {
			t.Fatalf("Failed to insert chunk_data: %v", err)
		}

		// Create a new connection for this test
		conn2 := &WebSocketConnection{
			conn:   nil, // Not needed for this test
			userID: 1,
			send:   make(chan []byte, 256),
		}
		handlers.GetHub().register <- conn2
		time.Sleep(10 * time.Millisecond)

		// NOTE: handleChunkRequest method removed - this test is skipped
		// Request the chunk via WebSocket - it should auto-regenerate
		// chunkRequest := &WebSocketMessage{
		// 	Type: "chunk_request",
		// 	ID:   "test-outdated",
		// 	Data: json.RawMessage(`{"chunks":["0_12380"],"lod_level":"medium"}`),
		// }
		// handlers.handleChunkRequest(conn2, chunkRequest)

		// Wait for response
		select {
		case responseBytes := <-conn2.send:
			var response WebSocketMessage
			if err := json.Unmarshal(responseBytes, &response); err != nil {
				t.Fatalf("Failed to unmarshal response: %v", err)
			}

			// Verify response type
			if response.Type != "chunk_data" {
				t.Errorf("Expected chunk_data, got %v", response.Type)
			}
		case <-time.After(2 * time.Second):
			t.Error("Timeout waiting for response")
		}

		// Verify chunk was regenerated (version should be updated to current)
		var newVersion int
		err = db.QueryRow("SELECT version FROM chunks WHERE floor = $1 AND chunk_index = $2", 0, 12380).Scan(&newVersion)
		if err != nil {
			t.Fatalf("Failed to query version: %v", err)
		}
		if newVersion < CurrentGeometryVersion {
			t.Errorf("Expected version >= %d after regeneration, got %d", CurrentGeometryVersion, newVersion)
		}

		// Unregister connection
		handlers.GetHub().unregister <- conn2
		time.Sleep(10 * time.Millisecond)
	})
}

func TestWebSocketHandlers_handleStreamSubscribe(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()
	defer func() {
		time.Sleep(10 * time.Millisecond)
	}()

	// Create a mock connection
	conn := &WebSocketConnection{
		userID:   1,
		username: "testuser",
		role:     "player",
		version:  ProtocolVersion1,
		send:     make(chan []byte, 256),
		hub:      handlers.GetHub(),
	}

	// Register connection
	handlers.GetHub().register <- conn
	time.Sleep(10 * time.Millisecond)

	tests := []struct {
		name        string
		message     *WebSocketMessage
		expectError bool
		errorCode   string
	}{
		{
			name: "valid stream_subscribe with chunks",
			message: &WebSocketMessage{
				Type: "stream_subscribe",
				ID:   "req-sub-1",
				Data: json.RawMessage(`{
					"pose": {
						"ring_position": 10000,
						"width_offset": 0,
						"elevation": 0,
						"active_floor": 0
					},
					"radius_meters": 5000,
					"width_meters": 5000,
					"include_chunks": true,
					"include_zones": false
				}`),
			},
			expectError: false,
		},
		{
			name: "valid stream_subscribe with zones",
			message: &WebSocketMessage{
				Type: "stream_subscribe",
				ID:   "req-sub-2",
				Data: json.RawMessage(`{
					"pose": {
						"ring_position": 20000,
						"width_offset": 0,
						"elevation": 0,
						"active_floor": 0
					},
					"radius_meters": 5000,
					"width_meters": 5000,
					"include_chunks": false,
					"include_zones": true
				}`),
			},
			expectError: false,
		},
		{
			name: "invalid stream_subscribe payload (missing required fields)",
			message: &WebSocketMessage{
				Type: "stream_subscribe",
				ID:   "req-sub-3",
				Data: json.RawMessage(`{"invalid": "data"}`),
			},
			expectError: true,
			errorCode:   "InvalidSubscriptionRequest", // JSON unmarshals but validation fails
		},
		{
			name: "stream_subscribe with zero radius",
			message: &WebSocketMessage{
				Type: "stream_subscribe",
				ID:   "req-sub-4",
				Data: json.RawMessage(`{
					"pose": {
						"ring_position": 10000,
						"active_floor": 0
					},
					"radius_meters": 0,
					"include_chunks": true
				}`),
			},
			expectError: true,
			errorCode:   "InvalidSubscriptionRequest",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear send channel
			for len(conn.send) > 0 {
				<-conn.send
			}

			handlers.handleStreamSubscribe(conn, tt.message)

			// Wait for response
			select {
			case responseBytes := <-conn.send:
				var response WebSocketMessage
				if err := json.Unmarshal(responseBytes, &response); err != nil {
					t.Fatalf("Failed to unmarshal response: %v", err)
				}

				if tt.expectError {
					// Should receive error message
					var errorMsg WebSocketError
					if err := json.Unmarshal(responseBytes, &errorMsg); err != nil {
						t.Fatalf("Failed to unmarshal error: %v", err)
					}
					if errorMsg.Type != "error" {
						t.Errorf("Expected error message, got type %s", response.Type)
					}
					if errorMsg.Code != tt.errorCode {
						t.Errorf("Expected error code %s, got %s", tt.errorCode, errorMsg.Code)
					}
				} else {
					// Should receive stream_ack message
					if response.Type != "stream_ack" {
						t.Errorf("Expected stream_ack message, got type %s", response.Type)
					}
					if response.ID != tt.message.ID {
						t.Errorf("Expected response ID %s, got %s", tt.message.ID, response.ID)
					}

					var ackData struct {
						SubscriptionID string   `json:"subscription_id"`
						ChunkIDs       []string `json:"chunk_ids,omitempty"`
						Message        string   `json:"message"`
					}
					if err := json.Unmarshal(response.Data, &ackData); err != nil {
						t.Fatalf("Failed to unmarshal ack data: %v", err)
					}
					if ackData.SubscriptionID == "" {
						t.Error("Expected subscription_id in ack response")
					}
				}
			case <-time.After(1 * time.Second):
				if !tt.expectError {
					t.Error("Timeout waiting for response")
				}
			}
		})
	}

	// Unregister connection
	handlers.GetHub().unregister <- conn
	time.Sleep(10 * time.Millisecond)
}

func TestWebSocketHandlers_handleStreamUpdatePose(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	profiler := performance.NewProfiler(false)
	handlers := NewWebSocketHandlers(db, cfg, profiler)
	go handlers.GetHub().Run()
	defer func() {
		time.Sleep(10 * time.Millisecond)
	}()

	// Create a mock connection
	conn := &WebSocketConnection{
		userID:   1,
		username: "testuser",
		role:     "player",
		version:  ProtocolVersion1,
		send:     make(chan []byte, 256),
		hub:      handlers.GetHub(),
	}

	// Register connection
	handlers.GetHub().register <- conn
	time.Sleep(10 * time.Millisecond)

	// First, create a subscription
	subscribeMsg := &WebSocketMessage{
		Type: "stream_subscribe",
		ID:   "req-sub-initial",
		Data: json.RawMessage(`{
			"pose": {
				"ring_position": 10000,
				"width_offset": 0,
				"elevation": 0,
				"active_floor": 0
			},
			"radius_meters": 5000,
			"width_meters": 5000,
			"include_chunks": true,
			"include_zones": false
		}`),
	}

	handlers.handleStreamSubscribe(conn, subscribeMsg)

	// Wait for subscription ack
	var subscriptionID string
	select {
	case responseBytes := <-conn.send:
		var response WebSocketMessage
		if err := json.Unmarshal(responseBytes, &response); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}
		var ackData struct {
			SubscriptionID string `json:"subscription_id"`
		}
		if err := json.Unmarshal(response.Data, &ackData); err != nil {
			t.Fatalf("Failed to unmarshal ack data: %v", err)
		}
		subscriptionID = ackData.SubscriptionID
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for subscription ack")
	}

	if subscriptionID == "" {
		t.Fatal("Failed to get subscription ID")
	}

	tests := []struct {
		name        string
		message     *WebSocketMessage
		expectError bool
		errorCode   string
	}{
		{
			name: "valid stream_update_pose",
			message: &WebSocketMessage{
				Type: "stream_update_pose",
				ID:   "req-pose-1",
				Data: json.RawMessage(fmt.Sprintf(`{
					"subscription_id": "%s",
					"pose": {
						"ring_position": 20000,
						"width_offset": 0,
						"elevation": 0,
						"active_floor": 0
					}
				}`, subscriptionID)),
			},
			expectError: false,
		},
		{
			name: "invalid stream_update_pose payload",
			message: &WebSocketMessage{
				Type: "stream_update_pose",
				ID:   "req-pose-2",
				Data: json.RawMessage(`{"invalid": "data"}`),
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name: "missing subscription_id",
			message: &WebSocketMessage{
				Type: "stream_update_pose",
				ID:   "req-pose-3",
				Data: json.RawMessage(`{
					"pose": {
						"ring_position": 20000,
						"active_floor": 0
					}
				}`),
			},
			expectError: true,
			errorCode:   "InvalidMessageFormat",
		},
		{
			name: "invalid subscription_id",
			message: &WebSocketMessage{
				Type: "stream_update_pose",
				ID:   "req-pose-4",
				Data: json.RawMessage(`{
					"subscription_id": "nonexistent",
					"pose": {
						"ring_position": 20000,
						"active_floor": 0
					}
				}`),
			},
			expectError: true,
			errorCode:   "InvalidSubscriptionRequest",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear send channel
			for len(conn.send) > 0 {
				<-conn.send
			}

			handlers.handleStreamUpdatePose(conn, tt.message)

			// Wait for response
			select {
			case responseBytes := <-conn.send:
				var response WebSocketMessage
				if err := json.Unmarshal(responseBytes, &response); err != nil {
					t.Fatalf("Failed to unmarshal response: %v", err)
				}

				if tt.expectError {
					// Should receive error message
					var errorMsg WebSocketError
					if err := json.Unmarshal(responseBytes, &errorMsg); err != nil {
						t.Fatalf("Failed to unmarshal error: %v", err)
					}
					if errorMsg.Type != "error" {
						t.Errorf("Expected error message, got type %s", response.Type)
					}
					if errorMsg.Code != tt.errorCode {
						t.Errorf("Expected error code %s, got %s", tt.errorCode, errorMsg.Code)
					}
				} else {
					// Should receive stream_pose_ack message
					if response.Type != "stream_pose_ack" {
						t.Errorf("Expected stream_pose_ack message, got type %s", response.Type)
					}
					if response.ID != tt.message.ID {
						t.Errorf("Expected response ID %s, got %s", tt.message.ID, response.ID)
					}

					var ackData struct {
						SubscriptionID string `json:"subscription_id"`
						Message        string `json:"message"`
					}
					if err := json.Unmarshal(response.Data, &ackData); err != nil {
						t.Fatalf("Failed to unmarshal ack data: %v", err)
					}
					if ackData.SubscriptionID != subscriptionID {
						t.Errorf("Expected subscription_id %s, got %s", subscriptionID, ackData.SubscriptionID)
					}
				}
			case <-time.After(1 * time.Second):
				if !tt.expectError {
					t.Error("Timeout waiting for response")
				}
			}
		})
	}

	// Unregister connection
	handlers.GetHub().unregister <- conn
	time.Sleep(10 * time.Millisecond)
}
