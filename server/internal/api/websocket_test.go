package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
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

	handlers := NewWebSocketHandlers(nil, cfg)
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

	handlers := NewWebSocketHandlers(nil, cfg)

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

	handlers := NewWebSocketHandlers(nil, cfg)

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
	defer db.Close()

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

	handlers := NewWebSocketHandlers(db, cfg)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, _ := passwordService.HashPassword("password123")
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

func TestWebSocketHandlers_HandleWebSocket_VersionNegotiation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer db.Close()

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

	handlers := NewWebSocketHandlers(db, cfg)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, _ := passwordService.HashPassword("password123")
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
	defer db.Close()

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	handlers := NewWebSocketHandlers(db, cfg)

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
			name: "chunk_request message",
			message: &WebSocketMessage{
				Type: "chunk_request",
				ID:   "req-123",
				Data: json.RawMessage(`{"chunks":["0_12345"]}`),
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
	defer db.Close()

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	handlers := NewWebSocketHandlers(db, cfg)

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
	defer db.Close()

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

	handlers := NewWebSocketHandlers(db, cfg)
	go handlers.GetHub().Run()

	// Create a test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, _ := passwordService.HashPassword("password123")
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
	defer conn.Close()

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
