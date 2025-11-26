package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/earthring/server/internal/ringmap"
	"github.com/lib/pq"
)

const (
	// RingCircumference is the circumference of the EarthRing in meters (264,000 km)
	RingCircumference = 264000000.0
)

// wrapCoordinate wraps a single X coordinate to [0, RingCircumference)
func wrapCoordinate(x float64) float64 {
	// Use modulo arithmetic to wrap coordinate
	// Add RingCircumference before modulo to handle negative values correctly
	wrapped := math.Mod(math.Mod(x, RingCircumference)+RingCircumference, RingCircumference)
	return wrapped
}

// wrapGeoJSONCoordinates wraps all X coordinates in a GeoJSON geometry to [0, RingCircumference)
func wrapGeoJSONCoordinates(geom json.RawMessage) (json.RawMessage, error) {
	var geomData map[string]interface{}
	if err := json.Unmarshal(geom, &geomData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal geometry: %w", err)
	}

	// Recursively wrap coordinates
	var wrapCoords func(interface{}) interface{}
	wrapCoords = func(v interface{}) interface{} {
		switch val := v.(type) {
		case []interface{}:
			// Check if this is a coordinate pair [x, y] or nested array
			if len(val) == 2 {
				if x, ok := val[0].(float64); ok {
					if _, ok := val[1].(float64); ok {
						// This is a coordinate pair [x, y]
						return []interface{}{wrapCoordinate(x), val[1]}
					}
				}
			}
			// Nested array - recurse
			result := make([]interface{}, len(val))
			for i, item := range val {
				result[i] = wrapCoords(item)
			}
			return result
		default:
			return val
		}
	}

	// Wrap coordinates in the geometry
	if coords, ok := geomData["coordinates"]; ok {
		geomData["coordinates"] = wrapCoords(coords)
	}

	// Marshal back to JSON
	wrappedJSON, err := json.Marshal(geomData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal wrapped geometry: %w", err)
	}

	return json.RawMessage(wrappedJSON), nil
}

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
//
// IMPORTANT: Player-created zones always claim the space the player selected,
// even if that area overlaps with other zones. The newly created zone takes
// precedence in overlap areas, ensuring player intent is respected.
func (s *ZoneStorage) CreateZone(input *ZoneCreateInput) (*Zone, error) {
	if input == nil {
		return nil, fmt.Errorf("input cannot be nil")
	}
	if err := validateZoneInput(*input); err != nil {
		return nil, err
	}

	geometryString := string(input.Geometry)

	// STEP 1: Find ALL overlapping zones (any type/owner) to implement conflict resolution
	// Player-created zones always claim their selected space, so we need to subtract
	// the new zone from any overlapping zones of different type/owner.
	allOverlapQuery := `
		WITH 
		new_geom AS (
			SELECT normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 0)) AS geom
		),
		existing_zones AS (
			SELECT 
				id,
				zone_type,
				owner_id,
				is_system_zone,
				normalize_for_intersection(geometry) AS normalized_geom
			FROM zones
			WHERE floor = $2
			  AND normalize_for_intersection(geometry) IS NOT NULL
		),
		all_bounds AS (
			SELECT 
				LEAST(
					COALESCE((SELECT ST_XMin(geom) FROM new_geom WHERE geom IS NOT NULL), 999999999),
					COALESCE((SELECT MIN(ST_XMin(normalized_geom)) FROM existing_zones WHERE normalized_geom IS NOT NULL), 999999999)
				) AS global_min_x
		),
		aligned_geoms AS (
			SELECT 
				ez.id,
				ez.zone_type,
				ez.owner_id,
				ez.is_system_zone,
				ST_Translate(
					ez.normalized_geom,
					-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0
				) AS aligned_existing,
				ST_Translate(
					(SELECT geom FROM new_geom),
					-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0
				) AS aligned_new
			FROM existing_zones ez
			CROSS JOIN new_geom
			CROSS JOIN all_bounds
		)
		SELECT id, zone_type, owner_id, is_system_zone
		FROM aligned_geoms
		WHERE aligned_existing IS NOT NULL
		  AND aligned_new IS NOT NULL
		  AND ST_Intersects(aligned_existing, aligned_new)
	`

	var owner sql.NullInt64
	if input.OwnerID != nil {
		owner = sql.NullInt64{Int64: *input.OwnerID, Valid: true}
	}

	// Find all overlapping zones
	allOverlapRows, err := s.db.Query(allOverlapQuery, geometryString, input.Floor)
	if err != nil {
		log.Printf("[ZoneConflict] ERROR: All-overlap query failed: %v", err)
		// Check if error is due to missing function
		errStr := err.Error()
		if strings.Contains(errStr, "normalize_for_intersection") && strings.Contains(errStr, "does not exist") {
			log.Printf("[ZoneConflict] CRITICAL: normalize_for_intersection function does not exist in database!")
			log.Printf("[ZoneConflict] This function is required for overlap detection. Run migration 000016.")
			return nil, fmt.Errorf("database function normalize_for_intersection does not exist - run migrations: %w", err)
		}
		return nil, fmt.Errorf("failed to query all overlapping zones: %w", err)
	}
	defer func() {
		if closeErr := allOverlapRows.Close(); closeErr != nil {
			log.Printf("Failed to close all-overlap rows: %v", closeErr)
		}
	}()

	type OverlappingZone struct {
		ID           int64
		ZoneType     string
		OwnerID      sql.NullInt64
		IsSystemZone bool
	}

	var allOverlappingZones []OverlappingZone
	for allOverlapRows.Next() {
		var oz OverlappingZone
		if err := allOverlapRows.Scan(&oz.ID, &oz.ZoneType, &oz.OwnerID, &oz.IsSystemZone); err != nil {
			return nil, fmt.Errorf("failed to scan overlapping zone: %w", err)
		}
		allOverlappingZones = append(allOverlappingZones, oz)
	}
	if err := allOverlapRows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate all overlapping zones: %w", err)
	}

	log.Printf("[ZoneConflict] Found %d total overlapping zones (any type/owner)", len(allOverlappingZones))

	// STEP 2: Separate overlapping zones into merge candidates and conflict zones
	// Merge candidates: same type AND same owner (will be merged with new zone)
	// Conflict zones: different type OR different owner (will have new zone subtracted from them)
	var mergeCandidateIDs []int64
	var conflictZoneIDs []int64

	for _, oz := range allOverlappingZones {
		sameType := oz.ZoneType == input.ZoneType
		sameOwner := (oz.OwnerID.Valid == (input.OwnerID != nil)) &&
			(!oz.OwnerID.Valid || (input.OwnerID != nil && oz.OwnerID.Int64 == *input.OwnerID))
		sameSystem := oz.IsSystemZone == input.IsSystemZone

		if sameType && sameOwner && sameSystem {
			mergeCandidateIDs = append(mergeCandidateIDs, oz.ID)
		} else {
			conflictZoneIDs = append(conflictZoneIDs, oz.ID)
		}
	}

	log.Printf("[ZoneConflict] Merge candidates (same type/owner): %d zones", len(mergeCandidateIDs))
	log.Printf("[ZoneConflict] Conflict zones (different type/owner): %d zones", len(conflictZoneIDs))

	// STEP 3: Subtract new zone from conflict zones (different type/owner)
	// This implements the "player zones always claim their space" rule
	if len(conflictZoneIDs) > 0 {
		// Only subtract from zones owned by the same user (players can't claim space from other players' zones)
		// System zones are protected and cannot be claimed
		if input.OwnerID != nil {
			for _, conflictZoneID := range conflictZoneIDs {
				conflictZone, err := s.GetZoneByID(conflictZoneID)
				if err != nil {
					log.Printf("[ZoneConflict] WARNING: Failed to get conflict zone %d: %v", conflictZoneID, err)
					continue
				}
				if conflictZone == nil {
					log.Printf("[ZoneConflict] WARNING: Conflict zone %d not found", conflictZoneID)
					continue
				}

				// Skip system zones - they cannot be claimed
				if conflictZone.IsSystemZone {
					log.Printf("[ZoneConflict] Skipping system zone %d - system zones cannot be claimed", conflictZoneID)
					continue
				}

				// Only subtract if the conflict zone is owned by the same user
				// (Players can claim space from their own zones of different types)
				if conflictZone.OwnerID != nil && *conflictZone.OwnerID == *input.OwnerID {
					log.Printf("[ZoneConflict] Subtracting new zone from conflict zone %d (same owner, different type)", conflictZoneID)
					_, err := s.subtractDezoneFromZone(conflictZoneID, input.Geometry)
					if err != nil {
						log.Printf("[ZoneConflict] WARNING: Failed to subtract new zone from conflict zone %d: %v", conflictZoneID, err)
						// Continue with other zones even if one fails
						continue
					}
					log.Printf("[ZoneConflict] Successfully subtracted new zone from conflict zone %d", conflictZoneID)
				} else {
					log.Printf("[ZoneConflict] Skipping conflict zone %d - owned by different user (cannot claim space from other players)", conflictZoneID)
				}
			}
		} else {
			log.Printf("[ZoneConflict] New zone has no owner - skipping conflict resolution (only player zones can claim space)")
		}
	}

	// STEP 4: Continue with existing merge logic for same type/owner zones
	// Start with the merge candidates we found, then find transitive overlaps
	// (If A overlaps B and B overlaps C, all three should merge together)
	var overlappingIDs []int64
	if len(mergeCandidateIDs) > 0 {
		// Start with the merge candidates we already found
		overlappingIDs = make([]int64, 0, len(mergeCandidateIDs)*2) // Pre-allocate with headroom for transitive overlaps
		overlappingIDs = append(overlappingIDs, mergeCandidateIDs...)
		log.Printf("[ZoneMerge] Starting with %d merge candidates, finding transitive overlaps...", len(mergeCandidateIDs))

		// Keep expanding the set until no new overlapping zones are found
		// This finds the transitive closure: if A overlaps B and B overlaps C, we find C
		for {
			expanded := false
			// Check each zone in the current set against all other zones of the same type/floor/owner
			// Use the current overlappingIDs set (which grows each iteration)
			expandQuery := `
				WITH 
				current_set AS (
					SELECT id, geometry FROM zones WHERE id = ANY($1::bigint[])
				),
				all_zones AS (
					SELECT id, geometry
					FROM zones
					WHERE floor = $2
					  AND zone_type = $3
					  AND owner_id IS NOT DISTINCT FROM $4
					  AND is_system_zone = $5
					  AND id != ALL($1::bigint[])
					  AND normalize_for_intersection(geometry) IS NOT NULL
				),
				current_normalized AS (
					SELECT id, normalize_for_intersection(geometry) AS normalized_geom
					FROM current_set
				),
				all_normalized AS (
					SELECT id, normalize_for_intersection(geometry) AS normalized_geom
					FROM all_zones
				),
				all_bounds AS (
					SELECT 
						LEAST(
							COALESCE((SELECT MIN(ST_XMin(normalized_geom)) FROM current_normalized), 999999999),
							COALESCE((SELECT MIN(ST_XMin(normalized_geom)) FROM all_normalized), 999999999)
						) AS global_min_x
				),
				aligned_geoms AS (
					SELECT 
						cz.id AS current_id,
						az.id AS other_id,
						ST_Translate(
							cz.normalized_geom,
							-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
							0
						) AS aligned_current,
						ST_Translate(
							az.normalized_geom,
							-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
							0
						) AS aligned_other
					FROM current_normalized cz
					CROSS JOIN all_normalized az
					CROSS JOIN all_bounds
				)
				SELECT DISTINCT other_id
				FROM aligned_geoms
				WHERE aligned_current IS NOT NULL
				  AND aligned_other IS NOT NULL
				  AND ST_Intersects(aligned_current, aligned_other)
			`

			var newOverlappingIDs []int64
			expandRows, err := s.db.Query(expandQuery,
				pq.Array(overlappingIDs), input.Floor, input.ZoneType, owner, input.IsSystemZone)
			if err == nil {
				defer func() {
					if closeErr := expandRows.Close(); closeErr != nil {
						log.Printf("Error closing expandRows: %v", closeErr)
					}
				}()
				for expandRows.Next() {
					var id int64
					if err := expandRows.Scan(&id); err == nil {
						// Check if this ID is already in our set
						found := false
						for _, existingID := range overlappingIDs {
							if existingID == id {
								found = true
								break
							}
						}
						if !found {
							newOverlappingIDs = append(newOverlappingIDs, id)
							expanded = true
						}
					}
				}
			} else {
				log.Printf("[ZoneMerge] WARNING: Failed to expand overlap set: %v", err)
				break
			}

			if !expanded {
				break
			}

			// Add newly found overlapping zones to the set
			overlappingIDs = append(overlappingIDs, newOverlappingIDs...)
		}

		if len(overlappingIDs) > len(mergeCandidateIDs) {
			log.Printf("[ZoneMerge] Expanded overlap set: initial candidates=%d, full connected set=%d",
				len(mergeCandidateIDs), len(overlappingIDs))
		}
	} else {
		// No merge candidates - new zone will be created without merging
		overlappingIDs = []int64{}
		log.Printf("[ZoneMerge] No merge candidates - new zone will be created without merging")
	}

	if len(overlappingIDs) > 0 {
		log.Printf("[ZoneMerge] Found %d overlapping zones to merge: %v", len(overlappingIDs), overlappingIDs)
	} else {
		log.Printf("[ZoneMerge] No overlapping zones found - will create new zone")
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
		log.Printf("[ZoneMerge] Will merge ALL %d overlapping zones together (including oldest zone %d)", len(overlappingIDs), oldestZoneID)
		if len(overlappingIDs) > 1 {
			log.Printf("[ZoneMerge] NOTE: Merging %d zones into one. Zones %v will be deleted, zone %d will contain the merged geometry.",
				len(overlappingIDs), func() []int64 {
					toDelete := make([]int64, 0, len(overlappingIDs)-1)
					for _, id := range overlappingIDs {
						if id != oldestZoneID {
							toDelete = append(toDelete, id)
						}
					}
					return toDelete
				}(), oldestZoneID)
		}

		// Build placeholders for union query
		// We need to include all overlapping zone IDs in the union, plus the new geometry
		// CRITICAL: ALL overlapping zones are included in the union, not just one!
		// This ensures that if a new zone overlaps 2 existing zones, all 3 are merged together
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
		committed := false
		defer func() {
			if !committed {
				if rollbackErr := tx.Rollback(); rollbackErr != nil {
					log.Printf("Error rolling back transaction: %v", rollbackErr)
				}
			}
		}()

		// Build query to merge new geometry with all overlapping zones using ST_Union
		//
		// WRAPPING APPROACH - Per-geometry normalization with hole detection
		//
		// CRITICAL: normalize_zone_geometry_for_area does NOT handle polygons with holes!
		// The unionQuery uses normalize_for_intersection which properly handles
		// polygons with holes by processing each ring (outer and inner) separately.
		// This allows wrapped geometries with holes to be correctly normalized and merged.
		//
		// Steps:
		// 1. Load and validate all geometries
		// 2. Detect if each geometry wraps (span > half_ring OR max_x > half_ring)
		// 3. Normalize wrapped geometries using normalize_for_intersection (preserves holes)
		// 4. Align all geometries to positive coordinate space
		// 5. Perform union in aligned space
		// 6. Shift back and wrap to [0, 264000000) range
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
			-- Step 2: Detect if EACH geometry wraps
			-- normalize_for_intersection properly handles polygons with holes
			all_with_spans AS (
				SELECT 
					geom,
					ST_XMax(geom) - ST_XMin(geom) AS span,
					ST_NumInteriorRings(geom) AS num_holes
				FROM all_raw_geoms
			),
			-- Step 3: For EACH wrapped geometry, normalize it using normalize_for_intersection
			-- This approach properly handles polygons with holes by processing each ring separately
						all_normalized AS (
							SELECT 
								CASE 
									-- Also normalize if max_x > half_ring (stored with wrapped coordinates, like merged zones)
									WHEN span > (SELECT half_ring FROM constants) OR ST_XMax(geom) > (SELECT half_ring FROM constants) THEN
										-- Wrapped geometry - use normalize_for_intersection which handles holes correctly 
										-- Validate the normalized result before using it
										CASE
											WHEN normalize_for_intersection(geom) IS NULL THEN geom
											WHEN NOT ST_IsValid(normalize_for_intersection(geom)) THEN geom
											WHEN ST_IsEmpty(normalize_for_intersection(geom)) THEN geom
											WHEN ST_GeometryType(normalize_for_intersection(geom)) NOT IN ('ST_Polygon', 'ST_MultiPolygon') THEN geom
											ELSE normalize_for_intersection(geom)
										END
									ELSE
										-- Not wrapped - leave it alone
										geom
								END AS geom
							FROM all_with_spans
						),
						-- Filter out NULL and invalid geometries before union (they can't be unioned)
						all_normalized_filtered AS (
							SELECT geom 
							FROM all_normalized 
							WHERE geom IS NOT NULL
							  AND ST_IsValid(geom)
							  AND NOT ST_IsEmpty(geom)
							  AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
						),
						-- Step 3: Find coordinate space boundaries after normalization
						-- Ensure we have at least one valid geometry before proceeding
						coord_bounds AS (
							SELECT 
								COALESCE(MIN(ST_XMin(geom)), 0.0) AS min_x,
								COALESCE(MAX(ST_XMax(geom)), 0.0) AS max_x
							FROM all_normalized_filtered
							HAVING COUNT(*) > 0
						),
						-- Step 4: Shift all geometries into positive coordinate space for union
						-- The shift amount is calculated to move the leftmost point to X=0
						aligned_geoms AS (
							SELECT 
								ST_Translate(
									geom,
									-- Shift by -min_x to move leftmost point to 0
									-COALESCE(LEAST((SELECT min_x FROM coord_bounds), 0.0), 0.0),
									0.0
								) AS geom
							FROM all_normalized_filtered
							CROSS JOIN coord_bounds
						),
						-- Step 5: Ensure all geometries are polygons (convert MultiPolygon to largest polygon if needed)
						polygon_geoms AS (
							SELECT 
								CASE
									WHEN ST_GeometryType(geom) = 'ST_MultiPolygon' THEN
										-- Take largest polygon from MultiPolygon
										(SELECT (ST_Dump(geom)).geom AS g
										 ORDER BY ST_Area((ST_Dump(geom)).geom) DESC
										 LIMIT 1)
									ELSE
										geom
								END AS geom
							FROM aligned_geoms
							WHERE ST_IsValid(geom) AND NOT ST_IsEmpty(geom)
						),
						-- Step 6: Union all aligned geometries
						unioned AS (
							SELECT ST_Union(geom) AS merged_geom
							FROM polygon_geoms
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
						-- Step 10: Wrap coordinates to [0, 264000000) range using modulo arithmetic
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
						-- Step 11: Validate and ensure clean geometry structure
			validated AS (
				SELECT ST_MakeValid(geom) AS geom
				FROM wrapped
			)
			-- Step 12: Convert to GeoJSON
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
		log.Printf("[ZoneMerge] Zones being merged: new zone (not yet in DB) + existing zones %v", overlappingIDs)
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
						ST_XMax(geom) - ST_XMin(geom) AS span,
						ST_NumInteriorRings(geom) AS num_holes
					FROM all_raw_geoms
				),
				all_normalized AS (
					SELECT 
						CASE 
							WHEN span > (SELECT half_ring FROM constants) THEN
								-- Wrapped geometry - normalize using ST_DumpRings to preserve holes
								(
									WITH 
									geom_to_normalize AS (
										SELECT geom AS g
									),
									rings AS (
										SELECT 
											(ST_DumpRings((SELECT g FROM geom_to_normalize))).path[1] AS ring_index,
											(ST_DumpRings((SELECT g FROM geom_to_normalize))).geom AS ring_geom
									),
									shifted_rings AS (
										SELECT 
											ring_index,
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
		log.Printf("[ZoneMerge] Merged result includes: new zone + existing zones %v (all %d zones)",
			overlappingIDs, len(overlappingIDs)+1)

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
				areaRows, err := tx.Query(areaQuery, unionIDs...)
				if err != nil {
					log.Printf("Error querying area: %v", err)
				} else if areaRows != nil {
					defer func() {
						if closeErr := areaRows.Close(); closeErr != nil {
							log.Printf("Error closing areaRows: %v", closeErr)
						}
					}()
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
		committed = true

		return zone, nil
	}

	// No overlapping zones, create normally
	// DEBUG: Log geometry structure before insert
	var geomDebug map[string]interface{}
	if err := json.Unmarshal([]byte(geometryString), &geomDebug); err == nil {
		if coords, ok := geomDebug["coordinates"].([]interface{}); ok {
			log.Printf("[ZoneCreate] Geometry structure: type=%s, ring_count=%d",
				geomDebug["type"], len(coords))
			for i, ring := range coords {
				if ringArray, ok := ring.([]interface{}); ok {
					log.Printf("[ZoneCreate]   Ring %d: %d points", i, len(ringArray))
				}
			}
		}
	}

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

// SubtractDezoneFromAllOverlapping finds all zones that overlap with the dezone geometry
// and subtracts the dezone from each of them. This is an "anti-merge" operation.
func (s *ZoneStorage) SubtractDezoneFromAllOverlapping(floor int, dezoneGeometry json.RawMessage, userID int64) ([]*Zone, error) {
	dezoneGeometryString := string(dezoneGeometry)

	// Find all zones on the same floor that overlap with the dezone geometry
	// Unlike normal zone merging, dezone subtracts from ANY zone type it overlaps
	overlapQuery := `
		WITH 
		dezone_geom AS (
			SELECT normalize_for_intersection(ST_SetSRID(ST_GeomFromGeoJSON($2), 0)) AS geom
		),
		existing_zones AS (
			SELECT 
				id,
				normalize_for_intersection(geometry) AS normalized_geom
			FROM zones
			WHERE floor = $1
			  AND normalize_for_intersection(geometry) IS NOT NULL
		),
		all_bounds AS (
			SELECT 
				LEAST(
					COALESCE((SELECT ST_XMin(geom) FROM dezone_geom WHERE geom IS NOT NULL), 999999999),
					COALESCE((SELECT MIN(ST_XMin(normalized_geom)) FROM existing_zones WHERE normalized_geom IS NOT NULL), 999999999)
				) AS global_min_x
		),
		aligned_geoms AS (
			SELECT 
				ez.id,
				ST_Translate(
					ez.normalized_geom,
					-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0
				) AS aligned_existing,
				ST_Translate(
					(SELECT geom FROM dezone_geom),
					-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0
				) AS aligned_dezone
			FROM existing_zones ez
			CROSS JOIN dezone_geom
			CROSS JOIN all_bounds
		)
		SELECT id
		FROM aligned_geoms
		WHERE aligned_existing IS NOT NULL
		  AND aligned_dezone IS NOT NULL
		  AND ST_Intersects(aligned_existing, aligned_dezone)
	`

	rows, err := s.db.Query(overlapQuery, floor, dezoneGeometryString)
	if err != nil {
		return nil, fmt.Errorf("failed to find overlapping zones: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Error closing rows: %v", closeErr)
		}
	}()

	var overlappingZoneIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan overlapping zone ID: %w", err)
		}
		overlappingZoneIDs = append(overlappingZoneIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate overlapping zones: %w", err)
	}

	if len(overlappingZoneIDs) == 0 {
		log.Printf("[Dezone] No overlapping zones found - nothing to subtract")
		return []*Zone{}, nil
	}

	log.Printf("[Dezone] Found %d overlapping zones to subtract from: %v", len(overlappingZoneIDs), overlappingZoneIDs)

	// Subtract dezone from each overlapping zone
	var updatedZones []*Zone
	for _, zoneID := range overlappingZoneIDs {
		// Verify ownership (user must own the zone to modify it)
		zone, err := s.GetZoneByID(zoneID)
		if err != nil {
			log.Printf("[Dezone] WARNING: Failed to get zone %d: %v", zoneID, err)
			continue
		}
		if zone == nil {
			log.Printf("[Dezone] WARNING: Zone %d not found", zoneID)
			continue
		}

		// Check ownership - user must own the zone to modify it
		if zone.OwnerID == nil || *zone.OwnerID != userID {
			log.Printf("[Dezone] WARNING: Permission denied - user %d does not own zone %d", userID, zoneID)
			continue
		}

		// Subtract dezone from this zone
		log.Printf("[Dezone] Attempting to subtract dezone from zone %d", zoneID)
		resultZones, err := s.subtractDezoneFromZone(zoneID, dezoneGeometry)
		if err != nil {
			log.Printf("[Dezone] WARNING: Failed to subtract dezone from zone %d: %v", zoneID, err)
			log.Printf("[Dezone] Error details: %+v", err)
			continue
		}
		log.Printf("[Dezone] Successfully subtracted dezone from zone %d (resulted in %d zones)", zoneID, len(resultZones))

		updatedZones = append(updatedZones, resultZones...)
	}

	log.Printf("[Dezone] Successfully subtracted dezone from %d zones", len(updatedZones))
	return updatedZones, nil
}

// subtractDezoneFromZone subtracts a dezone geometry from a specific zone using ST_Difference.
// Returns a slice of zones: the first is the updated original zone, and any additional ones
// are new zones created from split components (when a zone is bisected).
// Note: Ownership is already verified by the caller (SubtractDezoneFromAllOverlapping).
func (s *ZoneStorage) subtractDezoneFromZone(targetZoneID int64, dezoneGeometry json.RawMessage) ([]*Zone, error) {
	dezoneGeometryString := string(dezoneGeometry)

	// Get the original zone to copy its properties for new zones
	originalZone, err := s.GetZoneByID(targetZoneID)
	if err != nil {
		return nil, fmt.Errorf("failed to get original zone: %w", err)
	}
	if originalZone == nil {
		return nil, fmt.Errorf("zone %d not found", targetZoneID)
	}

	// Use ST_Difference to subtract the dezone from the target zone
	// This handles wrap-point normalization similar to the union query
	// Returns all polygons if the zone is split (MultiPolygon result)
	differenceQuery := `
		WITH 
		constants AS (
			SELECT 264000000.0 AS ring_circ, 132000000.0 AS half_ring
		),
		-- Step 1: Load and validate both geometries
		target_geom AS (
			SELECT ST_MakeValid(geometry) AS geom FROM zones WHERE id = $1
		),
		dezone_geom AS (
			SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2), 0)) AS geom
		),
		-- Step 2: Normalize both geometries for wrap-point handling
		-- Validate normalization results and fall back to original if normalization fails
		target_normalized AS (
			SELECT 
				CASE 
					WHEN ST_XMax(geom) - ST_XMin(geom) > (SELECT half_ring FROM constants) 
					     OR ST_XMax(geom) > (SELECT half_ring FROM constants) THEN
						CASE
							WHEN normalize_for_intersection(geom) IS NULL THEN geom
							WHEN NOT ST_IsValid(normalize_for_intersection(geom)) THEN geom
							WHEN ST_IsEmpty(normalize_for_intersection(geom)) THEN geom
							ELSE normalize_for_intersection(geom)
						END
					ELSE
						geom
				END AS geom
			FROM target_geom
		),
		dezone_normalized AS (
			SELECT 
				CASE 
					WHEN ST_XMax(geom) - ST_XMin(geom) > (SELECT half_ring FROM constants) 
					     OR ST_XMax(geom) > (SELECT half_ring FROM constants) THEN
						CASE
							WHEN normalize_for_intersection(geom) IS NULL THEN geom
							WHEN NOT ST_IsValid(normalize_for_intersection(geom)) THEN geom
							WHEN ST_IsEmpty(normalize_for_intersection(geom)) THEN geom
							ELSE normalize_for_intersection(geom)
						END
					ELSE
						geom
				END AS geom
			FROM dezone_geom
		),
		-- Filter out NULL geometries before alignment
		valid_geoms AS (
			SELECT 
				tg.geom AS target,
				dg.geom AS dezone
			FROM target_normalized tg
			CROSS JOIN dezone_normalized dg
			WHERE tg.geom IS NOT NULL
			  AND dg.geom IS NOT NULL
			  AND ST_IsValid(tg.geom)
			  AND ST_IsValid(dg.geom)
			  AND NOT ST_IsEmpty(tg.geom)
			  AND NOT ST_IsEmpty(dg.geom)
		),
		-- Step 3: Align both geometries to common coordinate space
		all_bounds AS (
			SELECT 
				LEAST(
					COALESCE((SELECT ST_XMin(target) FROM valid_geoms WHERE target IS NOT NULL), 999999999),
					COALESCE((SELECT ST_XMin(dezone) FROM valid_geoms WHERE dezone IS NOT NULL), 999999999)
				) AS global_min_x
		),
		aligned_target AS (
			SELECT 
				ST_Translate(
					target,
					-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0.0
				) AS geom
			FROM valid_geoms
			CROSS JOIN all_bounds
		),
		aligned_dezone AS (
			SELECT 
				ST_Translate(
					dezone,
					-(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0.0
				) AS geom
			FROM valid_geoms
			CROSS JOIN all_bounds
		),
		-- Step 4: Perform difference operation
		differenced AS (
			SELECT ST_Difference(
				(SELECT geom FROM aligned_target),
				(SELECT geom FROM aligned_dezone)
			) AS geom
		),
		-- Step 5: Shift back to original coordinate space
		shifted_back AS (
			SELECT 
				ST_Translate(
					geom,
					(SELECT COALESCE(global_min_x, 0) FROM all_bounds),
					0.0
				) AS geom
			FROM differenced
			CROSS JOIN all_bounds
		),
		-- Step 6: Wrap coordinates to [0, 264000000) range
		wrapped AS (
			SELECT 
				CASE 
					WHEN ST_XMin(geom) < 0 THEN
						ST_Translate(geom, 264000000.0, 0.0)
					WHEN ST_XMax(geom) >= 264000000 THEN
						ST_Translate(geom, -264000000.0, 0.0)
					ELSE
						geom
				END AS geom
			FROM shifted_back
		),
		-- Step 7: Validate result
		validated AS (
			SELECT ST_MakeValid(geom) AS geom
			FROM wrapped
		),
		-- Step 8: Dump all polygons from result (handles both Polygon and MultiPolygon)
		-- If the zone is bisected, ST_Difference returns MultiPolygon with multiple components
		-- We want to create separate zones for each component
		dumped_polygons AS (
			SELECT 
				(ST_Dump(geom)).geom AS geom
			FROM validated
			WHERE ST_IsValid(geom)
				AND NOT ST_IsEmpty(geom)
				AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
		),
		-- Step 9: Filter to only valid polygons and convert to GeoJSON
		valid_polygons AS (
			SELECT 
				ST_AsGeoJSON(geom, 15, 0)::TEXT AS geom_json
			FROM dumped_polygons
			WHERE ST_IsValid(geom)
				AND NOT ST_IsEmpty(geom)
				AND ST_GeometryType(geom) = 'ST_Polygon'
			ORDER BY ST_Area(geom) DESC  -- Largest first
		)
		-- Return all polygons (may be multiple rows if zone was split)
		SELECT geom_json FROM valid_polygons
	`

	// Query may return multiple rows if the zone was split into multiple components
	rows, err := s.db.Query(differenceQuery, targetZoneID, dezoneGeometryString)
	if err != nil {
		log.Printf("[Dezone] Subtraction query failed for zone %d: %v", targetZoneID, err)
		return nil, fmt.Errorf("failed to subtract dezone: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("Error closing rows: %v", closeErr)
		}
	}()

	// Collect all resulting geometries
	var resultGeometries []json.RawMessage
	for rows.Next() {
		var geomJSON sql.NullString
		if err := rows.Scan(&geomJSON); err != nil {
			log.Printf("[Dezone] Failed to scan geometry result: %v", err)
			continue
		}
		if !geomJSON.Valid || geomJSON.String == "" {
			continue
		}
		resultGeometries = append(resultGeometries, json.RawMessage(geomJSON.String))
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating geometry results: %w", err)
	}

	if len(resultGeometries) == 0 {
		log.Printf("[Dezone] Subtraction returned no valid geometries for zone %d - zone completely removed, deleting", targetZoneID)
		// Zone is completely removed by dezone - delete it
		if err := s.DeleteZone(targetZoneID); err != nil {
			return nil, fmt.Errorf("failed to delete completely removed zone: %w", err)
		}
		// Return empty slice to indicate zone was deleted
		return []*Zone{}, nil
	}

	log.Printf("[Dezone] Zone %d split into %d components", targetZoneID, len(resultGeometries))

	// Update the original zone with the first (largest) component
	// Wrap coordinates to ensure they're within [0, 264000000) range
	wrappedFirstGeometry, err := wrapGeoJSONCoordinates(resultGeometries[0])
	if err != nil {
		return nil, fmt.Errorf("failed to wrap coordinates for updated zone: %w", err)
	}

	updateInput := ZoneUpdateInput{
		Geometry: &wrappedFirstGeometry,
	}

	updatedZone, err := s.UpdateZone(targetZoneID, updateInput)
	if err != nil {
		return nil, fmt.Errorf("failed to update zone after dezone subtraction: %w", err)
	}

	resultZones := []*Zone{updatedZone}

	// Create new zones for any additional components (zone was split)
	for i := 1; i < len(resultGeometries); i++ {
		// Wrap coordinates to ensure they're within [0, 264000000) range
		wrappedGeometry, err := wrapGeoJSONCoordinates(resultGeometries[i])
		if err != nil {
			log.Printf("[Dezone] WARNING: Failed to wrap coordinates for split component %d: %v", i, err)
			continue
		}

		newZoneInput := &ZoneCreateInput{
			Name:         fmt.Sprintf("%s (Split %d)", originalZone.Name, i),
			ZoneType:     originalZone.ZoneType,
			Floor:        originalZone.Floor,
			OwnerID:      originalZone.OwnerID,
			IsSystemZone: originalZone.IsSystemZone,
			Geometry:     wrappedGeometry,
			Properties:   originalZone.Properties,
			Metadata:     originalZone.Metadata,
		}

		newZone, err := s.CreateZone(newZoneInput)
		if err != nil {
			log.Printf("[Dezone] WARNING: Failed to create new zone for split component %d: %v", i, err)
			continue
		}

		log.Printf("[Dezone] Created new zone %d for split component %d", newZone.ID, i)
		resultZones = append(resultZones, newZone)
	}

	return resultZones, nil
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
		// Allow floors from -2 to +2 (main ring structure)
		if *input.Floor < -2 || *input.Floor > 2 {
			return nil, fmt.Errorf("zone floor must be between -2 and 2, got %d", *input.Floor)
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

// RecreateDefaultZones recreates the default system zones (e.g., maglev transit zones).
// This should be called after TRUNCATE to restore default zones.
func (s *ZoneStorage) RecreateDefaultZones() error {
	query := `
		INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
		VALUES
		  -- Floor -2
		  (
		    'Maglev Transit Zone (Floor -2)',
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
		    -2,
		    NULL,
		    TRUE,
		    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
		    '{"default_zone": true, "maglev_zone": true}'::jsonb
		  ),
		  -- Floor -1
		  (
		    'Maglev Transit Zone (Floor -1)',
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
		    -1,
		    NULL,
		    TRUE,
		    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
		    '{"default_zone": true, "maglev_zone": true}'::jsonb
		  ),
		  -- Floor 0 (primary floor with maglev rail)
		  (
		    'Maglev Transit Zone (Floor 0)',
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
		    0,
		    NULL,
		    TRUE,
		    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
		    '{"default_zone": true, "maglev_zone": true}'::jsonb
		  ),
		  -- Floor +1
		  (
		    'Maglev Transit Zone (Floor +1)',
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
		    1,
		    NULL,
		    TRUE,
		    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
		    '{"default_zone": true, "maglev_zone": true}'::jsonb
		  ),
		  -- Floor +2
		  (
		    'Maglev Transit Zone (Floor +2)',
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
		    2,
		    NULL,
		    TRUE,
		    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
		    '{"default_zone": true, "maglev_zone": true}'::jsonb
		  )
	`
	_, err := s.db.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to recreate default zones: %w", err)
	}
	return nil
}

// DeleteAllZones removes all zones from the database.
// If cascade is true, uses TRUNCATE CASCADE (deletes all zones, resets sequence, cascades to related tables).
// If cascade is false, uses DELETE (preserves related records but clears zone references).
// After TRUNCATE, default zones are automatically recreated.
// Returns the number of zones deleted.
func (s *ZoneStorage) DeleteAllZones(cascade bool) (int64, error) {
	if cascade {
		// Clean Reset: TRUNCATE CASCADE - deletes all zones, resets sequence, cascades to related tables
		// Count before truncating since TRUNCATE doesn't return rows affected
		var count int64
		err := s.db.QueryRow(`SELECT COUNT(*) FROM zones`).Scan(&count)
		if err != nil {
			// If query fails, just proceed with truncate
			count = 0
		}

		_, err = s.db.Exec(`TRUNCATE zones RESTART IDENTITY CASCADE`)
		if err != nil {
			return 0, fmt.Errorf("failed to truncate all zones: %w", err)
		}

		// Recreate default zones after TRUNCATE
		if err := s.RecreateDefaultZones(); err != nil {
			log.Printf("Warning: Failed to recreate default zones after TRUNCATE: %v", err)
			// Don't fail the operation, just log the warning
		}

		return count, nil
	} else {
		// Preserve Related Records: DELETE with manual cleanup
		// First, clear zone references in npcs table
		_, err := s.db.Exec(`UPDATE npcs SET home_zone_id = NULL, work_zone_id = NULL`)
		if err != nil {
			return 0, fmt.Errorf("failed to clear npc zone references: %w", err)
		}

		// Then delete all zones (structures and roads will have zone_id set to NULL automatically due to ON DELETE SET NULL)
		result, err := s.db.Exec(`DELETE FROM zones`)
		if err != nil {
			return 0, fmt.Errorf("failed to delete all zones: %w", err)
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("failed to get rows affected: %w", err)
		}

		// Reset sequence numbering
		_, err = s.db.Exec(`ALTER SEQUENCE zones_id_seq RESTART WITH 1`)
		if err != nil {
			// Log but don't fail - sequence reset is nice to have but not critical
			log.Printf("Warning: Failed to reset zones sequence: %v", err)
		}

		return rowsAffected, nil
	}
}

// ListZonesByArea returns all zones whose geometry intersects the provided bounding box on a floor.
// Supports both legacy (X/Y) and new (RingPolar/RingArc) coordinate systems.
// For new coordinates, converts RingArc bounds to legacy X/Y for database query (temporary during transition).
func (s *ZoneStorage) ListZonesByArea(floor int, minX, minY, maxX, maxY float64) ([]Zone, error) {
	// Allow floors from -2 to +2 (main ring structure)
	if floor < -2 || floor > 2 {
		return nil, fmt.Errorf("floor must be between -2 and 2, got %d", floor)
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

// ListZonesByRingArc returns all zones whose geometry intersects the provided RingArc bounding box on a floor.
// Converts RingArc bounds to legacy X/Y coordinates for database query (temporary during transition).
// TODO: Once geometry_polar column is populated, query that column directly instead of converting.
func (s *ZoneStorage) ListZonesByRingArc(floor int, minS, minR, minZ, maxS, maxR, maxZ float64) ([]Zone, error) {
	// Convert RingArc bounds to legacy X/Y for database query
	// For now, we convert to legacy coordinates since geometry_polar may not be populated yet
	// minS/maxS -> minX/maxX, minR/maxR -> minY/maxY
	// Note: This is a temporary solution during the transition period
	
	// Convert arc length to legacy X position using ringmap functions
	// Legacy X = s (arc length), wrapped to [0, RingCircumference)
	minX := ringmap.WrapArcLength(minS)
	maxX := ringmap.WrapArcLength(maxS)
	
	// Handle wrapping: if minS > maxS (after wrapping), the bounding box wraps around
	// Check if the bounding box crosses the ring boundary
	if minS < 0 && maxS > 0 {
		// Bounding box wraps around - need to handle this case
		// For now, expand the query to cover the full visible area
		// This is a simplified approach - a full implementation would query both sides
		if maxX < minX {
			// Wrapped case: query from minX to circumference and from 0 to maxX
			// For simplicity, query the larger range
			if (maxX + (RingCircumference - minX)) > (minX - maxX) {
				// Wrapped range is larger, query full ring
				minX = 0
				maxX = RingCircumference
			}
		}
	}
	
	// R maps to Y (width position)
	minY := minR
	maxY := maxR
	
	// Z is not used in 2D geometry queries (it's the vertical offset, handled by floor)
	
	return s.ListZonesByArea(floor, minX, minY, maxX, maxY)
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
