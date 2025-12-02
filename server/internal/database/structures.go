package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// Structure represents a stored structure record.
type Structure struct {
	ID             int64           `json:"id"`
	StructureType  string          `json:"structure_type"`
	Floor          int             `json:"floor"`
	OwnerID        *int64          `json:"owner_id,omitempty"`
	ZoneID         *int64          `json:"zone_id,omitempty"`
	IsProcedural   bool            `json:"is_procedural"`
	ProceduralSeed *int64          `json:"procedural_seed,omitempty"`
	Position       Position        `json:"position"` // (ring_position, width_position)
	Rotation       float64         `json:"rotation"` // Rotation in degrees
	Scale          float64         `json:"scale"`
	Properties     json.RawMessage `json:"properties,omitempty"`
	ModelData      json.RawMessage `json:"model_data,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// Position represents a 2D point (ring_position, width_position).
type Position struct {
	X float64 `json:"x"` // Ring position (arc length along ring)
	Y float64 `json:"y"` // Width position (offset from centerline)
}

// StructureCreateInput contains the fields required to create a structure.
type StructureCreateInput struct {
	StructureType  string
	Floor          int
	OwnerID        *int64
	ZoneID         *int64
	IsProcedural   bool
	ProceduralSeed *int64
	Position       Position
	Rotation       float64
	Scale          float64
	Properties     json.RawMessage
	ModelData      json.RawMessage
}

// StructureUpdateInput describes the fields that can be updated on a structure.
// A nil field means "leave unchanged".
type StructureUpdateInput struct {
	StructureType     *string
	Floor             *int
	OwnerID           *int64
	OwnerIDSet        bool
	ZoneID            *int64
	ZoneIDSet         bool
	IsProcedural      *bool
	ProceduralSeed    *int64
	ProceduralSeedSet bool
	Position          *Position
	Rotation          *float64
	Scale             *float64
	Properties        *json.RawMessage
	ModelData         *json.RawMessage
}

// StructureStorage provides structure persistence helpers.
type StructureStorage struct {
	db *sql.DB
}

// NewStructureStorage creates a new StructureStorage instance.
func NewStructureStorage(db *sql.DB) *StructureStorage {
	return &StructureStorage{db: db}
}

// CreateStructure inserts a new structure and returns the stored record.
func (s *StructureStorage) CreateStructure(input *StructureCreateInput) (*Structure, error) {
	if input == nil {
		return nil, fmt.Errorf("input cannot be nil")
	}
	if err := validateStructureInput(*input); err != nil {
		return nil, err
	}

	// Validate zone relationship if zone_id is provided
	if input.ZoneID != nil {
		if err := s.validateZoneRelationship(*input.ZoneID, input.Position, input.Floor, input.StructureType); err != nil {
			return nil, err
		}
	}

	// Check for collisions with existing structures
	if err := s.checkCollisions(input.StructureType, input.Position, input.Floor, input.Properties, input.Scale, nil); err != nil {
		return nil, err
	}

	// Validate height limits
	if err := validateHeight(input.StructureType, input.Floor, input.Properties, input.Scale); err != nil {
		return nil, err
	}

	var ownerID sql.NullInt64
	if input.OwnerID != nil {
		ownerID = sql.NullInt64{Int64: *input.OwnerID, Valid: true}
	}

	var zoneID sql.NullInt64
	if input.ZoneID != nil {
		zoneID = sql.NullInt64{Int64: *input.ZoneID, Valid: true}
	}

	var proceduralSeed sql.NullInt64
	if input.ProceduralSeed != nil {
		proceduralSeed = sql.NullInt64{Int64: *input.ProceduralSeed, Valid: true}
	}

	// Handle nil JSON values
	var propertiesJSON interface{} = input.Properties
	if len(input.Properties) == 0 {
		propertiesJSON = nil
	}
	var modelDataJSON interface{} = input.ModelData
	if len(input.ModelData) == 0 {
		modelDataJSON = nil
	}

	// Convert Position to PostGIS geometry POINT using ST_MakePoint
	query := `
		INSERT INTO structures (
			structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
			position, rotation, scale, properties, model_data
		) VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 0), $9, $10, $11, $12)
		RETURNING id, structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
		          ST_X(position)::float, ST_Y(position)::float, rotation, scale,
		          properties, model_data, created_at, updated_at
	`

	var structure Structure
	var posX, posY float64
	var ownerIDOut sql.NullInt64
	var zoneIDOut sql.NullInt64
	var proceduralSeedOut sql.NullInt64
	var propertiesOut sql.NullString
	var modelDataOut sql.NullString

	err := s.db.QueryRow(
		query,
		input.StructureType,
		input.Floor,
		ownerID,
		zoneID,
		input.IsProcedural,
		proceduralSeed,
		input.Position.X,
		input.Position.Y,
		input.Rotation,
		input.Scale,
		propertiesJSON,
		modelDataJSON,
	).Scan(
		&structure.ID,
		&structure.StructureType,
		&structure.Floor,
		&ownerIDOut,
		&zoneIDOut,
		&structure.IsProcedural,
		&proceduralSeedOut,
		&posX,
		&posY,
		&structure.Rotation,
		&structure.Scale,
		&propertiesOut,
		&modelDataOut,
		&structure.CreatedAt,
		&structure.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create structure: %w", err)
	}

	structure.Position = Position{X: posX, Y: posY}
	if ownerIDOut.Valid {
		structure.OwnerID = &ownerIDOut.Int64
	}
	if zoneIDOut.Valid {
		structure.ZoneID = &zoneIDOut.Int64
	}
	if proceduralSeedOut.Valid {
		structure.ProceduralSeed = &proceduralSeedOut.Int64
	}
	if propertiesOut.Valid {
		structure.Properties = json.RawMessage(propertiesOut.String)
	}
	if modelDataOut.Valid {
		structure.ModelData = json.RawMessage(modelDataOut.String)
	}

	return &structure, nil
}

// GetStructure retrieves a structure by ID.
func (s *StructureStorage) GetStructure(id int64) (*Structure, error) {
	query := `
		SELECT id, structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
		       ST_X(position)::float, ST_Y(position)::float, rotation, scale,
		       properties, model_data, created_at, updated_at
		FROM structures
		WHERE id = $1
	`

	var structure Structure
	var posX, posY float64
	var ownerID sql.NullInt64
	var zoneID sql.NullInt64
	var proceduralSeed sql.NullInt64
	var properties sql.NullString
	var modelData sql.NullString

	err := s.db.QueryRow(query, id).Scan(
		&structure.ID,
		&structure.StructureType,
		&structure.Floor,
		&ownerID,
		&zoneID,
		&structure.IsProcedural,
		&proceduralSeed,
		&posX,
		&posY,
		&structure.Rotation,
		&structure.Scale,
		&properties,
		&modelData,
		&structure.CreatedAt,
		&structure.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("structure not found: %w", err)
		}
		return nil, fmt.Errorf("failed to get structure: %w", err)
	}

	structure.Position = Position{X: posX, Y: posY}
	if ownerID.Valid {
		structure.OwnerID = &ownerID.Int64
	}
	if zoneID.Valid {
		structure.ZoneID = &zoneID.Int64
	}
	if proceduralSeed.Valid {
		structure.ProceduralSeed = &proceduralSeed.Int64
	}
	if properties.Valid {
		structure.Properties = json.RawMessage(properties.String)
	}
	if modelData.Valid {
		structure.ModelData = json.RawMessage(modelData.String)
	}

	return &structure, nil
}

// UpdateStructure updates a structure and returns the updated record.
func (s *StructureStorage) UpdateStructure(id int64, input *StructureUpdateInput) (*Structure, error) {
	if input == nil {
		return nil, fmt.Errorf("input cannot be nil")
	}
	if err := validateStructureUpdate(*input); err != nil {
		return nil, err
	}

	// Build dynamic UPDATE query
	setParts := []string{}
	args := []interface{}{}
	argIndex := 1

	if input.StructureType != nil {
		setParts = append(setParts, fmt.Sprintf("structure_type = $%d", argIndex))
		args = append(args, *input.StructureType)
		argIndex++
	}

	if input.Floor != nil {
		setParts = append(setParts, fmt.Sprintf("floor = $%d", argIndex))
		args = append(args, *input.Floor)
		argIndex++
	}

	if input.OwnerIDSet {
		if input.OwnerID != nil {
			setParts = append(setParts, fmt.Sprintf("owner_id = $%d", argIndex))
			args = append(args, *input.OwnerID)
			argIndex++
		} else {
			setParts = append(setParts, "owner_id = NULL")
		}
	}

	if input.ZoneIDSet {
		if input.ZoneID != nil {
			setParts = append(setParts, fmt.Sprintf("zone_id = $%d", argIndex))
			args = append(args, *input.ZoneID)
			argIndex++
		} else {
			setParts = append(setParts, "zone_id = NULL")
		}
	}

	if input.IsProcedural != nil {
		setParts = append(setParts, fmt.Sprintf("is_procedural = $%d", argIndex))
		args = append(args, *input.IsProcedural)
		argIndex++
	}

	if input.ProceduralSeedSet {
		if input.ProceduralSeed != nil {
			setParts = append(setParts, fmt.Sprintf("procedural_seed = $%d", argIndex))
			args = append(args, *input.ProceduralSeed)
			argIndex++
		} else {
			setParts = append(setParts, "procedural_seed = NULL")
		}
	}

	if input.Position != nil {
		// For PostGIS geometry POINT, use ST_MakePoint
		setParts = append(setParts, fmt.Sprintf("position = ST_SetSRID(ST_MakePoint($%d, $%d), 0)", argIndex, argIndex+1))
		args = append(args, input.Position.X, input.Position.Y)
		argIndex += 2
	}

	if input.Rotation != nil {
		setParts = append(setParts, fmt.Sprintf("rotation = $%d", argIndex))
		args = append(args, *input.Rotation)
		argIndex++
	}

	if input.Scale != nil {
		setParts = append(setParts, fmt.Sprintf("scale = $%d", argIndex))
		args = append(args, *input.Scale)
		argIndex++
	}

	if input.Properties != nil {
		setParts = append(setParts, fmt.Sprintf("properties = $%d", argIndex))
		args = append(args, *input.Properties)
		argIndex++
	}

	if input.ModelData != nil {
		setParts = append(setParts, fmt.Sprintf("model_data = $%d", argIndex))
		args = append(args, *input.ModelData)
		argIndex++
	}

	if len(setParts) == 0 {
		// No fields to update, just return the existing structure
		return s.GetStructure(id)
	}

	// Get current structure to check collisions and zone relationships
	current, err := s.GetStructure(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get current structure: %w", err)
	}

	// Determine new position, floor, type, properties, and scale for validation
	pos := current.Position
	floor := current.Floor
	structureType := current.StructureType
	propsForValidation := current.Properties
	scale := current.Scale

	if input.Position != nil {
		pos = *input.Position
	}
	if input.Floor != nil {
		floor = *input.Floor
	}
	if input.StructureType != nil {
		structureType = *input.StructureType
	}
	if input.Properties != nil {
		propsForValidation = *input.Properties
	}
	if input.Scale != nil {
		scale = *input.Scale
	}

	// Validate zone relationship if zone_id is being updated
	if input.ZoneIDSet && input.ZoneID != nil {
		if err := s.validateZoneRelationship(*input.ZoneID, pos, floor, structureType); err != nil {
			return nil, err
		}
	}

	// Check for collisions with existing structures (excluding this structure)
	excludeID := &id
	if err := s.checkCollisions(structureType, pos, floor, propsForValidation, scale, excludeID); err != nil {
		return nil, err
	}

	// Validate height limits
	if err := validateHeight(structureType, floor, propsForValidation, scale); err != nil {
		return nil, err
	}

	// Always update updated_at
	setParts = append(setParts, "updated_at = CURRENT_TIMESTAMP")

	// Build final query
	setClause := strings.Join(setParts, ", ")
	query := fmt.Sprintf(`
		UPDATE structures
		SET %s
		WHERE id = $%d
		RETURNING id, structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
		          ST_X(position)::float, ST_Y(position)::float, rotation, scale,
		          properties, model_data, created_at, updated_at
	`, setClause, argIndex)

	args = append(args, id)

	var structure Structure
	var posX, posY float64
	var ownerID sql.NullInt64
	var zoneID sql.NullInt64
	var proceduralSeed sql.NullInt64
	var properties sql.NullString
	var modelData sql.NullString

	err = s.db.QueryRow(query, args...).Scan(
		&structure.ID,
		&structure.StructureType,
		&structure.Floor,
		&ownerID,
		&zoneID,
		&structure.IsProcedural,
		&proceduralSeed,
		&posX,
		&posY,
		&structure.Rotation,
		&structure.Scale,
		&properties,
		&modelData,
		&structure.CreatedAt,
		&structure.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("structure not found: %w", err)
		}
		return nil, fmt.Errorf("failed to update structure: %w", err)
	}

	structure.Position = Position{X: posX, Y: posY}
	if ownerID.Valid {
		structure.OwnerID = &ownerID.Int64
	}
	if zoneID.Valid {
		structure.ZoneID = &zoneID.Int64
	}
	if proceduralSeed.Valid {
		structure.ProceduralSeed = &proceduralSeed.Int64
	}
	if properties.Valid {
		structure.Properties = json.RawMessage(properties.String)
	}
	if modelData.Valid {
		structure.ModelData = json.RawMessage(modelData.String)
	}

	return &structure, nil
}

// DeleteStructure deletes a structure by ID.
func (s *StructureStorage) DeleteStructure(id int64) error {
	query := `DELETE FROM structures WHERE id = $1`
	result, err := s.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete structure: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("structure not found")
	}

	return nil
}

// ListStructuresByArea retrieves structures within a bounding box.
func (s *StructureStorage) ListStructuresByArea(minX, maxX, minY, maxY float64, floor int) ([]*Structure, error) {
	query := `
		SELECT id, structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
		       ST_X(position)::float, ST_Y(position)::float, rotation, scale,
		       properties, model_data, created_at, updated_at
		FROM structures
		WHERE floor = $1
		  AND ST_X(position) BETWEEN $2 AND $3
		  AND ST_Y(position) BETWEEN $4 AND $5
		ORDER BY id
	`

	rows, err := s.db.Query(query, floor, minX, maxX, minY, maxY)
	if err != nil {
		return nil, fmt.Errorf("failed to query structures: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Failed to close rows: %v", closeErr)
		}
	}()

	var structures []*Structure
	for rows.Next() {
		var structure Structure
		var posX, posY float64
		var ownerID sql.NullInt64
		var zoneID sql.NullInt64
		var proceduralSeed sql.NullInt64
		var properties sql.NullString
		var modelData sql.NullString

		err := rows.Scan(
			&structure.ID,
			&structure.StructureType,
			&structure.Floor,
			&ownerID,
			&zoneID,
			&structure.IsProcedural,
			&proceduralSeed,
			&posX,
			&posY,
			&structure.Rotation,
			&structure.Scale,
			&properties,
			&modelData,
			&structure.CreatedAt,
			&structure.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan structure: %w", err)
		}

		structure.Position = Position{X: posX, Y: posY}
		if ownerID.Valid {
			structure.OwnerID = &ownerID.Int64
		}
		if zoneID.Valid {
			structure.ZoneID = &zoneID.Int64
		}
		if proceduralSeed.Valid {
			structure.ProceduralSeed = &proceduralSeed.Int64
		}
		if properties.Valid {
			structure.Properties = json.RawMessage(properties.String)
		}
		if modelData.Valid {
			structure.ModelData = json.RawMessage(modelData.String)
		}

		structures = append(structures, &structure)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate structures: %w", err)
	}

	return structures, nil
}

// ListStructuresByOwner retrieves structures owned by a specific player.
func (s *StructureStorage) ListStructuresByOwner(ownerID int64) ([]*Structure, error) {
	query := `
		SELECT id, structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
		       ST_X(position)::float, ST_Y(position)::float, rotation, scale,
		       properties, model_data, created_at, updated_at
		FROM structures
		WHERE owner_id = $1
		ORDER BY id
	`

	rows, err := s.db.Query(query, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to query structures: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Failed to close rows: %v", closeErr)
		}
	}()

	var structures []*Structure
	for rows.Next() {
		var structure Structure
		var posX, posY float64
		var ownerIDOut sql.NullInt64
		var zoneID sql.NullInt64
		var proceduralSeed sql.NullInt64
		var properties sql.NullString
		var modelData sql.NullString

		err := rows.Scan(
			&structure.ID,
			&structure.StructureType,
			&structure.Floor,
			&ownerIDOut,
			&zoneID,
			&structure.IsProcedural,
			&proceduralSeed,
			&posX,
			&posY,
			&structure.Rotation,
			&structure.Scale,
			&properties,
			&modelData,
			&structure.CreatedAt,
			&structure.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan structure: %w", err)
		}

		structure.Position = Position{X: posX, Y: posY}
		if ownerIDOut.Valid {
			structure.OwnerID = &ownerIDOut.Int64
		}
		if zoneID.Valid {
			structure.ZoneID = &zoneID.Int64
		}
		if proceduralSeed.Valid {
			structure.ProceduralSeed = &proceduralSeed.Int64
		}
		if properties.Valid {
			structure.Properties = json.RawMessage(properties.String)
		}
		if modelData.Valid {
			structure.ModelData = json.RawMessage(modelData.String)
		}

		structures = append(structures, &structure)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate structures: %w", err)
	}

	return structures, nil
}

// Constants for coordinate bounds.
// NOTE: RingCircumference is defined once in zones.go and shared across the package.
const (
	MaxWidthOffset = 2500.0 // meters (±2.5 km)
	MinFloor       = -2
	MaxFloor       = 15
	FloorHeight    = 20.0 // meters per floor level
)

// Default maximum heights (in meters) for different structure types.
// These represent the maximum height a structure can be.
// Structures can override this via the "max_height" property in the properties JSONB field.
// Height limits can also be enforced by zones (checked separately).
var defaultMaxHeights = map[string]float64{
	"building":   100.0, // 100m (5 floors) - typical building height
	"decoration": 20.0,  // 20m (1 floor) - decorative elements
	"furniture":  5.0,   // 5m - furniture items
	"vehicle":    5.0,   // 5m - vehicles
	"road":       1.0,   // 1m - roads (flat)
	"default":    20.0,  // 20m default (1 floor) for unknown types
}

// Default collision radii (in meters) for different structure types.
// These represent the minimum distance between structure centers.
// Structures can override this via the "collision_radius" property in the properties JSONB field.
var defaultCollisionRadii = map[string]float64{
	"building":   50.0, // 50m radius (100m diameter) - typical building footprint
	"decoration": 5.0,  // 5m radius (10m diameter) - small decorative objects
	"furniture":  2.0,  // 2m radius (4m diameter) - furniture items
	"vehicle":    10.0, // 10m radius (20m diameter) - vehicles
	"road":       25.0, // 25m radius (50m width) - roads
	"default":    10.0, // 10m default radius for unknown types
}

// validateStructureInput validates structure creation input.
func validateStructureInput(input StructureCreateInput) error {
	if input.StructureType == "" {
		return fmt.Errorf("structure_type is required")
	}
	if len(input.StructureType) > 50 {
		return fmt.Errorf("structure_type must be 50 characters or less")
	}
	if input.Scale <= 0 {
		return fmt.Errorf("scale must be greater than 0")
	}
	if input.Rotation < -360 || input.Rotation > 360 {
		return fmt.Errorf("rotation must be between -360 and 360 degrees")
	}

	// Validate position bounds
	if err := validatePosition(input.Position); err != nil {
		return err
	}

	// Validate floor range
	if input.Floor < MinFloor || input.Floor > MaxFloor {
		return fmt.Errorf("floor must be between %d and %d", MinFloor, MaxFloor)
	}

	return nil
}

// validatePosition validates position coordinates are within bounds.
func validatePosition(pos Position) error {
	if !isFinite(pos.X) || !isFinite(pos.Y) {
		return fmt.Errorf("position coordinates must be finite numbers")
	}
	if pos.X < 0 || pos.X >= RingCircumference {
		return fmt.Errorf("x coordinate out of bounds: %f (allowed 0..%f)", pos.X, RingCircumference)
	}
	if pos.Y < -MaxWidthOffset || pos.Y > MaxWidthOffset {
		return fmt.Errorf("y coordinate out of bounds: %f (allowed ±%f)", pos.Y, MaxWidthOffset)
	}
	return nil
}

// validateStructureUpdate validates structure update input.
func validateStructureUpdate(input StructureUpdateInput) error {
	if input.StructureType != nil {
		if *input.StructureType == "" {
			return fmt.Errorf("structure_type cannot be empty")
		}
		if len(*input.StructureType) > 50 {
			return fmt.Errorf("structure_type must be 50 characters or less")
		}
	}
	if input.Scale != nil && *input.Scale <= 0 {
		return fmt.Errorf("scale must be greater than 0")
	}
	if input.Rotation != nil && (*input.Rotation < -360 || *input.Rotation > 360) {
		return fmt.Errorf("rotation must be between -360 and 360 degrees")
	}
	if input.Position != nil {
		if err := validatePosition(*input.Position); err != nil {
			return err
		}
	}
	if input.Floor != nil {
		if *input.Floor < MinFloor || *input.Floor > MaxFloor {
			return fmt.Errorf("floor must be between %d and %d", MinFloor, MaxFloor)
		}
	}
	return nil
}

// validateZoneRelationship checks if a structure position is within the specified zone.
// This validates that if a zone_id is provided, the structure is actually within that zone's geometry.
// It also validates zone type compatibility and restricted zone access.
func (s *StructureStorage) validateZoneRelationship(zoneID int64, position Position, floor int, structureType string) error {
	query := `
		SELECT zone_type, is_system_zone
		FROM zones
		WHERE id = $1
		  AND floor = $2
		  AND ST_Contains(
			  geometry,
			  ST_SetSRID(ST_MakePoint($3, $4), 0)
		  )
	`

	var zoneType string
	var isSystemZone bool
	err := s.db.QueryRow(query, zoneID, floor, position.X, position.Y).Scan(&zoneType, &isSystemZone)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("zone %d not found or structure position (%.2f, %.2f) is not within zone %d on floor %d", zoneID, position.X, position.Y, zoneID, floor)
		}
		return fmt.Errorf("failed to validate zone relationship: %w", err)
	}

	// Check if structure is being placed in a restricted zone
	if zoneType == "restricted" {
		return fmt.Errorf("structures cannot be placed in restricted zones (zone %d is restricted)", zoneID)
	}

	// Validate zone type compatibility with structure type
	if err := validateZoneTypeCompatibility(zoneType, structureType); err != nil {
		return err
	}

	return nil
}

// validateZoneTypeCompatibility checks if a structure type is compatible with a zone type.
// Returns an error if the structure type is not allowed in the zone type.
func validateZoneTypeCompatibility(zoneType string, structureType string) error {
	// Normalize zone type (handle mixed-use vs mixed_use)
	normalizedZoneType := strings.ToLower(strings.ReplaceAll(zoneType, "_", "-"))
	normalizedStructureType := strings.ToLower(structureType)

	// Define allowed structure types per zone type
	allowedStructures := map[string][]string{
		"residential":  {"building", "decoration", "furniture"},
		"commercial":   {"building", "decoration", "furniture"},
		"industrial":   {"building", "decoration", "furniture", "vehicle"},
		"mixed-use":    {"building", "decoration", "furniture"},
		"mixed_use":    {"building", "decoration", "furniture"},
		"agricultural": {"building", "decoration", "furniture", "vehicle"},
		"park":         {"decoration", "furniture"}, // Parks allow decorations and furniture, but not buildings
		"cargo":        {"building", "decoration", "furniture", "vehicle"},
		"transit":      {"decoration", "furniture"}, // Transit zones allow decorations and furniture, but not buildings
	}

	// Get allowed structures for this zone type
	allowed, exists := allowedStructures[normalizedZoneType]
	if !exists {
		// Unknown zone type - allow all structure types (for future extensibility)
		return nil
	}

	// Check if structure type is allowed
	for _, allowedType := range allowed {
		if normalizedStructureType == allowedType {
			return nil
		}
	}

	return fmt.Errorf("structure type '%s' is not allowed in zone type '%s' (allowed types: %v)", structureType, zoneType, allowed)
}

// getCollisionRadius returns the collision radius for a structure.
// First checks the properties JSONB for a "collision_radius" field,
// then falls back to the default for the structure type, or the global default.
func getCollisionRadius(structureType string, properties json.RawMessage, scale float64) float64 {
	// Try to extract collision_radius from properties
	if len(properties) > 0 {
		var props map[string]interface{}
		if err := json.Unmarshal(properties, &props); err == nil {
			if radius, ok := props["collision_radius"].(float64); ok && radius > 0 {
				// Apply scale to the collision radius
				return radius * scale
			}
		}
	}

	// Fall back to default for structure type
	radius, ok := defaultCollisionRadii[structureType]
	if !ok {
		radius = defaultCollisionRadii["default"]
	}

	// Apply scale to the default radius
	return radius * scale
}

// getStructureHeight extracts the height of a structure from its properties.
// Returns 0 if height is not specified (structures without explicit height are assumed to fit within their floor).
func getStructureHeight(properties json.RawMessage, scale float64) float64 {
	if len(properties) == 0 {
		return 0
	}

	var props map[string]interface{}
	if err := json.Unmarshal(properties, &props); err != nil {
		return 0
	}

	// Try to get height from properties
	height, ok := props["height"].(float64)
	if !ok {
		return 0
	}

	// Apply scale to the height
	return height * scale
}

// getMaxHeight returns the maximum allowed height for a structure.
// First checks the properties JSONB for a "max_height" field,
// then falls back to the default for the structure type, or the global default.
func getMaxHeight(structureType string, properties json.RawMessage) float64 {
	// Try to extract max_height from properties
	if len(properties) > 0 {
		var props map[string]interface{}
		if err := json.Unmarshal(properties, &props); err == nil {
			if maxHeight, ok := props["max_height"].(float64); ok && maxHeight > 0 {
				return maxHeight
			}
		}
	}

	// Fall back to default for structure type
	maxHeight, ok := defaultMaxHeights[structureType]
	if !ok {
		maxHeight = defaultMaxHeights["default"]
	}

	return maxHeight
}

// validateHeight checks if a structure's height is within allowed limits.
// It checks:
// 1. Structure doesn't span beyond available floors (if height > FloorHeight) - checked first to give clearer error
// 2. Structure height doesn't exceed the maximum for its type
func validateHeight(structureType string, floor int, properties json.RawMessage, scale float64) error {
	height := getStructureHeight(properties, scale)
	if height <= 0 {
		// No height specified, structure is assumed to fit within its floor
		return nil
	}

	// Check if structure fits within available floor space
	// Each floor is FloorHeight (20m) tall, and structures should fit within their floor
	// For structures taller than one floor, we need to check if they span valid floors
	if height > FloorHeight {
		// Structure spans multiple floors - calculate how many floors it needs
		floorsNeeded := int(height/FloorHeight) + 1
		if height/FloorHeight == float64(int(height/FloorHeight)) {
			floorsNeeded = int(height / FloorHeight)
		}

		// Check if structure would extend beyond valid floor range
		topFloor := floor + floorsNeeded - 1
		if topFloor > MaxFloor {
			return fmt.Errorf("structure height %.2fm would extend beyond maximum floor %d (structure on floor %d needs %d floors, would reach floor %d)", height, MaxFloor, floor, floorsNeeded, topFloor)
		}
		if floor < MinFloor {
			return fmt.Errorf("structure on floor %d is below minimum floor %d", floor, MinFloor)
		}
	}

	// Check against maximum height for structure type (after floor check)
	maxHeight := getMaxHeight(structureType, properties)
	if height > maxHeight {
		return fmt.Errorf("structure height %.2fm exceeds maximum allowed height %.2fm for type '%s'", height, maxHeight, structureType)
	}

	return nil
}

// checkCollisions checks if placing a structure at the given position would collide with existing structures.
// It queries for structures on the same floor within the collision radius.
// excludeID is used when updating a structure (to exclude itself from collision checks).
func (s *StructureStorage) checkCollisions(structureType string, position Position, floor int, properties json.RawMessage, scale float64, excludeID *int64) error {
	collisionRadius := getCollisionRadius(structureType, properties, scale)

	// Query for structures on the same floor within collision radius
	// We use ST_DWithin to check distance between points
	var rows *sql.Rows
	var err error

	if excludeID != nil {
		query := `
			SELECT id, structure_type, ST_X(position)::float as x, ST_Y(position)::float as y
			FROM structures
			WHERE floor = $1
			  AND ST_DWithin(
				  position,
				  ST_SetSRID(ST_MakePoint($2, $3), 0),
				  $4
			  )
			  AND id != $5
		`
		rows, err = s.db.Query(query, floor, position.X, position.Y, collisionRadius, *excludeID)
	} else {
		query := `
			SELECT id, structure_type, ST_X(position)::float as x, ST_Y(position)::float as y
			FROM structures
			WHERE floor = $1
			  AND ST_DWithin(
				  position,
				  ST_SetSRID(ST_MakePoint($2, $3), 0),
				  $4
			  )
		`
		rows, err = s.db.Query(query, floor, position.X, position.Y, collisionRadius)
	}
	if err != nil {
		return fmt.Errorf("failed to check collisions: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Failed to close rows: %v", closeErr)
		}
	}()

	var collisions []struct {
		id            int64
		structureType string
		x, y          float64
	}

	for rows.Next() {
		var c struct {
			id            int64
			structureType string
			x, y          float64
		}
		if err := rows.Scan(&c.id, &c.structureType, &c.x, &c.y); err != nil {
			return fmt.Errorf("failed to scan collision: %w", err)
		}
		collisions = append(collisions, c)
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate collisions: %w", err)
	}

	if len(collisions) > 0 {
		// Build error message with collision details
		var details []string
		for _, c := range collisions {
			details = append(details, fmt.Sprintf("structure %d (%s) at (%.2f, %.2f)", c.id, c.structureType, c.x, c.y))
		}
		return fmt.Errorf("structure would collide with existing structures: %s (minimum distance: %.2fm)", strings.Join(details, ", "), collisionRadius)
	}

	return nil
}
