package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/earthring/server/internal/procedural"
	"github.com/lib/pq"
)

// ChunkStorage handles chunk storage and retrieval from the database
type ChunkStorage struct {
	db               *sql.DB
	zoneStorage      *ZoneStorage      // Optional zone storage for creating zones from chunk generation
	structureStorage *StructureStorage // Optional structure storage for creating structures from chunk generation
}

// NewChunkStorage creates a new chunk storage instance
func NewChunkStorage(db *sql.DB) *ChunkStorage {
	return &ChunkStorage{
		db:               db,
		zoneStorage:      NewZoneStorage(db),      // Create zone storage for zone creation
		structureStorage: NewStructureStorage(db), // Create structure storage for structure creation
	}
}

// StoredChunkMetadata represents chunk metadata stored in the database
type StoredChunkMetadata struct {
	ID             int64
	Floor          int
	ChunkIndex     int
	Version        int
	LastModified   time.Time
	IsDirty        bool
	ProceduralSeed *int
	Metadata       json.RawMessage
}

// StoredChunkData represents chunk geometry data stored in the database
type StoredChunkData struct {
	ChunkID        int64
	Geometry       string  // PostGIS geometry as WKT or WKB
	GeometryDetail *string // Optional detailed geometry
	StructureIDs   []int64
	ZoneIDs        []int64
	NPCData        json.RawMessage
	TerrainData    json.RawMessage
	LastUpdated    time.Time
}

// GetChunkMetadata retrieves chunk metadata from the database
func (s *ChunkStorage) GetChunkMetadata(floor, chunkIndex int) (*StoredChunkMetadata, error) {
	// Validate inputs
	if floor < 0 {
		return nil, fmt.Errorf("invalid floor: %d (must be >= 0)", floor)
	}
	if chunkIndex < 0 || chunkIndex > 263999 {
		return nil, fmt.Errorf("invalid chunk_index: %d (must be 0-263999)", chunkIndex)
	}

	var metadata StoredChunkMetadata
	var proceduralSeed sql.NullInt64
	var metadataJSON sql.NullString

	query := `
		SELECT id, floor, chunk_index, version, last_modified, is_dirty, procedural_seed, metadata
		FROM chunks
		WHERE floor = $1 AND chunk_index = $2
	`
	err := s.db.QueryRow(query, floor, chunkIndex).Scan(
		&metadata.ID,
		&metadata.Floor,
		&metadata.ChunkIndex,
		&metadata.Version,
		&metadata.LastModified,
		&metadata.IsDirty,
		&proceduralSeed,
		&metadataJSON,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query chunk metadata: %w", err)
	}

	if proceduralSeed.Valid {
		seed := int(proceduralSeed.Int64)
		metadata.ProceduralSeed = &seed
	}
	if metadataJSON.Valid {
		metadata.Metadata = json.RawMessage(metadataJSON.String)
	}

	return &metadata, nil
}

// GetChunkData retrieves chunk geometry data from the database
func (s *ChunkStorage) GetChunkData(chunkID int64) (*StoredChunkData, error) {
	if chunkID <= 0 {
		return nil, fmt.Errorf("invalid chunk_id: %d (must be > 0)", chunkID)
	}

	var data StoredChunkData
	var geometryDetail sql.NullString
	var npcData sql.NullString
	var terrainData sql.NullString

	query := `
		SELECT chunk_id, ST_AsText(geometry) as geometry, 
		       ST_AsText(geometry_detail) as geometry_detail,
		       structure_ids, zone_ids, npc_data, terrain_data, last_updated
		FROM chunk_data
		WHERE chunk_id = $1
	`
	err := s.db.QueryRow(query, chunkID).Scan(
		&data.ChunkID,
		&data.Geometry,
		&geometryDetail,
		pq.Array(&data.StructureIDs),
		pq.Array(&data.ZoneIDs),
		&npcData,
		&terrainData,
		&data.LastUpdated,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		// Check for PostGIS-specific errors
		errStr := err.Error()
		if contains(errStr, "st_astext") || contains(errStr, "function") && contains(errStr, "does not exist") {
			return nil, fmt.Errorf("PostGIS functions not available - ensure PostGIS extension is installed: %w", err)
		}
		return nil, fmt.Errorf("failed to query chunk data: %w", err)
	}

	if geometryDetail.Valid {
		data.GeometryDetail = &geometryDetail.String
	}
	if npcData.Valid {
		data.NPCData = json.RawMessage(npcData.String)
	}
	if terrainData.Valid {
		data.TerrainData = json.RawMessage(terrainData.String)
	}

	return &data, nil
}

// rollbackTx safely rolls back a transaction, ignoring errors if the transaction was already committed.
func rollbackTx(tx *sql.Tx) {
	if err := tx.Rollback(); err != nil {
		// Transaction was already committed or closed, ignore rollback error
		// This is expected behavior - if Commit() succeeded, Rollback() will fail
		_ = err // Explicitly ignore error to satisfy staticcheck SA9003
	}
}

// StoreChunk stores a chunk in the database (both metadata and geometry)
func (s *ChunkStorage) StoreChunk(floor, chunkIndex int, genResponse *procedural.GenerateChunkResponse, proceduralSeed *int) error {
	if genResponse == nil {
		return fmt.Errorf("genResponse cannot be nil")
	}
	if !genResponse.Success {
		return fmt.Errorf("cannot store failed chunk generation response")
	}
	if floor < 0 {
		return fmt.Errorf("invalid floor: %d (must be >= 0)", floor)
	}
	if chunkIndex < 0 || chunkIndex > 263999 {
		return fmt.Errorf("invalid chunk_index: %d (must be 0-263999)", chunkIndex)
	}

	// Start transaction
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer rollbackTx(tx)

	// Insert or update chunk metadata
	var chunkID int64
	var version int
	query := `
		INSERT INTO chunks (floor, chunk_index, version, is_dirty, procedural_seed, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (floor, chunk_index) 
		DO UPDATE SET 
			version = chunks.version + 1,
			last_modified = CURRENT_TIMESTAMP,
			is_dirty = $4,
			procedural_seed = COALESCE($5, chunks.procedural_seed),
			metadata = COALESCE($6, chunks.metadata)
		RETURNING id, version
	`

	var seedValue sql.NullInt64
	if proceduralSeed != nil {
		seedValue = sql.NullInt64{Int64: int64(*proceduralSeed), Valid: true}
	}

	// Build metadata JSON with version metadata if available
	var metadataJSON sql.NullString
	if genResponse.Chunk.Version > 0 {
		metadataMap := map[string]interface{}{
			"width": genResponse.Chunk.Width,
		}

		// Include version metadata if present
		if genResponse.Chunk.VersionMetadata != nil {
			vm := genResponse.Chunk.VersionMetadata
			versionMetadataMap := map[string]interface{}{
				"geometry_version": vm.GeometryVersion,
			}
			if vm.SampleInterval != nil {
				versionMetadataMap["sample_interval"] = *vm.SampleInterval
			}
			if vm.Algorithm != nil {
				versionMetadataMap["algorithm"] = *vm.Algorithm
			}
			if vm.VertexCount != nil {
				versionMetadataMap["vertex_count"] = *vm.VertexCount
			}
			if vm.FaceCount != nil {
				versionMetadataMap["face_count"] = *vm.FaceCount
			}
			metadataMap["version_metadata"] = versionMetadataMap
		}

		metadataBytes, err := json.Marshal(metadataMap)
		if err == nil {
			metadataJSON = sql.NullString{String: string(metadataBytes), Valid: true}
		}
	}

	err = tx.QueryRow(query, floor, chunkIndex, genResponse.Chunk.Version, false, seedValue, metadataJSON).Scan(&chunkID, &version)
	if err != nil {
		return fmt.Errorf("failed to insert/update chunk metadata: %w", err)
	}

	// Convert geometry to PostGIS format and store
	if genResponse.Geometry != nil {
		geometryWKT, err := convertGeometryToPostGIS(genResponse.Geometry)
		if err != nil {
			return fmt.Errorf("failed to convert geometry: %w", err)
		}

		// Validate PostGIS extension is available
		var postgisExists bool
		err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')").Scan(&postgisExists)
		if err != nil {
			return fmt.Errorf("failed to check PostGIS extension: %w", err)
		}
		if !postgisExists {
			return fmt.Errorf("PostGIS extension is not installed - cannot store geometry")
		}

		// Create zones from generation response if any (before storing chunk_data)
		var zoneIDs []int64
		if len(genResponse.Zones) > 0 && s.zoneStorage != nil {
			for _, zoneData := range genResponse.Zones {
				// Convert zone data (GeoJSON Feature) to ZoneCreateInput
				zoneMap, ok := zoneData.(map[string]interface{})
				if !ok {
					log.Printf("[StoreChunk] Warning: zone data is not a map, skipping: %T", zoneData)
					continue
				}

				// Extract zone properties
				props, ok := zoneMap["properties"].(map[string]interface{})
				if !ok {
					log.Printf("[StoreChunk] Warning: zone properties not found or invalid, skipping")
					continue
				}

				// Extract geometry
				geometry, ok := zoneMap["geometry"].(map[string]interface{})
				if !ok {
					log.Printf("[StoreChunk] Warning: zone geometry not found or invalid, skipping")
					continue
				}

				// Build zone geometry GeoJSON
				geometryJSON, err := json.Marshal(geometry)
				if err != nil {
					log.Printf("[StoreChunk] Warning: failed to marshal zone geometry: %v", err)
					continue
				}

				// Extract zone properties
				zoneType, _ := props["zone_type"].(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
				if zoneType == "" {
					zoneType = "restricted" // Default to restricted
				}
				name, _ := props["name"].(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
				if name == "" {
					name = fmt.Sprintf("Chunk Zone (Floor %d, Chunk %d)", floor, chunkIndex)
				}
				isSystemZone, _ := props["is_system_zone"].(bool) //nolint:errcheck // ok value ignored - defaults to false if not a bool

				// Extract properties and metadata
				var propertiesJSON json.RawMessage
				if propsObj, ok := props["properties"].(map[string]interface{}); ok {
					if propsBytes, err := json.Marshal(propsObj); err == nil {
						propertiesJSON = propsBytes
					}
				}
				var metadataJSON json.RawMessage
				if metadataObj, ok := props["metadata"].(map[string]interface{}); ok {
					if metadataBytes, err := json.Marshal(metadataObj); err == nil {
						metadataJSON = metadataBytes
					}
				}

				// Check if zone already exists for this chunk (by metadata chunk_index and side if present)
				// If it exists, use its ID; otherwise create it
				var zoneID int64
				// Extract side from metadata if present (for industrial zones)
				var side string
				if metadataObj, ok := props["metadata"].(map[string]interface{}); ok {
					if sideVal, ok := metadataObj["side"].(string); ok {
						side = sideVal
					}
				}

				var checkZoneQuery string
				if side != "" {
					// For zones with a side (e.g., north/south industrial zones), include side in the check
					checkZoneQuery = `
						SELECT id FROM zones
						WHERE floor = $1 
						  AND zone_type = $2
						  AND is_system_zone = $3
						  AND metadata->>'chunk_index' = $4
						  AND metadata->>'default_zone' = 'true'
						  AND metadata->>'side' = $5
						LIMIT 1
					`
					err = tx.QueryRow(checkZoneQuery, floor, zoneType, isSystemZone, fmt.Sprintf("%d", chunkIndex), side).Scan(&zoneID)
				} else {
					// For zones without a side (e.g., restricted zones), use the original query
					checkZoneQuery = `
						SELECT id FROM zones
						WHERE floor = $1 
						  AND zone_type = $2
						  AND is_system_zone = $3
						  AND metadata->>'chunk_index' = $4
						  AND metadata->>'default_zone' = 'true'
						  AND (metadata->>'side' IS NULL OR metadata->>'side' = '')
						LIMIT 1
					`
					err = tx.QueryRow(checkZoneQuery, floor, zoneType, isSystemZone, fmt.Sprintf("%d", chunkIndex)).Scan(&zoneID)
				}
				if err == nil {
					// Zone already exists, use it
					zoneIDs = append(zoneIDs, zoneID)
					continue
				} else if err != sql.ErrNoRows {
					log.Printf("[StoreChunk] Warning: failed to check for existing zone: %v", err)
					continue
				}

				// Zone doesn't exist, create it
				zoneQuery := `
					INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
					VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 0), $4, NULL, $5, $6, $7)
					RETURNING id
				`
				err = tx.QueryRow(
					zoneQuery,
					name,
					zoneType,
					string(geometryJSON),
					floor,
					isSystemZone,
					nullableJSONString(propertiesJSON),
					nullableJSONString(metadataJSON),
				).Scan(&zoneID)
				if err != nil {
					log.Printf("[StoreChunk] Warning: failed to create zone for chunk %d_%d: %v", floor, chunkIndex, err)
					continue
				}
				zoneIDs = append(zoneIDs, zoneID)
			}
		}

		// Create structures from generation response if any (before storing chunk_data)
		var structureIDs []int64
		if len(genResponse.Structures) > 0 {
			for _, structureData := range genResponse.Structures {
				// Convert structure data to StructureCreateInput
				structureMap, ok := structureData.(map[string]interface{})
				if !ok {
					log.Printf("[StoreChunk] Warning: structure data is not a map, skipping: %T", structureData)
					continue
				}

				// Extract structure properties
				structureType, ok := structureMap["structure_type"].(string)
				if !ok || structureType == "" {
					log.Printf("[StoreChunk] Warning: structure missing structure_type, skipping")
					continue
				}

				// Extract position
				posMap, ok := structureMap["position"].(map[string]interface{})
				if !ok {
					log.Printf("[StoreChunk] Warning: structure position is not a map, skipping")
					continue
				}
				posX, ok := posMap["x"].(float64)
				if !ok {
					log.Printf("[StoreChunk] Warning: structure missing X coordinate, skipping")
					continue
				}
				posY, ok := posMap["y"].(float64)
				if !ok {
					log.Printf("[StoreChunk] Warning: structure missing Y coordinate, skipping")
					continue
				}

				// Extract floor (default to 0 if missing)
				floorVal, ok := structureMap["floor"].(float64)
				if !ok {
					floorVal = 0.0
				}
				structFloor := int(floorVal)

				// Extract optional fields
				isProcedural, ok := structureMap["is_procedural"].(bool)
				if !ok {
					isProcedural = false // Default to false if missing
				}
				var proceduralSeed *int64
				if seedVal, ok := structureMap["procedural_seed"].(float64); ok {
					seed := int64(seedVal)
					proceduralSeed = &seed
				}

				// Extract properties and dimensions
				var propertiesJSON json.RawMessage
				if propsObj, ok := structureMap["properties"].(map[string]interface{}); ok {
					if propsBytes, err := json.Marshal(propsObj); err == nil {
						propertiesJSON = propsBytes
					}
				}
				// Include dimensions and windows in properties if present
				var modelDataJSON json.RawMessage
				modelDataMap := make(map[string]interface{})
				if dimensions, ok := structureMap["dimensions"].(map[string]interface{}); ok {
					modelDataMap["dimensions"] = dimensions
				}
				if windows, ok := structureMap["windows"].([]interface{}); ok {
					modelDataMap["windows"] = windows
				}
				if len(modelDataMap) > 0 {
					if modelBytes, err := json.Marshal(modelDataMap); err == nil {
						modelDataJSON = modelBytes
					}
				}

				// For procedural structures, we don't need to link them to zones
				// They're deterministic and guaranteed to be within their zones
				var zoneID *int64 // nil for procedural structures

				// Insert structure directly into database within transaction
				// Bypass validation for procedural structures (they're deterministic and guaranteed valid)
				structureQuery := `
					INSERT INTO structures (
						structure_type, floor, owner_id, zone_id, is_procedural, procedural_seed,
						position, rotation, scale, properties, model_data
					) VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 0), $9, $10, $11, $12)
					RETURNING id
				`

				var structID int64
				rotation, ok := structureMap["rotation"].(float64)
				if !ok {
					rotation = 0.0
				}
				scale, ok := structureMap["scale"].(float64)
				if !ok || scale == 0 {
					scale = 1.0
				}

				var propertiesJSONInterface interface{} = propertiesJSON
				if len(propertiesJSON) == 0 {
					propertiesJSONInterface = nil
				}
				var modelDataJSONInterface interface{} = modelDataJSON
				if len(modelDataJSON) == 0 {
					modelDataJSONInterface = nil
				}

				var seedVal sql.NullInt64
				if proceduralSeed != nil {
					seedVal = sql.NullInt64{Int64: *proceduralSeed, Valid: true}
				}
				var zoneIDVal sql.NullInt64
				if zoneID != nil {
					zoneIDVal = sql.NullInt64{Int64: *zoneID, Valid: true}
				}

				err = tx.QueryRow(
					structureQuery,
					structureType,
					structFloor,
					nil, // owner_id (NULL for procedural structures)
					zoneIDVal,
					isProcedural,
					seedVal,
					posX,
					posY,
					rotation,
					scale,
					propertiesJSONInterface,
					modelDataJSONInterface,
				).Scan(&structID)
				if err != nil {
					log.Printf("[StoreChunk] Warning: failed to create structure for chunk %d_%d: %v", floor, chunkIndex, err)
					continue
				}
				structureIDs = append(structureIDs, structID)
			}
		}

		// Store geometry in chunk_data table
		// For ring floor geometry, we'll store it as a POLYGON
		// The geometry represents the chunk boundary rectangle
		query = `
			INSERT INTO chunk_data (chunk_id, geometry, structure_ids, zone_ids, terrain_data)
			VALUES ($1, ST_GeomFromText($2, 0), $3, $4, $5)
			ON CONFLICT (chunk_id)
			DO UPDATE SET
				geometry = ST_GeomFromText($2, 0),
				structure_ids = $3,
				zone_ids = $4,
				terrain_data = $5,
				last_updated = CURRENT_TIMESTAMP
		`

		// Store geometry data as JSONB in terrain_data for now
		// In the future, we can optimize this to use PostGIS geometry more efficiently
		geometryJSON, err := json.Marshal(genResponse.Geometry)
		if err != nil {
			return fmt.Errorf("failed to marshal geometry: %w", err)
		}

		_, err = tx.Exec(query, chunkID, geometryWKT, pq.Array(structureIDs), pq.Array(zoneIDs), string(geometryJSON))
		if err != nil {
			// Check for PostGIS-specific errors
			errStr := err.Error()
			if contains(errStr, "st_geomfromtext") || contains(errStr, "function") && contains(errStr, "does not exist") {
				return fmt.Errorf("PostGIS functions not available - ensure PostGIS extension is installed: %w", err)
			}
			if contains(errStr, "invalid") && contains(errStr, "geometry") {
				return fmt.Errorf("invalid geometry format - failed to parse WKT: %w", err)
			}
			return fmt.Errorf("failed to insert/update chunk data: %w", err)
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// convertGeometryToPostGIS converts procedural geometry to PostGIS POLYGON format
// For ring floor geometry, we create a rectangle polygon from the vertices
func convertGeometryToPostGIS(geometry *procedural.ChunkGeometry) (string, error) {
	if geometry == nil {
		return "", fmt.Errorf("geometry cannot be nil")
	}

	if geometry.Type != "ring_floor" {
		return "", fmt.Errorf("unsupported geometry type: %s (only 'ring_floor' is supported)", geometry.Type)
	}

	if len(geometry.Vertices) < 4 {
		return "", fmt.Errorf("ring floor geometry requires at least 4 vertices, got %d", len(geometry.Vertices))
	}

	// For ring floor, vertices form a rectangle
	// We'll create a POLYGON from the boundary vertices
	// Find min/max coordinates to create a bounding rectangle
	var minX, minY, maxX, maxY float64
	first := true
	validVertices := 0
	for i, vertex := range geometry.Vertices {
		if len(vertex) < 2 {
			return "", fmt.Errorf("vertex %d has insufficient coordinates (need at least 2, got %d)", i, len(vertex))
		}
		x, y := vertex[0], vertex[1]

		// Validate coordinates are finite numbers
		if !isFinite(x) || !isFinite(y) {
			return "", fmt.Errorf("vertex %d contains non-finite coordinates: [%f, %f]", i, x, y)
		}

		if first {
			minX, minY, maxX, maxY = x, y, x, y
			first = false
			validVertices++
		} else {
			if x < minX {
				minX = x
			}
			if x > maxX {
				maxX = x
			}
			if y < minY {
				minY = y
			}
			if y > maxY {
				maxY = y
			}
			validVertices++
		}
	}

	if validVertices < 4 {
		return "", fmt.Errorf("insufficient valid vertices: need at least 4, got %d", validVertices)
	}

	// Validate that we have a valid rectangle (non-zero width and height)
	if maxX-minX <= 0 || maxY-minY <= 0 {
		return "", fmt.Errorf("invalid rectangle dimensions: width=%f, height=%f", maxX-minX, maxY-minY)
	}

	// Create POLYGON from bounding rectangle
	// Format: POLYGON((x1 y1, x2 y1, x2 y2, x1 y2, x1 y1))
	wkt := fmt.Sprintf("POLYGON((%f %f, %f %f, %f %f, %f %f, %f %f))",
		minX, minY, // bottom-left
		maxX, minY, // bottom-right
		maxX, maxY, // top-right
		minX, maxY, // top-left
		minX, minY) // close polygon

	return wkt, nil
}

// ConvertPostGISToGeometry converts PostGIS geometry back to procedural geometry format
// This reads the geometry from terrain_data JSONB field
func (s *ChunkStorage) ConvertPostGISToGeometry(chunkID int64) (*procedural.ChunkGeometry, error) {
	if chunkID <= 0 {
		return nil, fmt.Errorf("invalid chunk_id: %d (must be > 0)", chunkID)
	}

	var terrainDataJSON sql.NullString
	query := `SELECT terrain_data FROM chunk_data WHERE chunk_id = $1`
	err := s.db.QueryRow(query, chunkID).Scan(&terrainDataJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query terrain_data: %w", err)
	}

	if !terrainDataJSON.Valid {
		return nil, nil
	}

	if terrainDataJSON.String == "" {
		return nil, nil
	}

	var geometry procedural.ChunkGeometry
	if err := json.Unmarshal([]byte(terrainDataJSON.String), &geometry); err != nil {
		return nil, fmt.Errorf("failed to unmarshal geometry (chunk_id=%d): %w", chunkID, err)
	}

	// Validate geometry after unmarshaling
	if geometry.Type == "" {
		return nil, fmt.Errorf("geometry type is empty (chunk_id=%d)", chunkID)
	}
	if len(geometry.Vertices) == 0 {
		return nil, fmt.Errorf("invalid geometry: no vertices (chunk_id=%d)", chunkID)
	}

	return &geometry, nil
}

// contains checks if a string contains a substring (case-insensitive)
func contains(s, substr string) bool {
	return len(s) >= len(substr) && containsSubstring(s, substr)
}

// containsSubstring is a simple substring check (case-insensitive)
func containsSubstring(s, substr string) bool {
	sLower := strings.ToLower(s)
	substrLower := strings.ToLower(substr)
	for i := 0; i <= len(sLower)-len(substrLower); i++ {
		if sLower[i:i+len(substrLower)] == substrLower {
			return true
		}
	}
	return false
}

// isFinite checks if a float64 is a finite number (not NaN or Inf)
func isFinite(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// DeleteChunk deletes a chunk and its associated data from the database.
// This will cause the procedural service to regenerate the chunk on next request.
// Returns an error if the chunk doesn't exist or if deletion fails.
func (s *ChunkStorage) DeleteChunk(floor, chunkIndex int) error {
	// Start a transaction to ensure atomic deletion
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		if err := tx.Rollback(); err != nil {
			// Log error but don't fail - transaction may already be committed
			log.Printf("Warning: failed to rollback transaction: %v", err)
		}
	}()

	// First, get the chunk ID to delete associated chunk_data
	var chunkID int64
	query := `SELECT id FROM chunks WHERE floor = $1 AND chunk_index = $2`
	err = tx.QueryRow(query, floor, chunkIndex).Scan(&chunkID)
	if err == sql.ErrNoRows {
		return fmt.Errorf("chunk not found: floor=%d, chunk_index=%d", floor, chunkIndex)
	}
	if err != nil {
		return fmt.Errorf("failed to query chunk: %w", err)
	}

	// Delete chunk_data (if exists) - this will cascade if foreign key is set up correctly
	// But we'll delete explicitly to be safe
	result, err := tx.Exec(`DELETE FROM chunk_data WHERE chunk_id = $1`, chunkID)
	if err != nil {
		return fmt.Errorf("failed to delete chunk_data: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected for chunk_data deletion: %w", err)
	}
	// rowsAffected > 0 means chunk_data was deleted (may not exist for all chunks)
	_ = rowsAffected // Explicitly ignore to satisfy staticcheck SA9003

	// Delete chunk metadata
	result, err = tx.Exec(`DELETE FROM chunks WHERE id = $1`, chunkID)
	if err != nil {
		return fmt.Errorf("failed to delete chunk: %w", err)
	}
	rowsAffected, err = result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected for chunk deletion: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("chunk not found: floor=%d, chunk_index=%d", floor, chunkIndex)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// DeleteAllChunks deletes all chunks and their associated data from the database.
// Returns the number of chunks deleted.
func (s *ChunkStorage) DeleteAllChunks() (int64, error) {
	// Start a transaction to ensure atomic deletion
	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		if err := tx.Rollback(); err != nil {
			// Log error but don't fail - transaction may already be committed
			log.Printf("Warning: failed to rollback transaction: %v", err)
		}
	}()

	// Delete all chunk_data first
	_, err = tx.Exec(`DELETE FROM chunk_data`)
	if err != nil {
		return 0, fmt.Errorf("failed to delete chunk_data: %w", err)
	}

	// Delete all chunks
	result, err := tx.Exec(`DELETE FROM chunks`)
	if err != nil {
		return 0, fmt.Errorf("failed to delete chunks: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return rowsAffected, nil
}
