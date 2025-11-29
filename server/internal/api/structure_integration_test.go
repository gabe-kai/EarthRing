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

// StructureIntegrationTestFramework provides utilities for structure API integration tests
type StructureIntegrationTestFramework struct {
	t            *testing.T
	db           *sql.DB
	cfg          *config.Config
	handlers     *StructureHandlers
	mux          *http.ServeMux
	server       *httptest.Server
	jwtService   *auth.JWTService
	testUserID   int64
	testUsername string
	testToken    string
}

// NewStructureIntegrationTestFramework creates a new integration test framework for structures
func NewStructureIntegrationTestFramework(t *testing.T) *StructureIntegrationTestFramework {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	// Create required tables
	_, err = db.Exec(`
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

	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}

	handlers := NewStructureHandlers(db, cfg)

	// Create test player
	passwordService := auth.NewPasswordService(cfg)
	hashedPassword, err := passwordService.HashPassword("Password123!")
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}

	username := testutil.RandomUsername()
	email := testutil.RandomEmail()

	var userID int64
	err = db.QueryRow(`
		INSERT INTO players (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id
	`, username, email, hashedPassword).Scan(&userID)
	if err != nil {
		t.Fatalf("Failed to create test player: %v", err)
	}

	jwtService := auth.NewJWTService(cfg)
	token, err := jwtService.GenerateAccessToken(userID, username, "player")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	// Create HTTP mux with routes
	mux := http.NewServeMux()
	SetupStructureRoutes(mux, db, cfg)

	// Create test server
	server := httptest.NewServer(mux)

	return &StructureIntegrationTestFramework{
		t:            t,
		db:           db,
		cfg:          cfg,
		handlers:     handlers,
		mux:          mux,
		server:       server,
		jwtService:   jwtService,
		testUserID:   userID,
		testUsername: username,
		testToken:    token,
	}
}

// Close cleans up the test framework
func (f *StructureIntegrationTestFramework) Close() {
	if f.server != nil {
		f.server.Close()
	}
}

// MakeRequest makes an authenticated HTTP request to the test server
func (f *StructureIntegrationTestFramework) MakeRequest(method, path string, body interface{}) *httptest.ResponseRecorder {
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = json.Marshal(body)
		if err != nil {
			f.t.Fatalf("Failed to marshal request body: %v", err)
		}
	}

	req := httptest.NewRequest(method, f.server.URL+path, bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+f.testToken)
	req.Header.Set("Content-Type", "application/json")

	// Add auth context
	ctx := context.WithValue(req.Context(), auth.UserIDKey, f.testUserID)
	ctx = context.WithValue(ctx, auth.RoleKey, "player")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	f.mux.ServeHTTP(rr, req)

	return rr
}

// TestIntegration_CreateAndGetStructure tests full HTTP cycle for structure creation and retrieval
func TestIntegration_CreateAndGetStructure(t *testing.T) {
	framework := NewStructureIntegrationTestFramework(t)
	defer framework.Close()

	// Create structure via HTTP
	createReq := map[string]interface{}{
		"structure_type": "building",
		"floor":          0,
		"position": map[string]float64{
			"x": 1000.0,
			"y": 50.0,
		},
		"rotation": 45.0,
		"scale":    1.0,
	}

	rr := framework.MakeRequest("POST", "/api/structures", createReq)
	if rr.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var createResponse structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&createResponse); err != nil {
		t.Fatalf("Failed to decode create response: %v", err)
	}

	if createResponse.ID == 0 {
		t.Fatal("Expected structure ID to be set")
	}

	// Get structure via HTTP (note: path parsing in routes expects /api/structures/{id})
	rr = framework.MakeRequest("GET", "/api/structures/"+strconv.FormatInt(createResponse.ID, 10), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var getResponse structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&getResponse); err != nil {
		t.Fatalf("Failed to decode get response: %v", err)
	}

	if getResponse.ID != createResponse.ID {
		t.Fatalf("Expected structure ID %d, got %d", createResponse.ID, getResponse.ID)
	}
	if getResponse.Position.X != 1000.0 || getResponse.Position.Y != 50.0 {
		t.Fatalf("Expected position (1000.0, 50.0), got (%f, %f)", getResponse.Position.X, getResponse.Position.Y)
	}
}

// TestIntegration_StructureCoordinateWrapping tests structure operations at ring boundaries via HTTP
func TestIntegration_StructureCoordinateWrapping(t *testing.T) {
	framework := NewStructureIntegrationTestFramework(t)
	defer framework.Close()

	// Create structure near ring start (0)
	createReq1 := map[string]interface{}{
		"structure_type": "building",
		"floor":          0,
		"position": map[string]float64{
			"x": 100.0,
			"y": 50.0,
		},
		"rotation": 0.0,
		"scale":    1.0,
	}

	rr := framework.MakeRequest("POST", "/api/structures", createReq1)
	if rr.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var response1 structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&response1); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response1.Position.X != 100.0 || response1.Position.Y != 50.0 {
		t.Fatalf("Expected position (100.0, 50.0), got (%f, %f)", response1.Position.X, response1.Position.Y)
	}

	// Create structure near ring end (263,999,000)
	createReq2 := map[string]interface{}{
		"structure_type": "building",
		"floor":          0,
		"position": map[string]float64{
			"x": 263999000.0,
			"y": -100.0,
		},
		"rotation": 0.0,
		"scale":    1.0,
	}

	rr = framework.MakeRequest("POST", "/api/structures", createReq2)
	if rr.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var response2 structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&response2); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response2.Position.X != 263999000.0 || response2.Position.Y != -100.0 {
		t.Fatalf("Expected position (263999000.0, -100.0), got (%f, %f)", response2.Position.X, response2.Position.Y)
	}

	// Query structures by area near start
	rr = framework.MakeRequest("GET", "/api/structures/area?min_x=0&max_x=1000&min_y=-200&max_y=200&floor=0", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var listResponse []structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&listResponse); err != nil {
		t.Fatalf("Failed to decode list response: %v", err)
	}

	foundNear0 := false
	for _, s := range listResponse {
		if s.ID == response1.ID {
			foundNear0 = true
			break
		}
	}
	if !foundNear0 {
		t.Error("Failed to find structure near 0 in area query")
	}
}

// TestIntegration_StructureZoneRelationship tests structure-zone relationships via HTTP
func TestIntegration_StructureZoneRelationship(t *testing.T) {
	framework := NewStructureIntegrationTestFramework(t)
	defer framework.Close()

	// Create zones table
	_, err := framework.db.Exec(`
		CREATE TABLE IF NOT EXISTS zones (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			zone_type VARCHAR(50) NOT NULL,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			floor INTEGER NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create zones table: %v", err)
	}

	// Create a test zone
	var zoneID int64
	err = framework.db.QueryRow(`
		INSERT INTO zones (name, zone_type, geometry, floor)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromText('POLYGON((1000 -100, 2000 -100, 2000 100, 1000 100, 1000 -100))'), 0), $3)
		RETURNING id
	`, "Test Zone", "residential", 0).Scan(&zoneID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	// Create structure with zone_id
	createReq := map[string]interface{}{
		"structure_type": "building",
		"floor":          0,
		"position": map[string]float64{
			"x": 1500.0,
			"y": 0.0,
		},
		"rotation": 0.0,
		"scale":    1.0,
		"zone_id":  zoneID,
	}

	rr := framework.MakeRequest("POST", "/api/structures", createReq)
	if rr.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var response structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.ZoneID == nil || *response.ZoneID != zoneID {
		t.Fatalf("Expected zone_id %d, got %v", zoneID, response.ZoneID)
	}

	// Update structure to remove zone_id
	updateReq := map[string]interface{}{
		"zone_id": nil,
	}

	rr = framework.MakeRequest("PUT", "/api/structures/"+strconv.FormatInt(response.ID, 10), updateReq)
	if rr.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var updateResponse structureResponse
	if err := json.NewDecoder(rr.Body).Decode(&updateResponse); err != nil {
		t.Fatalf("Failed to decode update response: %v", err)
	}

	if updateResponse.ZoneID != nil {
		t.Errorf("Expected zone_id to be nil after update, got %v", updateResponse.ZoneID)
	}
}

// TestIntegration_UnauthorizedAccess tests that unauthorized requests are rejected
func TestIntegration_UnauthorizedAccess(t *testing.T) {
	framework := NewStructureIntegrationTestFramework(t)
	defer framework.Close()

	// Request without authentication
	req := httptest.NewRequest("GET", framework.server.URL+"/api/structures/1", nil)
	rr := httptest.NewRecorder()
	framework.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("Expected status 401, got %d: %s", rr.Code, rr.Body.String())
	}
}

