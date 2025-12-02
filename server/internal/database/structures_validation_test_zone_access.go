package database

import (
	"database/sql"
	"fmt"
	"testing"

	"github.com/earthring/server/internal/testutil"
)

// TestStructureStorage_ZoneAccessRules tests zone access rules:
// 1. Structures cannot be placed in restricted zones
// 2. Structures must be compatible with zone types
func TestStructureStorage_ZoneAccessRules(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Create PostGIS extension
	_, err := db.Exec(`CREATE EXTENSION IF NOT EXISTS postgis;`)
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	// Create structures table
	_, _ = db.Exec(`DROP TABLE IF EXISTS structures CASCADE`) //nolint:errcheck
	_, err = db.Exec(`
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

	// Create zones table
	_, _ = db.Exec(`DROP TABLE IF EXISTS zones CASCADE`) //nolint:errcheck
	_, err = db.Exec(`
		CREATE TABLE zones (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			zone_type VARCHAR(50) NOT NULL,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			floor INTEGER NOT NULL,
			owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
			is_system_zone BOOLEAN DEFAULT FALSE,
			properties JSONB,
			metadata JSONB,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_zones_geometry ON zones USING GIST(geometry);
		CREATE INDEX IF NOT EXISTS idx_zones_floor ON zones(floor);
		CREATE INDEX IF NOT EXISTS idx_zones_type ON zones(zone_type);
	`)
	if err != nil {
		t.Fatalf("failed to create zones table: %v", err)
	}

	_, _ = db.Exec(`TRUNCATE TABLE structures RESTART IDENTITY CASCADE`) //nolint:errcheck
	_, _ = db.Exec(`TRUNCATE TABLE zones RESTART IDENTITY CASCADE`)      //nolint:errcheck

	storage := NewStructureStorage(db)

	// Create test zones
	restrictedZoneID := createTestZone(t, db, "restricted", 0, 1000.0, 0.0, 100.0)
	residentialZoneID := createTestZone(t, db, "residential", 0, 2000.0, 0.0, 100.0)
	commercialZoneID := createTestZone(t, db, "commercial", 0, 3000.0, 0.0, 100.0)
	industrialZoneID := createTestZone(t, db, "industrial", 0, 4000.0, 0.0, 100.0)
	parkZoneID := createTestZone(t, db, "park", 0, 5000.0, 0.0, 100.0)
	mixedUseZoneID := createTestZone(t, db, "mixed-use", 0, 6000.0, 0.0, 100.0)

	tests := []struct {
		name    string
		input   StructureCreateInput
		wantErr bool
		errMsg  string
	}{
		// Restricted zone tests
		{
			name: "invalid - building in restricted zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &restrictedZoneID,
			},
			wantErr: true,
			errMsg:  "cannot be placed in restricted zones",
		},
		{
			name: "invalid - decoration in restricted zone",
			input: StructureCreateInput{
				StructureType: "decoration",
				Floor:         0,
				Position:      Position{X: 1000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &restrictedZoneID,
			},
			wantErr: true,
			errMsg:  "cannot be placed in restricted zones",
		},
		// Zone type compatibility tests
		{
			name: "valid - building in residential zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 2000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &residentialZoneID,
			},
			wantErr: false,
		},
		{
			name: "valid - building in commercial zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 3000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &commercialZoneID,
			},
			wantErr: false,
		},
		{
			name: "valid - building in industrial zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 4000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &industrialZoneID,
			},
			wantErr: false,
		},
		{
			name: "valid - building in mixed-use zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 6000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &mixedUseZoneID,
			},
			wantErr: false,
		},
		{
			name: "invalid - building in park zone",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 5000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &parkZoneID,
			},
			wantErr: true,
			errMsg:  "is not allowed in zone type",
		},
		{
			name: "valid - decoration in park zone",
			input: StructureCreateInput{
				StructureType: "decoration",
				Floor:         0,
				Position:      Position{X: 5000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &parkZoneID,
			},
			wantErr: false,
		},
		{
			name: "valid - furniture in park zone",
			input: StructureCreateInput{
				StructureType: "furniture",
				Floor:         0,
				Position:      Position{X: 5000.0, Y: 10.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &parkZoneID,
			},
			wantErr: false,
		},
		{
			name: "valid - vehicle in industrial zone",
			input: StructureCreateInput{
				StructureType: "vehicle",
				Floor:         0,
				Position:      Position{X: 4000.0, Y: 10.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &industrialZoneID,
			},
			wantErr: false,
		},
		{
			name: "invalid - vehicle in residential zone",
			input: StructureCreateInput{
				StructureType: "vehicle",
				Floor:         0,
				Position:      Position{X: 2000.0, Y: 10.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        &residentialZoneID,
			},
			wantErr: true,
			errMsg:  "is not allowed in zone type",
		},
		{
			name: "valid - structure without zone_id (no zone restrictions)",
			input: StructureCreateInput{
				StructureType: "building",
				Floor:         0,
				Position:      Position{X: 7000.0, Y: 0.0},
				Rotation:      0.0,
				Scale:         1.0,
				ZoneID:        nil, // No zone specified
			},
			wantErr: false,
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

	// Test update zone access rules
	t.Run("invalid - update structure to restricted zone", func(t *testing.T) {
		// Create a structure in a residential zone
		structure, err := storage.CreateStructure(&StructureCreateInput{
			StructureType: "building",
			Floor:         0,
			Position:      Position{X: 8000.0, Y: 0.0},
			Rotation:      0.0,
			Scale:         1.0,
			ZoneID:        &residentialZoneID,
		})
		if err != nil {
			t.Fatalf("Failed to create structure: %v", err)
		}

		// Try to update zone to restricted
		_, err = storage.UpdateStructure(structure.ID, &StructureUpdateInput{
			ZoneID:    &restrictedZoneID,
			ZoneIDSet: true,
		})
		if err == nil {
			t.Errorf("Expected error when updating structure to restricted zone")
		} else if !contains(err.Error(), "cannot be placed in restricted zones") {
			t.Errorf("Expected error message containing 'cannot be placed in restricted zones', got '%s'", err.Error())
		}
	})

	t.Run("invalid - update structure to incompatible zone type", func(t *testing.T) {
		// Create a structure in a residential zone
		structure, err := storage.CreateStructure(&StructureCreateInput{
			StructureType: "building",
			Floor:         0,
			Position:      Position{X: 9000.0, Y: 0.0},
			Rotation:      0.0,
			Scale:         1.0,
			ZoneID:        &residentialZoneID,
		})
		if err != nil {
			t.Fatalf("Failed to create structure: %v", err)
		}

		// Try to update zone to park (buildings not allowed in parks)
		_, err = storage.UpdateStructure(structure.ID, &StructureUpdateInput{
			ZoneID:    &parkZoneID,
			ZoneIDSet: true,
		})
		if err == nil {
			t.Errorf("Expected error when updating structure to incompatible zone type")
		} else if !contains(err.Error(), "is not allowed in zone type") {
			t.Errorf("Expected error message containing 'is not allowed in zone type', got '%s'", err.Error())
		}
	})
}

// Helper function to create a test zone
func createTestZone(t *testing.T, db *sql.DB, zoneType string, floor int, centerX, centerY, radius float64) int64 {
	t.Helper()

	// Create a circular zone using PostGIS
	query := `
		INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone)
		VALUES (
			$1,
			$2,
			ST_SetSRID(
				ST_Buffer(
					ST_MakePoint($3, $4),
					$5
				),
				0
			),
			$6,
			NULL,
			false
		)
		RETURNING id
	`

	var zoneID int64
	err := db.QueryRow(query, fmt.Sprintf("Test %s Zone", zoneType), zoneType, centerX, centerY, radius, floor).Scan(&zoneID)
	if err != nil {
		t.Fatalf("Failed to create test zone: %v", err)
	}

	return zoneID
}
