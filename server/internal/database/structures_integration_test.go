package database

import (
	"testing"

	"github.com/earthring/server/internal/testutil"
)

// TestStructureStorage_CoordinateWrapping tests structure operations at ring boundaries
func TestStructureStorage_CoordinateWrapping(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	// Test structure at ring boundary (near 0)
	structure1, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 100.0, Y: 50.0}, // Near start of ring
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure near 0: %v", err)
	}
	if structure1.Position.X != 100.0 || structure1.Position.Y != 50.0 {
		t.Fatalf("Expected position (100.0, 50.0), got (%f, %f)", structure1.Position.X, structure1.Position.Y)
	}

	// Test structure at ring boundary (near 264,000,000)
	structure2, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 263999000.0, Y: -100.0}, // Near end of ring
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure near end: %v", err)
	}
	if structure2.Position.X != 263999000.0 || structure2.Position.Y != -100.0 {
		t.Fatalf("Expected position (263999000.0, -100.0), got (%f, %f)", structure2.Position.X, structure2.Position.Y)
	}

	// Test querying structures near boundary (should find both)
	structures, err := storage.ListStructuresByArea(0, 1000, -200, 200, 0)
	if err != nil {
		t.Fatalf("Failed to list structures near 0: %v", err)
	}
	foundNear0 := false
	for _, s := range structures {
		if s.ID == structure1.ID {
			foundNear0 = true
			break
		}
	}
	if !foundNear0 {
		t.Error("Failed to find structure near 0 in query")
	}

	// Test querying structures near end boundary
	structures, err = storage.ListStructuresByArea(263998000, 264000000, -200, 200, 0)
	if err != nil {
		t.Fatalf("Failed to list structures near end: %v", err)
	}
	foundNearEnd := false
	for _, s := range structures {
		if s.ID == structure2.ID {
			foundNearEnd = true
			break
		}
	}
	if !foundNearEnd {
		t.Error("Failed to find structure near end in query")
	}

	// Test structure at exactly 0
	structure3, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 0.0, Y: 0.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure at 0: %v", err)
	}
	if structure3.Position.X != 0.0 || structure3.Position.Y != 0.0 {
		t.Fatalf("Expected position (0.0, 0.0), got (%f, %f)", structure3.Position.X, structure3.Position.Y)
	}

	// Test structure at maximum valid position (just before wrap)
	maxX := 263999999.0
	structure4, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: maxX, Y: 0.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure at max position: %v", err)
	}
	if structure4.Position.X != maxX || structure4.Position.Y != 0.0 {
		t.Fatalf("Expected position (%f, 0.0), got (%f, %f)", maxX, structure4.Position.X, structure4.Position.Y)
	}
}

// TestStructureStorage_ZoneRelationship tests structures placed within zones
func TestStructureStorage_ZoneRelationship(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	// Create zones table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS zones (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			zone_type VARCHAR(50) NOT NULL,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			floor INTEGER NOT NULL,
			owner_id INTEGER,
			is_system_zone BOOLEAN DEFAULT FALSE
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create zones table: %v", err)
	}

	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	// Create a test zone (polygon from (1000, -100) to (2000, 100))
	var zoneID int64
	err = db.QueryRow(`
		INSERT INTO zones (name, zone_type, geometry, floor, is_system_zone)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromText('POLYGON((1000 -100, 2000 -100, 2000 100, 1000 100, 1000 -100))'), 0), $3, FALSE)
		RETURNING id
	`, "Test Zone", "residential", 0).Scan(&zoneID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	storage := NewStructureStorage(db)

	// Test structure placed inside zone
	structure1, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1500.0, Y: 0.0}, // Inside zone
		Rotation:      0.0,
		Scale:         1.0,
		ZoneID:        &zoneID,
	})
	if err != nil {
		t.Fatalf("Failed to create structure in zone: %v", err)
	}
	if structure1.ZoneID == nil || *structure1.ZoneID != zoneID {
		t.Fatalf("Expected zone_id %d, got %v", zoneID, structure1.ZoneID)
	}

	// Test structure placed outside zone (no zone_id)
	structure2, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 5000.0, Y: 0.0}, // Outside zone
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure outside zone: %v", err)
	}
	if structure2.ZoneID != nil {
		t.Errorf("Expected zone_id to be nil for structure outside zone, got %v", structure2.ZoneID)
	}

	// Test structure with zone_id on a different floor - create a zone on floor 1
	var zoneID2 int64
	err = db.QueryRow(`
		INSERT INTO zones (name, zone_type, geometry, floor, is_system_zone)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromText('POLYGON((1000 -100, 2000 -100, 2000 100, 1000 100, 1000 -100))'), 0), $3, FALSE)
		RETURNING id
	`, "Test Zone Floor 1", "residential", 1).Scan(&zoneID2)
	if err != nil {
		t.Fatalf("Failed to create test zone on floor 1: %v", err)
	}

	structure3, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         1, // Different floor
		Position:      Position{X: 1500.0, Y: 0.0},
		Rotation:      0.0,
		Scale:         1.0,
		ZoneID:        &zoneID2, // Use zone on floor 1
	})
	if err != nil {
		t.Fatalf("Failed to create structure with zone_id on different floor: %v", err)
	}
	if structure3.ZoneID == nil || *structure3.ZoneID != zoneID2 {
		t.Fatalf("Expected zone_id %d, got %v", zoneID2, structure3.ZoneID)
	}

	// Test updating structure to add zone_id
	// First, move structure2 inside the zone, then add zone_id
	updateInput := &StructureUpdateInput{
		Position: &Position{X: 1500.0, Y: 0.0}, // Move inside zone
	}
	_, err = storage.UpdateStructure(structure2.ID, updateInput)
	if err != nil {
		t.Fatalf("Failed to move structure inside zone: %v", err)
	}

	// Now add zone_id
	updateInput = &StructureUpdateInput{
		ZoneIDSet: true,
		ZoneID:    &zoneID,
	}
	updated, err := storage.UpdateStructure(structure2.ID, updateInput)
	if err != nil {
		t.Fatalf("Failed to update structure with zone_id: %v", err)
	}
	if updated.ZoneID == nil || *updated.ZoneID != zoneID {
		t.Fatalf("Expected zone_id %d after update, got %v", zoneID, updated.ZoneID)
	}

	// Test updating structure to remove zone_id
	updateInput = &StructureUpdateInput{
		ZoneIDSet: true,
		ZoneID:    nil,
	}
	updated, err = storage.UpdateStructure(structure1.ID, updateInput)
	if err != nil {
		t.Fatalf("Failed to update structure to remove zone_id: %v", err)
	}
	if updated.ZoneID != nil {
		t.Errorf("Expected zone_id to be nil after removal, got %v", updated.ZoneID)
	}
}

// TestStructureStorage_BoundaryConditions tests edge cases and boundary conditions
func TestStructureStorage_BoundaryConditions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	// Test negative Y position (valid: -2500 to +2500)
	structure1, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: -2500.0}, // Minimum Y
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure at minimum Y: %v", err)
	}
	if structure1.Position.Y != -2500.0 {
		t.Fatalf("Expected Y -2500.0, got %f", structure1.Position.Y)
	}

	// Test maximum Y position
	structure2, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 2500.0}, // Maximum Y
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create structure at maximum Y: %v", err)
	}
	if structure2.Position.Y != 2500.0 {
		t.Fatalf("Expected Y 2500.0, got %f", structure2.Position.Y)
	}

	// Test different floors
	for floor := -2; floor <= 15; floor++ {
		structure, err := storage.CreateStructure(&StructureCreateInput{
			StructureType: "building",
			Floor:         floor,
			Position:      Position{X: float64(1000 + floor*100), Y: 0.0},
			Rotation:      0.0,
			Scale:         1.0,
		})
		if err != nil {
			t.Fatalf("Failed to create structure on floor %d: %v", floor, err)
		}
		if structure.Floor != floor {
			t.Fatalf("Expected floor %d, got %d", floor, structure.Floor)
		}
	}

	// Test querying by area across floor boundaries
	structures, err := storage.ListStructuresByArea(0, 5000, -3000, 3000, 0)
	if err != nil {
		t.Fatalf("Failed to list structures: %v", err)
	}
	// Should find structures on floor 0
	foundFloor0 := false
	for _, s := range structures {
		if s.Floor == 0 {
			foundFloor0 = true
			break
		}
	}
	if !foundFloor0 {
		t.Error("Failed to find structures on floor 0")
	}
}
