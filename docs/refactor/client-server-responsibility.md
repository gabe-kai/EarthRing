## Client/Server Responsibility Refactor Plan

### Goals
- Move chunk/zone/procedural streaming logic to the server so all clients can stay thin.
- Provide new APIs/WebSocket streams that deliver ready-to-render data (with wrapping, filtering, deduping performed centrally).
- Keep documentation and automated tests fully aligned with each milestone.

### Phased Process

#### Phase 1 – Contracts & Groundwork ✅ COMPLETE
1. **Design Streaming Contracts** ✅
   - ✅ Defined payload schemas for `stream_subscribe`, `stream_ack`, and `stream_delta` messages
   - ✅ WebSocket transport selected (existing WebSocket infrastructure)
   - ✅ Streaming contracts documented in `server/internal/streaming/manager.go`
   - ✅ Unit tests added for subscription validation and delta computation
2. **Shared Coordinate/Geometry Utilities** ✅
   - ✅ Server-side coordinate utilities in `server/internal/ringmap/`
   - ✅ Chunk window computation in `streaming.ComputeChunkWindow()`
   - ✅ Zone bounding box computation in `streaming.ComputeZoneBoundingBox()`
   - ✅ Unit tests for wrapping and coordinate math

#### Phase 2 – Server-Side Processing ✅ COMPLETE
1. **Chunk Pipeline Migration** ✅
   - ✅ Server performs chunk selection based on camera pose and radius
   - ✅ Server handles database lookup, procedural generation, and compression
   - ✅ Delta delivery implemented (`ChunkDelta` with added/removed chunks)
   - ✅ Chunks delivered asynchronously via `stream_delta` messages
   - ✅ Unit tests for chunk delta computation
2. **Zone Pipeline Migration** ✅
   - ✅ Server handles bounding box computation from camera pose
   - ✅ Server performs active-floor filtering via database queries
   - ✅ Zone delta computation implemented (`ZoneDelta` with added/removed zones)
   - ✅ Zones delivered asynchronously via `stream_delta` messages
   - ✅ Unit tests for zone bounding box and delta computation
   - ✅ Zone delta delivery on pose updates via `stream_update_pose` handler
3. **Authentication-Aware Streaming** ✅
   - ✅ WebSocket handshake enforces JWT validation (`conn.userID` set on connection)
   - ✅ Subscriptions tracked per user ID with ownership validation
   - ✅ Unit tests for subscription ownership validation

#### Phase 3 – Client Slim-Down ✅ COMPLETE
1. **Client Consumption Update** ✅
   - ✅ `ChunkManager` updated to use `stream_subscribe` instead of `chunk_request`
   - ✅ `ZoneManager` updated to consume `stream_delta` messages with zones
   - ✅ Client subscribes automatically on WebSocket connection
   - ✅ Legacy `chunk_request` still supported for backward compatibility
   - ⏳ **Remaining**: Remove client-side decompression/coordinate math (kept for now for compatibility)
2. **Documentation & Cleanup** ✅ COMPLETE
   - ✅ Integration testing plan created (`docs/refactor/INTEGRATION_TESTING.md`)
   - ✅ Updated `docs/06-client-architecture.md` to reflect server-driven streaming
   - ✅ Updated `docs/07-streaming-system.md` with completed delta streaming implementation
   - ✅ Updated README with server-driven pipeline description
   - ⏳ Remove obsolete code paths (legacy chunk_request can be removed after full migration - kept for backward compatibility)

### Working Agreement
- ✅ All work happens on `feature/client-refactor`, with incremental commits per phase.
- ✅ Each milestone keeps the branch buildable (backward compatibility maintained).
- ✅ Every code change accompanied by matching documentation and automated tests.

### Implementation Status

**Completed:**
- ✅ Streaming subscription system (`stream_subscribe`, `stream_ack`, `stream_delta`)
- ✅ Server-side chunk pipeline (selection, generation, compression, delivery)
- ✅ Server-side zone pipeline (bounding box, filtering, delivery)
- ✅ Chunk delta computation
- ✅ Zone delta computation
- ✅ Pose update handler (`stream_update_pose` with automatic delta delivery)
- ✅ Client integration (ChunkManager and ZoneManager use streaming)
- ✅ Unit tests for streaming manager
- ✅ Integration testing plan

**Remaining:**
- ✅ Pose update handler (`stream_update_pose` message type) - **COMPLETED**
- ✅ Zone delta delivery on pose updates - **COMPLETED**
- ✅ Documentation updates (`docs/06-client-architecture.md`, `docs/07-streaming-system.md`, `README.md`) - **COMPLETED**
- ⏳ Remove legacy client-side processing (after full migration verified - kept for backward compatibility)

### Testing

- ✅ Unit tests: `server/internal/streaming/manager_test.go` (7 tests, all passing)
- ✅ Unit tests: `server/internal/api/websocket_test.go` (stream_subscribe, stream_update_pose handlers)
- ✅ Integration test framework: `server/internal/api/websocket_integration_test.go`
- ✅ Integration test scenarios: 3 scenarios implemented and passing
  - Streaming subscription flow
  - Pose updates with chunk deltas
  - Zone streaming with test data
- ✅ Integration test plan: `docs/refactor/INTEGRATION_TESTING.md`
- ⏳ Additional integration test scenarios (ring wrapping, error handling, performance)
- ⏳ Manual testing checklist (see integration testing doc)

