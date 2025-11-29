package database

import (
	"testing"

	"github.com/earthring/server/internal/testutil"
)

// TestStructureStorage_ValidationPositionBounds tests position bounds validation
func TestStructureStorage_ValidationPositionBounds(t *testing.T) {
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

	tests := []struct {
		name    string
		input   StructureCreateInput
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid position at origin",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 0.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: false,
		},
		{
			name: "valid position at ring end",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 263999999.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: false,
		},
		{
			name: "valid position at max width",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 2500.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: false,
		},
		{
			name: "valid position at min width",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: -2500.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: false,
		},
		{
			name: "invalid X coordinate - negative",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: -1.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "x coordinate out of bounds",
		},
		{
			name: "invalid X coordinate - too large",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 264000000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "x coordinate out of bounds",
		},
		{
			name: "invalid Y coordinate - too large",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 2501.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "y coordinate out of bounds",
		},
		{
			name: "invalid Y coordinate - too small",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: -2501.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "y coordinate out of bounds",
		},
		{
			name: "invalid scale - zero",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         0.0,
			},
			wantErr: true,
			errMsg:  "scale must be greater than 0",
		},
		{
			name: "invalid scale - negative",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         -1.0,
			},
			wantErr: true,
			errMsg:  "scale must be greater than 0",
		},
		{
			name: "invalid rotation - too large",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      361.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "rotation must be between -360 and 360",
		},
		{
			name: "invalid rotation - too small",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      -361.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "rotation must be between -360 and 360",
		},
		{
			name: "invalid structure_type - empty",
			input: StructureCreateInput{
				StructureType: "",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "structure_type is required",
		},
		{
			name: "invalid structure_type - too long",
			input: StructureCreateInput{
				StructureType: "a" + string(make([]byte, 50)), // 51 characters
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			},
			wantErr: true,
			errMsg:  "structure_type must be 50 characters or less",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := storage.CreateStructure(&tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error but got none")
					return
				}
				if tt.errMsg != "" && !contains(err.Error(), tt.errMsg) {
					t.Errorf("Expected error message containing '%s', got '%s'", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

// TestStructureStorage_ValidationFloorRange tests floor range validation
func TestStructureStorage_ValidationFloorRange(t *testing.T) {
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

	tests := []struct {
		name    string
		floor   int
		wantErr bool
	}{
		{"valid floor -2", -2, false},
		{"valid floor -1", -1, false},
		{"valid floor 0", 0, false},
		{"valid floor 15", 15, false},
		{"invalid floor -3", -3, true},
		{"invalid floor 16", 16, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := StructureCreateInput{
				StructureType: "building",
				Floor:         tt.floor,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
			}
			_, err := storage.CreateStructure(&input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error but got none")
				} else if !contains(err.Error(), "floor must be between") {
					t.Errorf("Expected floor validation error, got: %v", err)
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

// TestStructureStorage_ValidationZoneRelationship tests zone relationship validation
func TestStructureStorage_ValidationZoneRelationship(t *testing.T) {
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
			floor INTEGER NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create zones table: %v", err)
	}

	createStructuresTable(t, db)
	truncateStructuresTable(t, db)

	storage := NewStructureStorage(db)

	// Create a test zone (polygon from (1000, -100) to (2000, 100))
	var zoneID int64
	err = db.QueryRow(`
		INSERT INTO zones (name, zone_type, geometry, floor)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromText('POLYGON((1000 -100, 2000 -100, 2000 100, 1000 100, 1000 -100))'), 0), $3)
		RETURNING id
	`, "Test Zone", "residential", 0).Scan(&zoneID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	tests := []struct {
		name    string
		input   StructureCreateInput
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid - structure inside zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1500.0, Y: 0.0}, // Inside zone
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &zoneID,
			},
			wantErr: false,
		},
		{
			name: "invalid - structure outside zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 5000.0, Y: 0.0}, // Outside zone
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &zoneID,
			},
			wantErr: true,
			errMsg:  "not within zone",
		},
		{
			name: "invalid - structure on wrong floor",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         1, // Zone is on floor 0
				Position:      Position{X: 1500.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &zoneID,
			},
			wantErr: true,
			errMsg:  "not within zone",
		},
		{
			name: "valid - no zone_id (optional)",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 5000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        nil,
			},
			wantErr: false,
		},
		{
			name: "invalid - zone does not exist",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        func() *int64 { id := int64(99999); return &id }(),
			},
			wantErr: true,
			errMsg:  "zone 99999 not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := storage.CreateStructure(&tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error but got none")
					return
				}
				if tt.errMsg != "" && !contains(err.Error(), tt.errMsg) {
					t.Errorf("Expected error message containing '%s', got '%s'", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

// TestStructureStorage_ValidationUpdate tests update validation
func TestStructureStorage_ValidationUpdate(t *testing.T) {
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

	// Create a valid structure first
	structure, err := storage.CreateStructure(&StructureCreateInput{
		StructureType: "building",
		Floor:         0,
		Position:      Position{X: 1000.0, Y: 0.0},
		Rotation:      0.0,
		Scale:         1.0,
	})
	if err != nil {
		t.Fatalf("Failed to create test structure: %v", err)
	}

	tests := []struct {
		name    string
		input   StructureUpdateInput
		wantErr bool
		errMsg  string
	}{
		{
			name: "invalid - position out of bounds",
			input: StructureUpdateInput{
				Position: &Position{X: 264000000.0, Y: 0.0},
			},
			wantErr: true,
			errMsg:  "x coordinate out of bounds",
		},
		{
			name: "invalid - floor out of range",
			input: StructureUpdateInput{
				Floor: func() *int { f := 16; return &f }(),
			},
			wantErr: true,
			errMsg:  "floor must be between",
		},
		{
			name: "invalid - scale zero",
			input: StructureUpdateInput{
				Scale: func() *float64 { s := 0.0; return &s }(),
			},
			wantErr: true,
			errMsg:  "scale must be greater than 0",
		},
		{
			name: "valid - update all fields",
			input: StructureUpdateInput{
				StructureType: func() *string { s := "house"; return &s }(),
				Floor:         func() *int { f := 1; return &f }(),
				Position:      &Position{X: 2000.0, Y: 50.0},
				Rotation:      func() *float64 { r := 90.0; return &r }(),
				Scale:         func() *float64 { s := 2.0; return &s }(),
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := storage.UpdateStructure(structure.ID, &tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error but got none")
					return
				}
				if tt.errMsg != "" && !contains(err.Error(), tt.errMsg) {
					t.Errorf("Expected error message containing '%s', got '%s'", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

