package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/earthring/server/internal/procedural"
	"github.com/lib/pq"
)

// ChunkStorage handles chunk storage and retrieval from the database
type ChunkStorage struct {
	db *sql.DB
}

// NewChunkStorage creates a new chunk storage instance
func NewChunkStorage(db *sql.DB) *ChunkStorage {
	return &ChunkStorage{db: db}
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
	defer func() {
		if err := tx.Rollback(); err != nil {
			// Ignore rollback error if transaction was already committed
			// This is expected behavior - if Commit() succeeded, Rollback() will fail
		}
	}()

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

	var metadataJSON sql.NullString
	if genResponse.Chunk.Version > 0 {
		metadataJSON = sql.NullString{String: fmt.Sprintf(`{"width": %f}`, genResponse.Chunk.Width), Valid: true}
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

		// Store geometry in chunk_data table
		// For ring floor geometry, we'll store it as a POLYGON
		// The geometry represents the chunk boundary rectangle
		query = `
			INSERT INTO chunk_data (chunk_id, geometry, structure_ids, zone_ids, terrain_data)
			VALUES ($1, ST_GeomFromText($2, 0), $3, $4, $5)
			ON CONFLICT (chunk_id)
			DO UPDATE SET
				geometry = ST_GeomFromText($2, 0),
				terrain_data = $5,
				last_updated = CURRENT_TIMESTAMP
		`

		// Store geometry data as JSONB in terrain_data for now
		// In the future, we can optimize this to use PostGIS geometry more efficiently
		geometryJSON, err := json.Marshal(genResponse.Geometry)
		if err != nil {
			return fmt.Errorf("failed to marshal geometry: %w", err)
		}

		_, err = tx.Exec(query, chunkID, geometryWKT, pq.Array([]int64{}), pq.Array([]int64{}), string(geometryJSON))
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
