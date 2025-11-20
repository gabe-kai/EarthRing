package database

import (
	"bytes"
	"database/sql"
	"encoding/json"
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
	newFloor := 3
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
