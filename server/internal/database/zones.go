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

	// Log overlap detection for debugging
	log.Printf("[ZoneMerge] Checking overlaps: type=%s, floor=%d, owner=%v, is_system=%v, geometry_length=%d",
		input.ZoneType, input.Floor, input.OwnerID, input.IsSystemZone, len(geometryString))
	
	// First, check how many zones exist with matching criteria (before intersection check)
	countQuery := `
		SELECT COUNT(*)
		FROM zones
		WHERE floor = $1
		  AND zone_type = $2
		  AND owner_id IS NOT DISTINCT FROM $3
		  AND is_system_zone = $4
	`
	var totalMatchingZones int
	if err := s.db.QueryRow(countQuery, input.Floor, input.ZoneType, owner, input.IsSystemZone).Scan(&totalMatchingZones); err == nil {
		log.Printf("[ZoneMerge] Found %d total zones with matching type/floor/owner/system (before intersection check)", totalMatchingZones)
	}

	rows, err := s.db.Query(overlapQuery, input.Floor, input.ZoneType, owner, input.IsSystemZone, geometryString)
	if err != nil {
		log.Printf("[ZoneMerge] ERROR: Overlap query failed: %v", err)
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

	if len(overlappingIDs) > 0 {
		log.Printf("[ZoneMerge] Found %d overlapping zones: %v", len(overlappingIDs), overlappingIDs)
	} else {
		log.Printf("[ZoneMerge] No overlapping zones found - will create new zone (total matching zones: %d)", totalMatchingZones)
	}

	// If there are overlapping zones, merge them
	if len(overlappingIDs) > 0 {
		// Find the oldest zone (first one placed) - keep its ID
		// Order by ID (lower ID = older) and created_at as tiebreaker
		oldestZoneQuery := `
			SELECT id, created_at
			FROM zones
			WHERE id IN (%s)
			ORDER BY id ASC, created_at ASC
			LIMIT 1
		`
		
		deletePlaceholders := make([]string, len(overlappingIDs))
		deleteArgs := make([]interface{}, len(overlappingIDs))
		for i, id := range overlappingIDs {
			deletePlaceholders[i] = fmt.Sprintf("$%d", i+1)
			deleteArgs[i] = id
		}
		
		var oldestZoneID int64
		var oldestZoneCreatedAt time.Time
		oldestZoneQueryFormatted := fmt.Sprintf(oldestZoneQuery, strings.Join(deletePlaceholders, ","))
		if err := s.db.QueryRow(oldestZoneQueryFormatted, deleteArgs...).Scan(&oldestZoneID, &oldestZoneCreatedAt); err != nil {
			return nil, fmt.Errorf("failed to find oldest overlapping zone: %w", err)
		}
		
		log.Printf("[ZoneMerge] Oldest zone ID to keep: %d (created: %v)", oldestZoneID, oldestZoneCreatedAt)
		
		// Build placeholders for union query
		// We need to include all overlapping zone IDs in the union, plus the new geometry
		// Use all overlappingIDs (not just deleteArgs, since we're including the oldest one in the union)
		unionPlaceholders := make([]string, len(overlappingIDs))
		unionIDs := make([]interface{}, len(overlappingIDs))
		for i, id := range overlappingIDs {
			unionPlaceholders[i] = fmt.Sprintf("$%d", i+2) // Start from $2 since $1 is the new geometry
			unionIDs[i] = id
		}

		// Use a transaction to ensure atomicity
		tx, err := s.db.Begin()
		if err != nil {
			return nil, fmt.Errorf("failed to begin transaction: %w", err)
		}
		defer tx.Rollback()

		// Build query to merge new geometry with all overlapping zones using ST_Union
		// 
		// WRAPPING APPROACH - Uses ST_DumpPoints + ST_MakePolygon for coordinate normalization
		// 
		// CRITICAL: Do NOT use normalize_zone_geometry_for_area() in transformations!
		// That function uses JSON manipulation which creates structures that corrupt when
		// further transformed (shifted, unioned, wrapped).
		//
		// Instead, we use ST_DumpPoints to extract individual coordinates, shift coordinates
		// where X > half_ring by -ring_circumference, then rebuild the polygon using ST_MakePolygon.
		// This handles geometries like rectangles from X=15 to X=263999970 (wraps around boundary).
		//
		// Steps:
		// 1. Detect if any geometry wraps (span > half_ring = 132,000 km)
		// 2. Extract points with ST_DumpPoints, shift individual X coords > half_ring
		// 3. Rebuild polygons with ST_MakePolygon from shifted points
		// 4. Align all geometries to positive coordinate space
		// 5. Perform union in aligned space
		// 6. Shift back and wrap to [0, 264000000) range
		//
		// Uses only PostGIS geometry operations: ST_DumpPoints, ST_MakePoint, ST_MakeLine,
		// ST_MakePolygon, ST_Translate, ST_Union, ST_MakeValid - NO JSON manipulation.
		unionQuery := fmt.Sprintf(`
			WITH 
			constants AS (
				SELECT 264000000.0 AS ring_circ, 132000000.0 AS half_ring
			),
			-- Step 1: Load and validate all geometries
			all_raw_geoms AS (
				SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) AS geom
				UNION ALL
				SELECT ST_MakeValid(geometry) AS geom FROM zones WHERE id IN (%s)
			),
			-- Step 2: Detect if any geometry wraps (span > half_ring)
			all_with_spans AS (
				SELECT 
					geom,
					ST_XMax(geom) - ST_XMin(geom) AS span
				FROM all_raw_geoms
			),
			has_wrapped_geom AS (
				SELECT EXISTS(SELECT 1 FROM all_with_spans, constants WHERE span > constants.half_ring) AS wrapped
			),
			-- Step 3: Normalize by shifting individual points where X > half_ring
			-- Use ST_DumpPoints to extract coordinates, shift them, then rebuild geometry
			-- This avoids JSON manipulation that corrupts coordinate structures
			all_normalized AS (
				SELECT 
					CASE 
						WHEN (SELECT wrapped FROM has_wrapped_geom) THEN
							-- Rebuild polygon with shifted coordinates
							ST_MakePolygon(
								ST_MakeLine(
									ARRAY(
										SELECT 
											ST_MakePoint(
												CASE 
													WHEN ST_X((dp).geom) > (SELECT half_ring FROM constants) 
													THEN ST_X((dp).geom) - (SELECT ring_circ FROM constants)
													ELSE ST_X((dp).geom)
												END,
												ST_Y((dp).geom)
											)
										FROM ST_DumpPoints(ST_ExteriorRing(geom)) AS dp
									)
								)
							)
						ELSE
							geom
					END AS geom
				FROM all_with_spans
			),
			-- Step 3: Find coordinate space boundaries after normalization
			coord_bounds AS (
				SELECT 
					MIN(ST_XMin(geom)) AS min_x,
					MAX(ST_XMax(geom)) AS max_x
				FROM all_normalized
			),
			-- Step 4: Shift all geometries into positive coordinate space for union
			-- The shift amount is calculated to move the leftmost point to X=0
			aligned_geoms AS (
				SELECT 
					ST_Translate(
						geom,
						-- Shift by -min_x to move leftmost point to 0
						-LEAST((SELECT min_x FROM coord_bounds), 0.0),
						0.0
					) AS geom
				FROM all_normalized
			),
			-- Step 5: Union all aligned geometries
			unioned AS (
				SELECT ST_Union(geom) AS merged_geom
				FROM aligned_geoms
			),
			-- Step 6: Handle MultiPolygon results (convert to Polygon if possible)
			single_geom AS (
				SELECT 
					CASE 
						WHEN ST_GeometryType(merged_geom) = 'ST_MultiPolygon' THEN
							-- Try to merge with ST_UnaryUnion
							ST_UnaryUnion(merged_geom)
						ELSE
							merged_geom
					END AS geom
				FROM unioned
			),
			-- Step 7: If still MultiPolygon, take the largest component
			final_single AS (
				SELECT 
					CASE 
						WHEN ST_GeometryType(geom) = 'ST_MultiPolygon' THEN
							-- Take largest polygon
							(SELECT (ST_Dump(single_geom.geom)).geom AS geom
							 ORDER BY ST_Area((ST_Dump(single_geom.geom)).geom) DESC
							 LIMIT 1)
						ELSE
							geom
					END AS geom
				FROM single_geom
			),
			-- Step 8: Shift back to original coordinate space
			shifted_back AS (
				SELECT 
					ST_Translate(
						geom,
						-- Reverse the shift we applied earlier
						LEAST((SELECT min_x FROM coord_bounds), 0.0),
						0.0
					) AS geom
				FROM final_single
			),
			-- Step 9: Wrap coordinates to [0, 264000000) range using modulo arithmetic
			wrapped AS (
				SELECT 
					CASE 
						-- Has negative coordinates - wrap by adding 264000000
						WHEN ST_XMin(geom) < 0 THEN
							ST_Translate(geom, 264000000.0, 0.0)
						-- Exceeds ring boundary - wrap by subtracting 264000000
						WHEN ST_XMax(geom) >= 264000000 THEN
							ST_Translate(geom, -264000000.0, 0.0)
						-- Already in valid range
						ELSE
							geom
					END AS geom
				FROM shifted_back
			),
			-- Step 10: Validate and ensure clean geometry structure
			validated AS (
				SELECT ST_MakeValid(geom) AS geom
				FROM wrapped
			)
			-- Step 11: Convert to GeoJSON
			SELECT 
				CASE 
					WHEN ST_IsEmpty(geom) THEN NULL::TEXT
					WHEN NOT ST_IsValid(geom) THEN NULL::TEXT
					WHEN ST_GeometryType(geom) != 'ST_Polygon' THEN NULL::TEXT
					ELSE ST_AsGeoJSON(geom, 15, 0)::TEXT
				END
			FROM validated
			WHERE ST_IsValid(geom)
				AND NOT ST_IsEmpty(geom)
				AND ST_GeometryType(geom) = 'ST_Polygon'
		`, strings.Join(unionPlaceholders, ","))

		// Combine geometry string with zone IDs for union query
		// Include ALL overlapping zones in the union (including the oldest one we're keeping)
		unionArgs := make([]interface{}, 0, len(overlappingIDs)+1)
		unionArgs = append(unionArgs, geometryString)
		unionArgs = append(unionArgs, unionIDs...)

		// Log input geometries for debugging
		log.Printf("[ZoneMerge] Merging %d geometries (new + %d existing)", 1, len(overlappingIDs))
		log.Printf("[ZoneMerge] New geometry (first 200 chars): %s", 
			func() string {
				if len(geometryString) > 200 {
					return geometryString[:200] + "..."
				}
				return geometryString
			}())
		
		// Log existing zone geometries
		for i, id := range overlappingIDs {
			var existingGeom sql.NullString
			if err := tx.QueryRow(`SELECT ST_AsGeoJSON(geometry)::TEXT FROM zones WHERE id = $1`, id).Scan(&existingGeom); err == nil && existingGeom.Valid {
				preview := existingGeom.String
				if len(preview) > 200 {
					preview = preview[:200] + "..."
				}
				log.Printf("[ZoneMerge] Existing zone %d geometry (first 200 chars): %s", id, preview)
			}
			_ = i // suppress unused warning
		}

		var mergedGeometryJSON sql.NullString
		if err := tx.QueryRow(unionQuery, unionArgs...).Scan(&mergedGeometryJSON); err != nil {
			log.Printf("[ZoneMerge] Union query failed: %v", err)
			log.Printf("[ZoneMerge] Query: %s", unionQuery)
			log.Printf("[ZoneMerge] Args count: %d", len(unionArgs))
			// Debug: Try to see what the geometry looks like after union but before wrapping
			var debugGeomType sql.NullString
			var debugIsValid sql.NullBool
			var debugMinX, debugMaxX sql.NullFloat64
			debugQuery := fmt.Sprintf(`
				WITH 
				constants AS (
					SELECT 264000000.0 AS ring_circ, 132000000.0 AS half_ring
				),
				all_raw_geoms AS (
					SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) AS geom
					UNION ALL
					SELECT ST_MakeValid(geometry) AS geom FROM zones WHERE id IN (%s)
				),
				all_with_spans AS (
					SELECT 
						geom,
						ST_XMax(geom) - ST_XMin(geom) AS span
					FROM all_raw_geoms
				),
				has_wrapped_geom AS (
					SELECT EXISTS(SELECT 1 FROM all_with_spans, constants WHERE span > constants.half_ring) AS wrapped
				),
				all_normalized AS (
					SELECT 
						CASE 
							WHEN (SELECT wrapped FROM has_wrapped_geom) THEN
								ST_MakePolygon(
									ST_MakeLine(
										ARRAY(
											SELECT 
												ST_MakePoint(
													CASE 
														WHEN ST_X((dp).geom) > (SELECT half_ring FROM constants) 
														THEN ST_X((dp).geom) - (SELECT ring_circ FROM constants)
														ELSE ST_X((dp).geom)
													END,
													ST_Y((dp).geom)
												)
											FROM ST_DumpPoints(ST_ExteriorRing(geom)) AS dp
										)
									)
								)
							ELSE
								geom
						END AS geom
					FROM all_with_spans
				),
				coord_bounds AS (
					SELECT 
						MIN(ST_XMin(geom)) AS min_x,
						MAX(ST_XMax(geom)) AS max_x
					FROM all_normalized
				),
				aligned_geoms AS (
					SELECT 
						ST_Translate(
							geom,
							-LEAST((SELECT min_x FROM coord_bounds), 0.0),
							0.0
						) AS geom
					FROM all_normalized
				),
				unioned AS (
					SELECT ST_Union(geom) AS merged_geom
					FROM aligned_geoms
				)
				SELECT 
					ST_GeometryType(merged_geom)::TEXT,
					ST_IsValid(merged_geom),
					ST_XMin(merged_geom),
					ST_XMax(merged_geom)
				FROM unioned
			`, strings.Join(unionPlaceholders, ","))
			if debugErr := tx.QueryRow(debugQuery, unionArgs...).Scan(&debugGeomType, &debugIsValid, &debugMinX, &debugMaxX); debugErr == nil {
				log.Printf("[ZoneMerge] Debug: union result - type: %v, valid: %v, X range: [%.2f, %.2f]", 
					debugGeomType.String, debugIsValid.Bool, debugMinX.Float64, debugMaxX.Float64)
			} else {
				log.Printf("[ZoneMerge] Debug query failed: %v", debugErr)
			}
			return nil, fmt.Errorf("failed to merge geometries: %w", err)
		}
		if !mergedGeometryJSON.Valid {
			return nil, fmt.Errorf("merged geometry is null")
		}
		
		// Log the merged geometry type and area for debugging
		// Also check if union resulted in MultiPolygon and log component count
		var mergedGeomType sql.NullString
		var mergedAreaCheck float64
		typeCheckQuery := `SELECT ST_GeometryType(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))::TEXT, ST_Area(normalize_zone_geometry_for_area(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)))`
		typeCheckErr := tx.QueryRow(typeCheckQuery, mergedGeometryJSON.String).Scan(&mergedGeomType, &mergedAreaCheck)
		if typeCheckErr != nil {
			// Log the error but don't fail - this is just for debugging
			log.Printf("[ZoneMerge] Warning: Could not check merged geometry type: %v", typeCheckErr)
		} else if mergedGeomType.Valid {
			log.Printf("[ZoneMerge] Merged geometry type: %s, area: %.2f", mergedGeomType.String, mergedAreaCheck)
			if mergedGeomType.String != "ST_Polygon" {
				log.Printf("[ZoneMerge] WARNING: Merged geometry is %s, expected ST_Polygon - union may have failed", mergedGeomType.String)
				if mergedGeomType.String == "ST_MultiPolygon" {
					var componentCount int
					countQuery := `SELECT COUNT(*) FROM (SELECT (ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))).geom) AS dump`
					if err := tx.QueryRow(countQuery, mergedGeometryJSON.String).Scan(&componentCount); err == nil {
						log.Printf("[ZoneMerge] MultiPolygon has %d components - geometries may not overlap in normalized coordinate space", componentCount)
					}
				}
			}
		} else {
			log.Printf("[ZoneMerge] Warning: Merged geometry type check returned NULL")
		}
		
		log.Printf("[ZoneMerge] Successfully merged %d zones into new geometry (result length: %d, type: %s)", 
			len(overlappingIDs)+1, len(mergedGeometryJSON.String), func() string {
				if mergedGeomType.Valid {
					return mergedGeomType.String
				}
				return "unknown"
			}())
		
		// Check if any geometry wraps around (spans > half ring) - this causes union issues
		const RING_CIRCUMFERENCE = 264000000.0
		const HALF_RING = 132000000.0
		var newGeomSpan, existingGeomSpan float64
		spanCheckQuery := `
			SELECT 
				ST_XMax(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) - ST_XMin(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) AS new_span,
				(SELECT ST_XMax(geometry) - ST_XMin(geometry) FROM zones WHERE id IN (%s) LIMIT 1) AS existing_span
		`
		spanCheckErr := tx.QueryRow(fmt.Sprintf(spanCheckQuery, strings.Join(unionPlaceholders, ",")), unionArgs...).Scan(&newGeomSpan, &existingGeomSpan)
		if spanCheckErr == nil {
			log.Printf("[ZoneMerge] Geometry spans: new=%.2f, existing=%.2f (ring=%.2f, half_ring=%.2f)", 
				newGeomSpan, existingGeomSpan, RING_CIRCUMFERENCE, HALF_RING)
			if newGeomSpan > HALF_RING || existingGeomSpan > HALF_RING {
				log.Printf("[ZoneMerge] WARNING: One or more geometries wrap around X-axis - PostGIS union may produce incorrect results")
			}
		}
		
		// Log merged geometry preview
		mergedPreview := mergedGeometryJSON.String
		if len(mergedPreview) > 300 {
			mergedPreview = mergedPreview[:300] + "..."
		}
		log.Printf("[ZoneMerge] Merged geometry (first 300 chars): %s", mergedPreview)
		
		// Log area comparison
		var newArea, mergedArea float64
		if err := tx.QueryRow(`SELECT ST_Area(normalize_zone_geometry_for_area(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)))`, geometryString).Scan(&newArea); err == nil {
			if err := tx.QueryRow(`SELECT ST_Area(normalize_zone_geometry_for_area(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)))`, mergedGeometryJSON.String).Scan(&mergedArea); err == nil {
				var existingAreas []float64
				// Build area query for all overlapping zones
				areaPlaceholders := make([]string, len(overlappingIDs))
				for i := range overlappingIDs {
					areaPlaceholders[i] = fmt.Sprintf("$%d", i+1)
				}
				areaQuery := fmt.Sprintf(`SELECT ST_Area(normalize_zone_geometry_for_area(geometry)) FROM zones WHERE id IN (%s)`, strings.Join(areaPlaceholders, ","))
				areaRows, _ := tx.Query(areaQuery, unionIDs...)
				if areaRows != nil {
					defer areaRows.Close()
					for areaRows.Next() {
						var area float64
						if areaRows.Scan(&area) == nil {
							existingAreas = append(existingAreas, area)
						}
					}
				}
				sumExisting := 0.0
				for _, area := range existingAreas {
					sumExisting += area
				}
				log.Printf("[ZoneMerge] Area comparison: new=%.2f, existing sum=%.2f, merged=%.2f (merged should be >= max of new/existing, less than sum if they overlap)", 
					newArea, sumExisting, mergedArea)
			}
		}

		// Delete overlapping zones EXCEPT the oldest one (we're keeping that one)
		zonesToDelete := make([]int64, 0, len(overlappingIDs))
		for _, id := range overlappingIDs {
			if id != oldestZoneID {
				zonesToDelete = append(zonesToDelete, id)
			}
		}
		
		if len(zonesToDelete) > 0 {
			deletePlaceholdersForDelete := make([]string, len(zonesToDelete))
			deleteArgsForDelete := make([]interface{}, len(zonesToDelete))
			for i, id := range zonesToDelete {
				deletePlaceholdersForDelete[i] = fmt.Sprintf("$%d", i+1)
				deleteArgsForDelete[i] = id
			}
			deleteQuery := fmt.Sprintf(`DELETE FROM zones WHERE id IN (%s)`, strings.Join(deletePlaceholdersForDelete, ","))
			if _, err := tx.Exec(deleteQuery, deleteArgsForDelete...); err != nil {
				return nil, fmt.Errorf("failed to delete overlapping zones: %w", err)
			}
			log.Printf("[ZoneMerge] Deleted %d overlapping zones: %v", len(zonesToDelete), zonesToDelete)
		}

		// Update the oldest zone's geometry to the merged geometry
		// Keep the original zone's name, properties, metadata, etc.
		updateQuery := `
			UPDATE zones
			SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 0),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $2
			RETURNING id, name, zone_type, floor, owner_id, is_system_zone,
			          properties, metadata, ST_AsGeoJSON(geometry), ST_Area(normalize_zone_geometry_for_area(geometry)),
			          created_at, updated_at
		`

		row := tx.QueryRow(
			updateQuery,
			mergedGeometryJSON.String,
			oldestZoneID,
		)

		zone, err := scanZone(row)
		if err != nil {
			return nil, fmt.Errorf("failed to update merged zone: %w", err)
		}
		
		log.Printf("[ZoneMerge] Updated zone %d with merged geometry (area: %f)", zone.ID, zone.Area)

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
