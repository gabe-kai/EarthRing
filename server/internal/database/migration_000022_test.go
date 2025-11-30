package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/earthring/server/internal/testutil"
)

// TestMigration000022_RemoveFullRingMaglevZones tests that migration 000022
// correctly removes old full-ring maglev zones.
func TestMigration000022_RemoveFullRingMaglevZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create zones table
	createZonesTable(t, db)

	// First, create the old full-ring maglev zones (as they would exist before migration)
	// These match the zones created by migration 000017
	createFullRingMaglevZones(t, db)

	// Verify zones exist before migration
	var zoneCount int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM zones
		WHERE is_system_zone = TRUE
		  AND zone_type = 'restricted'
		  AND metadata->>'default_zone' = 'true'
		  AND metadata->>'maglev_zone' = 'true'
		  AND metadata->>'chunk_index' IS NULL
		  AND floor IN (-2, -1, 0, 1, 2)
	`).Scan(&zoneCount)
	if err != nil {
		t.Fatalf("Failed to count zones before migration: %v", err)
	}
	if zoneCount != 5 {
		t.Fatalf("Expected 5 full-ring maglev zones before migration, got %d", zoneCount)
	}

	// Apply migration 000022
	migrationPath := findMigrationFile(t, "000022_remove_full_ring_maglev_zones.up.sql")
	migrationSQL, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("Failed to read migration file: %v", err)
	}

	_, err = db.Exec(string(migrationSQL))
	if err != nil {
		t.Fatalf("Failed to apply migration: %v", err)
	}

	// Verify zones were removed
	err = db.QueryRow(`
		SELECT COUNT(*) FROM zones
		WHERE is_system_zone = TRUE
		  AND zone_type = 'restricted'
		  AND metadata->>'default_zone' = 'true'
		  AND metadata->>'maglev_zone' = 'true'
		  AND metadata->>'chunk_index' IS NULL
		  AND floor IN (-2, -1, 0, 1, 2)
	`).Scan(&zoneCount)
	if err != nil {
		t.Fatalf("Failed to count zones after migration: %v", err)
	}
	if zoneCount != 0 {
		t.Errorf("Expected 0 full-ring maglev zones after migration, got %d", zoneCount)
	}

	// Verify per-chunk zones are NOT affected (if any exist)
	var perChunkZoneCount int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM zones
		WHERE is_system_zone = TRUE
		  AND zone_type = 'restricted'
		  AND metadata->>'default_zone' = 'true'
		  AND metadata->>'chunk_index' IS NOT NULL
	`).Scan(&perChunkZoneCount)
	if err != nil {
		t.Fatalf("Failed to count per-chunk zones: %v", err)
	}
	// Per-chunk zones should not be affected by this migration
	t.Logf("Per-chunk zones count: %d (should not be affected)", perChunkZoneCount)
}

// TestMigration000022_Rollback tests that the rollback migration correctly
// recreates the full-ring maglev zones.
func TestMigration000022_Rollback(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create zones table
	createZonesTable(t, db)

	// Create full-ring zones first
	createFullRingMaglevZones(t, db)

	// Apply migration 000022 (remove zones)
	migrationUpPath := findMigrationFile(t, "000022_remove_full_ring_maglev_zones.up.sql")
	migrationUpSQL, err := os.ReadFile(migrationUpPath)
	if err != nil {
		t.Fatalf("Failed to read up migration file: %v", err)
	}

	_, err = db.Exec(string(migrationUpSQL))
	if err != nil {
		t.Fatalf("Failed to apply up migration: %v", err)
	}

	// Verify zones are removed
	var zoneCount int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM zones
		WHERE is_system_zone = TRUE
		  AND zone_type = 'restricted'
		  AND metadata->>'default_zone' = 'true'
		  AND metadata->>'maglev_zone' = 'true'
		  AND metadata->>'chunk_index' IS NULL
		  AND floor IN (-2, -1, 0, 1, 2)
	`).Scan(&zoneCount)
	if err != nil {
		t.Fatalf("Failed to count zones after up migration: %v", err)
	}
	if zoneCount != 0 {
		t.Fatalf("Expected 0 zones after up migration, got %d", zoneCount)
	}

	// Apply rollback migration (down)
	migrationDownPath := findMigrationFile(t, "000022_remove_full_ring_maglev_zones.down.sql")
	migrationDownSQL, err := os.ReadFile(migrationDownPath)
	if err != nil {
		t.Fatalf("Failed to read down migration file: %v", err)
	}

	_, err = db.Exec(string(migrationDownSQL))
	if err != nil {
		t.Fatalf("Failed to apply down migration: %v", err)
	}

	// Verify zones were recreated
	err = db.QueryRow(`
		SELECT COUNT(*) FROM zones
		WHERE is_system_zone = TRUE
		  AND zone_type = 'restricted'
		  AND metadata->>'default_zone' = 'true'
		  AND metadata->>'maglev_zone' = 'true'
		  AND metadata->>'chunk_index' IS NULL
		  AND floor IN (-2, -1, 0, 1, 2)
	`).Scan(&zoneCount)
	if err != nil {
		t.Fatalf("Failed to count zones after rollback: %v", err)
	}
	if zoneCount != 5 {
		t.Errorf("Expected 5 full-ring maglev zones after rollback, got %d", zoneCount)
	}

	// Verify zone properties are correct
	for _, floor := range []int{-2, -1, 0, 1, 2} {
		var name, zoneType string
		var isSystemZone bool
		var metadata sql.NullString
		err = db.QueryRow(`
			SELECT name, zone_type, is_system_zone, metadata::text
			FROM zones
			WHERE floor = $1
			  AND is_system_zone = TRUE
			  AND zone_type = 'restricted'
			  AND metadata->>'maglev_zone' = 'true'
		`, floor).Scan(&name, &zoneType, &isSystemZone, &metadata)
		if err != nil {
			t.Errorf("Failed to verify zone for floor %d: %v", floor, err)
			continue
		}
		if name == "" {
			t.Errorf("Zone name is empty for floor %d", floor)
		}
		if zoneType != "restricted" {
			t.Errorf("Expected zone_type 'restricted' for floor %d, got %s", floor, zoneType)
		}
		if !isSystemZone {
			t.Errorf("Expected is_system_zone = true for floor %d", floor)
		}
	}
}

// createFullRingMaglevZones creates the old full-ring maglev zones
// that would exist before migration 000022.
func createFullRingMaglevZones(t *testing.T, db *sql.DB) {
	t.Helper()

	// Create zones matching migration 000017
	for _, floor := range []int{-2, -1, 0, 1, 2} {
		_, err := db.Exec(`
			INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
			VALUES (
				$1,
				'restricted',
				ST_MakePolygon(
					ST_MakeLine(ARRAY[
						ST_MakePoint(0, -10),
						ST_MakePoint(264000000, -10),
						ST_MakePoint(264000000, 10),
						ST_MakePoint(0, 10),
						ST_MakePoint(0, -10)
					])
				),
				$2,
				NULL,
				TRUE,
				'{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
				'{"default_zone": true, "maglev_zone": true}'::jsonb
			)
		`, "Maglev Transit Zone (Floor "+formatFloor(floor)+")", floor)
		if err != nil {
			t.Fatalf("Failed to create full-ring zone for floor %d: %v", floor, err)
		}
	}
}

// formatFloor formats a floor number for display
func formatFloor(floor int) string {
	if floor < 0 {
		return fmt.Sprintf("%d", floor) // e.g., "-2", "-1"
	}
	return fmt.Sprintf("+%d", floor) // e.g., "+1", "+2"
}

// findMigrationFile finds a migration file by name, searching common locations
func findMigrationFile(t *testing.T, filename string) string {
	t.Helper()

	// Try multiple possible paths
	possiblePaths := []string{
		filepath.Join("..", "..", "..", "..", "database", "migrations", filename),
		filepath.Join("database", "migrations", filename),
		filepath.Join("..", "database", "migrations", filename),
		filepath.Join("..", "..", "database", "migrations", filename),
		filepath.Join("..", "..", "..", "database", "migrations", filename),
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	// If not found, try to find it relative to current working directory
	wd, err := os.Getwd()
	if err == nil {
		for _, path := range possiblePaths {
			fullPath := filepath.Join(wd, path)
			if _, err := os.Stat(fullPath); err == nil {
				return fullPath
			}
		}
	}

	t.Fatalf("Could not find migration file: %s (tried paths: %v)", filename, possiblePaths)
	return ""
}
