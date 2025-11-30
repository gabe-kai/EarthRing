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
	"github.com/earthring/server/internal/database"
	"github.com/earthring/server/internal/testutil"
)

func createStructuresTableForTest(t *testing.T, db *sql.DB) {
	t.Helper()
	// Create PostGIS extension if needed
	_, _ = db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`) //nolint:errcheck // Test setup - extension may already exist

	// Drop table if exists to ensure clean state
	_, _ = db.Exec(`DROP TABLE IF EXISTS structures CASCADE`) //nolint:errcheck // Test setup - table may not exist

	_, err := db.Exec(`
		CREATE TABLE structures (
			id SERIAL PRIMARY KEY,
			structure_type VARCHAR(50) NOT NULL,
			position GEOMETRY(POINT, 0) NOT NULL,
			floor INTEGER DEFAULT 0 NOT NULL,
			rotation REAL DEFAULT 0,
			scale REAL DEFAULT 1.0,
			owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
			zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
			is_procedural BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			properties JSONB,
			model_data JSONB
		);
		CREATE INDEX idx_structures_position ON structures USING GIST(position);
	`)
	if err != nil {
		t.Fatalf("failed to create structures table: %v", err)
	}
}

func TestStructureHandlers_CreateStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	createStructuresTableForTest(t, db)

	// Create test player
	passwordService := auth.NewPasswordService(&config.Config{})
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id
	`, username, email, hashedPassword).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	handlers := NewStructureHandlers(db, cfg)

	// Create structure request
	reqBody := map[string]interface{}{
		"structure_type": "building",
		"floor":          0,
		"position": map[string]float64{
			"x": 1000.0,
			"y": 50.0,
		},
		"rotation": 45.0,
		"scale":    1.0,
	}
	body, _ := json.Marshal(reqBody) //nolint:errcheck // Test setup - will fail later if marshal fails

	req := httptest.NewRequest("POST", "/api/structures", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, playerID)
	ctx = context.WithValue(ctx, auth.RoleKey, "player")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handlers.CreateStructure(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var response structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.ID == 0 {
		t.Fatal("expected structure ID to be set")
	}
	if response.StructureType != "building" {
		t.Fatalf("expected structure_type building, got %s", response.StructureType)
	}
	if response.Position.X != 1000.0 || response.Position.Y != 50.0 {
		t.Fatalf("expected position (1000.0, 50.0), got (%f, %f)", response.Position.X, response.Position.Y)
	}
	if response.OwnerID == nil || *response.OwnerID != playerID {
		t.Fatalf("expected owner_id %d, got %v", playerID, response.OwnerID)
	}
}

func TestStructureHandlers_GetStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	createStructuresTableForTest(t, db)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	handlers := NewStructureHandlers(db, cfg)
	storage := database.NewStructureStorage(db)

	// Create a structure directly
	structure, err := storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      database.Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	// Get structure via handler
	req := httptest.NewRequest("GET", "/api/structures/"+strconv.FormatInt(structure.ID, 10), nil)
	rr := httptest.NewRecorder()
	handlers.GetStructure(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var response structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.ID != structure.ID {
		t.Fatalf("expected structure ID %d, got %d", structure.ID, response.ID)
	}
}

func TestStructureHandlers_GetStructureNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	createStructuresTableForTest(t, db)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	handlers := NewStructureHandlers(db, cfg)

	req := httptest.NewRequest("GET", "/api/structures/99999", nil)
	rr := httptest.NewRecorder()
	handlers.GetStructure(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestStructureHandlers_UpdateStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	createStructuresTableForTest(t, db)

	// Create test player
	passwordService := auth.NewPasswordService(&config.Config{})
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id
	`, username, email, hashedPassword).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	handlers := NewStructureHandlers(db, cfg)
	storage := database.NewStructureStorage(db)

	// Create a structure owned by the player
	structure, err := storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		OwnerID:       &playerID,
		Position:      database.Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	// Update structure
	newType := "road"
	newRotation := 90.0
	reqBody := map[string]interface{}{
		"structure_type": newType,
		"rotation":       newRotation,
	}
	body, _ := json.Marshal(reqBody) //nolint:errcheck // Test setup - will fail later if marshal fails

	req := httptest.NewRequest("PUT", "/api/structures/"+strconv.FormatInt(structure.ID, 10), bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, playerID)
	ctx = context.WithValue(ctx, auth.RoleKey, "player")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handlers.UpdateStructure(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var response structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.StructureType != newType {
		t.Fatalf("expected structure_type %s, got %s", newType, response.StructureType)
	}
	if response.Rotation != newRotation {
		t.Fatalf("expected rotation %f, got %f", newRotation, response.Rotation)
	}
}

func TestStructureHandlers_DeleteStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	createStructuresTableForTest(t, db)

	// Create test player
	passwordService := auth.NewPasswordService(&config.Config{})
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id
	`, username, email, hashedPassword).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	handlers := NewStructureHandlers(db, cfg)
	storage := database.NewStructureStorage(db)

	// Create a structure owned by the player
	structure, err := storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		OwnerID:       &playerID,
		Position:      database.Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	// Delete structure
	req := httptest.NewRequest("DELETE", "/api/structures/"+strconv.FormatInt(structure.ID, 10), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, playerID)
	ctx = context.WithValue(ctx, auth.RoleKey, "player")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handlers.DeleteStructure(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify structure is deleted
	_, err = storage.GetStructure(structure.ID)
	if err == nil {
		t.Fatal("expected structure to be deleted")
	}
}

func TestStructureHandlers_ListStructuresByArea(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	createStructuresTableForTest(t, db)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	handlers := NewStructureHandlers(db, cfg)
	storage := database.NewStructureStorage(db)

	// Create structures at different positions
	_, err := storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      database.Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	_, err = storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      database.Position{X: 5000.0, Y: 200.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	// Query structures in area
	req := httptest.NewRequest("GET", "/api/structures/area?x_min=500&x_max=2000&y_min=0&y_max=100&floor=0", nil)
	rr := httptest.NewRecorder()
	handlers.ListStructuresByArea(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	structures, ok := response["structures"].([]interface{})
	if !ok {
		t.Fatal("expected structures array in response")
	}
	if len(structures) != 1 {
		t.Fatalf("expected 1 structure in area, got %d", len(structures))
	}
}

func TestStructureHandlers_ListStructuresByOwner(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create players table
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS players (
			id SERIAL PRIMARY KEY,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create players table: %v", err)
	}

	createStructuresTableForTest(t, db)

	// Create test player
	passwordService := auth.NewPasswordService(&config.Config{})
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var playerID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id
	`, username, email, hashedPassword).Scan(&playerID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(playerID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	handlers := NewStructureHandlers(db, cfg)
	storage := database.NewStructureStorage(db)

	// Create structures for the player
	_, err = storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		OwnerID:       &playerID,
		Position:      database.Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	_, err = storage.CreateStructure(&database.StructureCreateInput{
		StructureType: "road",
		Floor:         0,
		OwnerID:       &playerID,
		Position:      database.Position{X: 2000.0, Y: 0.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure: %v", err)
	}

	// Query structures by owner
	req := httptest.NewRequest("GET", "/api/structures/owner/"+strconv.FormatInt(playerID, 10), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, playerID)
	ctx = context.WithValue(ctx, auth.RoleKey, "player")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handlers.ListStructuresByOwner(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	structures, ok := response["structures"].([]interface{})
	if !ok {
		t.Fatal("expected structures array in response")
	}
	if len(structures) != 2 {
		t.Fatalf("expected 2 structures for owner, got %d", len(structures))
	}
}
