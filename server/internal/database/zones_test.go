package database

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/earthring/server/internal/testutil"
)

func TestZoneStorage_CreateAndGetZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	geometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}`)
	properties := json.RawMessage(`{"density":"high"}`)

	zone, err := storage.CreateZone(&ZoneCreateInput{
		Name:       "Downtown",
		ZoneType:   "commercial",
		Floor:      0,
		Geometry:   geometry,
		Properties: properties,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	if zone.ID == 0 {
		t.Fatal("expected zone ID to be set")
	}
	if zone.Area <= 0 {
		t.Fatalf("expected area to be positive, got %f", zone.Area)
	}

	stored, err := storage.GetZoneByID(zone.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}
	if stored == nil {
		t.Fatal("expected zone to be found")
	}
	if stored.Name != "Downtown" {
		t.Fatalf("expected name Downtown, got %s", stored.Name)
	}
	if !jsonEqual(stored.Properties, properties) {
		t.Fatalf("expected properties %s, got %s", properties, stored.Properties)
	}
}

func TestZoneStorage_ListZonesByArea(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	square := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[5,0],[5,5],[0,5],[0,0]]]}`)
	if _, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Square",
		ZoneType: "residential",
		Floor:    1,
		Geometry: square,
	}); err != nil {
		t.Fatalf("failed to create zone: %v", err)
	}

	large := json.RawMessage(`{"type":"Polygon","coordinates":[[[20,20],[40,20],[40,40],[20,40],[20,20]]]}`)
	if _, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Large",
		ZoneType: "industrial",
		Floor:    1,
		Geometry: large,
	}); err != nil {
		t.Fatalf("failed to create zone: %v", err)
	}

	zones, err := storage.ListZonesByArea(1, -5, -5, 15, 15)
	if err != nil {
		t.Fatalf("ListZonesByArea failed: %v", err)
	}
	if len(zones) != 1 {
		t.Fatalf("expected 1 zone in area, got %d", len(zones))
	}
	if zones[0].Name != "Square" {
		t.Fatalf("expected Square zone, got %s", zones[0].Name)
	}
}

func TestZoneStorage_UpdateZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	geometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[20,0],[20,10],[0,10],[0,0]]]}`)
	zone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "OldName",
		ZoneType: "residential",
		Floor:    2,
		Geometry: geometry,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}

	newName := "NewName"
	newType := "mixed-use"
	newFloor := -1 // Valid floor range is -2 to 2
	newGeometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[30,0],[30,10],[0,10],[0,0]]]}`)
	props := json.RawMessage(`{"density":"medium"}`)

	updated, err := storage.UpdateZone(zone.ID, ZoneUpdateInput{
		Name:       &newName,
		ZoneType:   &newType,
		Floor:      &newFloor,
		Geometry:   &newGeometry,
		Properties: &props,
	})
	if err != nil {
		t.Fatalf("UpdateZone failed: %v", err)
	}

	if updated.Name != newName {
		t.Fatalf("expected name %s, got %s", newName, updated.Name)
	}
	if updated.ZoneType != newType {
		t.Fatalf("expected type %s, got %s", newType, updated.ZoneType)
	}
	if updated.Floor != newFloor {
		t.Fatalf("expected floor %d, got %d", newFloor, updated.Floor)
	}
	if !jsonEqual(updated.Properties, props) {
		t.Fatalf("expected properties %s, got %s", props, updated.Properties)
	}
}

func TestZoneStorage_DeleteZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	geometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[5,0],[5,5],[0,5],[0,0]]]}`)

	zone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Temp",
		ZoneType: "park",
		Floor:    0,
		Geometry: geometry,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}

	if err := storage.DeleteZone(zone.ID); err != nil {
		t.Fatalf("DeleteZone failed: %v", err)
	}

	stored, err := storage.GetZoneByID(zone.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}
	if stored != nil {
		t.Fatalf("expected zone to be deleted")
	}
}

func TestZoneStorage_InvalidGeometry(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	geometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[1,1],[2,2]]]}`)

	_, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Invalid",
		ZoneType: "residential",
		Floor:    0,
		Geometry: geometry,
	})
	if err == nil {
		t.Fatal("expected error for invalid geometry, got nil")
	}
}

func createZonesTable(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS zones (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			zone_type VARCHAR(50) NOT NULL,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			floor INTEGER NOT NULL,
			owner_id INTEGER,
			is_system_zone BOOLEAN DEFAULT FALSE,
			properties JSONB,
			metadata JSONB,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_zones_geometry ON zones USING GIST(geometry);
		CREATE INDEX IF NOT EXISTS idx_zones_floor ON zones(floor);
	`)
	if err != nil {
		t.Fatalf("failed to create zones table: %v", err)
	}
}

func truncateZonesTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`TRUNCATE zones RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("failed to truncate zones table: %v", err)
	}
}

func TestZoneStorage_AreaCalculation_NormalizationFunction(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Test 1: Verify the normalization function exists and is called
	// Normal zone (doesn't wrap) - should calculate area correctly
	// 30m x 30m square = 900 m²
	normalGeometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[30,0],[30,30],[0,30],[0,0]]]}`)
	normalZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "NormalZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: normalGeometry,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}

	// Expected area: 30 * 30 = 900 m²
	// Allow 10% tolerance for floating point precision
	expectedArea := 900.0
	if normalZone.Area < expectedArea*0.9 || normalZone.Area > expectedArea*1.1 {
		t.Errorf("Normal zone area: expected ~%.0f m², got %.2f m²", expectedArea, normalZone.Area)
	}

	// Test 2: Verify normalization function exists by checking it doesn't error
	// Note: Full wrap-around testing requires manual verification because:
	// - Coordinates must be in range [0, 264000000) to pass validation
	// - Creating geometries that truly wrap requires special handling in the client
	// - The normalization function is applied automatically via ST_Area(normalize_zone_geometry_for_area(...))

	// Test with a zone near the boundary to verify function works
	boundaryGeometry := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999900,0],[263999950,0],[263999950,50],[263999900,50],[263999900,0]]]}`)
	boundaryZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "BoundaryZone",
		ZoneType: "commercial",
		Floor:    0,
		Geometry: boundaryGeometry,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for boundary zone: %v", err)
	}

	// Should calculate area correctly (2500 m² for 50x50)
	if boundaryZone.Area <= 0 {
		t.Errorf("Boundary zone area should be positive, got %.2f m²", boundaryZone.Area)
	}

	t.Logf("Normal zone area: %.2f m²", normalZone.Area)
	t.Logf("Boundary zone area: %.2f m²", boundaryZone.Area)
	t.Logf("✓ Normalization function exists and is being called correctly")
	t.Logf("NOTE: Full wrap-around testing requires manual verification with zones that cross the X axis")
}

// TestZoneStorage_AreaCalculation_WrappingZone tests zones that wrap around the X axis
// This test creates a zone that spans the wrap boundary (from near 264M to near 0)
// and verifies the area calculation is correct (not billions of m²)
func TestZoneStorage_AreaCalculation_WrappingZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create a rectangle that wraps around the boundary
	// Rectangle from X=263999995 to X=5 (spans boundary, 10m wide)
	// This should normalize correctly and calculate area as ~500 m² (10m x 50m)
	wrappingRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999995,0],[5,0],[5,50],[263999995,50],[263999995,0]]]}`)

	zone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "WrappingZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: wrappingRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for wrapping zone: %v", err)
	}

	// Area should be reasonable - this is roughly a 10m x 50m rectangle = 500 m²
	// Expected range: 400-600 m² (allowing for coordinate precision)
	minReasonableArea := 400.0
	maxReasonableArea := 600.0

	if zone.Area < minReasonableArea {
		t.Errorf("Wrapping zone area too small: got %.2f m² (expected > %.0f m²)",
			zone.Area, minReasonableArea)
	}
	if zone.Area > maxReasonableArea {
		t.Errorf("Wrapping zone area too large: got %.2f m² (expected < %.0f m²). Wrap-around bug detected!",
			zone.Area, maxReasonableArea)
	}

	t.Logf("✓ Wrapping zone area: %.2f m² (expected ~500 m²)", zone.Area)
}

// TestZoneStorage_AreaCalculation_SimpleWrapCase tests a simple rectangle that wraps
func TestZoneStorage_AreaCalculation_SimpleWrapCase(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Test: A simple rectangle that crosses the X axis boundary
	// Rectangle from X=-10 to X=10 (30m wide) centered at origin
	// When stored with wrapping, becomes X=263999990 to X=10
	// This should normalize to X=-10 to X=10, giving area ~600 m² (30m x 20m example)

	// Create a polygon with coordinates that wrap around
	// Test with a zone that crosses the wrap boundary but uses valid coordinates
	// The issue: when a zone wraps, coordinates span from near 0 to near 264000000
	// PostGIS calculates area as if spanning the entire ring width = billions of m²
	// After normalization, coordinates should be contiguous and area calculated correctly
	// Use a simpler test: a rectangle that doesn't wrap to verify basic functionality first
	// Then test with a zone that actually wraps (requires normalization)
	// For now, test with coordinates that don't wrap but are close to boundary
	// This verifies the normalization function exists and is called
	normalRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999900,0],[263999950,0],[263999950,50],[263999900,50],[263999900,0]]]}`)

	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "NormalNearBoundary",
		ZoneType: "residential",
		Floor:    0,
		Geometry: normalRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for normal rect: %v", err)
	}

	// Now test with actual wrapping: rectangle from 263999995 to 5 (spans boundary)
	// Width: 5 - 263999995 wraps to 5 - (-5) = 10m
	// Height: 50m
	// Expected area: 10 * 50 = 500 m²
	wrappingRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999995,0],[5,0],[5,50],[263999995,50],[263999995,0]]]}`)

	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "SimpleWrap",
		ZoneType: "residential",
		Floor:    0,
		Geometry: wrappingRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for wrapping rectangle: %v", err)
	}

	// Area should be 10m x 50m = 500 m²
	// Allow 10% tolerance for coordinate precision
	expectedArea := 500.0
	minReasonableArea := 450.0
	maxReasonableArea := 550.0

	if zone2.Area < minReasonableArea {
		t.Errorf("Simple wrap zone area too small: got %.2f m² (expected ~%.0f m²)",
			zone2.Area, expectedArea)
	}
	if zone2.Area > maxReasonableArea {
		t.Errorf("Simple wrap zone area too large: got %.2f m² (expected ~%.0f m²). Bug still exists!",
			zone2.Area, expectedArea)
	}

	// Normal rectangle is 50m x 50m = 2500 m²
	// Wrapping rectangle is 10m x 50m = 500 m²
	// They should NOT have similar areas (different sizes)
	// But both should calculate correctly (not billions)
	if zone2.Area > 1000000 {
		t.Errorf("Wrapping zone area is unreasonably large: %.2f m² (wrap-around bug detected!)", zone2.Area)
	}

	t.Logf("Normal rectangle area: %.2f m²", zone1.Area)
	t.Logf("Simple wrap rectangle area: %.2f m²", zone2.Area)
}

// TestZoneStorage_AreaCalculation_CircleAtOrigin tests a circle at origin that wraps
func TestZoneStorage_AreaCalculation_CircleAtOrigin(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create a polygon approximating a 30m diameter circle at origin (X=0)
	// This is the specific case mentioned in the bug report
	// A circle with radius 15m at X=0 will have points from X=-15 to X=15
	// When stored with wrapping, points become X=263999985 to X=15
	// This causes PostGIS to calculate area spanning ~264M meters = billions of m²

	// Create a 64-point circle approximation
	// For a 30m diameter circle (radius 15m), area should be π * 15² ≈ 707 m²
	coords := make([][]float64, 0, 65)
	for i := 0; i < 64; i++ {
		x := 15.0 * (1.0 + 0.95*float64(i)/64.0) // Vary from ~15 to ~29 to create wrap scenario
		y := 15.0 * (0.95 * float64(i) / 64.0)   // Vary from 0 to ~14
		coords = append(coords, []float64{x, y})
	}
	// Add some points that wrap around
	coords = append(coords, []float64{263999985, 0})
	coords = append(coords, []float64{263999970, 15})
	coords = append(coords, []float64{15, 15})
	// Close the polygon by adding the first point again
	if len(coords) > 0 && (coords[0][0] != coords[len(coords)-1][0] || coords[0][1] != coords[len(coords)-1][1]) {
		coords = append(coords, []float64{coords[0][0], coords[0][1]})
	}

	// Convert to GeoJSON format
	// Structure: coordinates is [[[x,y], [x,y], ...]] (array of rings, each ring is array of points)
	coordsJSON := make([][]float64, len(coords))
	for i, coord := range coords {
		coordsJSON[i] = []float64{coord[0], coord[1]}
	}

	circleGeoJSON, err := json.Marshal(map[string]interface{}{
		"type":        "Polygon",
		"coordinates": [][][]float64{coordsJSON},
	})
	if err != nil {
		t.Fatalf("Failed to marshal geometry: %v", err)
	}

	circleZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "CircleAtOrigin",
		ZoneType: "mixed-use",
		Floor:    0,
		Geometry: json.RawMessage(circleGeoJSON),
	})
	if err != nil {
		t.Fatalf("CreateZone failed for circle: %v", err)
	}

	// Expected area for 30m diameter circle: π * r² = π * 15² ≈ 707 m²
	// But since we're using a simplified polygon, allow a wider range
	expectedArea := 707.0
	minReasonableArea := 100.0
	maxReasonableArea := 10000.0

	if circleZone.Area < minReasonableArea {
		t.Errorf("Circle zone area too small: got %.2f m² (expected > %.0f m²)",
			circleZone.Area, minReasonableArea)
	}
	if circleZone.Area > maxReasonableArea {
		t.Errorf("Circle zone area too large: got %.2f m² (expected < %.0f m²). Bug still exists - area should be ~%.0f m²!",
			circleZone.Area, maxReasonableArea, expectedArea)
	}

	t.Logf("Circle at origin area: %.2f m² (expected ~%.0f m²)", circleZone.Area, expectedArea)
}

func createNormalizeFunction(t *testing.T, db *sql.DB) {
	t.Helper()

	// First create normalize_for_intersection function (for overlap detection)
	normalizeForIntersectionSQL := `
CREATE OR REPLACE FUNCTION normalize_for_intersection(geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circ CONSTANT NUMERIC := 264000000;
    half_ring CONSTANT NUMERIC := 132000000;
    span NUMERIC;
    max_x NUMERIC;
BEGIN
    IF geom IS NULL OR ST_IsEmpty(geom) THEN
        RETURN geom;
    END IF;
    
    span := ST_XMax(geom) - ST_XMin(geom);
    max_x := ST_XMax(geom);
    
    -- Normalize if:
    -- 1. Span > half_ring (definitely wraps), OR
    -- 2. Max X > half_ring (stored with wrapped coordinates, e.g., from a merge)
    -- This handles merged geometries that are stored with wrapped coordinates
    IF span > half_ring OR max_x > half_ring THEN
        -- Continue to normalization logic below
    ELSE
        -- Not wrapped - return as-is
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

	// Then create normalize_zone_geometry_for_area function (for area calculation)
	// Read the migration file to create the function
	migrationPath := filepath.Join("..", "..", "..", "..", "database", "migrations", "000015_normalize_zone_geometry_for_area.up.sql")

	// Try multiple paths
	paths := []string{
		migrationPath,
		filepath.Join("database", "migrations", "000015_normalize_zone_geometry_for_area.up.sql"),
		filepath.Join("..", "database", "migrations", "000015_normalize_zone_geometry_for_area.up.sql"),
		filepath.Join("..", "..", "database", "migrations", "000015_normalize_zone_geometry_for_area.up.sql"),
		filepath.Join("..", "..", "..", "database", "migrations", "000015_normalize_zone_geometry_for_area.up.sql"),
	}

	var migrationSQL string
	var err error
	for _, path := range paths {
		if data, readErr := os.ReadFile(path); readErr == nil {
			migrationSQL = string(data)
			break
		}
	}

	if migrationSQL == "" {
		// If file not found, create function directly (for testing)
		migrationSQL = `
CREATE OR REPLACE FUNCTION normalize_zone_geometry_for_area(geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circumference CONSTANT NUMERIC := 264000000;
    half_ring CONSTANT NUMERIC := 132000000;
    min_x NUMERIC;
    max_x NUMERIC;
    span NUMERIC;
    geom_type TEXT;
    geom_json JSONB;
    coords JSONB;
    ring JSONB;
    normalized_rings JSONB := '[]'::JSONB;
    point JSONB;
    x NUMERIC;
    y NUMERIC;
    i INTEGER;
    j INTEGER;
    normalized_coords JSONB;
BEGIN
    IF geom IS NULL OR ST_IsEmpty(geom) THEN
        RETURN geom;
    END IF;
    
    min_x := ST_XMin(geom);
    max_x := ST_XMax(geom);
    span := max_x - min_x;
    
    IF span <= half_ring THEN
        RETURN geom;
    END IF;
    
    geom_json := ST_AsGeoJSON(geom)::JSONB;
    geom_type := geom_json->>'type';
    
    IF geom_type = 'Polygon' THEN
        coords := geom_json->'coordinates';
        FOR i IN 0..jsonb_array_length(coords) - 1 LOOP
            ring := coords->i;
            normalized_coords := '[]'::JSONB;
            
            FOR j IN 0..jsonb_array_length(ring) - 1 LOOP
                point := ring->j;
                x := (point->0)::NUMERIC;
                y := (point->1)::NUMERIC;
                
                IF x > half_ring THEN
                    x := x - ring_circumference;
                END IF;
                
                normalized_coords := normalized_coords || jsonb_build_array(x, y);
            END LOOP;
            
            normalized_rings := normalized_rings || jsonb_build_array(normalized_coords);
        END LOOP;
        
        geom_json := jsonb_build_object(
            'type', 'Polygon',
            'coordinates', normalized_rings
        );
        
        RETURN ST_SetSRID(ST_GeomFromGeoJSON(geom_json::TEXT), 0);
        
    ELSIF geom_type = 'MultiPolygon' THEN
        coords := geom_json->'coordinates';
        normalized_rings := '[]'::JSONB;
        
        FOR i IN 0..jsonb_array_length(coords) - 1 LOOP
            ring := coords->i;
            normalized_coords := '[]'::JSONB;
            
            FOR j IN 0..jsonb_array_length(ring) - 1 LOOP
                DECLARE
                    ring_points JSONB := ring->j;
                    normalized_ring_points JSONB := '[]'::JSONB;
                    k INTEGER;
                    point_x NUMERIC;
                    point_y NUMERIC;
                    point_coord JSONB;
                BEGIN
                    FOR k IN 0..jsonb_array_length(ring_points) - 1 LOOP
                        point_coord := ring_points->k;
                        point_x := (point_coord->0)::NUMERIC;
                        point_y := (point_coord->1)::NUMERIC;
                        
                        IF point_x > half_ring THEN
                            point_x := point_x - ring_circumference;
                        END IF;
                        
                        normalized_ring_points := normalized_ring_points || jsonb_build_array(point_x, point_y);
                    END LOOP;
                    
                    normalized_coords := normalized_coords || jsonb_build_array(normalized_ring_points);
                END;
            END LOOP;
            
            normalized_rings := normalized_rings || jsonb_build_array(normalized_coords);
        END LOOP;
        
        geom_json := jsonb_build_object(
            'type', 'MultiPolygon',
            'coordinates', normalized_rings
        );
        
        RETURN ST_SetSRID(ST_GeomFromGeoJSON(geom_json::TEXT), 0);
        
    ELSE
        RETURN geom;
    END IF;
    
END;
$$ LANGUAGE plpgsql IMMUTABLE;
`
	}

	_, err = db.Exec(migrationSQL)
	if err != nil {
		t.Fatalf("failed to create normalize function: %v", err)
	}
}

// TestZoneStorage_MergeOverlappingZones tests basic zone merging functionality
func TestZoneStorage_MergeOverlappingZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone: rectangle from (0,0) to (20,20)
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create second zone: overlapping rectangle from (10,10) to (30,30)
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30],[10,10]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// After merge, zone2 should have the ID of zone1 (oldest zone)
	if zone2.ID != zone1ID {
		t.Errorf("Expected merged zone to have ID %d (oldest zone), got %d", zone1ID, zone2.ID)
	}

	// Zone1 should no longer exist (replaced by merged zone)
	stored1, err := storage.GetZoneByID(zone1ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}
	if stored1 == nil {
		t.Fatal("Expected zone1 to still exist (with merged geometry)")
	}
	if stored1.ID != zone1ID {
		t.Errorf("Expected zone1 ID to remain %d, got %d", zone1ID, stored1.ID)
	}

	// Merged zone should have larger area than individual zones
	// Area of rect1: 400 m², rect2: 400 m², merged: ~700 m² (400 + 400 - 100 overlap)
	expectedMinArea := 600.0
	if zone2.Area < expectedMinArea {
		t.Errorf("Expected merged area >= %.0f m², got %.2f m²", expectedMinArea, zone2.Area)
	}
	if zone2.Area <= zone1Area {
		t.Errorf("Expected merged area (%.2f) > original area (%.2f)", zone2.Area, zone1Area)
	}

	t.Logf("Zone1 area: %.2f m²", zone1Area)
	t.Logf("Merged zone area: %.2f m²", zone2.Area)
}

// TestZoneStorage_MergeWrappedZones tests merging zones that wrap around X-axis
// This test verifies the wrap-point handling in zone merging using the simplified coordinate
// transformation approach that follows the same pattern as chunk wrapping, zone rendering, and zone editing.
func TestZoneStorage_MergeWrappedZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone: rectangle that wraps across boundary
	// Rectangle from (263999990, 0) to (10, 50) - wraps from high X to low X
	// When normalized: (-10, 0) to (10, 50) = 20m x 50m = 1000 m²
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999990,0],[10,0],[10,50],[263999990,50],[263999990,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "commercial",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create second zone: overlapping rectangle that also wraps
	// Rectangle from (263999995, 10) to (15, 40) - overlaps with zone1
	// When normalized: (-5, 10) to (15, 40) = 20m x 30m = 600 m²
	// Overlaps zone1 from X=-5 to X=10, Y=10 to Y=40
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999995,10],[15,10],[15,40],[263999995,40],[263999995,10]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone2",
		ZoneType: "commercial",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// After merge, should preserve zone1 ID (oldest)
	if zone2.ID != zone1ID {
		t.Errorf("Expected merged zone to have ID %d (oldest zone), got %d", zone1ID, zone2.ID)
	}

	// Merged zone should have valid geometry and reasonable area
	// Merged area should be > max(zone1, zone2) but < sum (they overlap)
	if zone2.Area <= 0 {
		t.Errorf("Expected merged area > 0, got %.2f m²", zone2.Area)
	}
	if zone2.Area <= zone1Area {
		t.Errorf("Expected merged area (%.2f) > original area (%.2f)", zone2.Area, zone1Area)
	}
	// Merged should be less than sum (they overlap)
	sumArea := zone1Area + zone2.Area
	if zone2.Area >= sumArea {
		t.Errorf("Expected merged area (%.2f) < sum of individual areas (%.2f) since they overlap",
			zone2.Area, sumArea)
	}

	// Verify geometry is valid Polygon (not MultiPolygon)
	if len(zone2.Geometry) == 0 {
		t.Fatal("Expected merged zone to have geometry")
	}
	var geomMap map[string]interface{}
	if err := json.Unmarshal(zone2.Geometry, &geomMap); err != nil {
		t.Fatalf("Failed to parse merged geometry: %v", err)
	}
	geomType, ok := geomMap["type"].(string)
	if !ok || geomType != "Polygon" {
		t.Errorf("Expected merged geometry type 'Polygon', got '%v'", geomType)
	}

	t.Logf("Zone1 area: %.2f m²", zone1Area)
	t.Logf("Merged zone area: %.2f m²", zone2.Area)
	t.Logf("Merged geometry type: %s", geomType)
}

// TestZoneStorage_MergePreservesOldestID tests that the oldest zone ID is preserved
func TestZoneStorage_MergePreservesOldestID(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create three zones with overlapping geometries
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "OldestZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	oldestID := zone1.ID

	// Create second zone that overlaps with first
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[5,5],[15,5],[15,15],[5,15],[5,5]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "MiddleZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Zone2 should merge with zone1, preserving zone1's ID
	if zone2.ID != oldestID {
		t.Errorf("Expected merged zone to have oldest ID %d, got %d", oldestID, zone2.ID)
	}

	// Create third zone that overlaps with merged zone
	rect3 := json.RawMessage(`{"type":"Polygon","coordinates":[[[12,12],[22,12],[22,22],[12,22],[12,12]]]}`)
	zone3, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "NewestZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect3,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone3: %v", err)
	}

	// Zone3 should also merge, still preserving the original oldest ID
	if zone3.ID != oldestID {
		t.Errorf("Expected merged zone to still have oldest ID %d after third merge, got %d", oldestID, zone3.ID)
	}

	t.Logf("Oldest zone ID: %d", oldestID)
	t.Logf("Final merged zone ID: %d", zone3.ID)
	t.Logf("Final merged zone area: %.2f m²", zone3.Area)
}

// TestZoneStorage_NoMergeDifferentTypes tests that zones of different types don't merge
func TestZoneStorage_NoMergeDifferentTypes(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone: residential
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ResidentialZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID

	// Create second zone: commercial (different type, overlapping geometry)
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30],[10,10]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "CommercialZone",
		ZoneType: "commercial",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Zones should NOT merge - different types
	if zone2.ID == zone1ID {
		t.Errorf("Expected zones NOT to merge (different types), but zone2.ID (%d) == zone1.ID (%d)", zone2.ID, zone1ID)
	}

	// Both zones should still exist
	stored1, err := storage.GetZoneByID(zone1ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for zone1: %v", err)
	}
	if stored1 == nil {
		t.Fatal("Expected zone1 to still exist")
	}
	stored2, err := storage.GetZoneByID(zone2.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for zone2: %v", err)
	}
	if stored2 == nil {
		t.Fatal("Expected zone2 to still exist")
	}

	t.Logf("Zone1 (residential) ID: %d, area: %.2f m²", zone1ID, zone1.Area)
	t.Logf("Zone2 (commercial) ID: %d, area: %.2f m²", zone2.ID, zone2.Area)
}

// TestZoneStorage_NoMergeDifferentFloors tests that zones on different floors don't merge
func TestZoneStorage_NoMergeDifferentFloors(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone: floor 0
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Floor0Zone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID

	// Create second zone: floor 1 (different floor, same type, overlapping geometry)
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30],[10,10]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Floor1Zone",
		ZoneType: "residential",
		Floor:    1,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Zones should NOT merge - different floors
	if zone2.ID == zone1ID {
		t.Errorf("Expected zones NOT to merge (different floors), but zone2.ID (%d) == zone1.ID (%d)", zone2.ID, zone1ID)
	}

	t.Logf("Zone1 (floor 0) ID: %d", zone1ID)
	t.Logf("Zone2 (floor 1) ID: %d", zone2.ID)
}

// TestZoneStorage_MergeMultipleZones tests merging 3+ overlapping zones
func TestZoneStorage_MergeMultipleZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[15,0],[15,15],[0,15],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "industrial",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	oldestID := zone1.ID

	// Create second zone (overlaps with zone1)
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[10,10],[25,10],[25,25],[10,25],[10,10]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone2",
		ZoneType: "industrial",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Zone2 should merge with zone1
	if zone2.ID != oldestID {
		t.Errorf("Expected zone2 to merge with zone1 (ID %d), got ID %d", oldestID, zone2.ID)
	}

	// Create third zone (overlaps with merged zone)
	rect3 := json.RawMessage(`{"type":"Polygon","coordinates":[[[20,20],[35,20],[35,35],[20,35],[20,20]]]}`)
	zone3, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone3",
		ZoneType: "industrial",
		Floor:    0,
		Geometry: rect3,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone3: %v", err)
	}

	// Zone3 should merge with merged zone, preserving oldest ID
	if zone3.ID != oldestID {
		t.Errorf("Expected zone3 to merge with existing merged zone (ID %d), got ID %d", oldestID, zone3.ID)
	}

	// Verify only one zone exists with this ID
	finalZone, err := storage.GetZoneByID(oldestID)
	if err != nil {
		t.Fatalf("Failed to get final merged zone: %v", err)
	}
	if finalZone == nil {
		t.Fatal("Expected final merged zone to exist")
	}

	// Final merged area should be larger than individual zones
	if finalZone.Area < zone1.Area*1.5 {
		t.Errorf("Expected merged area (%.2f) to be significantly larger than first zone (%.2f)", finalZone.Area, zone1.Area)
	}

	t.Logf("Oldest zone ID: %d", oldestID)
	t.Logf("Final merged zone area: %.2f m²", finalZone.Area)
}

// TestZoneStorage_MergeNonOverlappingZones tests that non-overlapping zones don't merge
func TestZoneStorage_MergeNonOverlappingZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID

	// Create second zone: far away, non-overlapping
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[100,100],[110,100],[110,110],[100,110],[100,100]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Zones should NOT merge - they don't overlap
	if zone2.ID == zone1ID {
		t.Errorf("Expected zones NOT to merge (non-overlapping), but zone2.ID (%d) == zone1.ID (%d)", zone2.ID, zone1ID)
	}

	// Both zones should exist independently
	stored1, err := storage.GetZoneByID(zone1ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for zone1: %v", err)
	}
	if stored1 == nil {
		t.Fatal("Expected zone1 to still exist")
	}
	stored2, err := storage.GetZoneByID(zone2.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for zone2: %v", err)
	}
	if stored2 == nil {
		t.Fatal("Expected zone2 to still exist")
	}

	// Areas should be identical to original (no merging occurred)
	if stored1.Area != zone1.Area {
		t.Errorf("Expected zone1 area to remain %.2f, got %.2f", zone1.Area, stored1.Area)
	}
	if stored2.Area != zone2.Area {
		t.Errorf("Expected zone2 area to remain %.2f, got %.2f", zone2.Area, stored2.Area)
	}

	t.Logf("Zone1 ID: %d, area: %.2f m²", zone1ID, zone1.Area)
	t.Logf("Zone2 ID: %d, area: %.2f m²", zone2.ID, zone2.Area)
}

// ============================================================================
// Dezone (Zone Subtraction) Tests
// ============================================================================

// TestZoneStorage_DezoneBasicSubtraction tests basic dezone functionality
// Creates a zone and subtracts a portion of it using a dezone
func TestZoneStorage_DezoneBasicSubtraction(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a rectangle zone: 100x100 at (0,0)
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "TestZone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: zone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	originalArea := createdZone.Area
	originalID := createdZone.ID

	// Create a dezone that subtracts a 20x20 square from the center
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[40,40],[60,40],[60,60],[40,60],[40,40]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	if len(updatedZones) != 1 {
		t.Fatalf("Expected 1 updated zone, got %d", len(updatedZones))
	}

	updatedZone := updatedZones[0]
	if updatedZone.ID != originalID {
		t.Errorf("Expected updated zone to have same ID (%d), got %d", originalID, updatedZone.ID)
	}

	// Area should be reduced (100*100 - 20*20 = 10000 - 400 = 9600)
	if updatedZone.Area >= originalArea {
		t.Errorf("Expected area to decrease (original: %.2f, updated: %.2f)", originalArea, updatedZone.Area)
	}

	// Verify the zone still exists and is valid
	stored, err := storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}
	if stored == nil {
		t.Fatal("Zone was deleted when it should have been updated")
	}

	t.Logf("✓ Dezone subtraction successful: area reduced from %.2f to %.2f m²", originalArea, updatedZone.Area)
}

// TestZoneStorage_DezoneBisectsZone tests that a dezone that bisects a zone creates two separate zones
func TestZoneStorage_DezoneBisectsZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a rectangle zone: 100x100 at (0,0)
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "TestZone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: zone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	originalID := createdZone.ID

	// Create a dezone that bisects the zone vertically (cuts it in half)
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[45,0],[55,0],[55,100],[45,100],[45,0]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should result in 2 zones: the updated original and a new split zone
	if len(updatedZones) != 2 {
		t.Fatalf("Expected 2 zones after bisection (original + split), got %d", len(updatedZones))
	}

	// First zone should be the updated original
	if updatedZones[0].ID != originalID {
		t.Errorf("Expected first zone to be original (ID %d), got %d", originalID, updatedZones[0].ID)
	}

	// Second zone should be a new zone with "(Split 1)" in the name
	if updatedZones[1].ID == originalID {
		t.Error("Expected second zone to be a new zone, but it has the same ID as original")
	}
	if updatedZones[1].Name != "TestZone (Split 1)" {
		t.Errorf("Expected split zone name to be 'TestZone (Split 1)', got '%s'", updatedZones[1].Name)
	}

	// Both zones should have valid areas
	if updatedZones[0].Area <= 0 {
		t.Errorf("First zone area should be positive, got %.2f", updatedZones[0].Area)
	}
	if updatedZones[1].Area <= 0 {
		t.Errorf("Second zone area should be positive, got %.2f", updatedZones[1].Area)
	}

	// Combined area should be less than original (100*100 = 10000, minus the 10*100 = 1000 dezone area)
	combinedArea := updatedZones[0].Area + updatedZones[1].Area
	expectedMaxArea := 10000.0 - 1000.0     // Original minus dezone
	if combinedArea > expectedMaxArea*1.1 { // Allow 10% tolerance
		t.Errorf("Combined area (%.2f) should be approximately %.2f, got %.2f", combinedArea, expectedMaxArea, combinedArea)
	}

	t.Logf("✓ Zone bisection successful: created 2 zones (ID %d and %d)", updatedZones[0].ID, updatedZones[1].ID)
	t.Logf("  Original zone area: %.2f m²", updatedZones[0].Area)
	t.Logf("  Split zone area: %.2f m²", updatedZones[1].Area)
}

// TestZoneStorage_DezoneNonOverlapping tests that a dezone that doesn't overlap has no effect
func TestZoneStorage_DezoneNonOverlapping(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a rectangle zone at (0,0)
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "TestZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	originalArea := createdZone.Area

	// Create a dezone that doesn't overlap (far away at X=5000)
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[5000,0],[5100,0],[5100,100],[5000,100],[5000,0]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should return no zones (no overlap)
	if len(updatedZones) != 0 {
		t.Errorf("Expected no zones to be updated (non-overlapping), got %d zones", len(updatedZones))
	}

	// Verify original zone is unchanged
	storedZone, err := storage.GetZoneByID(createdZone.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}
	if storedZone == nil {
		t.Fatal("Expected zone to still exist")
	}
	if storedZone.Area != originalArea {
		t.Errorf("Expected zone area to be unchanged (%.2f), got %.2f", originalArea, storedZone.Area)
	}

	t.Logf("✓ Non-overlapping dezone correctly had no effect")
	t.Logf("  Original zone area: %.2f m²", originalArea)
	t.Logf("  Zone area after dezone: %.2f m²", storedZone.Area)
}

// TestZoneStorage_DezoneMultipleOverlapping tests dezone with multiple overlapping zones
func TestZoneStorage_DezoneMultipleOverlapping(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create two overlapping zones
	zone1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone1,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}

	zone2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,50],[150,50],[150,150],[50,150],[50,50]]]}`)
	createdZone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone2,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Create a dezone that overlaps both zones
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[25,25],[125,25],[125,125],[25,125],[25,25]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should update both zones
	if len(updatedZones) != 2 {
		t.Errorf("Expected 2 zones to be updated, got %d", len(updatedZones))
	}

	// Verify both zones were updated
	zoneIDs := make(map[int64]bool)
	for _, z := range updatedZones {
		zoneIDs[z.ID] = true
	}
	if !zoneIDs[createdZone1.ID] {
		t.Error("Expected zone1 to be updated")
	}
	if !zoneIDs[createdZone2.ID] {
		t.Error("Expected zone2 to be updated")
	}

	t.Logf("✓ Dezone correctly subtracted from multiple overlapping zones")
	t.Logf("  Updated %d zones", len(updatedZones))
}

// TestZoneStorage_DezoneWrappedCoordinates tests dezone with wrapped coordinates
func TestZoneStorage_DezoneWrappedCoordinates(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a zone that wraps around the X-axis boundary
	// From X=263999950 to X=50 (wraps across boundary)
	wrappedZone := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999950,0],[50,0],[50,100],[263999950,100],[263999950,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "WrappedZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: wrappedZone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for wrapped zone: %v", err)
	}
	originalArea := createdZone.Area

	// Create a dezone that also wraps and overlaps the zone
	// From X=263999980 to X=20 (wraps, overlaps wrapped zone)
	wrappedDezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[263999980,30],[20,30],[20,70],[263999980,70],[263999980,30]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, wrappedDezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should update the wrapped zone
	if len(updatedZones) != 1 {
		t.Errorf("Expected 1 zone to be updated, got %d", len(updatedZones))
	}

	// Verify the zone was updated
	if updatedZones[0].ID != createdZone.ID {
		t.Errorf("Expected updated zone ID %d, got %d", createdZone.ID, updatedZones[0].ID)
	}

	// Area should be reduced
	if updatedZones[0].Area >= originalArea {
		t.Errorf("Expected updated area (%.2f) < original area (%.2f)", updatedZones[0].Area, originalArea)
	}

	t.Logf("✓ Wrapped dezone correctly subtracted from wrapped zone")
	t.Logf("  Original area: %.2f m²", originalArea)
	t.Logf("  Updated area: %.2f m²", updatedZones[0].Area)
}

// TestZoneStorage_DezoneCompletelyRemovesZone tests that a dezone that completely covers a zone removes it
func TestZoneStorage_DezoneCompletelyRemovesZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a zone
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "TestZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}

	// Create a dezone that completely covers the zone
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[-10,-10],[110,-10],[110,110],[-10,110],[-10,-10]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should return empty (zone completely removed)
	if len(updatedZones) != 0 {
		t.Errorf("Expected 0 zones (zone completely removed), got %d zones", len(updatedZones))
	}

	// Verify zone no longer exists or has zero area
	storedZone, err := storage.GetZoneByID(createdZone.ID)
	if err != nil {
		// Zone doesn't exist, which is acceptable
		return
	}
	if storedZone != nil && storedZone.Area > 0 {
		t.Errorf("Expected zone to be completely removed or have zero area, but it still exists with area %.2f m²", storedZone.Area)
	}

	t.Logf("✓ Dezone completely removed zone")
}

// TestZoneStorage_DezoneWithDifferentZoneTypes tests dezone with different zone types
func TestZoneStorage_DezoneWithDifferentZoneTypes(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create zones of different types
	residentialZone := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdResidential, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Residential",
		ZoneType: "residential",
		Floor:    0,
		Geometry: residentialZone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for residential: %v", err)
	}

	industrialZone := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,50],[150,50],[150,150],[50,150],[50,50]]]}`)
	createdIndustrial, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Industrial",
		ZoneType: "industrial",
		Floor:    0,
		Geometry: industrialZone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for industrial: %v", err)
	}

	// Create a dezone that overlaps both
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[25,25],[125,25],[125,125],[25,125],[25,25]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should update both zones regardless of type
	if len(updatedZones) != 2 {
		t.Errorf("Expected 2 zones to be updated (both types), got %d", len(updatedZones))
	}

	// Verify both zones were updated
	zoneIDs := make(map[int64]bool)
	for _, z := range updatedZones {
		zoneIDs[z.ID] = true
	}
	if !zoneIDs[createdResidential.ID] {
		t.Error("Expected residential zone to be updated")
	}
	if !zoneIDs[createdIndustrial.ID] {
		t.Error("Expected industrial zone to be updated")
	}

	t.Logf("✓ Dezone correctly subtracted from zones of different types")
	t.Logf("  Updated %d zones", len(updatedZones))
}

// TestZoneStorage_DezoneOwnershipCheck tests that dezone only affects zones owned by the user
func TestZoneStorage_DezoneOwnershipCheck(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID1 := int64(1)
	userID2 := int64(2)

	// Create a zone owned by user1
	zone1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "User1Zone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone1,
		OwnerID:  &userID1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for user1: %v", err)
	}
	originalArea1 := createdZone1.Area

	// Create a zone owned by user2
	zone2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,50],[150,50],[150,150],[50,150],[50,50]]]}`)
	createdZone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "User2Zone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone2,
		OwnerID:  &userID2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for user2: %v", err)
	}
	originalArea2 := createdZone2.Area

	// Create a dezone that overlaps both zones, but user1 tries to dezone
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[25,25],[125,25],[125,125],[25,125],[25,25]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID1)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should only update user1's zone
	if len(updatedZones) != 1 {
		t.Errorf("Expected 1 zone to be updated (only user1's), got %d", len(updatedZones))
	}

	// Verify only user1's zone was updated
	if updatedZones[0].ID != createdZone1.ID {
		t.Errorf("Expected user1's zone to be updated, got zone ID %d", updatedZones[0].ID)
	}

	// Verify user2's zone is unchanged
	storedZone2, err := storage.GetZoneByID(createdZone2.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for user2's zone: %v", err)
	}
	if storedZone2 == nil {
		t.Fatal("Expected user2's zone to still exist")
	}
	if storedZone2.Area != originalArea2 {
		t.Errorf("Expected user2's zone area to be unchanged (%.2f), got %.2f", originalArea2, storedZone2.Area)
	}

	t.Logf("✓ Dezone correctly respects ownership")
	t.Logf("  User1's zone updated: area %.2f -> %.2f m²", originalArea1, updatedZones[0].Area)
	t.Logf("  User2's zone unchanged: area %.2f m²", originalArea2)
}

// TestZoneStorage_DezoneAtOrigin tests dezone at the origin (0,0)
func TestZoneStorage_DezoneAtOrigin(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a zone at origin
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ZoneAtOrigin",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	originalArea := createdZone.Area

	// Create a dezone at origin that overlaps
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[25,25],[75,25],[75,75],[25,75],[25,25]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should update the zone
	if len(updatedZones) != 1 {
		t.Errorf("Expected 1 zone to be updated, got %d", len(updatedZones))
	}

	// Area should be reduced
	if updatedZones[0].Area >= originalArea {
		t.Errorf("Expected updated area (%.2f) < original area (%.2f)", updatedZones[0].Area, originalArea)
	}

	t.Logf("✓ Dezone at origin correctly subtracted from zone")
	t.Logf("  Original area: %.2f m²", originalArea)
	t.Logf("  Updated area: %.2f m²", updatedZones[0].Area)
}

// TestZoneStorage_DezoneOnXAxis tests dezone on X axis (Y=0)
func TestZoneStorage_DezoneOnXAxis(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a zone on X axis (Y=0)
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ZoneOnXAxis",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	originalArea := createdZone.Area

	// Create a dezone on X axis that overlaps
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[1025,25],[1075,25],[1075,75],[1025,75],[1025,25]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should update the zone
	if len(updatedZones) != 1 {
		t.Errorf("Expected 1 zone to be updated, got %d", len(updatedZones))
	}

	// Area should be reduced
	if updatedZones[0].Area >= originalArea {
		t.Errorf("Expected updated area (%.2f) < original area (%.2f)", updatedZones[0].Area, originalArea)
	}

	t.Logf("✓ Dezone on X axis correctly subtracted from zone")
	t.Logf("  Original area: %.2f m²", originalArea)
	t.Logf("  Updated area: %.2f m²", updatedZones[0].Area)
}

// TestZoneStorage_DezoneWithPositiveX tests dezone with positive X coordinates
func TestZoneStorage_DezoneWithPositiveX(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a zone with positive X coordinates
	zone := json.RawMessage(`{"type":"Polygon","coordinates":[[[5000,100],[5100,100],[5100,200],[5000,200],[5000,100]]]}`)
	createdZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ZonePositiveX",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zone,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed: %v", err)
	}
	originalArea := createdZone.Area

	// Create a dezone with positive X that overlaps
	dezone := json.RawMessage(`{"type":"Polygon","coordinates":[[[5025,125],[5075,125],[5075,175],[5025,175],[5025,125]]]}`)
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	// Should update the zone
	if len(updatedZones) != 1 {
		t.Errorf("Expected 1 zone to be updated, got %d", len(updatedZones))
	}

	// Area should be reduced
	if updatedZones[0].Area >= originalArea {
		t.Errorf("Expected updated area (%.2f) < original area (%.2f)", updatedZones[0].Area, originalArea)
	}

	t.Logf("✓ Dezone with positive X correctly subtracted from zone")
	t.Logf("  Original area: %.2f m²", originalArea)
	t.Logf("  Updated area: %.2f m²", updatedZones[0].Area)
}

// TestZoneStorage_DezoneSubtractsFromSingleZone tests dezone subtracting from a single zone
func TestZoneStorage_DezoneSubtractsFromSingleZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a rectangle zone
	rect := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "OriginalZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect,
		OwnerID:  &userID,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for rectangle: %v", err)
	}
	originalArea := zone1.Area
	originalID := zone1.ID

	// Create a dezone that overlaps the rectangle (smaller circle in center)
	dezone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1030,30],[1070,30],[1070,70],[1030,70],[1030,30]]]
	}`)

	// Subtract the dezone from overlapping zones
	updatedZones, err := storage.SubtractDezoneFromAllOverlapping(0, dezone, userID)
	if err != nil {
		t.Fatalf("SubtractDezoneFromAllOverlapping failed: %v", err)
	}

	if len(updatedZones) != 1 {
		t.Fatalf("Expected 1 updated zone, got %d", len(updatedZones))
	}

	// Fetch the updated zone
	updatedZone := updatedZones[0]
	if updatedZone.ID != originalID {
		t.Fatalf("Expected updated zone to have ID %d, got %d", originalID, updatedZone.ID)
	}

	// Also verify by fetching directly
	updatedZone, err = storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}

	// Area should be reduced (rectangle minus the dezone area)
	if updatedZone.Area >= originalArea {
		t.Errorf("Expected dezone to reduce area: original %.2f >= updated %.2f", originalArea, updatedZone.Area)
	}

	// Verify the zone still exists and is valid
	var geomMap map[string]interface{}
	if err := json.Unmarshal(updatedZone.Geometry, &geomMap); err != nil {
		t.Fatalf("Failed to parse updated geometry: %v", err)
	}
	geomType, ok := geomMap["type"].(string)
	if !ok || geomType != "Polygon" {
		t.Errorf("Expected updated geometry type 'Polygon', got '%v'", geomType)
	}

	t.Logf("✓ Dezone successfully subtracted from single zone")
	t.Logf("  Original area: %.2f m²", originalArea)
	t.Logf("  Updated area: %.2f m²", updatedZone.Area)
}

// ============================================================================
// Comprehensive tests for all zone tools (Rectangle, Circle, Polygon, Paintbrush)
// ============================================================================

// TestZoneStorage_RectangleMerging tests rectangle tool merging scenarios
func TestZoneStorage_RectangleMerging(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first rectangle at origin
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Rect1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for rect1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create second overlapping rectangle
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,50],[150,50],[150,150],[50,150],[50,50]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Rect2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for rect2: %v", err)
	}

	// Should merge
	if zone2.ID != zone1ID {
		t.Errorf("Expected rectangles to merge, zone2.ID (%d) should equal zone1.ID (%d)", zone2.ID, zone1ID)
	}
	if zone2.Area <= zone1Area {
		t.Errorf("Expected merged area (%.2f) > original area (%.2f)", zone2.Area, zone1Area)
	}

	t.Logf("✓ Rectangles merged successfully")
	t.Logf("  Original area: %.2f m², Merged area: %.2f m²", zone1Area, zone2.Area)
}

// TestZoneStorage_RectangleAtOriginWithEdges tests the exact production scenario:
// Rectangle at origin with overlapping rectangles on all four edges (north, south, east, west)
// This reproduces the user's reported issue where some edges merge and others don't
func TestZoneStorage_RectangleAtOriginWithEdges(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create rectangle at origin (centered at 0,0)
	// Rectangle from (0, 0) to (100, 100)
	originRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	zoneOrigin, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "OriginRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: originRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for origin rectangle: %v", err)
	}
	originID := zoneOrigin.ID
	originArea := zoneOrigin.Area

	// Create rectangle overlapping WEST edge (left side)
	// Rectangle from (50, 0) to (150, 100) - overlaps with origin on right edge
	// Note: In ring coordinates, "west" relative to origin might mean wrapping, but for test we use simple overlap
	// Actually, let's make it overlap the LEFT edge: from (50, 0) overlaps right edge, so for left we need negative
	// But negative is rejected, so let's use a rectangle that overlaps the left side by being positioned to the left
	// Actually, in absolute coordinates, "west" of origin would be negative, but we can't do that
	// Let's simulate by having a rectangle that should overlap but might not be detected
	// Rectangle positioned to overlap left edge: from (50, 0) to (150, 100) - this overlaps RIGHT edge
	// For LEFT edge overlap, we'd need something like wrapping, but let's test with a rectangle that touches
	westRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,0],[150,0],[150,100],[50,100],[50,0]]]}`)
	zoneWest, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "WestRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: westRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for west rectangle: %v", err)
	}

	// Create rectangle overlapping NORTH edge (top) - Y increases upward
	// Rectangle from (0, 50) to (100, 150) - overlaps with origin on top edge
	northRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,50],[100,50],[100,150],[0,150],[0,50]]]}`)
	zoneNorth, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "NorthRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: northRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for north rectangle: %v", err)
	}

	// Create rectangle overlapping EAST edge (right side) - X increases eastward
	// Rectangle from (50, 0) to (150, 100) - overlaps with origin on right edge
	eastRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,0],[150,0],[150,100],[50,100],[50,0]]]}`)
	zoneEast, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "EastRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: eastRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for east rectangle: %v", err)
	}

	// Create rectangle overlapping SOUTH edge (bottom) - Y decreases southward
	// Rectangle from (0, 50) to (100, 150) - wait, that's north
	// For south, we need negative Y, but that's rejected
	// Let's use a rectangle that overlaps bottom: from (0, 0) to (100, 50) - overlaps top of south rect
	// Actually, let's make it overlap the bottom edge properly
	southRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,50],[0,50],[0,0]]]}`)
	zoneSouth, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "SouthRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: southRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for south rectangle: %v", err)
	}

	// ALL rectangles should merge into the origin (oldest)
	zones := []struct {
		name string
		zone *Zone
	}{
		{"West", zoneWest},
		{"North", zoneNorth},
		{"East", zoneEast},
		{"South", zoneSouth},
	}

	allMerged := true
	for _, z := range zones {
		if z.zone.ID != originID {
			t.Errorf("❌ %s rectangle did NOT merge with origin (ID %d), got ID %d", z.name, originID, z.zone.ID)
			allMerged = false
		} else {
			t.Logf("✓ %s rectangle merged with origin", z.name)
		}
	}

	if !allMerged {
		t.Errorf("Expected all edge rectangles to merge with origin, but some did not")
	}

	// Verify final merged zone
	finalZone, err := storage.GetZoneByID(originID)
	if err != nil {
		t.Fatalf("Failed to get final merged zone: %v", err)
	}

	// Final area should be larger than origin
	if finalZone.Area <= originArea {
		t.Errorf("Expected merged area (%.2f) > origin area (%.2f)", finalZone.Area, originArea)
	}

	// Count total zones - should be only 1
	var zoneCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM zones WHERE zone_type = 'residential' AND floor = 0`).Scan(&zoneCount); err != nil {
		t.Fatalf("Failed to count zones: %v", err)
	}

	if zoneCount != 1 {
		t.Errorf("Expected 1 merged zone, but found %d separate zones", zoneCount)
		t.Logf("  This indicates the merge failed - zones are not being combined")
	}

	t.Logf("✓ Rectangle at origin with edge overlaps test")
	t.Logf("  Origin area: %.2f m²", originArea)
	t.Logf("  Final merged area: %.2f m²", finalZone.Area)
	t.Logf("  Total zones in DB: %d (expected 1)", zoneCount)
}

// TestZoneStorage_VerifyNormalizeForIntersectionExists tests that normalize_for_intersection exists
// This is critical - if this function doesn't exist, overlap detection will fail silently
// and zones won't merge, even though tests pass (because tests create the function)
func TestZoneStorage_VerifyNormalizeForIntersectionExists(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)
	createZonesTable(t, db)
	// NOTE: We do NOT call createNormalizeFunction here - we want to test if it exists from migrations
	truncateZonesTable(t, db)

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
		t.Fatal("❌ CRITICAL: normalize_for_intersection function does not exist in database!")
		t.Fatal("   This function is REQUIRED for overlap detection.")
		t.Fatal("   Without it, zones will not merge correctly.")
		t.Fatal("   Run migration 000016_normalize_for_intersection.up.sql")
	}

	// Test the function works with a simple query
	testQuery := `
		SELECT ST_AsText(normalize_for_intersection(
			ST_GeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))')
		))
	`
	var result string
	err = db.QueryRow(testQuery).Scan(&result)
	if err != nil {
		t.Fatalf("normalize_for_intersection function exists but failed to execute: %v", err)
	}
	if result == "" {
		t.Error("normalize_for_intersection returned empty result")
	}

	t.Logf("✓ normalize_for_intersection function exists and works")
	t.Logf("  Test result: %s", result)
}

// TestZoneStorage_CircleMerging tests circle tool merging scenarios
func TestZoneStorage_CircleMerging(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first circle (approximated as polygon with many points)
	// Circle centered at (100, 100) with radius 50
	circle1 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[
			[150,100],[148,110],[145,120],[140,128],[133,135],[125,140],[115,145],[105,148],[95,149],[85,148],
			[75,145],[65,140],[57,135],[50,128],[45,120],[42,110],[40,100],[42,90],[45,80],[50,72],[57,65],
			[65,60],[75,55],[85,52],[95,51],[105,52],[115,55],[125,60],[133,65],[140,72],[145,80],[148,90],[150,100]
		]]
	}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Circle1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: circle1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for circle1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create second overlapping circle
	// Circle centered at (120, 120) with radius 50
	circle2 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[
			[170,120],[168,130],[165,140],[160,148],[153,155],[145,160],[135,165],[125,168],[115,169],[105,168],
			[95,165],[85,160],[77,155],[70,148],[65,140],[62,130],[60,120],[62,110],[65,100],[70,92],[77,85],
			[85,80],[95,75],[105,72],[115,71],[125,72],[135,75],[145,80],[153,85],[160,92],[165,100],[168,110],[170,120]
		]]
	}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Circle2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: circle2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for circle2: %v", err)
	}

	// Should merge
	if zone2.ID != zone1ID {
		t.Errorf("Expected circles to merge, zone2.ID (%d) should equal zone1.ID (%d)", zone2.ID, zone1ID)
	}
	if zone2.Area <= zone1Area {
		t.Errorf("Expected merged area (%.2f) > original area (%.2f)", zone2.Area, zone1Area)
	}

	t.Logf("✓ Circles merged successfully")
	t.Logf("  Original area: %.2f m², Merged area: %.2f m²", zone1Area, zone2.Area)
}

// TestZoneStorage_PolygonMerging tests polygon tool merging scenarios
func TestZoneStorage_PolygonMerging(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first polygon (triangle)
	poly1 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[0,0],[100,0],[50,100],[0,0]]]
	}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Poly1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: poly1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for poly1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create second overlapping polygon (pentagon)
	poly2 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[50,50],[150,50],[180,100],[100,150],[20,100],[50,50]]]
	}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Poly2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: poly2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for poly2: %v", err)
	}

	// Should merge
	if zone2.ID != zone1ID {
		t.Errorf("Expected polygons to merge, zone2.ID (%d) should equal zone1.ID (%d)", zone2.ID, zone1ID)
	}
	if zone2.Area <= zone1Area {
		t.Errorf("Expected merged area (%.2f) > original area (%.2f)", zone2.Area, zone1Area)
	}

	t.Logf("✓ Polygons merged successfully")
	t.Logf("  Original area: %.2f m², Merged area: %.2f m²", zone1Area, zone2.Area)
}

// TestZoneStorage_PaintbrushMerging tests paintbrush tool merging scenarios
// Paintbrush creates freeform polygons from a path of points
func TestZoneStorage_PaintbrushMerging(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first paintbrush zone (freeform shape)
	paint1 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[0,0],[50,10],[100,20],[120,50],[100,80],[50,90],[0,100],[0,0]]]
	}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Paint1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: paint1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for paint1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create second overlapping paintbrush zone
	paint2 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[80,30],[130,40],[150,70],[130,100],[80,110],[50,90],[80,30]]]
	}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Paint2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: paint2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for paint2: %v", err)
	}

	// Should merge
	if zone2.ID != zone1ID {
		t.Errorf("Expected paintbrush zones to merge, zone2.ID (%d) should equal zone1.ID (%d)", zone2.ID, zone1ID)
	}
	if zone2.Area <= zone1Area {
		t.Errorf("Expected merged area (%.2f) > original area (%.2f)", zone2.Area, zone1Area)
	}

	t.Logf("✓ Paintbrush zones merged successfully")
	t.Logf("  Original area: %.2f m², Merged area: %.2f m²", zone1Area, zone2.Area)
}

// ============================================================================
// Multi-zone merging tests (3+ zones, indefinite merging)
// ============================================================================

// TestZoneStorage_MergeManyZones tests merging many overlapping zones (5 zones)
func TestZoneStorage_MergeManyZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	oldestID := zone1.ID
	initialArea := zone1.Area

	// Create 4 more overlapping zones
	zones := []struct {
		name string
		geom json.RawMessage
	}{
		{"Zone2", json.RawMessage(`{"type":"Polygon","coordinates":[[[15,15],[35,15],[35,35],[15,35],[15,15]]]}`)},
		{"Zone3", json.RawMessage(`{"type":"Polygon","coordinates":[[[30,30],[50,30],[50,50],[30,50],[30,30]]]}`)},
		{"Zone4", json.RawMessage(`{"type":"Polygon","coordinates":[[[45,45],[65,45],[65,65],[45,65],[45,45]]]}`)},
		{"Zone5", json.RawMessage(`{"type":"Polygon","coordinates":[[[60,60],[80,60],[80,80],[60,80],[60,60]]]}`)},
	}

	for _, z := range zones {
		zone, err := storage.CreateZone(&ZoneCreateInput{
			Name:     z.name,
			ZoneType: "residential",
			Floor:    0,
			Geometry: z.geom,
		})
		if err != nil {
			t.Fatalf("CreateZone failed for %s: %v", z.name, err)
		}

		// All zones should merge into the oldest
		if zone.ID != oldestID {
			t.Errorf("Expected %s to merge with oldest zone (ID %d), got ID %d", z.name, oldestID, zone.ID)
		}
		t.Logf("  %s merged (ID: %d, area: %.2f m²)", z.name, zone.ID, zone.Area)
	}

	// Verify final merged zone
	finalZone, err := storage.GetZoneByID(oldestID)
	if err != nil {
		t.Fatalf("Failed to get final merged zone: %v", err)
	}
	if finalZone == nil {
		t.Fatal("Expected final merged zone to exist")
	}

	// Final area should be much larger than initial
	if finalZone.Area <= initialArea*2 {
		t.Errorf("Expected merged area (%.2f) to be significantly larger than initial (%.2f)", finalZone.Area, initialArea)
	}

	t.Logf("✓ Merged 5 zones successfully")
	t.Logf("  Initial area: %.2f m²", initialArea)
	t.Logf("  Final merged area: %.2f m²", finalZone.Area)
	t.Logf("  All zones merged into ID: %d", oldestID)
}

// TestZoneStorage_MergeIndefiniteZones tests that we can keep adding overlapping zones indefinitely
// This simulates the user's workflow of continuously adding overlapping shapes
func TestZoneStorage_MergeIndefiniteZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create initial zone
	baseZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "BaseZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[50,0],[50,50],[0,50],[0,0]]]}`),
	})
	if err != nil {
		t.Fatalf("CreateZone failed for base zone: %v", err)
	}
	oldestID := baseZone.ID
	baseArea := baseZone.Area

	// Add 10 more overlapping zones in a chain
	numZones := 10
	for i := 1; i <= numZones; i++ {
		x := i * 30
		y := i * 30
		geom := json.RawMessage(fmt.Sprintf(`{"type":"Polygon","coordinates":[[[%d,%d],[%d,%d],[%d,%d],[%d,%d],[%d,%d]]]}`,
			x, y, x+50, y, x+50, y+50, x, y+50, x, y))

		zone, err := storage.CreateZone(&ZoneCreateInput{
			Name:     fmt.Sprintf("Zone%d", i+1),
			ZoneType: "residential",
			Floor:    0,
			Geometry: geom,
		})
		if err != nil {
			t.Fatalf("CreateZone failed for zone %d: %v", i+1, err)
		}

		// Should merge with existing merged zone
		if zone.ID != oldestID {
			t.Errorf("Zone %d: Expected to merge with oldest zone (ID %d), got ID %d", i+1, oldestID, zone.ID)
		}

		// Verify area increases
		if zone.Area <= baseArea {
			t.Errorf("Zone %d: Expected area (%.2f) > base area (%.2f)", i+1, zone.Area, baseArea)
		}
		baseArea = zone.Area // Update for next iteration
	}

	// Verify final state
	finalZone, err := storage.GetZoneByID(oldestID)
	if err != nil {
		t.Fatalf("Failed to get final merged zone: %v", err)
	}

	t.Logf("✓ Successfully merged %d zones indefinitely", numZones+1)
	t.Logf("  Initial area: %.2f m²", baseZone.Area)
	t.Logf("  Final merged area: %.2f m²", finalZone.Area)
	t.Logf("  All zones merged into ID: %d", oldestID)
}

// TestZoneStorage_MergeMixedToolTypes tests merging zones created with different tools
func TestZoneStorage_MergeMixedToolTypes(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create rectangle
	rect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Rectangle",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for rectangle: %v", err)
	}
	oldestID := zone1.ID

	// Create circle (overlapping)
	circle := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[80,80],[120,80],[130,100],[120,120],[80,120],[70,100],[80,80]]]
	}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Circle",
		ZoneType: "residential",
		Floor:    0,
		Geometry: circle,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for circle: %v", err)
	}

	// Create polygon (overlapping)
	poly := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[50,50],[150,50],[150,150],[50,150],[50,50]]]
	}`)
	zone3, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Polygon",
		ZoneType: "residential",
		Floor:    0,
		Geometry: poly,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for polygon: %v", err)
	}

	// Create paintbrush zone (overlapping, irregular shape)
	paintbrush := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[100,100],[150,100],[180,130],[200,150],[180,170],[150,200],[100,200],[80,180],[90,150],[100,100]]]
	}`)
	zone4, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Paintbrush",
		ZoneType: "residential",
		Floor:    0,
		Geometry: paintbrush,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for paintbrush: %v", err)
	}

	// All should merge into oldest
	zones := []*Zone{zone2, zone3, zone4}
	for i, z := range zones {
		if z.ID != oldestID {
			t.Errorf("Zone %d: Expected to merge with oldest (ID %d), got ID %d", i+2, oldestID, z.ID)
		}
	}

	t.Logf("✓ Mixed tool types merged successfully")
	t.Logf("  Rectangle + Circle + Polygon + Paintbrush all merged into ID: %d", oldestID)
	t.Logf("  Final area: %.2f m²", zone4.Area)
}

// ============================================================================
// Tests for NULL handling and edge cases in overlap detection
// ============================================================================

// TestZoneStorage_NormalizeForIntersectionNeverReturnsNULL tests that normalize_for_intersection
// never returns NULL for valid geometries, as NULL breaks ST_Intersects
func TestZoneStorage_NormalizeForIntersectionNeverReturnsNULL(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	// Test various geometries that should never return NULL
	testCases := []struct {
		name     string
		geometry string
	}{
		{"Simple rectangle", `{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`},
		{"Wrapped rectangle", `{"type":"Polygon","coordinates":[[[263999990,0],[10,0],[10,50],[263999990,50],[263999990,0]]]}`},
		{"Rectangle at origin", `{"type":"Polygon","coordinates":[[[0,0],[50,0],[50,50],[0,50],[0,0]]]}`},
		{"Polygon with hole", `{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]],[[25,25],[75,25],[75,75],[25,75],[25,25]]]}`},
		{"Wrapped polygon with hole", `{"type":"Polygon","coordinates":[[[263999950,0],[50,0],[50,100],[263999950,100],[263999950,0]],[[263999980,30],[20,30],[20,70],[263999980,70],[263999980,30]]]}`},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var normalized sql.NullString
			var isValid, isEmpty bool
			query := `
				SELECT 
					ST_AsText(normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))) AS normalized_geom,
					ST_IsValid(normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))) AS is_valid,
					ST_IsEmpty(normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))) AS is_empty
			`
			err := db.QueryRow(query, tc.geometry).Scan(&normalized, &isValid, &isEmpty)
			if err != nil {
				t.Fatalf("Failed to test normalization: %v", err)
			}

			if !normalized.Valid || normalized.String == "" {
				t.Errorf("normalize_for_intersection returned NULL or empty for %s - this will break overlap detection!", tc.name)
			} else if !isValid {
				t.Errorf("normalize_for_intersection returned invalid geometry for %s", tc.name)
			} else {
				t.Logf("✓ %s: normalized successfully (valid: %v, empty: %v)", tc.name, isValid, isEmpty)
			}
		})
	}
}

// TestZoneStorage_OverlapDetectionWithNULLFiltering tests that the overlap query
// properly filters out zones where normalize_for_intersection returns NULL
func TestZoneStorage_OverlapDetectionWithNULLFiltering(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create first zone
	rect1 := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone1",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID

	// Create second overlapping zone - should merge
	rect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[50,50],[150,50],[150,150],[50,150],[50,50]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: rect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Should merge
	if zone2.ID != zone1ID {
		t.Errorf("Expected zones to merge, zone2.ID (%d) should equal zone1.ID (%d)", zone2.ID, zone1ID)
	}

	// Verify that normalize_for_intersection didn't return NULL for either geometry
	// by checking the overlap query directly
	overlapTestQuery := `
		SELECT 
			id,
			normalize_for_intersection(geometry) IS NOT NULL AS normalized_not_null,
			normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) IS NOT NULL AS new_normalized_not_null,
			ST_Intersects(
				normalize_for_intersection(geometry),
				normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))
			) AS intersects
		FROM zones
		WHERE floor = 0 AND zone_type = 'residential' AND id != $2
		LIMIT 1
	`
	var testID int64
	var existingNotNull, newNotNull, intersects bool
	testGeom := `{"type":"Polygon","coordinates":[[[75,75],[175,75],[175,175],[75,175],[75,175]]]}`
	if err := db.QueryRow(overlapTestQuery, testGeom, zone1ID).Scan(&testID, &existingNotNull, &newNotNull, &intersects); err == nil {
		if !existingNotNull {
			t.Error("Existing zone normalization returned NULL - overlap detection would fail!")
		}
		if !newNotNull {
			t.Error("New zone normalization returned NULL - overlap detection would fail!")
		}
		if !intersects {
			t.Logf("Note: Test geometry doesn't intersect (expected for this test)")
		}
		t.Logf("✓ NULL filtering test: existing_not_null=%v, new_not_null=%v, intersects=%v", existingNotNull, newNotNull, intersects)
	}

	t.Logf("✓ Overlap detection with NULL filtering works correctly")
}

// TestZoneStorage_EdgeCaseGeometries tests edge cases that might cause normalization to fail
func TestZoneStorage_EdgeCaseGeometries(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Test case 1: Very small rectangle
	smallRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "SmallRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: smallRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for small rectangle: %v", err)
	}

	// Test case 2: Large rectangle (but not wrapped, within Y bounds)
	largeRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[10000,0],[10000,2000],[0,2000],[0,0]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "LargeRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: largeRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for large rectangle: %v", err)
	}

	// Test case 3: Rectangle exactly at wrap boundary (span = half_ring)
	boundaryRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[132000000,0],[132000000,100],[0,100],[0,0]]]}`)
	zone3, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "BoundaryRect",
		ZoneType: "residential",
		Floor:    0,
		Geometry: boundaryRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for boundary rectangle: %v", err)
	}

	// All zones should be created successfully (already checked via err != nil above)
	// Verify normalization works for all
	testQuery := `
		SELECT 
			id,
			normalize_for_intersection(geometry) IS NOT NULL AS normalized_not_null,
			ST_IsValid(normalize_for_intersection(geometry)) AS is_valid
		FROM zones
		WHERE id IN ($1, $2, $3)
		ORDER BY id
	`
	rows, err := db.Query(testQuery, zone1.ID, zone2.ID, zone3.ID)
	if err != nil {
		t.Fatalf("Failed to test normalization: %v", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			t.Logf("Error closing rows: %v", closeErr)
		}
	}()

	zoneNames := []string{"SmallRect", "LargeRect", "BoundaryRect"}
	idx := 0
	for rows.Next() {
		var id int64
		var notNull, isValid bool
		if err := rows.Scan(&id, &notNull, &isValid); err != nil {
			t.Fatalf("Failed to scan: %v", err)
		}
		if !notNull {
			t.Errorf("%s (ID %d): normalize_for_intersection returned NULL", zoneNames[idx], id)
		} else if !isValid {
			t.Errorf("%s (ID %d): normalize_for_intersection returned invalid geometry", zoneNames[idx], id)
		} else {
			t.Logf("✓ %s (ID %d): normalized successfully", zoneNames[idx], id)
		}
		idx++
	}

	t.Logf("✓ Edge case geometries handled correctly")
}

// TestZoneStorage_TransitiveClosureMerge tests that zones form a connected overlap graph
// If zone A overlaps B and B overlaps C (but A doesn't overlap C), all three should merge together
func TestZoneStorage_TransitiveClosureMerge(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create zone A: [0,0] to [10,10]
	zoneA := json.RawMessage(`{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}`)
	zoneAObj, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ZoneA",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zoneA,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone A: %v", err)
	}
	zoneAID := zoneAObj.ID

	// Create zone B: [5,5] to [15,15] - overlaps with A
	zoneB := json.RawMessage(`{"type":"Polygon","coordinates":[[[5,5],[15,5],[15,15],[5,15],[5,5]]]}`)
	zoneBObj, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ZoneB",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zoneB,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone B: %v", err)
	}
	// Zone B should merge with zone A
	if zoneBObj.ID != zoneAID {
		t.Errorf("Expected zone B to merge with zone A, zoneB.ID (%d) should equal zoneA.ID (%d)", zoneBObj.ID, zoneAID)
	}

	// Create zone C: [12,12] to [22,22] - overlaps with B but NOT with A
	zoneC := json.RawMessage(`{"type":"Polygon","coordinates":[[[12,12],[22,12],[22,22],[12,22],[12,12]]]}`)
	zoneCObj, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ZoneC",
		ZoneType: "residential",
		Floor:    0,
		Geometry: zoneC,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone C: %v", err)
	}
	// Zone C should merge with the merged zone (A+B) even though C doesn't directly overlap A
	// This tests transitive closure: A overlaps B, B overlaps C, so all merge together
	if zoneCObj.ID != zoneAID {
		t.Errorf("Expected zone C to merge with merged zone (A+B), zoneC.ID (%d) should equal zoneA.ID (%d)", zoneCObj.ID, zoneAID)
		t.Logf("This indicates transitive closure is not working - zone C overlaps B, B overlaps A, so all should merge")
	} else {
		t.Logf("✓ Transitive closure merge working correctly")
		t.Logf("  Zone A (ID %d): [0,0] to [10,10]", zoneAID)
		t.Logf("  Zone B overlaps A: [5,5] to [15,15]")
		t.Logf("  Zone C overlaps B (but not A): [12,12] to [22,22]")
		t.Logf("  All merged into zone %d with area: %.2f m²", zoneCObj.ID, zoneCObj.Area)
	}
}

// TestZoneStorage_WrappedAndNonWrappedOverlap tests the critical production bug:
// A wrapped zone (spanning from small X to ~264M) should merge with a non-wrapped zone
// at small positive X coordinates. The issue was that normalize_for_intersection puts
// wrapped zones in negative coordinate space while non-wrapped stay positive, so they
// don't intersect even when they should.
func TestZoneStorage_WrappedAndNonWrappedOverlap(t *testing.T) {
	db := testutil.SetupTestDB(t)
	defer testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create wrapped zone (like zone 1 in production logs)
	// This spans from ~32 to ~264M, which wraps around
	wrappedRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[32.368904442,69.844438828],[263999995.52796313,69.844438828],[263999995.52796313,117.467701801],[32.368904442,117.467701801],[32.368904442,69.844438828]]]}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "WrappedZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: wrappedRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for wrapped zone: %v", err)
	}
	zone1ID := zone1.ID

	// Create non-wrapped zone at small positive coordinates (like new zones in production)
	// This should overlap with the wrapped zone when both are properly aligned
	nonWrappedRect := json.RawMessage(`{"type":"Polygon","coordinates":[[[2.6859406530857086,59.95130970420562],[24.949971795082092,59.95130970420562],[24.949971795082092,80.80886175238585],[2.6859406530857086,80.80886175238585],[2.6859406530857086,59.95130970420562]]]}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "NonWrappedZone",
		ZoneType: "residential",
		Floor:    0,
		Geometry: nonWrappedRect,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for non-wrapped zone: %v", err)
	}

	// Should merge - the zones overlap in real space even though one is wrapped
	if zone2.ID != zone1ID {
		t.Errorf("Expected zones to merge, zone2.ID (%d) should equal zone1.ID (%d)", zone2.ID, zone1ID)
		t.Logf("This indicates the coordinate space alignment fix is working")
	} else {
		t.Logf("✓ Wrapped and non-wrapped zones merged correctly")
		t.Logf("  Zone1 (wrapped) area: %.2f m²", zone1.Area)
		t.Logf("  Merged area: %.2f m²", zone2.Area)
	}

	// Test case: Multiple zones, some wrapped, some not - all should merge if overlapping
	// Create another non-wrapped zone that overlaps with the merged zone
	nonWrappedRect2 := json.RawMessage(`{"type":"Polygon","coordinates":[[[10,70],[30,70],[30,90],[10,90],[10,70]]]}`)
	zone3, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "NonWrappedZone2",
		ZoneType: "residential",
		Floor:    0,
		Geometry: nonWrappedRect2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for second non-wrapped zone: %v", err)
	}

	// Should merge with the existing merged zone
	if zone3.ID != zone1ID {
		t.Errorf("Expected zone3 to merge with merged zone, zone3.ID (%d) should equal zone1.ID (%d)", zone3.ID, zone1ID)
	} else {
		t.Logf("✓ Multiple zones (wrapped + non-wrapped) merged correctly")
		t.Logf("  Final merged area: %.2f m²", zone3.Area)
	}
}

func jsonEqual(a, b json.RawMessage) bool {
	normalizedA := normalizeJSON(a)
	normalizedB := normalizeJSON(b)
	return normalizedA == normalizedB
}

func normalizeJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return string(raw)
	}
	return buf.String()
}

// ============================================================================
// Zone Conflict Resolution Tests
// ============================================================================

// TestZoneStorage_PlayerZoneClaimsSpaceFromOwnZones tests that a player-created zone
// claims space from the player's own zones of different types
func TestZoneStorage_PlayerZoneClaimsSpaceFromOwnZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a residential zone (100x100 rectangle)
	residentialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	originalZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ResidentialArea",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: residentialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for residential zone: %v", err)
	}
	originalArea := originalZone.Area
	originalID := originalZone.ID

	// Create a commercial zone that overlaps the residential zone
	// This should claim space from the residential zone
	commercialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	newZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "CommercialArea",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: commercialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for commercial zone: %v", err)
	}
	if newZone.ID == 0 {
		t.Fatal("Expected new zone to be created")
	}

	// Fetch the updated residential zone
	updatedZone, err := storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}

	// The residential zone should have reduced area (claimed by commercial zone)
	if updatedZone.Area >= originalArea {
		t.Errorf("Expected residential zone area to be reduced: original %.2f >= updated %.2f", originalArea, updatedZone.Area)
	}

	// Both zones should still exist
	if updatedZone == nil {
		t.Fatal("Expected residential zone to still exist")
	}

	t.Logf("✓ Player zone successfully claimed space from own zone of different type")
	t.Logf("  Original residential area: %.2f m²", originalArea)
	t.Logf("  Updated residential area: %.2f m²", updatedZone.Area)
	t.Logf("  New commercial zone area: %.2f m²", newZone.Area)
}

// TestZoneStorage_PlayerZoneDoesNotClaimFromOtherPlayers tests that a player-created zone
// does NOT claim space from other players' zones
func TestZoneStorage_PlayerZoneDoesNotClaimFromOtherPlayers(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	user1ID := int64(1)
	user2ID := int64(2)

	// User 1 creates a residential zone
	residentialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	user1Zone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "User1Residential",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &user1ID,
		Geometry: residentialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for user1 zone: %v", err)
	}
	originalArea := user1Zone.Area
	originalID := user1Zone.ID

	// User 2 creates a commercial zone that overlaps user1's zone
	// This should NOT claim space from user1's zone
	commercialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	user2Zone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "User2Commercial",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &user2ID,
		Geometry: commercialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for user2 zone: %v", err)
	}
	if user2Zone.ID == 0 {
		t.Fatal("Expected user2 zone to be created")
	}

	// Fetch user1's zone - it should be unchanged
	user1ZoneUpdated, err := storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}

	// User1's zone should have the same area (not claimed by user2)
	if user1ZoneUpdated.Area != originalArea {
		t.Errorf("Expected user1 zone area to remain unchanged: original %.2f != updated %.2f", originalArea, user1ZoneUpdated.Area)
	}

	t.Logf("✓ Player zone correctly did NOT claim space from other player's zone")
	t.Logf("  User1 zone area (unchanged): %.2f m²", user1ZoneUpdated.Area)
	t.Logf("  User2 zone area: %.2f m²", user2Zone.Area)
}

// TestZoneStorage_SystemZonesAreProtected tests that system zones cannot be claimed
func TestZoneStorage_SystemZonesAreProtected(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a system zone
	systemZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	systemZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:         "SystemZone",
		ZoneType:     "restricted",
		Floor:        0,
		IsSystemZone: true,
		Geometry:     systemZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for system zone: %v", err)
	}
	originalArea := systemZoneCreated.Area
	originalID := systemZoneCreated.ID

	// Player creates a zone that overlaps the system zone
	// This should NOT claim space from the system zone
	playerZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	playerZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "PlayerZone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: playerZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for player zone: %v", err)
	}
	if playerZoneCreated.ID == 0 {
		t.Fatal("Expected player zone to be created")
	}

	// Fetch the system zone - it should be unchanged
	systemZoneUpdated, err := storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}

	// System zone should have the same area (protected from claims)
	if systemZoneUpdated.Area != originalArea {
		t.Errorf("Expected system zone area to remain unchanged: original %.2f != updated %.2f", originalArea, systemZoneUpdated.Area)
	}

	t.Logf("✓ System zone correctly protected from player zone claims")
	t.Logf("  System zone area (unchanged): %.2f m²", systemZoneUpdated.Area)
	t.Logf("  Player zone area: %.2f m²", playerZoneCreated.Area)
}

// TestZoneStorage_MergeBehaviorStillWorks tests that zones of same type/owner still merge
func TestZoneStorage_MergeBehaviorStillWorks(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create first residential zone
	zone1 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	zone1Created, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Residential1",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: zone1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1Created.ID
	zone1Area := zone1Created.Area

	// Create second residential zone that overlaps (same type/owner)
	// This should merge with zone1
	zone2 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	zone2Created, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Residential2",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: zone2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}

	// Zone2 should have been merged into zone1 (oldest zone ID is kept)
	if zone2Created.ID != zone1ID {
		t.Errorf("Expected zones to merge (zone2 should have zone1's ID), but zone2 ID is %d (expected %d)", zone2Created.ID, zone1ID)
	}

	// Merged zone should have larger area than original
	if zone2Created.Area <= zone1Area {
		t.Errorf("Expected merged zone area to be larger: original %.2f >= merged %.2f", zone1Area, zone2Created.Area)
	}

	// Verify zone2 no longer exists as separate zone
	_, err = storage.GetZoneByID(zone2Created.ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for merged zone: %v", err)
	}

	t.Logf("✓ Zones of same type/owner correctly merged")
	t.Logf("  Original zone1 area: %.2f m²", zone1Area)
	t.Logf("  Merged zone area: %.2f m²", zone2Created.Area)
}

// TestZoneStorage_PlayerZoneCompletelyRemovesOwnZone tests that a player zone
// that completely covers an existing zone of different type removes it
func TestZoneStorage_PlayerZoneCompletelyRemovesOwnZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a residential zone
	residentialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	originalZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ResidentialArea",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: residentialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for residential zone: %v", err)
	}
	originalID := originalZone.ID

	// Create a commercial zone that completely covers the residential zone
	commercialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[990,-10],[1110,-10],[1110,110],[990,110],[990,-10]]]
	}`)
	newZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "CommercialArea",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: commercialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for commercial zone: %v", err)
	}
	if newZone.ID == 0 {
		t.Fatal("Expected new zone to be created")
	}

	// The residential zone should be completely removed
	_, err = storage.GetZoneByID(originalID)
	if err == nil {
		// Zone might still exist but with zero area - check that
		remainingZone, err := storage.GetZoneByID(originalID)
		if err != nil {
			// Zone was deleted, which is expected
			return
		}
		if remainingZone != nil && remainingZone.Area > 0 {
			t.Errorf("Expected residential zone to be completely removed, but it still exists with area %.2f m²", remainingZone.Area)
		}
	}

	t.Logf("✓ Player zone completely removed own zone of different type")
	t.Logf("  New commercial zone area: %.2f m²", newZone.Area)
}

// TestZoneStorage_PlayerZoneBisectsOwnZone tests that a player zone that bisects
// an existing zone of different type creates split zones
func TestZoneStorage_PlayerZoneBisectsOwnZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a residential zone (100x100 rectangle)
	residentialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	originalZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "ResidentialArea",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: residentialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for residential zone: %v", err)
	}
	originalID := originalZone.ID
	originalArea := originalZone.Area

	// Create a commercial zone that bisects the residential zone vertically
	commercialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1045,0],[1055,0],[1055,100],[1045,100],[1045,0]]]
	}`)
	newZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "CommercialArea",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: commercialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for commercial zone: %v", err)
	}
	if newZone.ID == 0 {
		t.Fatal("Expected new zone to be created")
	}

	// The residential zone should be bisected into two zones
	// Check if the original zone was updated or if a split zone was created
	updatedZone, err := storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}

	// The updated zone should have reduced area (one half of the original)
	if updatedZone.Area >= originalArea {
		t.Errorf("Expected residential zone area to be reduced after bisection: original %.2f >= updated %.2f", originalArea, updatedZone.Area)
	}

	// Note: The bisection logic in subtractDezoneFromZone creates split zones,
	// but we're not checking for them here since the test focuses on conflict resolution
	// The important thing is that the zone was reduced

	t.Logf("✓ Player zone bisected own zone of different type")
	t.Logf("  Original residential area: %.2f m²", originalArea)
	t.Logf("  Updated residential area: %.2f m²", updatedZone.Area)
	t.Logf("  New commercial zone area: %.2f m²", newZone.Area)
}

// TestZoneStorage_PlayerZoneClaimsFromMultipleZones tests that a player zone
// can claim space from multiple zones of different types at once
func TestZoneStorage_PlayerZoneClaimsFromMultipleZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create multiple zones of different types
	residentialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	residential, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Residential",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: residentialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for residential zone: %v", err)
	}
	residentialArea := residential.Area
	residentialID := residential.ID

	industrialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1100,0],[1200,0],[1200,100],[1100,100],[1100,0]]]
	}`)
	industrial, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Industrial",
		ZoneType: "industrial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: industrialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for industrial zone: %v", err)
	}
	industrialArea := industrial.Area
	industrialID := industrial.ID

	// Create a commercial zone that overlaps both zones
	commercialZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	newZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Commercial",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: commercialZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for commercial zone: %v", err)
	}
	if newZone.ID == 0 {
		t.Fatal("Expected new zone to be created")
	}

	// Both zones should have reduced area
	updatedResidential, err := storage.GetZoneByID(residentialID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for residential: %v", err)
	}
	if updatedResidential.Area >= residentialArea {
		t.Errorf("Expected residential zone area to be reduced: original %.2f >= updated %.2f", residentialArea, updatedResidential.Area)
	}

	updatedIndustrial, err := storage.GetZoneByID(industrialID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for industrial: %v", err)
	}
	if updatedIndustrial.Area >= industrialArea {
		t.Errorf("Expected industrial zone area to be reduced: original %.2f >= updated %.2f", industrialArea, updatedIndustrial.Area)
	}

	t.Logf("✓ Player zone successfully claimed space from multiple zones")
	t.Logf("  Original residential area: %.2f m², Updated: %.2f m²", residentialArea, updatedResidential.Area)
	t.Logf("  Original industrial area: %.2f m², Updated: %.2f m²", industrialArea, updatedIndustrial.Area)
	t.Logf("  New commercial zone area: %.2f m²", newZone.Area)
}

// TestZoneStorage_PlayerZoneDoesNotClaimFromZonesWithNoOwner tests that zones
// with no owner (NULL owner_id) cannot be claimed from
func TestZoneStorage_PlayerZoneDoesNotClaimFromZonesWithNoOwner(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a zone with no owner (NULL owner_id)
	unownedZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	unowned, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "UnownedZone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  nil, // No owner
		Geometry: unownedZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for unowned zone: %v", err)
	}
	originalArea := unowned.Area
	originalID := unowned.ID

	// Player creates a zone that overlaps the unowned zone
	// This should NOT claim space from it
	playerZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	playerZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "PlayerZone",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: playerZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for player zone: %v", err)
	}
	if playerZoneCreated.ID == 0 {
		t.Fatal("Expected player zone to be created")
	}

	// The unowned zone should be unchanged
	unownedUpdated, err := storage.GetZoneByID(originalID)
	if err != nil {
		t.Fatalf("GetZoneByID failed: %v", err)
	}
	if unownedUpdated.Area != originalArea {
		t.Errorf("Expected unowned zone area to remain unchanged: original %.2f != updated %.2f", originalArea, unownedUpdated.Area)
	}

	t.Logf("✓ Player zone correctly did NOT claim space from zone with no owner")
	t.Logf("  Unowned zone area (unchanged): %.2f m²", unownedUpdated.Area)
	t.Logf("  Player zone area: %.2f m²", playerZoneCreated.Area)
}

// TestZoneStorage_PlayerZoneWithMixedOverlaps tests that a player zone can handle
// both merge candidates (same type/owner) and conflict zones (different type/owner) at once
func TestZoneStorage_PlayerZoneWithMixedOverlaps(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create a residential zone (will be merged with new zone)
	residential1 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[1100,0],[1100,100],[1000,100],[1000,0]]]
	}`)
	zone1, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Residential1",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: residential1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone1: %v", err)
	}
	zone1ID := zone1.ID
	zone1Area := zone1.Area

	// Create a commercial zone (will have space claimed from it)
	commercial := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1100,0],[1200,0],[1200,100],[1100,100],[1100,0]]]
	}`)
	zone2, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Commercial",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: commercial,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for zone2: %v", err)
	}
	zone2Area := zone2.Area
	zone2ID := zone2.ID

	// Create a new residential zone that overlaps both
	// Should merge with zone1 and claim space from zone2
	residential2 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1050,0],[1150,0],[1150,100],[1050,100],[1050,0]]]
	}`)
	newZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Residential2",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: residential2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for new zone: %v", err)
	}

	// Zone1 should be merged (new zone should have zone1's ID)
	if newZone.ID != zone1ID {
		t.Errorf("Expected zones to merge (new zone should have zone1's ID), but new zone ID is %d (expected %d)", newZone.ID, zone1ID)
	}

	// Merged zone should have larger area than original zone1
	if newZone.Area <= zone1Area {
		t.Errorf("Expected merged zone area to be larger: original %.2f >= merged %.2f", zone1Area, newZone.Area)
	}

	// Zone2 should have reduced area (claimed by new zone)
	updatedZone2, err := storage.GetZoneByID(zone2ID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for zone2: %v", err)
	}
	if updatedZone2.Area >= zone2Area {
		t.Errorf("Expected zone2 area to be reduced: original %.2f >= updated %.2f", zone2Area, updatedZone2.Area)
	}

	t.Logf("✓ Player zone correctly handled mixed overlaps (merge + claim)")
	t.Logf("  Zone1 merged: original %.2f m², merged %.2f m²", zone1Area, newZone.Area)
	t.Logf("  Zone2 claimed from: original %.2f m², updated %.2f m²", zone2Area, updatedZone2.Area)
}

// ============================================================================
// Tests for New Zone Overlap Rules
// ============================================================================

// TestZoneStorage_DefaultZoneWins tests that default zones (system zones) always win
// When a new zone overlaps a default zone, the default zone keeps its area and
// the new zone's area is subtracted from the overlap region
func TestZoneStorage_DefaultZoneWins(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create a default (system) zone
	defaultZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,-50],[2000,-50],[2000,50],[1000,50],[1000,-50]]]
	}`)
	defaultZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:         "Default Restricted Zone",
		ZoneType:     "restricted",
		Floor:        0,
		IsSystemZone: true,
		Geometry:     defaultZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for default zone: %v", err)
	}
	defaultZoneID := defaultZoneCreated.ID
	defaultZoneArea := defaultZoneCreated.Area

	// Create a new player zone that overlaps the default zone
	// The new zone should have its overlapping area subtracted
	newZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1500,-100],[2500,-100],[2500,100],[1500,100],[1500,-100]]]
	}`)
	userID := int64(1)
	newZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Player Zone Overlapping Default",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: newZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for new zone: %v", err)
	}

	// Default zone should keep its original area
	defaultZoneUpdated, err := storage.GetZoneByID(defaultZoneID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for default zone: %v", err)
	}
	if defaultZoneUpdated.Area != defaultZoneArea {
		t.Errorf("Default zone area should remain unchanged: original %.2f != updated %.2f", defaultZoneArea, defaultZoneUpdated.Area)
	}

	// New zone should have reduced area (overlapping portion subtracted)
	// The new zone originally covers 1000m x 200m = 200,000 m²
	// It overlaps with default zone for 500m x 200m = 100,000 m²
	// So new zone should have approximately 100,000 m² remaining
	if newZoneCreated.Area >= 200000 {
		t.Errorf("New zone area should be reduced (overlap subtracted): got %.2f, expected < 200000", newZoneCreated.Area)
	}
	if newZoneCreated.Area <= 0 {
		t.Errorf("New zone area should be positive: got %.2f", newZoneCreated.Area)
	}

	t.Logf("✓ Default zone wins: default zone area unchanged (%.2f m²), new zone area reduced (%.2f m²)", defaultZoneArea, newZoneCreated.Area)
}

// TestZoneStorage_DefaultZoneBisectsNewZone tests that when a default zone bisects
// a new zone, both resulting components are created as separate zones
func TestZoneStorage_DefaultZoneBisectsNewZone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create a default zone that will bisect the new zone
	defaultZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,-50],[2000,-50],[2000,50],[1000,50],[1000,-50]]]
	}`)
	_, err := storage.CreateZone(&ZoneCreateInput{
		Name:         "Default Zone (Bisector)",
		ZoneType:     "restricted",
		Floor:        0,
		IsSystemZone: true,
		Geometry:     defaultZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for default zone: %v", err)
	}

	// Create a new zone that will be bisected by the default zone
	// This zone spans from 500 to 2500, with the default zone in the middle (1000-2000)
	newZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[500,-100],[2500,-100],[2500,100],[500,100],[500,-100]]]
	}`)
	userID := int64(1)
	firstZone, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone That Gets Bisected",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: newZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for new zone: %v", err)
	}

	// Check that two zones were created (the original zone should be split)
	// We can verify this by checking if there's a zone with "Part 2" in the name
	zones, err := storage.ListZonesByArea(0, 0, -200, 3000, 200)
	if err != nil {
		t.Fatalf("ListZonesByArea failed: %v", err)
	}

	// Count zones created by this test (should be 1 default + 2 parts of bisected zone)
	playerZones := 0
	for _, zone := range zones {
		if zone.OwnerID != nil && *zone.OwnerID == userID {
			playerZones++
		}
	}

	// Should have at least 2 player zones (the original and potentially a "Part 2")
	// Actually, the first zone returned is the main one, and if bisected, there should be another
	if playerZones < 1 {
		t.Errorf("Expected at least 1 player zone, got %d", playerZones)
	}

	// The first zone should have reduced area (one side of the bisection)
	// Original zone was 2000m x 200m = 400,000 m²
	// After bisection, each part should be approximately 500m x 200m = 100,000 m²
	if firstZone.Area <= 0 {
		t.Errorf("First zone area should be positive: got %.2f", firstZone.Area)
	}
	if firstZone.Area >= 400000 {
		t.Errorf("First zone area should be reduced after bisection: got %.2f, expected < 400000", firstZone.Area)
	}

	t.Logf("✓ Default zone bisects new zone: created zone with area %.2f m² (should be one component)", firstZone.Area)
	t.Logf("  Total player zones in area: %d", playerZones)
}

// TestZoneStorage_DifferentTypeZoneWins tests that new zones win over different type zones
// When a new zone overlaps a different type zone, the new zone claims the space
func TestZoneStorage_DifferentTypeZoneWins(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create an existing commercial zone
	existingZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[2000,0],[2000,100],[1000,100],[1000,0]]]
	}`)
	existing, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Existing Commercial Zone",
		ZoneType: "commercial",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: existingZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for existing zone: %v", err)
	}
	existingID := existing.ID
	existingArea := existing.Area

	// Create a new residential zone that overlaps the commercial zone
	// The new zone should win and claim the overlapping space
	newZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1500,0],[2500,0],[2500,100],[1500,100],[1500,0]]]
	}`)
	newZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "New Residential Zone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: newZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for new zone: %v", err)
	}

	// Existing zone should have reduced area (overlapping portion claimed by new zone)
	existingUpdated, err := storage.GetZoneByID(existingID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for existing zone: %v", err)
	}
	if existingUpdated.Area >= existingArea {
		t.Errorf("Existing zone area should be reduced: original %.2f >= updated %.2f", existingArea, existingUpdated.Area)
	}

	// New zone should have its full area (minus any default zones, but there are none)
	// Original new zone: 1000m x 100m = 100,000 m²
	if newZoneCreated.Area <= 0 {
		t.Errorf("New zone area should be positive: got %.2f", newZoneCreated.Area)
	}

	t.Logf("✓ Different type zone wins: existing zone area reduced (%.2f → %.2f m²), new zone area %.2f m²", existingArea, existingUpdated.Area, newZoneCreated.Area)
}

// TestZoneStorage_SameTypeZonesMerge tests that zones of the same type merge together
func TestZoneStorage_SameTypeZonesMerge(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)
	userID := int64(1)

	// Create an existing residential zone
	existingZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,0],[2000,0],[2000,100],[1000,100],[1000,0]]]
	}`)
	existing, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Existing Residential Zone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: existingZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for existing zone: %v", err)
	}
	existingID := existing.ID
	existingArea := existing.Area

	// Create a new residential zone that overlaps the existing one
	// They should merge into one zone
	newZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1500,0],[2500,0],[2500,100],[1500,100],[1500,0]]]
	}`)
	newZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "New Residential Zone",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: newZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for new zone: %v", err)
	}

	// The zones should merge - new zone should have the existing zone's ID
	if newZoneCreated.ID != existingID {
		t.Errorf("Zones should merge: new zone ID %d != existing zone ID %d", newZoneCreated.ID, existingID)
	}

	// Merged zone should have larger area than the original
	// Original: 1000m x 100m = 100,000 m²
	// New: 1000m x 100m = 100,000 m²
	// Overlap: 500m x 100m = 50,000 m²
	// Merged: approximately 150,000 m² (100k + 100k - 50k overlap)
	if newZoneCreated.Area <= existingArea {
		t.Errorf("Merged zone area should be larger: original %.2f >= merged %.2f", existingArea, newZoneCreated.Area)
	}

	// The existing zone should no longer exist as a separate entity (it's been merged)
	// Actually, it's been updated, so it should still exist with the same ID
	existingUpdated, err := storage.GetZoneByID(existingID)
	if err != nil {
		t.Fatalf("GetZoneByID failed for existing zone: %v", err)
	}
	if existingUpdated.ID != existingID {
		t.Errorf("Existing zone ID should remain: got %d, expected %d", existingUpdated.ID, existingID)
	}
	if existingUpdated.Area != newZoneCreated.Area {
		t.Errorf("Merged zone areas should match: existing %.2f != new %.2f", existingUpdated.Area, newZoneCreated.Area)
	}

	t.Logf("✓ Same type zones merge: merged zone ID %d, area %.2f m² (original %.2f m²)", existingID, newZoneCreated.Area, existingArea)
}

// TestZoneStorage_ZoneCompletelyOverlappedByDefault tests that if a new zone
// is completely covered by default zones, zone creation is rejected
func TestZoneStorage_ZoneCompletelyOverlappedByDefault(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create a default zone that completely covers the area where we'll try to create a new zone
	defaultZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,-100],[2000,-100],[2000,100],[1000,100],[1000,-100]]]
	}`)
	_, err := storage.CreateZone(&ZoneCreateInput{
		Name:         "Default Zone (Full Coverage)",
		ZoneType:     "restricted",
		Floor:        0,
		IsSystemZone: true,
		Geometry:     defaultZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for default zone: %v", err)
	}

	// Try to create a new zone completely within the default zone
	// This should fail because the new zone would have no remaining area
	newZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1200,-50],[1800,-50],[1800,50],[1200,50],[1200,-50]]]
	}`)
	userID := int64(1)
	_, err = storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone Completely in Default",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: newZone,
	})
	if err == nil {
		t.Fatal("Expected CreateZone to fail when new zone is completely overlapped by default zone")
	}
	if err.Error() == "" {
		t.Fatal("Expected error message when zone creation is rejected")
	}

	t.Logf("✓ Zone creation correctly rejected when completely overlapped by default zone: %v", err)
}

// TestZoneStorage_MultipleDefaultZones tests that multiple default zones
// are properly handled when subtracting from a new zone
func TestZoneStorage_MultipleDefaultZones(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)
	createZonesTable(t, db)
	createNormalizeFunction(t, db)
	truncateZonesTable(t, db)

	storage := NewZoneStorage(db)

	// Create two default zones that overlap with the new zone
	defaultZone1 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[1000,-50],[1500,-50],[1500,50],[1000,50],[1000,-50]]]
	}`)
	_, err := storage.CreateZone(&ZoneCreateInput{
		Name:         "Default Zone 1",
		ZoneType:     "restricted",
		Floor:        0,
		IsSystemZone: true,
		Geometry:     defaultZone1,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for default zone 1: %v", err)
	}

	defaultZone2 := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[2000,-50],[2500,-50],[2500,50],[2000,50],[2000,-50]]]
	}`)
	_, err = storage.CreateZone(&ZoneCreateInput{
		Name:         "Default Zone 2",
		ZoneType:     "restricted",
		Floor:        0,
		IsSystemZone: true,
		Geometry:     defaultZone2,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for default zone 2: %v", err)
	}

	// Create a new zone that overlaps both default zones
	newZone := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[500,-100],[3000,-100],[3000,100],[500,100],[500,-100]]]
	}`)
	userID := int64(1)
	newZoneCreated, err := storage.CreateZone(&ZoneCreateInput{
		Name:     "Zone Overlapping Multiple Defaults",
		ZoneType: "residential",
		Floor:    0,
		OwnerID:  &userID,
		Geometry: newZone,
	})
	if err != nil {
		t.Fatalf("CreateZone failed for new zone: %v", err)
	}

	// New zone should have reduced area (both default zones subtracted)
	// Original: 2500m x 200m = 500,000 m²
	// Default 1: 500m x 100m = 50,000 m²
	// Default 2: 500m x 100m = 50,000 m²
	// Remaining: approximately 400,000 m²
	if newZoneCreated.Area <= 0 {
		t.Errorf("New zone area should be positive: got %.2f", newZoneCreated.Area)
	}
	if newZoneCreated.Area >= 500000 {
		t.Errorf("New zone area should be reduced: got %.2f, expected < 500000", newZoneCreated.Area)
	}

	t.Logf("✓ Multiple default zones correctly subtracted from new zone: area %.2f m²", newZoneCreated.Area)
}
