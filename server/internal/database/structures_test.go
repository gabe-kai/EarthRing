package database

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/earthring/server/internal/testutil"
)

func createStructuresTable(t *testing.T, db *sql.DB) {
	t.Helper()
	// Drop table if it exists to ensure we use the correct type
	_, _ = db.Exec(`DROP TABLE IF EXISTS structures CASCADE`)
	// Use PostGIS geometry instead of PostgreSQL POINT for compatibility with PostGIS functions
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
		CREATE INDEX IF NOT EXISTS idx_structures_position ON structures USING GIST(position);
		CREATE INDEX IF NOT EXISTS idx_structures_owner ON structures(owner_id);
		CREATE INDEX IF NOT EXISTS idx_structures_zone ON structures(zone_id);
		CREATE INDEX IF NOT EXISTS idx_structures_floor ON structures(floor);
		CREATE INDEX IF NOT EXISTS idx_structures_type ON structures(structure_type);
	`)
	if err != nil {
		t.Fatalf("failed to create structures table: %v", err)
	}
}

func truncateStructuresTable(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`TRUNCATE TABLE structures RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatalf("failed to truncate structures table: %v", err)
	}
}

func TestStructureStorage_CreateAndGetStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	ownerID := int64(1)
	properties := json.RawMessage(`{"height":10.5,"material":"concrete"}`)
	modelData := json.RawMessage(`{"model":"building_01","lod":1}`)

	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		OwnerID:       &ownerID,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      45.0,
		Scale:         1.0,
		Properties:    properties,
		ModelData:     modelData,
	})
	if err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}
	if structure.ID == 0 {
		t.Fatal("expected structure ID to be set")
	}
	if structure.StructureType != "building" {
		t.Fatalf("expected structure_type building, got %s", structure.StructureType)
	}
	if structure.Position.X != 1000.0 || structure.Position.Y != 50.0 {
		t.Fatalf("expected position (1000.0, 50.0), got (%f, %f)", structure.Position.X, structure.Position.Y)
	}
	if structure.Rotation != 45.0 {
		t.Fatalf("expected rotation 45.0, got %f", structure.Rotation)
	}
	if structure.Scale != 1.0 {
		t.Fatalf("expected scale 1.0, got %f", structure.Scale)
	}
	if structure.OwnerID == nil || *structure.OwnerID != ownerID {
		t.Fatalf("expected owner_id %d, got %v", ownerID, structure.OwnerID)
	}
	if !jsonEqualTest(structure.Properties, properties) {
		t.Fatalf("expected properties %s, got %s", properties, structure.Properties)
	}
	if !jsonEqualTest(structure.ModelData, modelData) {
		t.Fatalf("expected model_data %s, got %s", modelData, structure.ModelData)
	}

	// Get the structure back
	stored, err := storage.GetStructure(structure.ID)
	if err != nil {
		t.Fatalf("GetStructure failed: %v", err)
	}
	if stored == nil {
		t.Fatal("expected structure to be found")
	}
	if stored.StructureType != "building" {
		t.Fatalf("expected structure_type building, got %s", stored.StructureType)
	}
	if stored.Position.X != 1000.0 || stored.Position.Y != 50.0 {
		t.Fatalf("expected position (1000.0, 50.0), got (%f, %f)", stored.Position.X, stored.Position.Y)
	}
}

func TestStructureStorage_CreateStructureWithProceduralFields(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	proceduralSeed := int64(12345)

	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType:  "decoration",
		Floor:          1,
		IsProcedural:   true,
		ProceduralSeed: &proceduralSeed,
		Position:       Position{X: 5000.0, Y: -100.0},
		Rotation:       90.0,
		Scale:          2.0,
	})
	if err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}
	if !structure.IsProcedural {
		t.Fatal("expected is_procedural to be true")
	}
	if structure.ProceduralSeed == nil || *structure.ProceduralSeed != proceduralSeed {
		t.Fatalf("expected procedural_seed %d, got %v", proceduralSeed, structure.ProceduralSeed)
	}
}

func TestStructureStorage_CreateStructureWithZoneID(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	
	// Create zones table and insert a test zone
	_, err := db.Exec(`
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
	
	// Insert a test zone
	var zoneID int64
	err = db.QueryRow(`
		INSERT INTO zones (name, zone_type, geometry, floor)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 100 0, 100 100, 0 100, 0 0))'), 0), $3)
		RETURNING id
	`, "Test Zone", "residential", 0).Scan(&zoneID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}
	
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:        0,
		ZoneID:       &zoneID,
		Position:     Position{X: 2000.0, Y: 0.0},
		Rotation:     0.0,
		Scale:        1.0,
	})
	if err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}
	if structure.ZoneID == nil || *structure.ZoneID != zoneID {
		t.Fatalf("expected zone_id %d, got %v", zoneID, structure.ZoneID)
	}
}

func TestStructureStorage_UpdateStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}

	newType := "road"
	newFloor := 1
	newRotation := 90.0
	newScale := 2.0
	newPosition := Position{X: 2000.0, Y: 100.0}
	newProperties := json.RawMessage(`{"width":5.0}`)

	updated, err := storage.UpdateStructure(structure.ID, &StructureUpdateInput{
		StructureType: &newType,
		Floor:         &newFloor,
		Rotation:      &newRotation,
		Scale:         &newScale,
		Position:      &newPosition,
		Properties:    &newProperties,
	})
	if err != nil {
		t.Fatalf("UpdateStructure failed: %v", err)
	}

	if updated.StructureType != newType {
		t.Fatalf("expected structure_type %s, got %s", newType, updated.StructureType)
	}
	if updated.Floor != newFloor {
		t.Fatalf("expected floor %d, got %d", newFloor, updated.Floor)
	}
	if updated.Rotation != newRotation {
		t.Fatalf("expected rotation %f, got %f", newRotation, updated.Rotation)
	}
	if updated.Scale != newScale {
		t.Fatalf("expected scale %f, got %f", newScale, updated.Scale)
	}
	if updated.Position.X != newPosition.X || updated.Position.Y != newPosition.Y {
		t.Fatalf("expected position (%f, %f), got (%f, %f)", newPosition.X, newPosition.Y, updated.Position.X, updated.Position.Y)
	}
	if !jsonEqualTest(updated.Properties, newProperties) {
		t.Fatalf("expected properties %s, got %s", newProperties, updated.Properties)
	}
}

func TestStructureStorage_UpdateStructureWithNullFields(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	
	// Create zones table and insert a test zone
	_, err := db.Exec(`
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
	
	// Insert a test zone
	var zoneID int64
	err = db.QueryRow(`
		INSERT INTO zones (name, zone_type, geometry, floor)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 100 0, 100 100, 0 100, 0 0))'), 0), $3)
		RETURNING id
	`, "Test Zone", "residential", 0).Scan(&zoneID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}
	
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	ownerID := int64(1)
	proceduralSeed := int64(123)

	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType:  "building",
		Floor:          0,
		OwnerID:        &ownerID,
		ZoneID:         &zoneID,
		ProceduralSeed: &proceduralSeed,
		Position:       Position{X: 1000.0, Y: 50.0},
		Rotation:       0.0,
		Scale:          1.0,
	})
	if err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}

	// Update to set owner_id, zone_id, and procedural_seed to NULL
	updated, err := storage.UpdateStructure(structure.ID, &StructureUpdateInput{
		OwnerIDSet:        true,
		OwnerID:           nil,
		ZoneIDSet:         true,
		ZoneID:            nil,
		ProceduralSeedSet: true,
		ProceduralSeed:    nil,
	})
	if err != nil {
		t.Fatalf("UpdateStructure failed: %v", err)
	}

	if updated.OwnerID != nil {
		t.Fatalf("expected owner_id to be nil, got %v", updated.OwnerID)
	}
	if updated.ZoneID != nil {
		t.Fatalf("expected zone_id to be nil, got %v", updated.ZoneID)
	}
	if updated.ProceduralSeed != nil {
		t.Fatalf("expected procedural_seed to be nil, got %v", updated.ProceduralSeed)
	}
}

func TestStructureStorage_DeleteStructure(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("CreateStructure failed: %v", err)
	}

	if err := storage.DeleteStructure(structure.ID); err != nil {
		t.Fatalf("DeleteStructure failed: %v", err)
	}

	// Verify structure is deleted
	_, err = storage.GetStructure(structure.ID)
	if err == nil {
		t.Fatal("expected GetStructure to fail after deletion")
	}
	if !containsError(err.Error(), "not found") {
		t.Fatalf("expected 'not found' error, got: %v", err)
	}
}

func TestStructureStorage_ListStructuresByArea(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	// Create structures at different positions
	_, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("failed to create structure: %v", err)
	}

	_, err = storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 5000.0, Y: 200.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("failed to create structure: %v", err)
	}

	// Create structure on different floor (should not be included)
	_, err = storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         1,
		Position:      Position{X: 1500.0, Y: 60.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("failed to create structure: %v", err)
	}

	// Query structures in area (should find first structure only)
	structures, err := storage.ListStructuresByArea(500.0, 2000.0, 0.0, 100.0, 0)
	if err != nil {
		t.Fatalf("ListStructuresByArea failed: %v", err)
	}
	if len(structures) != 1 {
		t.Fatalf("expected 1 structure in area, got %d", len(structures))
	}
	if structures[0].Position.X != 1000.0 {
		t.Fatalf("expected structure at X=1000.0, got X=%f", structures[0].Position.X)
	}
}

func TestStructureStorage_ListStructuresByOwner(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	ownerID1 := int64(1)
	ownerID2 := int64(2)

	// Create structures for owner 1
	_, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		OwnerID:       &ownerID1,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("failed to create structure: %v", err)
	}

	_, err = storage.CreateStructure(&StructureCreateInput{
		StructureType: "road",
		Floor:         0,
		OwnerID:       &ownerID1,
		Position:      Position{X: 2000.0, Y: 0.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("failed to create structure: %v", err)
	}

	// Create structure for owner 2
	_, err = storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		OwnerID:       &ownerID2,
		Position:      Position{X: 3000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("failed to create structure: %v", err)
	}

	// Query structures by owner 1
	structures, err := storage.ListStructuresByOwner(ownerID1)
	if err != nil {
		t.Fatalf("ListStructuresByOwner failed: %v", err)
	}
	if len(structures) != 2 {
		t.Fatalf("expected 2 structures for owner 1, got %d", len(structures))
	}

	// Query structures by owner 2
	structures, err = storage.ListStructuresByOwner(ownerID2)
	if err != nil {
		t.Fatalf("ListStructuresByOwner failed: %v", err)
	}
	if len(structures) != 1 {
		t.Fatalf("expected 1 structure for owner 2, got %d", len(structures))
	}
}

func TestStructureStorage_ValidationErrors(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	// Test empty structure_type
	_, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err == nil {
		t.Fatal("expected error for empty structure_type")
	}

	// Test invalid scale (must be > 0)
	_, err = storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         0.0,
	})
	if err == nil {
		t.Fatal("expected error for scale <= 0")
	}

	// Test negative scale
	_, err = storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 50.0},
		Rotation:      0.0,
		Scale:         -1.0,
	})
	if err == nil {
		t.Fatal("expected error for negative scale")
	}
}

func TestStructureStorage_GetStructureNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	_, err := storage.GetStructure(99999)
	if err == nil {
		t.Fatal("expected error for non-existent structure")
	}
	if !containsError(err.Error(), "not found") {
		t.Fatalf("expected 'not found' error, got: %v", err)
	}
}

func TestStructureStorage_UpdateStructureNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)
	newType := "road"

	_, err := storage.UpdateStructure(99999, &StructureUpdateInput{
		StructureType: &newType,
	})
	if err == nil {
		t.Fatal("expected error for non-existent structure")
	}
	if !containsError(err.Error(), "not found") {
		t.Fatalf("expected 'not found' error, got: %v", err)
	}
}

func TestStructureStorage_DeleteStructureNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	err := storage.DeleteStructure(99999)
	if err == nil {
		t.Fatal("expected error for non-existent structure")
	}
	if !containsError(err.Error(), "not found") {
		t.Fatalf("expected 'not found' error, got: %v", err)
	}
}

// Helper function to check if error message contains substring
// Note: contains function already exists in chunks.go, but we need it for tests
func containsError(s, substr string) bool {
	return strings.Contains(s, substr)
}

// jsonEqualTest compares two json.RawMessage values for equality
// Normalizes JSON by compacting to handle formatting differences (spaces, etc.)
func jsonEqualTest(a, b json.RawMessage) bool {
	normalizedA := normalizeJSONForStructures(a)
	normalizedB := normalizeJSONForStructures(b)
	return normalizedA == normalizedB
}

func normalizeJSONForStructures(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// Parse and re-marshal to normalize key ordering
	var val interface{}
	if err := json.Unmarshal(raw, &val); err != nil {
		// If parsing fails, just compact the original
		var buf bytes.Buffer
		if err := json.Compact(&buf, raw); err != nil {
			return string(raw)
		}
		return buf.String()
	}
	// Re-marshal to normalize
	normalized, err := json.Marshal(val)
	if err != nil {
		return string(raw)
	}
	return string(normalized)
}

