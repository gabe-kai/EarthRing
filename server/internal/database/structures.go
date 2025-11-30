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
		if err := s.validateZoneRelationship(*input.ZoneID, input.Position, input.Floor); err != nil {
			return nil, err
		}
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

	// Validate zone relationship if zone_id is being updated
	if input.ZoneIDSet && input.ZoneID != nil {
		// Get current position and floor if not being updated
		current, err := s.GetStructure(id)
		if err != nil {
			return nil, fmt.Errorf("failed to get current structure: %w", err)
		}

		pos := current.Position
		floor := current.Floor
		if input.Position != nil {
			pos = *input.Position
		}
		if input.Floor != nil {
			floor = *input.Floor
		}

		if err := s.validateZoneRelationship(*input.ZoneID, pos, floor); err != nil {
			return nil, err
		}
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

	err := s.db.QueryRow(query, args...).Scan(
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
)

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
func (s *StructureStorage) validateZoneRelationship(zoneID int64, position Position, floor int) error {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM zones
			WHERE id = $1
			  AND floor = $2
			  AND ST_Contains(
				  geometry,
				  ST_SetSRID(ST_MakePoint($3, $4), 0)
			  )
		)
	`

	var exists bool
	err := s.db.QueryRow(query, zoneID, floor, position.X, position.Y).Scan(&exists)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("zone %d not found", zoneID)
		}
		return fmt.Errorf("failed to validate zone relationship: %w", err)
	}

	if !exists {
		return fmt.Errorf("structure position (%.2f, %.2f) is not within zone %d on floor %d", position.X, position.Y, zoneID, floor)
	}

	return nil
}
