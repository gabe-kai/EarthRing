package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// Zone represents a stored zone record including geometry metadata.
type Zone struct {
	ID           int64           `json:"id"`
	Name         string          `json:"name"`
	ZoneType     string          `json:"zone_type"`
	Floor        int             `json:"floor"`
	OwnerID      *int64          `json:"owner_id,omitempty"`
	IsSystemZone bool            `json:"is_system_zone"`
	Properties   json.RawMessage `json:"properties,omitempty"`
	Metadata     json.RawMessage `json:"metadata,omitempty"`
	Geometry     json.RawMessage `json:"geometry,omitempty"`
	Area         float64         `json:"area"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

// ZoneCreateInput contains the fields required to create a zone.
type ZoneCreateInput struct {
	Name         string
	ZoneType     string
	Floor        int
	OwnerID      *int64
	IsSystemZone bool
	Geometry     json.RawMessage
	Properties   json.RawMessage
	Metadata     json.RawMessage
}

// ZoneUpdateInput describes the fields that can be updated on a zone.
// A nil field means "leave unchanged". For OwnerID use OwnerIDSet to control null assignment.
type ZoneUpdateInput struct {
	Name         *string
	ZoneType     *string
	Floor        *int
	OwnerID      *int64
	OwnerIDSet   bool
	IsSystemZone *bool
	Geometry     *json.RawMessage
	Properties   *json.RawMessage
	Metadata     *json.RawMessage
}

// ZoneStorage provides zone persistence helpers.
type ZoneStorage struct {
	db *sql.DB
}

// NewZoneStorage creates a new ZoneStorage instance.
func NewZoneStorage(db *sql.DB) *ZoneStorage {
	return &ZoneStorage{db: db}
}

// CreateZone inserts a new zone and returns the stored record.
// If the new zone overlaps with existing zones of the same type and floor,
// it merges them using PostGIS ST_Union and deletes the old zones.
func (s *ZoneStorage) CreateZone(input *ZoneCreateInput) (*Zone, error) {
	if input == nil {
		return nil, fmt.Errorf("input cannot be nil")
	}
	if err := validateZoneInput(*input); err != nil {
		return nil, err
	}

	geometryString := string(input.Geometry)

	// Check for overlapping zones of the same type and floor
	// Use ST_Intersects to detect any spatial intersection (overlap, touch, or contain)
	overlapQuery := `
		SELECT id
		FROM zones
		WHERE floor = $1
		  AND zone_type = $2
		  AND owner_id IS NOT DISTINCT FROM $3
		  AND is_system_zone = $4
		  AND ST_Intersects(geometry, ST_SetSRID(ST_GeomFromGeoJSON($5), 0))
	`

	var owner sql.NullInt64
	if input.OwnerID != nil {
		owner = sql.NullInt64{Int64: *input.OwnerID, Valid: true}
	}

	rows, err := s.db.Query(overlapQuery, input.Floor, input.ZoneType, owner, input.IsSystemZone, geometryString)
	if err != nil {
		return nil, fmt.Errorf("failed to query overlapping zones: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Failed to close rows in CreateZone overlap check: %v", closeErr)
		}
	}()

	var overlappingIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan overlapping zone ID: %w", err)
		}
		overlappingIDs = append(overlappingIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate overlapping zones: %w", err)
	}

	// Log overlap detection for debugging
	log.Printf("[ZoneMerge] Checking overlaps: type=%s, floor=%d, owner=%v, is_system=%v, geometry_length=%d",
		input.ZoneType, input.Floor, input.OwnerID, input.IsSystemZone, len(geometryString))
	if len(overlappingIDs) > 0 {
		log.Printf("[ZoneMerge] Found %d overlapping zones: %v", len(overlappingIDs), overlappingIDs)
	} else {
		log.Printf("[ZoneMerge] No overlapping zones found - will create new zone")
	}

	// If there are overlapping zones, merge them
	if len(overlappingIDs) > 0 {
		// Build placeholders for queries
		// For union query, we need placeholders starting from $2 (since $1 is the new geometry)
		unionPlaceholders := make([]string, len(overlappingIDs))
		// For delete query, placeholders start from $1
		deletePlaceholders := make([]string, len(overlappingIDs))
		deleteArgs := make([]interface{}, len(overlappingIDs))
		for i, id := range overlappingIDs {
			unionPlaceholders[i] = fmt.Sprintf("$%d", i+2) // Start from $2 since $1 is geometry
			deletePlaceholders[i] = fmt.Sprintf("$%d", i+1) // Start from $1
			deleteArgs[i] = id
		}

		// Use a transaction to ensure atomicity
		tx, err := s.db.Begin()
		if err != nil {
			return nil, fmt.Errorf("failed to begin transaction: %w", err)
		}
		defer tx.Rollback()

		// Build query to merge new geometry with all overlapping zones using ST_Union aggregate
		// Use ST_MakeValid to ensure geometries are valid before union
		// This prevents topology errors when merging zones near X axis wrap boundary
		// ST_Union as an aggregate function will merge all geometries
		// Convert MultiPolygon to Polygon if needed (database only accepts Polygon)
		// If result is MultiPolygon, union all components using ST_UnaryUnion
		unionQuery := fmt.Sprintf(`
			WITH unioned AS (
				SELECT ST_Union(geom) AS merged_geom
				FROM (
					SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) AS geom
					UNION ALL
					SELECT ST_MakeValid(geometry) AS geom FROM zones WHERE id IN (%s)
				) AS geometries
			),
			finalized AS (
				SELECT 
					CASE 
						WHEN ST_GeometryType(unioned.merged_geom) = 'ST_MultiPolygon' THEN
							-- Use buffer with small positive and negative values to dissolve boundaries
							-- This converts MultiPolygon to a single Polygon by dissolving shared boundaries
							ST_Buffer(ST_Buffer(unioned.merged_geom, 0.1), -0.1)
						ELSE
							unioned.merged_geom
					END AS final_geom
				FROM unioned
			)
			SELECT ST_AsGeoJSON(final_geom)::TEXT
			FROM finalized
		`, strings.Join(unionPlaceholders, ","))

		// Combine geometry string with zone IDs for union query
		unionArgs := make([]interface{}, 0, len(deleteArgs)+1)
		unionArgs = append(unionArgs, geometryString)
		unionArgs = append(unionArgs, deleteArgs...)

		var mergedGeometryJSON sql.NullString
		if err := tx.QueryRow(unionQuery, unionArgs...).Scan(&mergedGeometryJSON); err != nil {
			log.Printf("[ZoneMerge] Union query failed: %v", err)
			return nil, fmt.Errorf("failed to merge geometries: %w", err)
		}
		if !mergedGeometryJSON.Valid {
			return nil, fmt.Errorf("merged geometry is null")
		}
		log.Printf("[ZoneMerge] Successfully merged %d zones into new geometry (result length: %d)", len(overlappingIDs)+1, len(mergedGeometryJSON.String))

		// Delete overlapping zones
		deleteQuery := fmt.Sprintf(`DELETE FROM zones WHERE id IN (%s)`, strings.Join(deletePlaceholders, ","))
		if _, err := tx.Exec(deleteQuery, deleteArgs...); err != nil {
			return nil, fmt.Errorf("failed to delete overlapping zones: %w", err)
		}

		// Insert merged zone using the merged geometry JSON
		insertQuery := `
			INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
			VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 0), $4, $5, $6, $7, $8)
			RETURNING id, name, zone_type, floor, owner_id, is_system_zone,
			          properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
			          created_at, updated_at
		`

		row := tx.QueryRow(
			insertQuery,
			input.Name,
			input.ZoneType,
			mergedGeometryJSON.String,
			input.Floor,
			owner,
			input.IsSystemZone,
			nullableJSONString(input.Properties),
			nullableJSONString(input.Metadata),
		)

		zone, err := scanZone(row)
		if err != nil {
			return nil, fmt.Errorf("failed to insert merged zone: %w", err)
		}

		// Commit transaction
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("failed to commit transaction: %w", err)
		}

		return zone, nil
	}

	// No overlapping zones, create normally
	query := `
		INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
		VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 0), $4, $5, $6, $7, $8)
		RETURNING id, name, zone_type, floor, owner_id, is_system_zone,
		          properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
		          created_at, updated_at
	`

	row := s.db.QueryRow(
		query,
		input.Name,
		input.ZoneType,
		geometryString,
		input.Floor,
		owner,
		input.IsSystemZone,
		nullableJSONString(input.Properties),
		nullableJSONString(input.Metadata),
	)

	return scanZone(row)
}

// GetZoneByID retrieves a zone by its identifier.
func (s *ZoneStorage) GetZoneByID(id int64) (*Zone, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid zone id: %d", id)
	}

	query := `
		SELECT id, name, zone_type, floor, owner_id, is_system_zone,
		       properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
		       created_at, updated_at
		FROM zones
		WHERE id = $1
	`
	row := s.db.QueryRow(query, id)
	zone, err := scanZone(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return zone, err
}

// UpdateZone updates the provided fields for a zone.
func (s *ZoneStorage) UpdateZone(id int64, input ZoneUpdateInput) (*Zone, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid zone id: %d", id)
	}

	setClauses := make([]string, 0, 8)
	args := make([]interface{}, 0, 10)
	argIdx := 1

	if input.Name != nil {
		if strings.TrimSpace(*input.Name) == "" {
			return nil, fmt.Errorf("zone name cannot be empty")
		}
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *input.Name)
		argIdx++
	}

	if input.ZoneType != nil {
		if err := validateZoneType(*input.ZoneType); err != nil {
			return nil, err
		}
		setClauses = append(setClauses, fmt.Sprintf("zone_type = $%d", argIdx))
		args = append(args, *input.ZoneType)
		argIdx++
	}

	if input.Floor != nil {
		if *input.Floor < 0 {
			return nil, fmt.Errorf("zone floor must be >= 0")
		}
		setClauses = append(setClauses, fmt.Sprintf("floor = $%d", argIdx))
		args = append(args, *input.Floor)
		argIdx++
	}

	if input.OwnerIDSet {
		var owner sql.NullInt64
		if input.OwnerID != nil {
			owner = sql.NullInt64{Int64: *input.OwnerID, Valid: true}
		}
		setClauses = append(setClauses, fmt.Sprintf("owner_id = $%d", argIdx))
		args = append(args, owner)
		argIdx++
	}

	if input.IsSystemZone != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_system_zone = $%d", argIdx))
		args = append(args, *input.IsSystemZone)
		argIdx++
	}

	if input.Geometry != nil {
		if err := validateZoneGeometry(*input.Geometry); err != nil {
			return nil, err
		}
		setClauses = append(setClauses, fmt.Sprintf("geometry = ST_SetSRID(ST_GeomFromGeoJSON($%d), 0)", argIdx))
		args = append(args, string(*input.Geometry))
		argIdx++
	}

	if input.Properties != nil {
		setClauses = append(setClauses, fmt.Sprintf("properties = $%d", argIdx))
		args = append(args, nullableJSONString(*input.Properties))
		argIdx++
	}

	if input.Metadata != nil {
		setClauses = append(setClauses, fmt.Sprintf("metadata = $%d", argIdx))
		args = append(args, nullableJSONString(*input.Metadata))
		argIdx++
	}

	if len(setClauses) == 0 {
		return s.GetZoneByID(id)
	}

	setClauses = append(setClauses, "updated_at = CURRENT_TIMESTAMP")

	query := fmt.Sprintf(`
		UPDATE zones
		SET %s
		WHERE id = $%d
		RETURNING id, name, zone_type, floor, owner_id, is_system_zone,
		          properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
		          created_at, updated_at
	`, strings.Join(setClauses, ", "), argIdx)

	args = append(args, id)
	row := s.db.QueryRow(query, args...)
	return scanZone(row)
}

// DeleteZone removes a zone by id. Returns nil if the zone did not exist.
func (s *ZoneStorage) DeleteZone(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid zone id: %d", id)
	}

	result, err := s.db.Exec(`DELETE FROM zones WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete zone: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check delete rows: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("zone not found: %d", id)
	}
	return nil
}

// CountZones returns the total number of zones in the database.
func (s *ZoneStorage) CountZones() (int64, error) {
	var count int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM zones`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count zones: %w", err)
	}
	return count, nil
}

// DeleteAllZones removes all zones from the database.
// Returns the number of zones deleted.
func (s *ZoneStorage) DeleteAllZones() (int64, error) {
	result, err := s.db.Exec(`DELETE FROM zones`)
	if err != nil {
		return 0, fmt.Errorf("failed to delete all zones: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}
	return rowsAffected, nil
}

// ListZonesByArea returns all zones whose geometry intersects the provided bounding box on a floor.
func (s *ZoneStorage) ListZonesByArea(floor int, minX, minY, maxX, maxY float64) ([]Zone, error) {
	if floor < 0 {
		return nil, fmt.Errorf("floor must be >= 0")
	}
	if minX >= maxX || minY >= maxY {
		return nil, fmt.Errorf("invalid bounding box coordinates")
	}

	query := `
		SELECT id, name, zone_type, floor, owner_id, is_system_zone,
		       properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
		       created_at, updated_at
		FROM zones
		WHERE floor = $1
		  AND geometry && ST_MakeEnvelope($2, $3, $4, $5, 0)
		ORDER BY updated_at DESC
	`

	rows, err := s.db.Query(query, floor, minX, minY, maxX, maxY)
	if err != nil {
		return nil, fmt.Errorf("failed to query zones by area: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Failed to close rows in ListZonesByArea: %v", closeErr)
		}
	}()

	var zones []Zone
	for rows.Next() {
		zone, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, *zone)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate zones: %w", err)
	}
	return zones, nil
}

// ListZonesByOwner fetches zones for the provided owner id.
func (s *ZoneStorage) ListZonesByOwner(ownerID int64) ([]Zone, error) {
	if ownerID <= 0 {
		return nil, fmt.Errorf("invalid owner id: %d", ownerID)
	}

	query := `
		SELECT id, name, zone_type, floor, owner_id, is_system_zone,
		       properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
		       created_at, updated_at
		FROM zones
		WHERE owner_id = $1
		ORDER BY updated_at DESC
	`

	rows, err := s.db.Query(query, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to query zones by owner: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Failed to close rows in ListZonesByOwner: %v", closeErr)
		}
	}()

	var zones []Zone
	for rows.Next() {
		zone, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, *zone)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate zones: %w", err)
	}
	return zones, nil
}

// Helper to scan a zone from a scanner.
type zoneScanner interface {
	Scan(dest ...interface{}) error
}

func scanZone(scanner zoneScanner) (*Zone, error) {
	var z Zone
	var owner sql.NullInt64
	var properties sql.NullString
	var metadata sql.NullString
	var geometry sql.NullString

	err := scanner.Scan(
		&z.ID,
		&z.Name,
		&z.ZoneType,
		&z.Floor,
		&owner,
		&z.IsSystemZone,
		&properties,
		&metadata,
		&geometry,
		&z.Area,
		&z.CreatedAt,
		&z.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if owner.Valid {
		value := owner.Int64
		z.OwnerID = &value
	}
	if properties.Valid && properties.String != "" {
		z.Properties = json.RawMessage(properties.String)
	}
	if metadata.Valid && metadata.String != "" {
		z.Metadata = json.RawMessage(metadata.String)
	}
	if geometry.Valid && geometry.String != "" {
		z.Geometry = json.RawMessage(geometry.String)
	}
	return &z, nil
}

func nullableJSONString(raw json.RawMessage) interface{} {
	if len(raw) == 0 {
		return sql.NullString{}
	}
	return sql.NullString{String: string(raw), Valid: true}
}

func validateZoneInput(input ZoneCreateInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return fmt.Errorf("zone name cannot be empty")
	}
	if err := validateZoneType(input.ZoneType); err != nil {
		return err
	}
	if len(input.Geometry) == 0 {
		return fmt.Errorf("zone geometry is required")
	}
	if err := validateZoneGeometry(input.Geometry); err != nil {
		return err
	}
	return validateZoneBounds(input.Geometry)
}

func validateZoneType(zoneType string) error {
	if strings.TrimSpace(zoneType) == "" {
		return fmt.Errorf("zone type cannot be empty")
	}
	return nil
}

func validateZoneGeometry(raw json.RawMessage) error {
	var geo struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	}
	if err := json.Unmarshal(raw, &geo); err != nil {
		return fmt.Errorf("invalid geometry: %w", err)
	}
	switch strings.ToLower(geo.Type) {
	case "polygon":
		return validatePolygonCoordinates(geo.Coordinates)
	case "multipolygon":
		return validateMultiPolygonCoordinates(geo.Coordinates)
	default:
		return fmt.Errorf("unsupported geometry type: %s (expected Polygon or MultiPolygon)", geo.Type)
	}
}

func validatePolygonCoordinates(raw json.RawMessage) error {
	var rings [][][]float64
	if err := json.Unmarshal(raw, &rings); err != nil {
		return fmt.Errorf("invalid polygon coordinates: %w", err)
	}
	if len(rings) == 0 {
		return fmt.Errorf("polygon must contain at least one ring")
	}
	for i, ring := range rings {
		if len(ring) < 4 {
			return fmt.Errorf("ring %d must contain at least 4 points", i)
		}
		if !pointsEqual(ring[0], ring[len(ring)-1]) {
			return fmt.Errorf("ring %d must be closed (first and last point must match)", i)
		}
	}
	return nil
}

func validateMultiPolygonCoordinates(raw json.RawMessage) error {
	var polygons [][][][]float64
	if err := json.Unmarshal(raw, &polygons); err != nil {
		return fmt.Errorf("invalid multipolygon coordinates: %w", err)
	}
	if len(polygons) == 0 {
		return fmt.Errorf("multipolygon must contain at least one polygon")
	}
	for idx, polygon := range polygons {
		ringsRaw, err := json.Marshal(polygon)
		if err != nil {
			return fmt.Errorf("failed to marshal polygon %d: %w", idx, err)
		}
		if err := validatePolygonCoordinates(ringsRaw); err != nil {
			return fmt.Errorf("invalid polygon %d: %w", idx, err)
		}
	}
	return nil
}

func validateZoneBounds(raw json.RawMessage) error {
	var geo struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	}
	if err := json.Unmarshal(raw, &geo); err != nil {
		return fmt.Errorf("invalid geometry: %w", err)
	}

	switch strings.ToLower(geo.Type) {
	case "polygon":
		return validatePolygonBounds(geo.Coordinates)
	case "multipolygon":
		var polygons []json.RawMessage
		if err := json.Unmarshal(geo.Coordinates, &polygons); err != nil {
			return fmt.Errorf("invalid multipolygon coordinates: %w", err)
		}
		for idx, polygon := range polygons {
			if err := validatePolygonBounds(polygon); err != nil {
				return fmt.Errorf("polygon %d out of bounds: %w", idx, err)
			}
		}
	default:
		return fmt.Errorf("unsupported geometry type for bounds validation: %s", geo.Type)
	}
	return nil
}

func validatePolygonBounds(raw json.RawMessage) error {
	var rings [][][]float64
	if err := json.Unmarshal(raw, &rings); err != nil {
		return fmt.Errorf("invalid polygon coordinates: %w", err)
	}
	if len(rings) == 0 {
		return fmt.Errorf("polygon must contain at least one ring")
	}

	const ringCircumference = 264000000.0
	const maxWidth = 2500.0

	for _, ring := range rings {
		for _, vertex := range ring {
			if len(vertex) < 2 {
				return fmt.Errorf("vertex has insufficient coordinates")
			}
			x, y := vertex[0], vertex[1]
			if !isFinite(x) || !isFinite(y) {
				return fmt.Errorf("vertex coordinates must be finite numbers")
			}
			if x < 0 || x > ringCircumference {
				return fmt.Errorf("x coordinate out of bounds: %f (allowed 0..%f)", x, ringCircumference)
			}
			if y < -maxWidth || y > maxWidth {
				return fmt.Errorf("y coordinate out of bounds: %f (allowed ±%f)", y, maxWidth)
			}
		}
	}

	return nil
}

func pointsEqual(a, b []float64) bool {
	if len(a) < 2 || len(b) < 2 {
		return false
	}
	return a[0] == b[0] && a[1] == b[1]
}
