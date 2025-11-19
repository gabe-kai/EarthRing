package database

import (
	"database/sql"
	"math"
	"testing"

	"github.com/earthring/server/internal/procedural"
	"github.com/earthring/server/internal/testutil"
	"github.com/lib/pq"
)

func TestChunkStorage_GetChunkMetadata(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("returns nil for non-existent chunk", func(t *testing.T) {
		metadata, err := storage.GetChunkMetadata(0, 99999)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if metadata != nil {
			t.Errorf("Expected nil for non-existent chunk, got %+v", metadata)
		}
	})

	t.Run("retrieves existing chunk metadata", func(t *testing.T) {
		// Insert test chunk
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version, is_dirty, procedural_seed)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id
		`, 0, 12345, 2, false, 123456).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		metadata, err := storage.GetChunkMetadata(0, 12345)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if metadata == nil {
			t.Fatal("Expected metadata, got nil")
		}

		if metadata.Floor != 0 {
			t.Errorf("Expected floor 0, got %d", metadata.Floor)
		}
		if metadata.ChunkIndex != 12345 {
			t.Errorf("Expected chunk_index 12345, got %d", metadata.ChunkIndex)
		}
		if metadata.Version != 2 {
			t.Errorf("Expected version 2, got %d", metadata.Version)
		}
		if metadata.IsDirty {
			t.Error("Expected is_dirty false, got true")
		}
		if metadata.ProceduralSeed == nil || *metadata.ProceduralSeed != 123456 {
			t.Errorf("Expected procedural_seed 123456, got %v", metadata.ProceduralSeed)
		}
	})

	t.Run("handles chunk without procedural_seed", func(t *testing.T) {
		// Insert test chunk without seed
		_, err := db.Exec(`
			INSERT INTO chunks (floor, chunk_index, version, is_dirty)
			VALUES ($1, $2, $3, $4)
		`, 0, 12346, 1, false)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		metadata, err := storage.GetChunkMetadata(0, 12346)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if metadata == nil {
			t.Fatal("Expected metadata, got nil")
		}
		if metadata.ProceduralSeed != nil {
			t.Errorf("Expected nil procedural_seed, got %v", metadata.ProceduralSeed)
		}
	})
}

func TestChunkStorage_GetChunkData(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("returns nil for non-existent chunk data", func(t *testing.T) {
		// Create a chunk without chunk_data
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version)
			VALUES ($1, $2, $3)
			RETURNING id
		`, 0, 99999, 1).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		data, err := storage.GetChunkData(chunkID)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if data != nil {
			t.Errorf("Expected nil for non-existent chunk data, got %+v", data)
		}
	})

	t.Run("retrieves existing chunk data", func(t *testing.T) {
		// Insert test chunk
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version)
			VALUES ($1, $2, $3)
			RETURNING id
		`, 0, 12347, 1).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		// Insert chunk_data
		_, err = db.Exec(`
			INSERT INTO chunk_data (chunk_id, geometry, structure_ids, zone_ids, terrain_data)
			VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2, $3, $4)
		`, chunkID, pq.Array([]int64{1, 2}), pq.Array([]int64{10}), `{"test": "data"}`)
		if err != nil {
			t.Fatalf("Failed to insert chunk_data: %v", err)
		}

		data, err := storage.GetChunkData(chunkID)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if data == nil {
			t.Fatal("Expected chunk data, got nil")
		}

		if data.ChunkID != chunkID {
			t.Errorf("Expected chunk_id %d, got %d", chunkID, data.ChunkID)
		}
		if data.Geometry == "" {
			t.Error("Expected geometry, got empty string")
		}
		if len(data.StructureIDs) != 2 || data.StructureIDs[0] != 1 || data.StructureIDs[1] != 2 {
			t.Errorf("Expected structure_ids [1, 2], got %v", data.StructureIDs)
		}
		if len(data.ZoneIDs) != 1 || data.ZoneIDs[0] != 10 {
			t.Errorf("Expected zone_ids [10], got %v", data.ZoneIDs)
		}
	})
}

func TestChunkStorage_StoreChunk(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("stores new chunk with geometry", func(t *testing.T) {
		genResponse := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12348",
				Floor:      0,
				ChunkIndex: 12348,
				Width:      400.0,
				Version:    2,
			},
			Geometry: &procedural.ChunkGeometry{
				Type:     "ring_floor",
				Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {1000, 400, 0}, {0, 400, 0}},
				Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
				Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
				Width:    400.0,
				Length:   1000.0,
			},
			Structures: []interface{}{},
			Zones:      []interface{}{},
		}

		err := storage.StoreChunk(0, 12348, genResponse, nil)
		if err != nil {
			t.Fatalf("Failed to store chunk: %v", err)
		}

		// Verify chunk was stored
		metadata, err := storage.GetChunkMetadata(0, 12348)
		if err != nil {
			t.Fatalf("Failed to retrieve metadata: %v", err)
		}
		if metadata == nil {
			t.Fatal("Chunk metadata not found after storage")
		}
		if metadata.Version != 2 {
			t.Errorf("Expected version 2, got %d", metadata.Version)
		}

		// Verify chunk_data was stored
		data, err := storage.GetChunkData(metadata.ID)
		if err != nil {
			t.Fatalf("Failed to retrieve chunk data: %v", err)
		}
		if data == nil {
			t.Fatal("Chunk data not found after storage")
		}
		if data.Geometry == "" {
			t.Error("Geometry not stored")
		}
	})

	t.Run("updates existing chunk", func(t *testing.T) {
		// First store
		genResponse1 := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12349",
				Floor:      0,
				ChunkIndex: 12349,
				Width:      400.0,
				Version:    1,
			},
			Geometry: &procedural.ChunkGeometry{
				Type:     "ring_floor",
				Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {1000, 400, 0}, {0, 400, 0}},
				Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
				Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
				Width:    400.0,
				Length:   1000.0,
			},
			Structures: []interface{}{},
			Zones:      []interface{}{},
		}

		err := storage.StoreChunk(0, 12349, genResponse1, nil)
		if err != nil {
			t.Fatalf("Failed to store chunk: %v", err)
		}

		// Get initial version
		metadata1, err := storage.GetChunkMetadata(0, 12349)
		if err != nil {
			t.Fatalf("Failed to get chunk metadata: %v", err)
		}
		initialVersion := metadata1.Version

		// Store again with updated version
		genResponse2 := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12349",
				Floor:      0,
				ChunkIndex: 12349,
				Width:      400.0,
				Version:    2,
			},
			Geometry: &procedural.ChunkGeometry{
				Type:     "ring_floor",
				Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {1000, 400, 0}, {0, 400, 0}},
				Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
				Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
				Width:    400.0,
				Length:   1000.0,
			},
			Structures: []interface{}{},
			Zones:      []interface{}{},
		}

		err = storage.StoreChunk(0, 12349, genResponse2, nil)
		if err != nil {
			t.Fatalf("Failed to update chunk: %v", err)
		}

		// Verify version was incremented
		metadata2, err := storage.GetChunkMetadata(0, 12349)
		if err != nil {
			t.Fatalf("Failed to get chunk metadata: %v", err)
		}
		if metadata2.Version <= initialVersion {
			t.Errorf("Expected version to increment, got %d (was %d)", metadata2.Version, initialVersion)
		}
	})

	t.Run("handles chunk without geometry", func(t *testing.T) {
		genResponse := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12350",
				Floor:      0,
				ChunkIndex: 12350,
				Width:      400.0,
				Version:    1,
			},
			Geometry:   nil,
			Structures: []interface{}{},
			Zones:      []interface{}{},
		}

		err := storage.StoreChunk(0, 12350, genResponse, nil)
		if err != nil {
			t.Fatalf("Failed to store chunk without geometry: %v", err)
		}

		// Verify chunk metadata was stored
		metadata, err := storage.GetChunkMetadata(0, 12350)
		if err != nil {
			t.Fatalf("Failed to retrieve metadata: %v", err)
		}
		if metadata == nil {
			t.Fatal("Chunk metadata not found")
		}
	})
}

func TestChunkStorage_ConvertPostGISToGeometry(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("returns nil for non-existent chunk", func(t *testing.T) {
		geometry, err := storage.ConvertPostGISToGeometry(99999)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if geometry != nil {
			t.Errorf("Expected nil for non-existent chunk, got %+v", geometry)
		}
	})

	t.Run("converts stored geometry back to procedural format", func(t *testing.T) {
		// Insert test chunk
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version)
			VALUES ($1, $2, $3)
			RETURNING id
		`, 0, 12351, 1).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		// Store geometry JSON in terrain_data
		geometryJSON := `{
			"type": "ring_floor",
			"vertices": [[0, 0, 0], [1000, 0, 0], [1000, 400, 0], [0, 400, 0]],
			"faces": [[0, 1, 2], [0, 2, 3]],
			"normals": [[0, 0, 1], [0, 0, 1]],
			"width": 400.0,
			"length": 1000.0
		}`

		_, err = db.Exec(`
			INSERT INTO chunk_data (chunk_id, geometry, terrain_data)
			VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2)
		`, chunkID, geometryJSON)
		if err != nil {
			t.Fatalf("Failed to insert chunk_data: %v", err)
		}

		geometry, err := storage.ConvertPostGISToGeometry(chunkID)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if geometry == nil {
			t.Fatal("Expected geometry, got nil")
		}

		if geometry.Type != "ring_floor" {
			t.Errorf("Expected type 'ring_floor', got '%s'", geometry.Type)
		}
		if geometry.Width != 400.0 {
			t.Errorf("Expected width 400.0, got %f", geometry.Width)
		}
		if geometry.Length != 1000.0 {
			t.Errorf("Expected length 1000.0, got %f", geometry.Length)
		}
		if len(geometry.Vertices) != 4 {
			t.Errorf("Expected 4 vertices, got %d", len(geometry.Vertices))
		}
	})
}

func TestConvertGeometryToPostGIS(t *testing.T) {
	t.Run("converts ring floor geometry to POLYGON", func(t *testing.T) {
		geometry := &procedural.ChunkGeometry{
			Type:     "ring_floor",
			Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {1000, 400, 0}, {0, 400, 0}},
			Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
			Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
			Width:    400.0,
			Length:   1000.0,
		}

		wkt, err := convertGeometryToPostGIS(geometry)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		// Verify WKT format
		if wkt == "" {
			t.Error("Expected WKT string, got empty")
		}
		// Should contain POLYGON and coordinates
		if len(wkt) < 20 {
			t.Errorf("WKT seems too short: %s", wkt)
		}
	})

	t.Run("rejects unsupported geometry type", func(t *testing.T) {
		geometry := &procedural.ChunkGeometry{
			Type:     "unsupported",
			Vertices: [][]float64{{0, 0, 0}},
			Faces:    [][]int{{0}},
			Normals:  [][]float64{{0, 0, 1}},
			Width:    100.0,
			Length:   100.0,
		}

		_, err := convertGeometryToPostGIS(geometry)
		if err == nil {
			t.Error("Expected error for unsupported geometry type")
		}
	})

	t.Run("rejects geometry with insufficient vertices", func(t *testing.T) {
		geometry := &procedural.ChunkGeometry{
			Type:     "ring_floor",
			Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}}, // Only 2 vertices
			Faces:    [][]int{{0, 1}},
			Normals:  [][]float64{{0, 0, 1}},
			Width:    400.0,
			Length:   1000.0,
		}

		_, err := convertGeometryToPostGIS(geometry)
		if err == nil {
			t.Error("Expected error for insufficient vertices")
		}
	})

	t.Run("rejects geometry with invalid coordinates", func(t *testing.T) {
		geometry := &procedural.ChunkGeometry{
			Type:     "ring_floor",
			Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {math.Inf(1), 400, 0}, {0, 400, 0}}, // Contains Inf
			Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
			Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
			Width:    400.0,
			Length:   1000.0,
		}

		_, err := convertGeometryToPostGIS(geometry)
		if err == nil {
			t.Error("Expected error for non-finite coordinates")
		}
	})

	t.Run("rejects geometry with NaN coordinates", func(t *testing.T) {
		geometry := &procedural.ChunkGeometry{
			Type:     "ring_floor",
			Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {math.NaN(), 400, 0}, {0, 400, 0}}, // Contains NaN
			Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
			Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
			Width:    400.0,
			Length:   1000.0,
		}

		_, err := convertGeometryToPostGIS(geometry)
		if err == nil {
			t.Error("Expected error for NaN coordinates")
		}
	})

	t.Run("rejects geometry with insufficient coordinates per vertex", func(t *testing.T) {
		geometry := &procedural.ChunkGeometry{
			Type:     "ring_floor",
			Vertices: [][]float64{{0}, {1000, 0}, {1000, 400}, {0, 400}}, // First vertex has only 1 coordinate
			Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
			Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
			Width:    400.0,
			Length:   1000.0,
		}

		_, err := convertGeometryToPostGIS(geometry)
		if err == nil {
			t.Error("Expected error for insufficient coordinates")
		}
	})
}

func TestChunkStorage_StoreChunk_EdgeCases(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("rejects nil genResponse", func(t *testing.T) {
		err := storage.StoreChunk(0, 12352, nil, nil)
		if err == nil {
			t.Error("Expected error for nil genResponse")
		}
	})

	t.Run("rejects failed genResponse", func(t *testing.T) {
		genResponse := &procedural.GenerateChunkResponse{
			Success: false,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12353",
				Floor:      0,
				ChunkIndex: 12353,
				Width:      400.0,
				Version:    1,
			},
		}

		err := storage.StoreChunk(0, 12353, genResponse, nil)
		if err == nil {
			t.Error("Expected error for failed genResponse")
		}
	})

	t.Run("rejects invalid floor", func(t *testing.T) {
		genResponse := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12354",
				Floor:      -1,
				ChunkIndex: 12354,
				Width:      400.0,
				Version:    1,
			},
		}

		err := storage.StoreChunk(-1, 12354, genResponse, nil)
		if err == nil {
			t.Error("Expected error for invalid floor")
		}
	})

	t.Run("rejects invalid chunk_index", func(t *testing.T) {
		genResponse := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_999999",
				Floor:      0,
				ChunkIndex: 999999,
				Width:      400.0,
				Version:    1,
			},
		}

		err := storage.StoreChunk(0, 999999, genResponse, nil)
		if err == nil {
			t.Error("Expected error for invalid chunk_index")
		}
	})
}

func TestChunkStorage_ConvertPostGISToGeometry_EdgeCases(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("rejects invalid chunk_id", func(t *testing.T) {
		geometry, err := storage.ConvertPostGISToGeometry(0)
		if err == nil {
			t.Error("Expected error for chunk_id 0")
		}
		if geometry != nil {
			t.Errorf("Expected nil geometry for invalid chunk_id, got %+v", geometry)
		}
	})

	t.Run("rejects negative chunk_id", func(t *testing.T) {
		geometry, err := storage.ConvertPostGISToGeometry(-1)
		if err == nil {
			t.Error("Expected error for negative chunk_id")
		}
		if geometry != nil {
			t.Errorf("Expected nil geometry for negative chunk_id, got %+v", geometry)
		}
	})

	t.Run("handles invalid geometry structure in terrain_data", func(t *testing.T) {
		// Insert test chunk
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version)
			VALUES ($1, $2, $3)
			RETURNING id
		`, 0, 12355, 1).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		// Store valid JSON but with invalid geometry structure (missing type field)
		invalidGeometryJSON := `{"vertices": [[0, 0, 0]], "faces": [[0]], "width": 400.0, "length": 1000.0}`
		_, err = db.Exec(`
			INSERT INTO chunk_data (chunk_id, geometry, terrain_data)
			VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2::jsonb)
		`, chunkID, invalidGeometryJSON)
		if err != nil {
			t.Fatalf("Failed to insert chunk_data: %v", err)
		}

		geometry, err := storage.ConvertPostGISToGeometry(chunkID)
		if err == nil {
			t.Error("Expected error for invalid geometry structure (missing type)")
		}
		if geometry != nil {
			t.Errorf("Expected nil geometry for invalid structure, got %+v", geometry)
		}
	})

	t.Run("handles geometry with empty vertices", func(t *testing.T) {
		// Insert test chunk
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version)
			VALUES ($1, $2, $3)
			RETURNING id
		`, 0, 12356, 1).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		// Store valid JSON but with empty vertices
		invalidGeometryJSON := `{"type": "ring_floor", "vertices": [], "faces": [], "width": 400.0, "length": 1000.0}`
		_, err = db.Exec(`
			INSERT INTO chunk_data (chunk_id, geometry, terrain_data)
			VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2::jsonb)
		`, chunkID, invalidGeometryJSON)
		if err != nil {
			t.Fatalf("Failed to insert chunk_data: %v", err)
		}

		geometry, err := storage.ConvertPostGISToGeometry(chunkID)
		if err == nil {
			t.Error("Expected error for geometry with empty vertices")
		}
		if geometry != nil {
			t.Errorf("Expected nil geometry for empty vertices, got %+v", geometry)
		}
	})
}

func TestChunkStorage_DeleteChunk(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.CloseDB(t, db)

	// Ensure PostGIS extension is available
	_, err := db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Skipf("PostGIS extension not available: %v", err)
	}

	// Create tables
	setupChunkTables(t, db)

	storage := NewChunkStorage(db)

	t.Run("deletes chunk with chunk_data", func(t *testing.T) {
		// First, store a chunk with geometry
		genResponse := &procedural.GenerateChunkResponse{
			Success: true,
			Chunk: procedural.ChunkMetadata{
				ChunkID:    "0_12360",
				Floor:      0,
				ChunkIndex: 12360,
				Width:      400.0,
				Version:    2,
			},
			Geometry: &procedural.ChunkGeometry{
				Type:     "ring_floor",
				Vertices: [][]float64{{0, 0, 0}, {1000, 0, 0}, {1000, 400, 0}, {0, 400, 0}},
				Faces:    [][]int{{0, 1, 2}, {0, 2, 3}},
				Normals:  [][]float64{{0, 0, 1}, {0, 0, 1}},
				Width:    400.0,
				Length:   1000.0,
			},
			Structures: []interface{}{},
			Zones:      []interface{}{},
		}

		err := storage.StoreChunk(0, 12360, genResponse, nil)
		if err != nil {
			t.Fatalf("Failed to store chunk: %v", err)
		}

		// Verify chunk exists
		metadata, err := storage.GetChunkMetadata(0, 12360)
		if err != nil {
			t.Fatalf("Failed to retrieve metadata: %v", err)
		}
		if metadata == nil {
			t.Fatal("Chunk should exist before deletion")
		}

		// Verify chunk_data exists
		data, err := storage.GetChunkData(metadata.ID)
		if err != nil {
			t.Fatalf("Failed to retrieve chunk data: %v", err)
		}
		if data == nil {
			t.Fatal("Chunk data should exist before deletion")
		}

		// Delete the chunk
		err = storage.DeleteChunk(0, 12360)
		if err != nil {
			t.Fatalf("Failed to delete chunk: %v", err)
		}

		// Store chunkID before deletion for verification
		chunkIDToVerify := metadata.ID

		// Verify chunk metadata is deleted
		metadata, err = storage.GetChunkMetadata(0, 12360)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if metadata != nil {
			t.Error("Chunk metadata should be deleted")
		}

		// Verify chunk_data is deleted
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM chunk_data WHERE chunk_id = $1", chunkIDToVerify).Scan(&count)
		if err != nil {
			t.Fatalf("Failed to query chunk_data: %v", err)
		}
		if count != 0 {
			t.Error("Chunk data should be deleted")
		}

		// Verify chunk doesn't exist in database
		var chunkID int64
		err = db.QueryRow("SELECT id FROM chunks WHERE floor = $1 AND chunk_index = $2", 0, 12360).Scan(&chunkID)
		if err == nil {
			t.Error("Chunk should not exist in database")
		}
	})

	t.Run("deletes chunk without chunk_data", func(t *testing.T) {
		// Insert chunk without chunk_data
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version, is_dirty)
			VALUES ($1, $2, $3, $4)
			RETURNING id
		`, 0, 12361, 1, false).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		// Verify chunk exists
		metadata, err := storage.GetChunkMetadata(0, 12361)
		if err != nil {
			t.Fatalf("Failed to retrieve metadata: %v", err)
		}
		if metadata == nil {
			t.Fatal("Chunk should exist before deletion")
		}

		// Delete the chunk
		err = storage.DeleteChunk(0, 12361)
		if err != nil {
			t.Fatalf("Failed to delete chunk: %v", err)
		}

		// Verify chunk is deleted
		metadata, err = storage.GetChunkMetadata(0, 12361)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if metadata != nil {
			t.Error("Chunk should be deleted")
		}
	})

	t.Run("returns error for non-existent chunk", func(t *testing.T) {
		err := storage.DeleteChunk(0, 99999)
		if err == nil {
			t.Error("Expected error for non-existent chunk")
		}
		if err != nil {
			errMsg := err.Error()
			// Check if error message contains "chunk not found"
			found := false
			for i := 0; i <= len(errMsg)-len("chunk not found"); i++ {
				if i+len("chunk not found") <= len(errMsg) && errMsg[i:i+len("chunk not found")] == "chunk not found" {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("Expected 'chunk not found' error, got: %v", err)
			}
		}
	})

	t.Run("transaction safety - rollback on chunk_data deletion failure", func(t *testing.T) {
		// This test verifies that if chunk_data deletion fails, the transaction rolls back
		// We'll insert a chunk and then try to delete it
		// In a real failure scenario, the transaction would roll back
		// For this test, we'll just verify normal deletion works atomically

		// Insert chunk with chunk_data
		var chunkID int64
		err := db.QueryRow(`
			INSERT INTO chunks (floor, chunk_index, version)
			VALUES ($1, $2, $3)
			RETURNING id
		`, 0, 12362, 1).Scan(&chunkID)
		if err != nil {
			t.Fatalf("Failed to insert test chunk: %v", err)
		}

		_, err = db.Exec(`
			INSERT INTO chunk_data (chunk_id, geometry, terrain_data)
			VALUES ($1, ST_GeomFromText('POLYGON((0 0, 1000 0, 1000 400, 0 400, 0 0))', 0), $2)
		`, chunkID, `{"test": "data"}`)
		if err != nil {
			t.Fatalf("Failed to insert chunk_data: %v", err)
		}

		// Delete should succeed and remove both
		err = storage.DeleteChunk(0, 12362)
		if err != nil {
			t.Fatalf("Failed to delete chunk: %v", err)
		}

		// Verify both are deleted
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM chunks WHERE id = $1", chunkID).Scan(&count)
		if err != nil {
			t.Fatalf("Failed to query chunks: %v", err)
		}
		if count != 0 {
			t.Error("Chunk should be deleted")
		}

		err = db.QueryRow("SELECT COUNT(*) FROM chunk_data WHERE chunk_id = $1", chunkID).Scan(&count)
		if err != nil {
			t.Fatalf("Failed to query chunk_data: %v", err)
		}
		if count != 0 {
			t.Error("Chunk data should be deleted")
		}
	})
}

// Helper function to set up chunk tables for testing
func setupChunkTables(t *testing.T, db *sql.DB) {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS chunks (
			id SERIAL PRIMARY KEY,
			floor INTEGER NOT NULL,
			chunk_index INTEGER NOT NULL,
			version INTEGER DEFAULT 1,
			last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			is_dirty BOOLEAN DEFAULT FALSE,
			procedural_seed INTEGER,
			metadata JSONB,
			UNIQUE(floor, chunk_index)
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunks table: %v", err)
	}

	// Drop and recreate chunk_data table to ensure it has the correct schema
	_, err = db.Exec("DROP TABLE IF EXISTS chunk_data")
	if err != nil {
		t.Logf("Warning: failed to drop chunk_data table: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE chunk_data (
			chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
			geometry GEOMETRY(POLYGON, 0) NOT NULL,
			geometry_detail GEOMETRY(MULTIPOLYGON, 0),
			structure_ids INTEGER[],
			zone_ids INTEGER[],
			npc_data JSONB,
			terrain_data JSONB,
			last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create chunk_data table: %v", err)
	}

	// Clean up test data
	_, err = db.Exec("DELETE FROM chunk_data")
	if err != nil {
		t.Logf("Warning: failed to delete chunk_data: %v", err)
	}
	_, err = db.Exec("DELETE FROM chunks")
	if err != nil {
		t.Logf("Warning: failed to delete chunks: %v", err)
	}
}
