package database

import (
	"fmt"
	"os"
	"testing"

	"github.com/earthring/server/internal/testutil"
)

// TestMigration000023_ConvertStructuresPositionToGeometry tests that migration 000023
// correctly converts structures.position from PostgreSQL POINT to PostGIS GEOMETRY(POINT, 0).
func TestMigration000023_ConvertStructuresPositionToGeometry(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	// Drop table if it exists to ensure clean state
	_, _ = db.Exec(`DROP TABLE IF EXISTS structures CASCADE`) //nolint:errcheck // Test setup - table may not exist

	// Create structures table with POINT type (as it exists before migration)
	_, err = db.Exec(`
		CREATE TABLE structures (
			id SERIAL PRIMARY KEY,
			structure_type VARCHAR(50) NOT NULL,
			position POINT NOT NULL,
			floor INTEGER DEFAULT 0 NOT NULL,
			rotation REAL DEFAULT 0,
			scale REAL DEFAULT 1.0,
			owner_id INTEGER,
			zone_id INTEGER,
			is_procedural BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			properties JSONB,
			model_data JSONB
		);
		CREATE INDEX IF NOT EXISTS idx_structures_position ON structures USING GIST(position);
	`)
	if err != nil {
		t.Fatalf("Failed to create structures table: %v", err)
	}

	// Insert test data with POINT type
	testPositions := []struct {
		x, y float64
	}{
		{1000.0, 50.0},
		{5000.0, -100.0},
		{10000.0, 200.0},
	}

	for i, pos := range testPositions {
		_, err = db.Exec(`
			INSERT INTO structures (structure_type, floor, position, rotation, scale)
			VALUES ($1, $2, POINT($3, $4), 0, 1.0)
		`, fmt.Sprintf("building_%d", i), 0, pos.x, pos.y)
		if err != nil {
			t.Fatalf("Failed to insert test structure: %v", err)
		}
	}

	// Verify column type is POINT before migration
	var columnType string
	err = db.QueryRow(`
		SELECT data_type 
		FROM information_schema.columns 
		WHERE table_name = 'structures' AND column_name = 'position'
	`).Scan(&columnType)
	if err != nil {
		t.Fatalf("Failed to check column type: %v", err)
	}
	if columnType != "USER-DEFINED" {
		t.Logf("Note: Column type before migration is %s (expected USER-DEFINED for POINT)", columnType)
	}

	// Check the actual type using pg_type
	var pgTypeName string
	err = db.QueryRow(`
		SELECT t.typname
		FROM pg_type t
		JOIN pg_attribute a ON a.atttypid = t.oid
		JOIN pg_class c ON c.oid = a.attrelid
		WHERE c.relname = 'structures' AND a.attname = 'position'
	`).Scan(&pgTypeName)
	if err != nil {
		t.Fatalf("Failed to check pg_type: %v", err)
	}
	if pgTypeName != "point" {
		t.Fatalf("Expected column type 'point' before migration, got '%s'", pgTypeName)
	}
	t.Logf("✓ Column type before migration: %s", pgTypeName)

	// Verify we can read POINT data
	var testX, testY float64
	err = db.QueryRow(`
		SELECT position[0]::float, position[1]::float
		FROM structures
		WHERE id = 1
	`).Scan(&testX, &testY)
	if err != nil {
		t.Fatalf("Failed to read POINT data: %v", err)
	}
	if testX != 1000.0 || testY != 50.0 {
		t.Fatalf("Expected position (1000.0, 50.0), got (%f, %f)", testX, testY)
	}
	t.Logf("✓ Successfully read POINT data: (%f, %f)", testX, testY)

	// Apply migration 000023
	migrationPath := findMigrationFile(t, "000023_convert_structures_position_to_geometry.up.sql")
	migrationSQL, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("Failed to read migration file: %v", err)
	}

	_, err = db.Exec(string(migrationSQL))
	if err != nil {
		t.Fatalf("Failed to apply migration: %v", err)
	}
	t.Logf("✓ Migration applied successfully")

	// Verify column type is now GEOMETRY
	err = db.QueryRow(`
		SELECT t.typname
		FROM pg_type t
		JOIN pg_attribute a ON a.atttypid = t.oid
		JOIN pg_class c ON c.oid = a.attrelid
		WHERE c.relname = 'structures' AND a.attname = 'position'
	`).Scan(&pgTypeName)
	if err != nil {
		t.Fatalf("Failed to check pg_type after migration: %v", err)
	}
	if pgTypeName != "geometry" {
		t.Fatalf("Expected column type 'geometry' after migration, got '%s'", pgTypeName)
	}
	t.Logf("✓ Column type after migration: %s", pgTypeName)

	// Verify we can read geometry data using PostGIS functions
	var posX, posY float64
	err = db.QueryRow(`
		SELECT ST_X(position)::float, ST_Y(position)::float
		FROM structures
		WHERE id = 1
	`).Scan(&posX, &posY)
	if err != nil {
		t.Fatalf("Failed to read geometry data: %v", err)
	}
	if posX != 1000.0 || posY != 50.0 {
		t.Fatalf("Expected position (1000.0, 50.0), got (%f, %f)", posX, posY)
	}
	t.Logf("✓ Successfully read geometry data: (%f, %f)", posX, posY)

	// Verify all structures have correct positions
	rows, err := db.Query(`
		SELECT id, ST_X(position)::float, ST_Y(position)::float
		FROM structures
		ORDER BY id
	`)
	if err != nil {
		t.Fatalf("Failed to query structures: %v", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			t.Logf("Failed to close rows: %v", closeErr)
		}
	}()

	structureCount := 0
	for rows.Next() {
		var id int
		var x, y float64
		if err := rows.Scan(&id, &x, &y); err != nil {
			t.Fatalf("Failed to scan structure: %v", err)
		}
		structureCount++

		expectedPos := testPositions[id-1]
		if x != expectedPos.x || y != expectedPos.y {
			t.Errorf("Structure %d: expected position (%f, %f), got (%f, %f)",
				id, expectedPos.x, expectedPos.y, x, y)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("Error iterating structures: %v", err)
	}
	if structureCount != len(testPositions) {
		t.Fatalf("Expected %d structures, got %d", len(testPositions), structureCount)
	}
	t.Logf("✓ All %d structures have correct positions", structureCount)

	// Verify GIST index exists
	var indexExists bool
	err = db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM pg_indexes
			WHERE tablename = 'structures'
			  AND indexname = 'idx_structures_position'
		)
	`).Scan(&indexExists)
	if err != nil {
		t.Fatalf("Failed to check index: %v", err)
	}
	if !indexExists {
		t.Error("GIST index idx_structures_position should exist after migration")
	} else {
		t.Logf("✓ GIST index exists")
	}

	// Verify we can insert new structures with geometry
	_, err = db.Exec(`
		INSERT INTO structures (structure_type, floor, position, rotation, scale)
		VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 0), 0, 1.0)
	`, "test_building", 0, 2000.0, 75.0)
	if err != nil {
		t.Fatalf("Failed to insert structure with geometry: %v", err)
	}
	t.Logf("✓ Successfully inserted new structure with geometry")

	// Verify the new structure
	err = db.QueryRow(`
		SELECT ST_X(position)::float, ST_Y(position)::float
		FROM structures
		WHERE structure_type = 'test_building'
	`).Scan(&posX, &posY)
	if err != nil {
		t.Fatalf("Failed to read new structure: %v", err)
	}
	if posX != 2000.0 || posY != 75.0 {
		t.Fatalf("Expected new structure position (2000.0, 75.0), got (%f, %f)", posX, posY)
	}
	t.Logf("✓ New structure has correct position: (%f, %f)", posX, posY)
}

// TestMigration000023_Rollback tests that the rollback migration correctly
// converts structures.position back from GEOMETRY to POINT.
func TestMigration000023_Rollback(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	// Drop table if it exists to ensure clean state
	_, _ = db.Exec(`DROP TABLE IF EXISTS structures CASCADE`) //nolint:errcheck // Test setup - table may not exist

	// Create structures table with GEOMETRY type (as it exists after migration 000023)
	_, err = db.Exec(`
		CREATE TABLE structures (
			id SERIAL PRIMARY KEY,
			structure_type VARCHAR(50) NOT NULL,
			position GEOMETRY(POINT, 0) NOT NULL,
			floor INTEGER DEFAULT 0 NOT NULL,
			rotation REAL DEFAULT 0,
			scale REAL DEFAULT 1.0,
			owner_id INTEGER,
			zone_id INTEGER,
			is_procedural BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			properties JSONB,
			model_data JSONB
		);
		CREATE INDEX IF NOT EXISTS idx_structures_position ON structures USING GIST(position);
	`)
	if err != nil {
		t.Fatalf("Failed to create structures table: %v", err)
	}

	// Insert test data with GEOMETRY type
	testPositions := []struct {
		x, y float64
	}{
		{3000.0, 100.0},
		{7000.0, -50.0},
	}

	for i, pos := range testPositions {
		_, err = db.Exec(`
			INSERT INTO structures (structure_type, floor, position, rotation, scale)
			VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 0), 0, 1.0)
		`, fmt.Sprintf("building_%d", i), 0, pos.x, pos.y)
		if err != nil {
			t.Fatalf("Failed to insert test structure: %v", err)
		}
	}

	// Verify column type is GEOMETRY before rollback
	var pgTypeName string
	err = db.QueryRow(`
		SELECT t.typname
		FROM pg_type t
		JOIN pg_attribute a ON a.atttypid = t.oid
		JOIN pg_class c ON c.oid = a.attrelid
		WHERE c.relname = 'structures' AND a.attname = 'position'
	`).Scan(&pgTypeName)
	if err != nil {
		t.Fatalf("Failed to check pg_type: %v", err)
	}
	if pgTypeName != "geometry" {
		t.Fatalf("Expected column type 'geometry' before rollback, got '%s'", pgTypeName)
	}
	t.Logf("✓ Column type before rollback: %s", pgTypeName)

	// Apply rollback migration
	rollbackPath := findMigrationFile(t, "000023_convert_structures_position_to_geometry.down.sql")
	rollbackSQL, err := os.ReadFile(rollbackPath)
	if err != nil {
		t.Fatalf("Failed to read rollback migration file: %v", err)
	}

	_, err = db.Exec(string(rollbackSQL))
	if err != nil {
		t.Fatalf("Failed to apply rollback migration: %v", err)
	}
	t.Logf("✓ Rollback migration applied successfully")

	// Verify column type is now POINT
	err = db.QueryRow(`
		SELECT t.typname
		FROM pg_type t
		JOIN pg_attribute a ON a.atttypid = t.oid
		JOIN pg_class c ON c.oid = a.attrelid
		WHERE c.relname = 'structures' AND a.attname = 'position'
	`).Scan(&pgTypeName)
	if err != nil {
		t.Fatalf("Failed to check pg_type after rollback: %v", err)
	}
	if pgTypeName != "point" {
		t.Fatalf("Expected column type 'point' after rollback, got '%s'", pgTypeName)
	}
	t.Logf("✓ Column type after rollback: %s", pgTypeName)

	// Verify we can read POINT data
	var posX, posY float64
	err = db.QueryRow(`
		SELECT position[0]::float, position[1]::float
		FROM structures
		WHERE id = 1
	`).Scan(&posX, &posY)
	if err != nil {
		t.Fatalf("Failed to read POINT data after rollback: %v", err)
	}
	if posX != 3000.0 || posY != 100.0 {
		t.Fatalf("Expected position (3000.0, 100.0), got (%f, %f)", posX, posY)
	}
	t.Logf("✓ Successfully read POINT data after rollback: (%f, %f)", posX, posY)

	// Verify all structures have correct positions
	rows, err := db.Query(`
		SELECT id, position[0]::float, position[1]::float
		FROM structures
		ORDER BY id
	`)
	if err != nil {
		t.Fatalf("Failed to query structures: %v", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			t.Logf("Failed to close rows: %v", closeErr)
		}
	}()

	structureCount := 0
	for rows.Next() {
		var id int
		var x, y float64
		if err := rows.Scan(&id, &x, &y); err != nil {
			t.Fatalf("Failed to scan structure: %v", err)
		}
		structureCount++

		expectedPos := testPositions[id-1]
		if x != expectedPos.x || y != expectedPos.y {
			t.Errorf("Structure %d: expected position (%f, %f), got (%f, %f)",
				id, expectedPos.x, expectedPos.y, x, y)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("Error iterating structures: %v", err)
	}
	if structureCount != len(testPositions) {
		t.Fatalf("Expected %d structures, got %d", len(testPositions), structureCount)
	}
	t.Logf("✓ All %d structures have correct positions after rollback", structureCount)

	// Verify GIST index exists
	var indexExists bool
	err = db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM pg_indexes
			WHERE tablename = 'structures'
			  AND indexname = 'idx_structures_position'
		)
	`).Scan(&indexExists)
	if err != nil {
		t.Fatalf("Failed to check index: %v", err)
	}
	if !indexExists {
		t.Error("GIST index idx_structures_position should exist after rollback")
	} else {
		t.Logf("✓ GIST index exists after rollback")
	}
}
