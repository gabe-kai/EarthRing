package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/testutil"
)

func TestGetCurrentPlayerProfile(t *testing.T) {
	// Setup test database
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Run migrations (simplified - just create players table)
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

	// Create test player with unique username/email
	passwordService := auth.NewPasswordService(&config.Config{})
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

	player := struct {
		ID       int64
		Username string
		Email    string
	}{ID: playerID, Username: username, Email: email}

	// Create config
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	// Create JWT service and generate token
	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(player.ID, player.Username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create handlers
	handlers := NewPlayerHandlers(db, cfg)

	// Create request
	req := httptest.NewRequest("GET", "/api/players/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	// Add user context (normally done by AuthMiddleware)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, player.ID)
	req = req.WithContext(ctx)

	// Create response recorder
	rr := httptest.NewRecorder()

	// Call handler
	handlers.GetCurrentPlayerProfile(rr, req)

	// Check status code
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
		return
	}

	// Parse response
	var profile PlayerProfile
	if err := json.NewDecoder(rr.Body).Decode(&profile); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify profile data
	if profile.ID != player.ID {
		t.Errorf("Expected ID %d, got %d", player.ID, profile.ID)
	}
	if profile.Username != player.Username {
		t.Errorf("Expected username %s, got %s", player.Username, profile.Username)
	}
}

func TestUpdatePlayerPosition(t *testing.T) {
	// Setup test database
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Run migrations (simplified - just create players table)
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

	// Create test player with unique username/email
	passwordService := auth.NewPasswordService(&config.Config{})
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

	player := struct {
		ID       int64
		Username string
		Email    string
	}{ID: playerID, Username: username, Email: email}

	// Create config
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	// Create JWT service and generate token
	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(player.ID, player.Username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create handlers
	handlers := NewPlayerHandlers(db, cfg)

	// Create request body
	updateReq := UpdatePositionRequest{
		Position: Position{X: 12345.0, Y: 100.0},
		Floor:    0,
	}
	body, err := json.Marshal(updateReq)
	if err != nil {
		t.Fatalf("Failed to marshal update request: %v", err)
	}

	// Create request
	req := httptest.NewRequest("PUT", "/api/players/"+strconv.FormatInt(player.ID, 10)+"/position", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	// Add user context (normally done by AuthMiddleware)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, player.ID)
	req = req.WithContext(ctx)

	// Create response recorder
	rr := httptest.NewRecorder()

	// Call handler
	handlers.UpdatePlayerPosition(rr, req)

	// Check status code
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
		return
	}

	// Parse response
	var response UpdatePositionResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify response
	if !response.Success {
		t.Error("Expected success to be true")
	}
	if response.Position.X != updateReq.Position.X || response.Position.Y != updateReq.Position.Y {
		t.Errorf("Expected position %+v, got %+v", updateReq.Position, response.Position)
	}

	// Verify position was updated in database
	var posX, posY sql.NullFloat64
	var floor int
	err = db.QueryRow("SELECT CASE WHEN current_position IS NULL THEN NULL ELSE ST_X(current_position::geometry) END, CASE WHEN current_position IS NULL THEN NULL ELSE ST_Y(current_position::geometry) END, current_floor FROM players WHERE id = $1", player.ID).Scan(&posX, &posY, &floor)
	if err != nil {
		t.Fatalf("Failed to query updated position: %v", err)
	}
	if !posX.Valid || posX.Float64 != updateReq.Position.X {
		t.Errorf("Expected X position %f, got %v", updateReq.Position.X, posX)
	}
	if !posY.Valid || posY.Float64 != updateReq.Position.Y {
		t.Errorf("Expected Y position %f, got %v", updateReq.Position.Y, posY)
	}
	if floor != updateReq.Floor {
		t.Errorf("Expected floor %d, got %d", updateReq.Floor, floor)
	}
}
