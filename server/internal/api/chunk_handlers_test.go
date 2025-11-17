package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/testutil"
)

func TestGetChunkMetadata(t *testing.T) {
	// Setup test database
	db := testutil.SetupTestDB(t)
	defer db.Close()

	// Run migrations (simplified - just create chunks table)
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

	// Clean up any existing test chunk first
	_, _ = db.Exec("DELETE FROM chunks WHERE floor = $1 AND chunk_index = $2", 0, 12345)

	// Create test chunk
	var chunkID int64
	err = db.QueryRow(`
		INSERT INTO chunks (floor, chunk_index, version, is_dirty)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, 0, 12345, 2, false).Scan(&chunkID)
	if err != nil {
		t.Fatalf("Failed to create test chunk: %v", err)
	}

	// Create config
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	// Create JWT service and generate token
	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(1, "testuser", "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create handlers
	handlers := NewChunkHandlers(db, cfg)

	// Create request
	req := httptest.NewRequest("GET", "/api/chunks/0_12345", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	// Add user context (normally done by AuthMiddleware)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, int64(1))
	req = req.WithContext(ctx)

	// Create response recorder
	rr := httptest.NewRecorder()

	// Call handler
	handlers.GetChunkMetadata(rr, req)

	// Check status code
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
		return
	}

	// Parse response
	var metadata ChunkMetadata
	if err := json.NewDecoder(rr.Body).Decode(&metadata); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify metadata
	if metadata.ID != "0_12345" {
		t.Errorf("Expected ID '0_12345', got '%s'", metadata.ID)
	}
	if metadata.Floor != 0 {
		t.Errorf("Expected floor 0, got %d", metadata.Floor)
	}
	if metadata.ChunkIndex != 12345 {
		t.Errorf("Expected chunk_index 12345, got %d", metadata.ChunkIndex)
	}
	if metadata.Version != 2 {
		t.Errorf("Expected version 2, got %d", metadata.Version)
	}
	if metadata.IsDirty {
		t.Error("Expected is_dirty to be false")
	}
}

func TestGetChunkMetadata_NonExistent(t *testing.T) {
	// Setup test database
	db := testutil.SetupTestDB(t)
	defer db.Close()

	// Run migrations (simplified - just create chunks table)
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

	// Create config
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	// Create JWT service and generate token
	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(1, "testuser", "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create handlers
	handlers := NewChunkHandlers(db, cfg)

	// Create request for non-existent chunk
	req := httptest.NewRequest("GET", "/api/chunks/0_99999", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	// Add user context
	ctx := context.WithValue(req.Context(), auth.UserIDKey, int64(1))
	req = req.WithContext(ctx)

	// Create response recorder
	rr := httptest.NewRecorder()

	// Call handler
	handlers.GetChunkMetadata(rr, req)

	// Check status code (should return 200 with default metadata)
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
		return
	}

	// Parse response
	var metadata ChunkMetadata
	if err := json.NewDecoder(rr.Body).Decode(&metadata); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify default metadata
	if metadata.ID != "0_99999" {
		t.Errorf("Expected ID '0_99999', got '%s'", metadata.ID)
	}
	if metadata.Floor != 0 {
		t.Errorf("Expected floor 0, got %d", metadata.Floor)
	}
	if metadata.ChunkIndex != 99999 {
		t.Errorf("Expected chunk_index 99999, got %d", metadata.ChunkIndex)
	}
	if metadata.Version != 1 {
		t.Errorf("Expected default version 1, got %d", metadata.Version)
	}
	if metadata.IsDirty {
		t.Error("Expected is_dirty to be false")
	}
}

func TestGetChunkMetadata_InvalidFormat(t *testing.T) {
	// Setup test database
	db := testutil.SetupTestDB(t)
	defer db.Close()

	// Create config
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	// Create JWT service and generate token
	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(1, "testuser", "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create handlers
	handlers := NewChunkHandlers(db, cfg)

	// Test cases for invalid chunk IDs
	testCases := []struct {
		name     string
		chunkID  string
		wantCode int
	}{
		{"invalid format", "invalid", http.StatusBadRequest},
		{"missing underscore", "012345", http.StatusBadRequest},
		{"too many parts", "0_12345_extra", http.StatusBadRequest},
		{"invalid floor", "abc_12345", http.StatusBadRequest},
		{"invalid chunk_index", "0_abc", http.StatusBadRequest},
		{"chunk_index out of range", "0_264000", http.StatusBadRequest},
		{"negative chunk_index", "0_-1", http.StatusBadRequest},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/chunks/"+tc.chunkID, nil)
			req.Header.Set("Authorization", "Bearer "+token)

			ctx := context.WithValue(req.Context(), auth.UserIDKey, int64(1))
			req = req.WithContext(ctx)

			rr := httptest.NewRecorder()
			handlers.GetChunkMetadata(rr, req)

			if rr.Code != tc.wantCode {
				t.Errorf("Expected status %d, got %d. Body: %s", tc.wantCode, rr.Code, rr.Body.String())
			}
		})
	}
}
