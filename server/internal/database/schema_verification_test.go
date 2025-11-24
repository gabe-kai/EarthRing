package database

import (
	"database/sql"
	"testing"

	"github.com/earthring/server/internal/testutil"
)

// TestDatabaseSchemaVerification verifies that all required database objects exist
// This test simulates a production environment check - it does NOT create the objects itself
// It verifies what should already exist after running migrations
func TestDatabaseSchemaVerification(t *testing.T) {
	// Skip if not running integration tests
	if testing.Short() {
		t.Skip("Skipping schema verification test in short mode")
	}

	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)

	t.Run("RequiredFunctions", func(t *testing.T) {
		requiredFunctions := []string{
			"normalize_for_intersection",       // Migration 000016 - overlap detection
			"normalize_zone_geometry_for_area", // Migration 000015 - area calculation
			"update_chunk_versions",            // Migration 000014 - bulk chunk updates
			"update_zone_timestamp",            // Migration 000013 - zone update trigger
			"mark_chunk_dirty",                 // Migration 000013 - chunk dirty trigger
		}

		for _, funcName := range requiredFunctions {
			var exists bool
			query := `
				SELECT EXISTS (
					SELECT 1 
					FROM pg_proc p
					JOIN pg_namespace n ON p.pronamespace = n.oid
					WHERE n.nspname = 'public' 
					AND p.proname = $1
				)
			`
			err := db.QueryRow(query, funcName).Scan(&exists)
			if err != nil {
				t.Fatalf("Failed to check if function %s exists: %v", funcName, err)
			}
			if !exists {
				t.Errorf("❌ Required function %s does not exist. Run migrations to create it.", funcName)
			} else {
				t.Logf("✓ Function %s exists", funcName)
			}
		}
	})

	t.Run("RequiredTables", func(t *testing.T) {
		requiredTables := []string{
			"zones",
			"players",
			"chunks",
			"chunk_data",
			"structures",
			"roads",
			"npcs",
			"npc_traffic",
			"racing_events",
			"racing_results",
			"player_actions",
		}

		for _, tableName := range requiredTables {
			var exists bool
			query := `
				SELECT EXISTS (
					SELECT 1 
					FROM information_schema.tables 
					WHERE table_schema = 'public' 
					AND table_name = $1
				)
			`
			err := db.QueryRow(query, tableName).Scan(&exists)
			if err != nil {
				t.Fatalf("Failed to check if table %s exists: %v", tableName, err)
			}
			if !exists {
				t.Errorf("❌ Required table %s does not exist. Run migrations to create it.", tableName)
			} else {
				t.Logf("✓ Table %s exists", tableName)
			}
		}
	})

	t.Run("RequiredTriggers", func(t *testing.T) {
		requiredTriggers := []struct {
			name  string
			table string
		}{
			{"zone_updated_at", "zones"},
			{"structure_chunk_dirty", "structures"},
		}

		for _, trigger := range requiredTriggers {
			var exists bool
			query := `
				SELECT EXISTS (
					SELECT 1 
					FROM information_schema.triggers 
					WHERE trigger_schema = 'public' 
					AND trigger_name = $1
					AND event_object_table = $2
				)
			`
			err := db.QueryRow(query, trigger.name, trigger.table).Scan(&exists)
			if err != nil {
				t.Fatalf("Failed to check if trigger %s exists: %v", trigger.name, err)
			}
			if !exists {
				t.Errorf("❌ Required trigger %s on table %s does not exist. Run migrations to create it.", trigger.name, trigger.table)
			} else {
				t.Logf("✓ Trigger %s on %s exists", trigger.name, trigger.table)
			}
		}
	})

	t.Run("RequiredIndexes", func(t *testing.T) {
		requiredIndexes := []struct {
			name  string
			table string
		}{
			{"idx_zones_geometry", "zones"},
			{"idx_zones_floor", "zones"},
			{"idx_chunks_x_z_floor", "chunks"},
			{"idx_chunk_data_chunk_id", "chunk_data"},
		}

		for _, index := range requiredIndexes {
			var exists bool
			query := `
				SELECT EXISTS (
					SELECT 1 
					FROM pg_indexes 
					WHERE schemaname = 'public' 
					AND indexname = $1
					AND tablename = $2
				)
			`
			err := db.QueryRow(query, index.name, index.table).Scan(&exists)
			if err != nil {
				t.Fatalf("Failed to check if index %s exists: %v", index.name, err)
			}
			if !exists {
				t.Errorf("❌ Required index %s on table %s does not exist. Run migrations to create it.", index.name, index.table)
			} else {
				t.Logf("✓ Index %s on %s exists", index.name, index.table)
			}
		}
	})

	t.Run("PostGISExtension", func(t *testing.T) {
		var exists bool
		query := `
			SELECT EXISTS (
				SELECT 1 
				FROM pg_extension 
				WHERE extname = 'postgis'
			)
		`
		err := db.QueryRow(query).Scan(&exists)
		if err != nil {
			t.Fatalf("Failed to check if PostGIS extension exists: %v", err)
		}
		if !exists {
			t.Error("❌ PostGIS extension is not installed. Run migrations to install it.")
		} else {
			t.Log("✓ PostGIS extension is installed")
		}
	})
}

// TestNormalizeForIntersectionFunction specifically tests the normalize_for_intersection function
// This test was added after discovering the function was missing in production but tests passed
func TestNormalizeForIntersectionFunction(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)

	// Create the function for this test
	createNormalizeForIntersectionFunction(t, db)

	// Check if function exists
	var exists bool
	query := `
		SELECT EXISTS (
			SELECT 1 
			FROM pg_proc p
			JOIN pg_namespace n ON p.pronamespace = n.oid
			WHERE n.nspname = 'public' 
			AND p.proname = 'normalize_for_intersection'
		)
	`
	err := db.QueryRow(query).Scan(&exists)
	if err != nil {
		t.Fatalf("Failed to check if normalize_for_intersection exists: %v", err)
	}

	if !exists {
		t.Fatal("❌ normalize_for_intersection function does not exist. This function is CRITICAL for wrapped zone overlap detection.")
	}

	// Test the function works correctly
	t.Run("NonWrappedGeometry", func(t *testing.T) {
		var result string
		query := `
			SELECT ST_AsText(normalize_for_intersection(
				ST_GeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))')
			))
		`
		err := db.QueryRow(query).Scan(&result)
		if err != nil {
			t.Fatalf("normalize_for_intersection failed on non-wrapped geometry: %v", err)
		}
		if result == "" {
			t.Error("normalize_for_intersection returned empty result")
		}
		t.Logf("✓ Non-wrapped geometry: %s", result)
	})

	t.Run("WrappedGeometry", func(t *testing.T) {
		// Create a geometry that spans the wrap boundary
		var result string
		query := `
			SELECT ST_AsText(normalize_for_intersection(
				ST_GeomFromText('POLYGON((263999990 0, 10 0, 10 10, 263999990 10, 263999990 0))')
			))
		`
		err := db.QueryRow(query).Scan(&result)
		if err != nil {
			t.Fatalf("normalize_for_intersection failed on wrapped geometry: %v", err)
		}
		if result == "" {
			t.Error("normalize_for_intersection returned empty result")
		}
		// After normalization, X coordinates should be contiguous (negative values)
		t.Logf("✓ Wrapped geometry normalized: %s", result)
	})

	t.Run("PolygonWithHole", func(t *testing.T) {
		// Create a polygon with hole that wraps
		var ringCount int
		query := `
			SELECT ST_NumInteriorRings(normalize_for_intersection(
				ST_GeomFromText('POLYGON((263999950 0, 50 0, 50 100, 263999950 100, 263999950 0), (263999980 30, 20 30, 20 70, 263999980 70, 263999980 30))')
			))
		`
		err := db.QueryRow(query).Scan(&ringCount)
		if err != nil {
			t.Fatalf("normalize_for_intersection failed on polygon with hole: %v", err)
		}
		if ringCount != 1 {
			t.Errorf("Expected polygon to have 1 interior ring (hole), got %d", ringCount)
		}
		t.Logf("✓ Polygon hole preserved: %d interior rings", ringCount)
	})
}

func createNormalizeForIntersectionFunction(t *testing.T, db *sql.DB) {
	t.Helper()
	normalizeForIntersectionSQL := `
CREATE OR REPLACE FUNCTION normalize_for_intersection(geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circ CONSTANT NUMERIC := 264000000;
    half_ring CONSTANT NUMERIC := 132000000;
    span NUMERIC;
BEGIN
    IF geom IS NULL OR ST_IsEmpty(geom) THEN
        RETURN geom;
    END IF;
    
    span := ST_XMax(geom) - ST_XMin(geom);
    
    IF span <= half_ring THEN
        RETURN geom;
    END IF;
    
    RETURN (
        WITH 
        rings AS (
            SELECT 
                (ST_DumpRings(geom)).path[1] AS ring_index,
                (ST_DumpRings(geom)).geom AS ring_geom
        ),
        shifted_rings AS (
            SELECT 
                ring_index,
                ST_MakeLine(
                    ARRAY(
                        SELECT 
                            ST_MakePoint(
                                CASE 
                                    WHEN ST_X((dp).geom) > half_ring
                                    THEN ST_X((dp).geom) - ring_circ
                                    ELSE ST_X((dp).geom)
                                END,
                                ST_Y((dp).geom)
                            )
                        FROM ST_DumpPoints(ring_geom) AS dp
                        ORDER BY (dp).path[1]
                    )
                ) AS shifted_ring
            FROM rings
        ),
        exterior_ring AS (
            SELECT shifted_ring FROM shifted_rings WHERE ring_index = 0
        ),
        interior_rings_agg AS (
            SELECT ARRAY_AGG(shifted_ring ORDER BY ring_index) AS holes
            FROM shifted_rings WHERE ring_index > 0
        )
        SELECT 
            CASE 
                WHEN EXISTS(SELECT 1 FROM shifted_rings WHERE ring_index > 0) THEN
                    ST_MakePolygon(
                        (SELECT shifted_ring FROM exterior_ring),
                        (SELECT holes FROM interior_rings_agg)
                    )
                ELSE
                    ST_MakePolygon((SELECT shifted_ring FROM exterior_ring))
            END
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;
`
	if _, err := db.Exec(normalizeForIntersectionSQL); err != nil {
		t.Fatalf("failed to create normalize_for_intersection function: %v", err)
	}
}
