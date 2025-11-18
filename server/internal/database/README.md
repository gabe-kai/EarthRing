# Database Package

This package provides database access layers for EarthRing server components.

## Chunk Storage

The `ChunkStorage` struct (`chunks.go`) handles chunk persistence and retrieval from the database.

### Features

- **Chunk Metadata Storage**: Stores chunk metadata in `chunks` table
- **Geometry Storage**: Stores chunk geometry in `chunk_data` table with PostGIS geometry
- **Automatic Persistence**: Generated chunks are automatically stored after generation
- **Database-First Loading**: Chunks are loaded from database before generating (avoids regeneration)
- **Chunk Deletion**: Deletes chunks and associated data atomically (transaction-safe)
- **Version Management**: Stores chunk version and version metadata (algorithm parameters, sample intervals, etc.)
- **PostGIS Integration**: Geometry stored as PostGIS POLYGON for spatial queries
- **Client Format Storage**: JSONB terrain_data field stores client-friendly geometry format
- **Transaction Safety**: All storage operations use database transactions
- **Error Handling**: Comprehensive error handling for PostGIS errors, invalid geometry, missing data

### Usage

```go
import "github.com/earthring/server/internal/database"

// Create storage instance
storage := database.NewChunkStorage(db)

// Get chunk metadata
metadata, err := storage.GetChunkMetadata(floor, chunkIndex)
if err != nil {
    // Handle error
}
if metadata == nil {
    // Chunk doesn't exist
}

// Store generated chunk (includes version metadata)
genResponse := &procedural.GenerateChunkResponse{...}
err := storage.StoreChunk(floor, chunkIndex, genResponse, proceduralSeed)
if err != nil {
    // Handle error (PostGIS not available, invalid geometry, etc.)
}

// Version metadata is automatically stored in metadata JSONB field:
// {
//   "width": 400.0,
//   "version_metadata": {
//     "geometry_version": 2,
//     "sample_interval": 50.0,
//     "algorithm": "smooth_curved_taper",
//     "vertex_count": 42,
//     "face_count": 40
//   }
// }

// Load geometry from database
geometry, err := storage.ConvertPostGISToGeometry(chunkID)
if err != nil {
    // Handle error
}

// Delete chunk (forces regeneration on next request)
err = storage.DeleteChunk(floor, chunkIndex)
if err != nil {
    // Handle error (chunk not found, database error, etc.)
}
```

### Error Handling

The storage layer handles various error conditions:

- **PostGIS Extension Missing**: Returns clear error if PostGIS is not installed
- **Invalid Geometry**: Validates geometry before storage (finite coordinates, sufficient vertices)
- **Database Errors**: Wraps database errors with context
- **Missing Data**: Returns `nil` (not error) for missing chunks/data

### Geometry Conversion

- **To PostGIS**: Converts procedural geometry (vertices/faces) to PostGIS POLYGON WKT format
- **From PostGIS**: Reads geometry from `terrain_data` JSONB field (stores client-friendly format)
- **Validation**: Validates coordinates are finite, sufficient vertices exist, valid bounding box

### Testing

Comprehensive tests in `chunks_test.go` cover:
- Normal operations (store, retrieve, update, delete)
- Chunk deletion (with/without chunk_data, transaction safety, error handling)
- Edge cases (nil inputs, invalid ranges, missing data)
- Geometry conversion (valid/invalid geometry, NaN/Inf coordinates)
- Error conditions (PostGIS errors, invalid JSON, non-existent chunks)

Run tests:
```bash
go test ./internal/database/... -v
```

