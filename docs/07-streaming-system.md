# Streaming System Design

## Table of Contents

- [Overview](#overview)
- [Chunk Specifications](#chunk-specifications)
  - [Chunk Dimensions](#chunk-dimensions)
  - [Chunk Identification](#chunk-identification)
  - [Chunk Data Structure](#chunk-data-structure)
- [Chunk Loading Strategy](#chunk-loading-strategy)
  - [Client-Side Loading](#client-side-loading)
  - [Viewport-Based Loading](#viewport-based-loading)
  - [Loading Algorithm](#loading-algorithm)
- [Server-Side Management](#server-side-management)
  - [Chunk Request Handling](#chunk-request-handling)
  - [Chunk Caching](#chunk-caching)
- [Level of Detail (LOD) System](#level-of-detail-lod-system)
  - [LOD Levels](#lod-levels)
  - [LOD Selection](#lod-selection)
  - [LOD Data Structure](#lod-data-structure)
- [Chunk Synchronization](#chunk-synchronization)
  - [Initial Load](#initial-load)
  - [Incremental Updates](#incremental-updates)
  - [Change Detection](#change-detection)
- [Conflict Resolution](#conflict-resolution)
- [Network Optimization](#network-optimization)
  - [Compression](#compression)
  - [Geometry Compression](#geometry-compression)
  - [Texture Compression](#texture-compression)
  - [Metadata Compression](#metadata-compression)
  - [Network Transmission Format](#network-transmission-format)
  - [Compression Performance Targets](#compression-performance-targets)
  - [Client-Side Decompression](#client-side-decompression)
  - [Compression Configuration](#compression-configuration)
  - [Database Storage Compression](#database-storage-compression)
- [Bandwidth Management](#bandwidth-management)
- [Caching Strategy](#caching-strategy)
  - [Client-Side Caching](#client-side-caching)
  - [Server-Side Caching](#server-side-caching)
- [Chunk Generation](#chunk-generation)
  - [Generation Strategy](#generation-strategy)
  - [Procedural Generation](#procedural-generation)
  - [Player Structure Integration](#player-structure-integration)
- [Performance Metrics](#performance-metrics)
  - [Key Metrics](#key-metrics)
- [Error Handling](#error-handling)
  - [Network Errors](#network-errors)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The streaming system handles loading and synchronizing map chunks between server and clients. Given the massive scale of the ring (264,000 km), efficient chunk streaming is critical for performance. The system supports different levels of detail (LOD) for different client types.

## Chunk Specifications

### Chunk Dimensions

- **Length (East-West)**: 1 km (1,000 meters)
- **Width (North-South)**: Variable
  - Standard: 400 meters
  - At local stations: Up to 5 km (5,000 meters)
  - At regional hubs: Up to 16 km (16,000 meters)
  - At pillar/elevator hubs: Up to 25 km (25,000 meters)
- **Vertical**: Single floor per chunk (multiple floors = multiple chunks)

### Chunk Identification

- **Chunk ID Format**: `{floor}_{chunk_index}`
- **Chunk Index**: `floor(ring_position / 1000) % 264000`
- **Range**: 0 to 263,999 chunks per floor

### Chunk Data Structure

Each chunk contains:

1. **Geometry Data**
   - Terrain mesh (heightmap, materials)
   - Building geometry (procedural and player-placed)
   - Road geometry
   - Decorative elements

2. **Metadata**
   - Zone assignments
   - Structure references
   - NPC population data
   - Traffic patterns

3. **Procedural Data**
   - Seed values
   - Generation parameters
   - Cache flags

## Chunk Loading Strategy

### Client-Side Loading

#### Viewport-Based Loading

Clients load chunks based on viewport and movement prediction:

1. **Current Viewport**
   - Load chunks visible in current camera view
   - Buffer zone around viewport (e.g., 2-3 chunks ahead)

2. **Movement Prediction**
   - Predict player movement direction
   - Preload chunks in movement direction
   - Unload chunks behind player

3. **Priority System**
   - **High Priority**: Chunks in viewport
   - **Medium Priority**: Chunks in buffer zone
   - **Low Priority**: Chunks in predicted path
   - **Unload**: Chunks beyond threshold distance

#### Loading Algorithm

```python
def get_chunks_to_load(player_position, viewport_size, movement_direction):
    """Determine which chunks should be loaded"""
    current_chunk = get_chunk_index(player_position)
    viewport_chunks = calculate_viewport_chunks(current_chunk, viewport_size)
    buffer_chunks = get_buffer_chunks(viewport_chunks, buffer_size=2)
    predicted_chunks = get_predicted_chunks(current_chunk, movement_direction)
    
    chunks_to_load = set(viewport_chunks + buffer_chunks + predicted_chunks)
    chunks_to_unload = get_chunks_beyond_threshold(current_chunk, threshold=5)
    
    return chunks_to_load, chunks_to_unload
```

### Server-Side Management

#### Chunk Request Handling ✅ **IMPLEMENTED** (Phase 2: Handler with database persistence)

**Status**: ✅ **IMPLEMENTED** - WebSocket chunk request handler is functional with full database persistence. Chunks are automatically stored in database after generation and loaded from database when they exist. Returns chunks with ring floor geometry and station flares (variable-width chunks). Ring floor geometry is visible in client. Full generation with buildings and structures will be added in Phase 2.

1. **Request Format** (via WebSocket)
   ```json
   {
     "type": "chunk_request",
     "id": "req_123",
     "data": {
       "chunks": ["0_12345", "0_12346", "0_12347"],
       "lod_level": "high"
     }
   }
   ```
   - Maximum 10 chunks per request
   - Validates chunk ID format ("floor_chunk_index")
   - Validates chunk index range (0-263,999)
   - Validates LOD level ("low", "medium", "high")

2. **Response Format** (via WebSocket)
   ```json
   {
     "type": "chunk_data",
     "id": "req_123",
     "data": {
       "chunks": [
         {
           "id": "0_12345",
           "geometry": {
             "type": "ring_floor",
             "vertices": [[x1, y1, z1], [x2, y2, z2], ...],
             "faces": [[v1, v2, v3], ...],
             "normals": [[nx1, ny1, nz1], ...],
             "width": 400.0,
             "length": 1000.0
           },
           "structures": [], // Empty for Phase 1
           "zones": [], // Empty for Phase 1
           "metadata": {
             "id": "0_12345",
             "floor": 0,
             "chunk_index": 12345,
             "version": 2,
             "last_modified": "2024-01-01T00:00:00Z",
             "is_dirty": false
           }
         }
       ]
     }
   }
   ```
   - Checks database for existing chunks using storage layer
   - Loads chunks from database if they exist (with geometry from terrain_data JSONB)
   - Generates new chunks via procedural service if not found
   - Automatically stores generated chunks in database (both `chunks` and `chunk_data` tables)
   - Returns chunks with ring floor geometry and station flares (variable-width chunks)
   - Ring floor geometry is visible in client (gray rectangular planes with variable width)
   - Full generation with buildings and structures will be populated in Phase 2
- Client seam handling: the web client dynamically shifts entire chunk meshes by integer multiples of the ring circumference so that only the copy closest to the camera is rendered. This ensures chunk `263999` sits perfectly beside chunk `0` with no overlapping geometry or visible gaps when the camera crosses the wrap point.

#### Chunk Storage ✅ **IMPLEMENTED**

**Status**: ✅ **IMPLEMENTED** - Chunk storage layer (`server/internal/database/chunks.go`) provides full persistence.

**Storage Strategy:**
- **Metadata Storage**: Chunks stored in `chunks` table (floor, chunk_index, version, is_dirty, procedural_seed, metadata)
- **Geometry Storage**: Chunk geometry stored in `chunk_data` table with PostGIS POLYGON geometry and JSONB terrain_data
- **Automatic Persistence**: Generated chunks are automatically stored after generation
- **Database-First Loading**: Chunks are loaded from database before generating (avoids regeneration)
- **PostGIS Integration**: Geometry stored as PostGIS POLYGON for spatial queries, JSONB for client format
- **Transaction Safety**: All storage operations use database transactions for atomicity
- **Error Handling**: Comprehensive error handling for PostGIS errors, invalid geometry, missing data

**Storage Functions:**
- `GetChunkMetadata()` - Retrieves chunk metadata from `chunks` table
- `GetChunkData()` - Retrieves chunk geometry from `chunk_data` table
- `StoreChunk()` - Stores generated chunks in both tables with PostGIS geometry conversion
- `ConvertPostGISToGeometry()` - Converts stored geometry back to client format
- `DeleteChunk()` - Deletes chunk and associated data from database (transaction-safe, forces regeneration on next request)

**Geometry Conversion:**
- Procedural geometry (vertices/faces) → PostGIS POLYGON WKT format
- PostGIS geometry → Client format (via terrain_data JSONB field)
- Validates geometry (finite coordinates, sufficient vertices, valid bounding box)

**Chunk Deletion**: ✅ **IMPLEMENTED**
- `DeleteChunk()` method deletes both chunk metadata and geometry data atomically
- Transaction-safe: Uses database transactions to ensure both `chunks` and `chunk_data` are deleted together
- On next request, deleted chunks are automatically regenerated by the procedural service
- Useful for forcing regeneration after procedural algorithm changes
- Accessible via REST API (`DELETE /api/chunks/{chunk_id}`) and client UI
- **Testing**: Comprehensive test coverage (database layer: 4 test cases, API handler: 6 test cases with sub-tests)

#### Chunk Caching

Server maintains cache of frequently accessed chunks:

- **Cache Strategy**: LRU (Least Recently Used) - **PENDING** (database storage implemented, in-memory cache pending)
- **Cache Size**: Configurable (e.g., 1000 chunks)
- **Cache Invalidation**: On chunk modification
- **Redis Integration**: Optional distributed cache

## Level of Detail (LOD) System

### LOD Levels

Different clients receive different levels of detail:

1. **LOD 0 - Ultra High**
   - Full geometry detail
   - All structures rendered
   - High-resolution textures
   - Use: Unreal Engine client

2. **LOD 1 - High**
   - Reduced geometry complexity
   - Most structures rendered
   - Medium-resolution textures
   - Use: Light local client

3. **LOD 2 - Medium**
   - Simplified geometry
   - Important structures only
   - Low-resolution textures
   - Use: Web client (initial)

4. **LOD 3 - Low**
   - Minimal geometry
   - Major structures only
   - Placeholder textures
   - Use: Distant chunks, mobile clients

### LOD Selection

LOD level determined by:

1. **Client Type**
   - Web client: LOD 2 default
   - Light client: LOD 1 default
   - Unreal client: LOD 0 default

2. **Distance from Player**
   - Close chunks: Higher LOD
   - Distant chunks: Lower LOD
   - Dynamic adjustment based on performance

3. **Chunk Importance**
   - Player structures: Always high LOD
   - Procedural buildings: Lower LOD acceptable
   - Empty chunks: Lowest LOD

### LOD Data Structure

```json
{
  "chunk_id": "0_12345",
  "lod_levels": {
    "0": {
      "geometry": "...", // Full detail
      "textures": ["high_res_1", "high_res_2"]
    },
    "1": {
      "geometry": "...", // Simplified
      "textures": ["med_res_1", "med_res_2"]
    },
    "2": {
      "geometry": "...", // Basic
      "textures": ["low_res_1"]
    }
  }
}
```

## Chunk Synchronization

### Initial Load

1. **Client Connection**
   - Client connects via WebSocket
   - Client authenticates
   - Client sends initial position

2. **Chunk Request**
   - Client requests chunks for current position
   - Server loads chunks from database
   - Server sends chunk data

3. **Rendering**
   - Client receives chunk data
   - Client caches chunks locally
   - Client renders chunks

### Incremental Updates

#### Change Detection

Server tracks chunk modifications:

1. **Modification Events**
   - Structure placed/removed
   - Zone created/modified
   - Road generated/updated
   - NPC population changes

2. **Change Notification**
   ```json
   {
     "type": "chunk_updated",
     "chunk_id": "0_12345",
     "changes": {
       "structures": ["added", "removed"],
       "zones": ["modified"],
       "roads": ["updated"]
     },
     "version": 2
   }
   ```

3. **Client Update**
   - Client receives update notification
   - Client requests updated chunk data
   - Client merges changes or reloads chunk

### Conflict Resolution

When multiple players modify same chunk:

1. **Optimistic Locking**
   - Chunk version numbers
   - Last-write-wins for non-conflicting changes
   - Conflict detection for overlapping modifications

2. **Conflict Handling**
   - Server detects conflicts
   - Server resolves or requests client resolution
   - Server broadcasts resolution to affected clients

## Network Optimization

### Compression

**Decision**: Multi-layer compression strategy optimized for chunk data transmission and storage.

**Goals:**
- Minimize network bandwidth usage
- Reduce database storage requirements
- Maintain fast decompression on client
- Support different LOD levels with appropriate compression

#### Geometry Compression

**Format**: Custom binary format with gzip compression

**Compression Pipeline:**

1. **Vertex Quantization**
   - Quantize vertex positions to reduce precision
   - **X (Ring Position)**: 1cm precision (10^-2 meters)
   - **Y (Width)**: 1mm precision (10^-3 meters)
   - **Z (Height/Elevation)**: 1cm precision (10^-2 meters)
   - Reduces vertex data size by ~50% while maintaining visual quality

2. **Index Optimization**
   - Use 16-bit indices for meshes with <65,536 vertices
   - Use 32-bit indices for larger meshes
   - Optimize index order for cache efficiency

3. **Delta Encoding**
   - Encode vertex positions as deltas from previous vertex
   - More efficient for smooth surfaces (buildings, roads)
   - Fall back to absolute positions for irregular geometry

4. **Mesh Optimization**
   - Remove duplicate vertices
   - Optimize triangle order
   - Simplify geometry for lower LOD levels

5. **Binary Format**
   ```
   [Header: 16 bytes]
   - Magic number: 4 bytes ("CHNK")
   - Version: 1 byte
   - Format flags: 1 byte (quantization level, index size, etc.)
   - Vertex count: 2 bytes (or 4 bytes if >65k)
   - Index count: 2 bytes (or 4 bytes if >65k)
   - Reserved: 6 bytes
   
   [Vertex Data: variable]
   - Quantized positions (X, Y, Z)
   - Normals (compressed to 2 bytes using octahedral encoding)
   - UV coordinates (quantized to 16-bit)
   - Optional: Colors, material indices
   
   [Index Data: variable]
   - Triangle indices (16-bit or 32-bit)
   
   [Metadata: variable]
   - Material references
   - Structure IDs
   - Zone IDs
   ```

6. **Final Compression**
   - Apply gzip compression to binary format
   - Compression level: 6 (balance between size and speed)
   - Expected compression ratio: 3:1 to 5:1

**Implementation:**
```go
// Server-side compression
func CompressChunkGeometry(chunk *Chunk) ([]byte, error) {
    // 1. Quantize vertices
    quantized := quantizeVertices(chunk.Vertices)
    
    // 2. Optimize indices
    optimized := optimizeIndices(quantized)
    
    // 3. Encode to binary format
    binary := encodeToBinary(optimized)
    
    // 4. Compress with gzip
    compressed := gzipCompress(binary, 6)
    
    return compressed, nil
}

// Client-side decompression
func DecompressChunkGeometry(data []byte) (*ChunkGeometry, error) {
    // 1. Decompress gzip
    binary, err := gzipDecompress(data)
    if err != nil {
        return nil, err
    }
    
    // 2. Decode binary format
    geometry, err := decodeFromBinary(binary)
    if err != nil {
        return nil, err
    }
    
    // 3. Dequantize vertices
    vertices := dequantizeVertices(geometry.Vertices)
    
    return &ChunkGeometry{Vertices: vertices, Indices: geometry.Indices}, nil
}
```

**LOD-Specific Compression:**

- **High LOD**: Full precision, all vertices, detailed normals
- **Medium LOD**: Reduced precision, simplified mesh, compressed normals
- **Low LOD**: Minimal precision, heavily simplified mesh, no normals

#### Texture Compression

**Format**: WebP for transmission, compressed textures for rendering

**Compression Strategy:**

1. **Server-Side Texture Processing**
   - Convert textures to WebP format (better compression than PNG/JPEG)
   - Quality: 85% (good balance between size and quality)
   - Support lossless WebP for UI elements

2. **Client-Side Texture Formats**
   - **Web Client**: WebP (browser native support)
   - **Future Clients**: DXT/BC formats (GPU-compressed)

3. **Texture Atlases**
   - Combine multiple small textures into atlases
   - Reduces texture count and improves batching
   - Atlas size: 2048×2048 or 4096×4096

4. **LOD Texture Strategy**
   - **High LOD**: Full resolution textures (2048×2048)
   - **Medium LOD**: Half resolution (1024×1024)
   - **Low LOD**: Quarter resolution (512×512)

**Implementation:**
```go
// Server-side texture compression
func CompressTexture(texture image.Image, lodLevel string) ([]byte, error) {
    // Resize based on LOD
    resized := resizeTexture(texture, getLODResolution(lodLevel))
    
    // Convert to WebP
    webpData, err := encodeWebP(resized, 85)
    if err != nil {
        return nil, err
    }
    
    return webpData, nil
}
```

#### Metadata Compression

**Format**: MessagePack (binary JSON alternative)

**Rationale:**
- More compact than JSON (typically 20-30% smaller)
- Faster to parse than JSON
- Maintains human readability when needed
- Good library support (Go, JavaScript)

**Compression Pipeline:**

1. **Structure Metadata**
   - Structure IDs, positions, rotations
   - Compressed using MessagePack
   - Further compressed with gzip if >1KB

2. **Zone References**
   - Zone IDs overlapping chunk
   - Compressed array format

3. **NPC Data**
   - Population counts, traffic patterns
   - MessagePack format
   - Gzip compression if large

**Implementation:**
```go
import "github.com/vmihailenco/msgpack/v5"

// Server-side metadata compression
func CompressMetadata(metadata ChunkMetadata) ([]byte, error) {
    // Encode to MessagePack
    msgpackData, err := msgpack.Marshal(metadata)
    if err != nil {
        return nil, err
    }
    
    // Compress if large
    if len(msgpackData) > 1024 {
        return gzipCompress(msgpackData, 6), nil
    }
    
    return msgpackData, nil
}

// Client-side decompression
func DecompressMetadata(data []byte) (*ChunkMetadata, error) {
    // Decompress if needed (check magic bytes)
    var decompressed []byte
    if isGzipped(data) {
        var err error
        decompressed, err = gzipDecompress(data)
        if err != nil {
            return nil, err
        }
    } else {
        decompressed = data
    }
    
    // Decode MessagePack
    var metadata ChunkMetadata
    err := msgpack.Unmarshal(decompressed, &metadata)
    return &metadata, err
}
```

#### Network Transmission Format

**Decision**: JSON wrapper with compressed binary payloads

**Message Format:**
```json
{
  "type": "chunk_data",
  "chunks": [
    {
      "id": "0_12345",
      "version": 3,
      "geometry": {
        "format": "binary_gzip",
        "data": "<base64_encoded_compressed_geometry>",
        "size": 12345,
        "uncompressed_size": 45678
      },
      "textures": [
        {
          "id": "texture_1",
          "format": "webp",
          "data": "<base64_encoded_webp>",
          "size": 5678
        }
      ],
      "metadata": {
        "format": "msgpack_gzip",
        "data": "<base64_encoded_compressed_metadata>",
        "size": 1234
      },
      "lod_level": "high"
    }
  ]
}
```

**Rationale:**
- JSON wrapper allows easy parsing and debugging
- Binary payloads minimize size
- Base64 encoding for JSON compatibility
- Size information helps with progress tracking

**Alternative Considered**: Pure binary protocol (rejected - harder to debug, less flexible)

#### Compression Performance Targets

**Target Compression Ratios:**
- **Geometry**: 3:1 to 5:1 (gzip on binary format)
- **Textures**: 5:1 to 10:1 (WebP compression)
- **Metadata**: 2:1 to 3:1 (MessagePack + gzip)

**Target Sizes (High LOD):**
- **Empty chunk**: <10 KB
- **Chunk with buildings**: 50-200 KB
- **Chunk at station**: 200-500 KB
- **Chunk with complex structures**: Up to 1 MB

**Decompression Performance:**
- **Target**: <50ms for high LOD chunk on modern hardware
- **Optimization**: Parallel decompression (geometry + textures)
- **Caching**: Decompressed data cached in memory

#### Client-Side Decompression

**Web Client (JavaScript):**
- **Geometry**: Decompress gzip using `pako` library, decode binary format
- **Textures**: Browser native WebP support
- **Metadata**: Decompress gzip, decode MessagePack using `@msgpack/msgpack`

**Implementation:**
```javascript
import pako from 'pako';
import { decode } from '@msgpack/msgpack';

async function decompressChunk(chunkData) {
    // Decompress geometry
    const geometryBinary = pako.inflate(
        base64ToArrayBuffer(chunkData.geometry.data)
    );
    const geometry = decodeGeometryBinary(geometryBinary);
    
    // Decompress metadata
    const metadataBinary = pako.inflate(
        base64ToArrayBuffer(chunkData.metadata.data)
    );
    const metadata = decode(metadataBinary);
    
    // Textures are already WebP (browser handles)
    const textures = await loadTextures(chunkData.textures);
    
    return { geometry, metadata, textures };
}
```

**Future Clients:**
- **Light Client**: Same as web client (Electron can use native modules)
- **Unreal Client**: Native compression libraries, GPU texture decompression

#### Compression Configuration

**Compression Levels (Configurable):**

1. **Maximum Compression** (Slow, Small)
   - Geometry: gzip level 9
   - Textures: WebP quality 75%
   - Use for: Low bandwidth, storage optimization

2. **Balanced** (Default)
   - Geometry: gzip level 6
   - Textures: WebP quality 85%
   - Use for: Normal operation

3. **Fast Compression** (Fast, Larger)
   - Geometry: gzip level 1
   - Textures: WebP quality 95%
   - Use for: High bandwidth, fast loading priority

**Adaptive Compression:**
- Detect client bandwidth
- Adjust compression level based on connection speed
- Prefer speed for high bandwidth, size for low bandwidth

#### Database Storage Compression

**PostGIS Geometry:**
- PostGIS handles geometry compression internally
- Use PostGIS compression functions if needed
- Store detailed geometry separately if too large

**JSONB Compression:**
- PostgreSQL compresses JSONB automatically
- Additional gzip compression not needed for JSONB columns
- Consider compression for very large JSONB fields (>1MB)

**Chunk Data Storage:**
- Store compressed geometry in database (gzip compressed binary)
- Store compressed textures separately (or reference asset URLs)
- Store metadata as JSONB (PostgreSQL compression)

**Storage Format:**
```sql
CREATE TABLE chunk_data (
    chunk_id INTEGER PRIMARY KEY,
    geometry_compressed BYTEA,  -- Gzip-compressed binary geometry
    metadata JSONB,              -- MessagePack data stored as JSONB
    texture_references TEXT[],   -- References to texture assets
    -- ... other fields
);
```

### Bandwidth Management

1. **Priority Queue**
   - High priority: Viewport chunks
   - Medium priority: Buffer chunks
   - Low priority: Predicted chunks

2. **Rate Limiting**
   - Limit chunk requests per client
   - Throttle based on network conditions
   - Adaptive quality based on bandwidth

3. **Incremental Loading**
   - Load geometry first
   - Load textures asynchronously
   - Load details progressively

## Caching Strategy

### Client-Side Caching

1. **Memory Cache**
   - Cache recently loaded chunks
   - LRU eviction policy
   - Size limit based on available memory

2. **Disk Cache**
   - Persist chunks to disk
   - Load from disk on startup
   - Invalidate on version mismatch

3. **Cache Invalidation**
   - Check chunk version on load
   - Request update if version changed
   - Clear cache on logout

### Server-Side Caching

1. **In-Memory Cache**
   - Cache frequently accessed chunks
   - Reduce database queries
   - Invalidate on modification

2. **Redis Cache**
   - Distributed cache for multiple servers
   - Cache chunk data and metadata
   - TTL-based expiration

## Chunk Generation

### Generation Strategy

**Decision**: On-demand generation - chunks are generated when first requested, not pre-generated.

**Rationale**:
- Minimal storage requirements (only generate what's needed)
- Allows optimization and refinement of generation algorithms over time
- Pre-generation would require massive storage (264,000 chunks × floors × detail levels)
- Can cache frequently accessed chunks to avoid regenerating them

### Procedural Generation

1. **On-Demand Generation** ✅ **IMPLEMENTED**
   - Generate chunks when first requested by client
   - **Store generated data in database (PostGIS geometry types)** ✅ **IMPLEMENTED**
   - **Load chunks from database before generating** ✅ **IMPLEMENTED** (avoids regeneration)
   - Cache generated chunks to avoid regeneration (in-memory cache pending)
   - Regenerate if seed changes or cache invalidated

2. **Caching Strategy**
   - Cache frequently accessed chunks in memory (server-side)
   - Cache in Redis for distributed server setups
   - Background pre-generation for popular areas (optional optimization)
   - Monitor generation performance and optimize as needed

3. **Generation Service**
   - Procedural generation handled by separate Python service (FastAPI)
   - **Status**: ✅ Implemented (Phase 1: basic service with ring floor geometry and station flares)
   - Main server (Go) requests generation via REST API (`POST /api/v1/chunks/generate`)
   - Go client (`server/internal/procedural/client.go`) handles communication with retries
   - Service runs on port 8081 (configurable via `PROCEDURAL_SERVICE_PORT`)
   - Generated chunks stored in database with PostGIS geometry (Phase 2)
   - Can scale generation service independently based on workload

4. **Background Generation** (Optional Optimization)
   - Pre-generate chunks around active areas
   - Generate chunks in background process
   - Queue system for generation tasks

5. **Generation Parameters**
   - Use chunk seed for determinism
   - Consider zone assignments
   - Consider nearby chunks for continuity

### Player Structure Integration

1. **Structure Loading**
   - Load player structures with chunk
   - Prioritize player structures over procedural
   - Full detail for player structures

2. **Structure Updates**
   - Notify clients when structures change
   - Update chunk version
   - Regenerate affected procedural elements

## Performance Metrics

### Key Metrics

1. **Load Time**
   - Time to load chunk from request to render
   - Target: < 100ms for cached chunks
   - Target: < 500ms for database chunks

2. **Bandwidth Usage**
   - Average bytes per chunk
   - Target: < 1MB per chunk (LOD 2)
   - Monitor and optimize

3. **Cache Hit Rate**
   - Percentage of chunks served from cache
   - Target: > 80% cache hit rate
   - Monitor cache effectiveness

4. **Update Latency**
   - Time from modification to client update
   - Target: < 200ms for nearby clients
   - Use WebSocket for real-time updates

## Error Handling

### Network Errors

1. **Connection Loss**
   - Retry chunk requests
   - Queue requests during disconnect
   - Resume on reconnection

2. **Timeout Handling**
   - Set timeout for chunk requests
   - Retry with exponential backoff
   - Fallback to lower LOD on failure

3. **Corrupted Data**
   - Validate chunk data on receive
   - Request re-transmission on corruption
   - Log errors for debugging

## Open Questions

1. What is the optimal chunk buffer size (chunks ahead/behind)?
2. Should we support streaming individual structures within chunks?
3. How do we handle chunk loading at map boundaries (wrapping)?
4. How do we handle chunk loading for racing mode (fast movement)?
5. ✅ **Chunk Compression Format**: RESOLVED - See Compression section above

## Future Considerations

- Predictive chunk loading using ML
- Adaptive LOD based on client performance
- Chunk compression improvements
- Support for streaming large structures
- Chunk versioning for rollback capability
- Support for custom chunk sizes for special areas

