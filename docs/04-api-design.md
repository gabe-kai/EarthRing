# API Design

## Table of Contents

- [Overview](#overview)
- [Authentication and Authorization](#authentication-and-authorization)
  - [Authentication](#authentication)
- [Authorization](#authorization)
- [REST API Endpoints](#rest-api-endpoints)
  - [Player Management](#player-management)
  - [Zone Management](#zone-management)
  - [Structure Management](#structure-management)
  - [Chunk Management](#chunk-management)
  - [Procedural Generation Service API](#procedural-generation-service-api)
  - [Racing](#racing)
- [WebSocket Protocol](#websocket-protocol)
  - [Connection](#connection)
  - [Protocol Version Negotiation](#protocol-version-negotiation)
  - [Message Format](#message-format)
  - [Message Types](#message-types)
  - [Error Handling](#error-handling)
  - [Error Codes](#error-codes)
  - [Error Response Format](#error-response-format)
- [Rate Limiting](#rate-limiting)
  - [Limits](#limits)
  - [Rate Limit Headers](#rate-limit-headers)
- [Versioning](#versioning)
  - [API Versioning](#api-versioning)
  - [Protocol Versioning](#protocol-versioning)
- [Compression](#compression)
  - [Request/Response Compression](#requestresponse-compression)
  - [Chunk Data Compression](#chunk-data-compression)
  - **Note**: Detailed compression specification in `07-streaming-system.md` Compression section
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The EarthRing API consists of two main communication protocols: REST for stateful operations and WebSocket for real-time bidirectional communication. The API is designed to be client-agnostic, supporting web, light local, and Unreal clients.

## Authentication and Authorization

### Authentication

All API requests require authentication except for public endpoints.

1. **Registration**
   ```
   POST /api/auth/register
   Body: {
     "username": "player1",
     "email": "player@example.com",
     "password": "SecurePass123!"
   }
   Response: {
     "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "expires_at": "2024-01-01T00:15:00Z",
     "user_id": 123,
     "username": "player1",
     "role": "player"
   }
   ```
   **Rate Limit**: 5 requests per minute per IP

2. **Login**
   ```
   POST /api/auth/login
   Body: {
     "username": "player1",
     "password": "SecurePass123!"
   }
   Response: {
     "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "expires_at": "2024-01-01T00:15:00Z",
     "user_id": 123,
     "username": "player1",
     "role": "player"
   }
   ```
   **Rate Limit**: 5 requests per minute per IP

3. **Token Refresh**
   ```
   POST /api/auth/refresh
   Headers: {
     "Authorization": "Bearer <refresh_token>"
   }
   Body (optional): {
     "refresh_token": "<refresh_token>"
   }
   Response: {
     "access_token": "new_jwt_token",
     "refresh_token": "new_refresh_token",
     "expires_at": "2024-01-01T00:15:00Z",
     "user_id": 123,
     "username": "player1",
     "role": "player"
   }
   ```
   **Rate Limit**: 5 requests per minute per IP
   **Note**: Refresh tokens are rotated on each refresh

4. **Logout**
   ```
   POST /api/auth/logout
   Headers: {
     "Authorization": "Bearer <access_token>"
   }
   Response: {
     "message": "Logged out successfully"
   }
   ```
   **Rate Limit**: 5 requests per minute per IP
   **Note**: Client should discard tokens locally

### Authorization

- JWT tokens in `Authorization: Bearer <token>` header
- Token contains user ID and permissions
- WebSocket connections authenticated during handshake

## REST API Endpoints

### Player Management

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/api/player_handlers.go`)

#### Get Current Player Profile
```
GET /api/players/me
Headers: Authorization: Bearer <access_token>
Response: {
  "id": 123,
  "username": "player1",
  "level": 5,
  "experience_points": 10000,
  "currency_amount": 50000,
  "current_position": {"x": 12345, "y": 0},
  "current_floor": 0,
  "created_at": "2024-01-01T00:00:00Z",
  "last_login": "2024-01-01T12:00:00Z"
}
```
**Rate Limit**: 500 requests per minute per user

#### Get Player Profile
```
GET /api/players/{player_id}
Headers: Authorization: Bearer <access_token>
Response: {
  "id": 123,
  "username": "player1",
  "level": 5,
  "experience_points": 10000,
  "currency_amount": 50000,
  "current_position": {"x": 12345, "y": 0},
  "current_floor": 0,
  "created_at": "2024-01-01T00:00:00Z",
  "last_login": "2024-01-01T12:00:00Z"
}
```
**Rate Limit**: 500 requests per minute per user
**Note**: Users can only view their own profile (403 Forbidden if requesting another player's profile)

#### Update Player Position
```
PUT /api/players/{player_id}/position
Headers: Authorization: Bearer <access_token>
Body: {
  "position": {"x": 12345, "y": 0},
  "floor": 0
}
Response: {
  "success": true,
  "position": {"x": 12345, "y": 0},
  "floor": 0
}
```
**Rate Limit**: 500 requests per minute per user
**Validation**:
- X position: 0 to 264,000,000 meters (ring circumference)
- Y position: Any valid float (ring width)
- Floor: -2 to 15
**Note**: Users can only update their own position (403 Forbidden if updating another player's position)

### Zone Management

#### Create Zone
```
POST /api/zones
Headers: Authorization
Body: {
  "name": "Downtown District",
  "zone_type": "commercial",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[x1, y1], [x2, y2], [x3, y3], [x1, y1]]]
  },
  "floor": 0,
  "properties": {
    "density": "high",
    "style": "modern"
  }
}
Response: {
  "id": 456,
  "name": "Downtown District",
  "zone_type": "commercial",
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### Get Zone
```
GET /api/zones/{zone_id}
Headers: Authorization
Response: {
  "id": 456,
  "name": "Downtown District",
  "zone_type": "commercial",
  "geometry": {...},
  "owner_id": 123,
  "properties": {...}
}
```

#### Update Zone
```
PUT /api/zones/{zone_id}
Headers: Authorization
Body: {
  "name": "Updated Name",
  "properties": {
    "density": "medium"
  }
}
Response: {
  "id": 456,
  "name": "Updated Name",
  ...
}
```

#### Delete Zone
```
DELETE /api/zones/{zone_id}
Headers: Authorization
Response: {
  "success": true
}
```

#### Get Zones in Area
```
GET /api/zones/area?x_min={x_min}&x_max={x_max}&y_min={y_min}&y_max={y_max}&floor={floor}
Headers: Authorization
Response: {
  "zones": [
    {"id": 456, "name": "Zone 1", ...},
    {"id": 457, "name": "Zone 2", ...}
  ]
}
```

### Structure Management

#### Place Structure
```
POST /api/structures
Headers: Authorization
Body: {
  "structure_type": "building",
  "position": {"x": 12345, "y": 100},
  "floor": 0,
  "rotation": 45,
  "scale": 1.0,
  "zone_id": 456,
  "properties": {
    "building_type": "apartment",
    "height": 50
  }
}
Response: {
  "id": 789,
  "structure_type": "building",
  "position": {"x": 12345, "y": 100},
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### Get Structure
```
GET /api/structures/{structure_id}
Headers: Authorization
Response: {
  "id": 789,
  "structure_type": "building",
  "position": {"x": 12345, "y": 100},
  "properties": {...},
  "model_data": {...}
}
```

#### Update Structure
```
PUT /api/structures/{structure_id}
Headers: Authorization
Body: {
  "rotation": 90,
  "properties": {
    "height": 60
  }
}
Response: {
  "id": 789,
  ...
}
```

#### Delete Structure
```
DELETE /api/structures/{structure_id}
Headers: Authorization
Response: {
  "success": true
}
```

#### Get Structures in Chunk
```
GET /api/structures/chunk?floor={floor}&chunk_index={chunk_index}
Headers: Authorization
Response: {
  "structures": [
    {"id": 789, "structure_type": "building", ...},
    {"id": 790, "structure_type": "decoration", ...}
  ]
}
```

### Chunk Management

**Implementation Status:** ✅ **PARTIALLY IMPLEMENTED** (metadata endpoint implemented, chunk request endpoint pending)

#### Get Chunk Metadata
```
GET /api/chunks/{chunk_id}
Headers: Authorization: Bearer <access_token>
Response: {
  "id": "0_12345",
  "floor": 0,
  "chunk_index": 12345,
  "version": 1,
  "last_modified": "2024-01-01T00:00:00Z",
  "is_dirty": false
}
```
**Rate Limit**: 100 requests per minute per user
**chunk_id Format**: `"floor_chunk_index"` (e.g., `"0_12345"` for floor 0, chunk index 12345)
**chunk_index Range**: 0 to 263,999
**Note**: Returns default metadata (version 1, is_dirty: false) if chunk doesn't exist yet (acceptable for chunks that haven't been generated)

#### Request Chunks (To Be Implemented)
```
POST /api/chunks/request
Headers: Authorization: Bearer <access_token>
Body: {
  "chunks": ["0_12345", "0_12346"],
  "lod_level": "medium"
}
Response: {
  "chunks": [
    {
      "id": "0_12345",
      "geometry": "...", // Compressed/base64
      "structures": [...],
      "zones": [...],
      "metadata": {...}
    }
  ]
}
```
**Status**: ⏳ **PENDING** (Phase 2: Map System Foundation)

### Procedural Generation Service API

**Status**: ✅ **IMPLEMENTED** (Phase 1: basic service with empty chunk generation)

The Python procedural generation service exposes a REST API for chunk generation. This is an internal service API called by the Go server, not directly exposed to clients.

**Base URL**: `http://localhost:8081` (configurable via `PROCEDURAL_BASE_URL`)

#### Health Check
```
GET /health
Response: {
  "status": "ok",
  "service": "earthring-procedural-service",
  "version": "0.1.0"
}
```

#### Generate Chunk
```
POST /api/v1/chunks/generate
Content-Type: application/json

Request: {
  "floor": 0,
  "chunk_index": 12345,
  "lod_level": "medium",  // "low", "medium", "high"
  "world_seed": 12345     // Optional, uses default if not provided
}

Response: {
  "success": true,
  "chunk": {
    "chunk_id": "0_12345",
    "floor": 0,
    "chunk_index": 12345,
    "width": 400.0,
    "version": 1
  },
  "geometry": null,        // Empty for Phase 1
  "structures": [],        // Empty for Phase 1
  "zones": [],            // Empty for Phase 1
  "message": "Empty chunk generated (full generation pending Phase 2)"
}
```

**Note**: For Phase 1, this endpoint returns empty chunks with metadata only. Full generation (buildings, zones, geometry) will be implemented in Phase 2.

#### Get Chunk Seed
```
GET /api/v1/chunks/seed/{floor}/{chunk_index}?world_seed=12345
Response: {
  "floor": 0,
  "chunk_index": 12345,
  "world_seed": 12345,
  "chunk_seed": 1234567890
}
```

**Use Case**: Useful for debugging and ensuring deterministic seed generation.

**Configuration**:
- Default port: `8081` (via `PROCEDURAL_SERVICE_PORT`)
- Default timeout: `30s` (via `PROCEDURAL_TIMEOUT`)
- Default retry count: `3` (via `PROCEDURAL_RETRY_COUNT`)
- Default world seed: `12345` (via `WORLD_SEED`)

**Go Server Integration**:
- Go server includes a `ProceduralClient` in `server/internal/procedural/client.go`
- Client handles retries with exponential backoff
- Client is integrated into `ChunkHandlers` for future chunk generation requests

### Racing

#### Create Racing Event
```
POST /api/racing/events
Headers: Authorization
Body: {
  "name": "Downtown Street Race",
  "start_point": {"x": 12345, "y": 100},
  "end_point": {"x": 15678, "y": 200},
  "checkpoints": [{"x": 14000, "y": 150}], // Optional
  "floor": 0,
  "route_generation": "auto", // 'auto' or 'manual'
  "properties": {
    "vehicle_type": "sports_car",
    "laps": 1 // Typically 1 lap for street racing
  }
}
Response: {
  "id": 101,
  "name": "Downtown Street Race",
  "route_geometry": {
    "type": "LineString",
    "coordinates": [[x1, y1], [x2, y2], ...] // Generated route through infrastructure
  },
  "status": "pending",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Route Generation**:
- **Auto**: System generates route using pathfinding through existing transportation infrastructure
- **Manual**: Player can specify exact route (still must use existing infrastructure)

#### Join Racing Event
```
POST /api/racing/events/{event_id}/join
Headers: Authorization
Response: {
  "success": true,
  "event_id": 101,
  "start_time": "2024-01-01T12:00:00Z"
}
```

#### Submit Race Result
```
POST /api/racing/events/{event_id}/result
Headers: Authorization
Body: {
  "finish_time": "00:05:30.123",
  "checkpoint_times": ["00:01:50.000", "00:03:20.100", "00:05:30.023"], // Times at each checkpoint
  "vehicle_data": {...}
}
Response: {
  "success": true,
  "position": 1,
  "leaderboard_position": 5
}
```

#### Get Race Leaderboard
```
GET /api/racing/events/{event_id}/leaderboard
Headers: Authorization
Response: {
  "event_id": 101,
  "leaderboard": [
    {
      "player_id": 123,
      "username": "player1",
      "finish_time": "00:05:20.000",
      "position": 1
    },
    ...
  ]
}
```

## WebSocket Protocol

**Status**: ✅ **IMPLEMENTED** (Phase 1)

### Connection

```
WebSocket URL: ws://localhost:8080/ws (development)
WebSocket URL: wss://api.earthring.game/ws (production)
Handshake: Include JWT token in query parameter or header
```

**Connection Lifecycle:**
- Client connects with JWT token (query parameter `?token=<jwt>` or `Authorization: Bearer <jwt>` header)
- Server validates token and upgrades connection
- Protocol version is negotiated via `Sec-WebSocket-Protocol` header
- Connection remains open until client disconnects or server closes it
- Automatic heartbeat: Server sends ping frames every 30 seconds
- Client should respond to ping frames with pong frames
- Client can also send `ping` messages for application-level heartbeat
- Connection timeout: 60 seconds without pong response triggers disconnect

#### Protocol Version Negotiation

**Decision**: WebSocket protocol version is negotiated during the handshake using the `Sec-WebSocket-Protocol` header.

**Client Handshake:**
```
GET /ws HTTP/1.1
Host: api.earthring.game
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <key>
Sec-WebSocket-Protocol: earthring-v1, earthring-v2
Authorization: Bearer <jwt_token>
```

**Server Response:**
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: <accept_key>
Sec-WebSocket-Protocol: earthring-v2
```

**Version Selection:**
- Client sends list of supported versions (e.g., `earthring-v1, earthring-v2`)
- Server selects highest mutually supported version
- If no version match, server closes connection with error
- All messages on the connection use the negotiated version

**Version Format:**
- Format: `earthring-v{N}` where N is the major version number
- Examples: `earthring-v1`, `earthring-v2`, `earthring-v3`
- Major version increments for breaking changes
- Minor changes handled within same version (optional fields, backward compatible)

### Message Format

All WebSocket messages use JSON:

```json
{
  "type": "message_type",
  "id": "unique_message_id", // For request/response matching
  "data": {...} // Message-specific data
}
```

### Message Types

#### Client → Server

1. **ping** (Heartbeat)
   ```json
   {
     "type": "ping",
     "id": "ping_123"
   }
   ```
   - Used for connection keepalive/heartbeat
   - Server responds with `pong` message
   - Recommended interval: 30 seconds
   - Server also sends automatic ping frames every 30 seconds

2. **chunk_request**
   ```json
   {
     "type": "chunk_request",
     "id": "req_123",
     "data": {
       "chunks": ["0_12345", "0_12346"],
       "lod_level": "medium"
     }
   }
   ```

2. **player_move**
   ```json
   {
     "type": "player_move",
     "data": {
       "position": {"x": 12345, "y": 0},
       "floor": 0,
       "rotation": 45
     }
   }
   ```

3. **zone_create**
   ```json
   {
     "type": "zone_create",
     "id": "req_124",
     "data": {
       "name": "New Zone",
       "zone_type": "residential",
       "geometry": {...}
     }
   }
   ```

4. **structure_place**
   ```json
   {
     "type": "structure_place",
     "id": "req_125",
     "data": {
       "structure_type": "building",
       "position": {"x": 12345, "y": 100},
       "properties": {...}
     }
   }
   ```

5. **racing_start**
   ```json
   {
     "type": "racing_start",
     "data": {
       "event_id": 101,
       "route": {
         "type": "LineString",
         "coordinates": [[x1, y1], [x2, y2], ...]
       },
       "checkpoints": [{"x": 14000, "y": 150}]
     }
   }
   ```

6. **racing_update**
   ```json
   {
     "type": "racing_update",
     "data": {
       "event_id": 101,
       "position": {"x": 12345, "y": 0},
       "speed": 120,
       "checkpoint_reached": 2 // Which checkpoint player has reached
     }
   }
   ```

#### Server → Client

1. **pong** (Heartbeat Response)
   ```json
   {
     "type": "pong",
     "id": "ping_123" // Matches ping request ID
   }
   ```
   - Response to `ping` messages
   - Server also sends automatic pong frames in response to ping frames

2. **error**
   ```json
   {
     "type": "error",
     "id": "req_123", // Matches request ID if applicable
     "error": "Error message",
     "message": "Human-readable error message",
     "code": "ErrorCode"
   }
   ```
   - Sent when an error occurs processing a message
   - Common error codes: `InvalidMessageFormat`, `UnknownMessageType`, `NotImplemented`, `Unauthorized`

3. **chunk_data**
   ```json
   {
     "type": "chunk_data",
     "id": "req_123", // Matches request ID
     "data": {
       "chunks": [
         {
           "id": "0_12345",
           "geometry": "...",
           "structures": [...],
           "zones": [...]
         }
       ]
     }
   }
   ```

2. **chunk_updated**
   ```json
   {
     "type": "chunk_updated",
     "data": {
       "chunk_id": "0_12345",
       "version": 3,
       "changes": {
         "structures": ["added", "removed"],
         "zones": ["modified"]
       }
     }
   }
   ```

3. **zone_created**
   ```json
   {
     "type": "zone_created",
     "id": "req_124",
     "data": {
       "id": 456,
       "name": "New Zone",
       "zone_type": "residential",
       "geometry": {...}
     }
   }
   ```

4. **structure_placed**
   ```json
   {
     "type": "structure_placed",
     "id": "req_125",
     "data": {
       "id": 789,
       "structure_type": "building",
       "position": {"x": 12345, "y": 100}
     }
   }
   ```

5. **player_move_ack** (Acknowledgment)
   ```json
   {
     "type": "player_move_ack",
     "id": "req_124" // Matches player_move request ID
   }
   ```
   - Acknowledgment response to `player_move` messages
   - Currently returns immediately (full implementation pending Phase 2)

6. **player_moved** (Broadcast)
   ```json
   {
     "type": "player_moved",
     "data": {
       "player_id": 123,
       "position": {"x": 12345, "y": 0},
       "floor": 0
     }
   }
   ```
   - Broadcast to other players when a player moves (not yet implemented)

7. **racing_started**
   ```json
   {
     "type": "racing_started",
     "data": {
       "event_id": 101,
       "start_time": "2024-01-01T12:00:00Z",
       "participants": [123, 124, 125],
       "route": {
         "type": "LineString",
         "coordinates": [[x1, y1], [x2, y2], ...]
       },
       "checkpoints": [{"x": 14000, "y": 150}]
     }
   }
   ```

8. **racing_update**
   ```json
   {
     "type": "racing_update",
     "data": {
       "event_id": 101,
       "players": [
         {
           "player_id": 123,
           "position": {"x": 12345, "y": 0},
           "checkpoint_reached": 2,
           "time": "00:03:45.123"
         }
       ]
     }
   }
   ```

### Error Handling

#### Error Codes

- `AUTHENTICATION_REQUIRED`: Not authenticated
- `AUTHORIZATION_FAILED`: Insufficient permissions
- `INVALID_REQUEST`: Malformed request
- `INVALID_ZONE`: Zone validation failed
- `INVALID_STRUCTURE`: Structure placement invalid
- `CHUNK_NOT_FOUND`: Requested chunk doesn't exist
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `SERVER_ERROR`: Internal server error

#### Error Response Format

```json
{
  "type": "error",
  "id": "req_123",
  "data": {
    "code": "INVALID_ZONE",
    "message": "Zone geometry contains self-intersections",
    "details": {
      "field": "geometry",
      "issue": "self_intersection"
    }
  }
}
```

## Rate Limiting

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/api/ratelimit.go`)

### Limits

**Multi-tier rate limiting:**

1. **Global Rate Limit** (All endpoints)
   - **Limit**: 1000 requests per minute per IP
   - **Purpose**: Prevent DoS attacks
   - **Status**: ✅ Implemented

2. **Authentication Endpoints** (register, login, refresh, logout)
   - **Limit**: 5 requests per minute per IP
   - **Status**: ✅ Implemented

3. **Per-User Rate Limit** (Authenticated endpoints)
   - **Limit**: 500 requests per minute per user
   - **Status**: ✅ Implemented (middleware available)

4. **Future Endpoints** (to be implemented)
   - Zone Creation: 10 requests per minute per user
   - Structure Placement: 20 requests per minute per user
   - Chunk Requests: 100 requests per minute per user
   - WebSocket: 1000 messages per minute per connection

### Rate Limit Headers

All responses include rate limit headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

### Rate Limit Exceeded Response

When rate limit is exceeded, returns `429 Too Many Requests`:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retry_after": 60
}
```

See `docs/05-authentication-security.md` for detailed rate limiting specification.

## Versioning

### API Versioning

- URL-based: `/api/v1/...`
- Header-based: `API-Version: 1`
- Default to latest version if not specified

### Protocol Versioning

**Strategy**: Version in handshake using WebSocket subprotocol negotiation.

**Implementation:**
- Client sends supported versions in `Sec-WebSocket-Protocol` header
- Server selects highest mutually supported version
- All messages on connection use negotiated version
- Version format: `earthring-v{N}` (e.g., `earthring-v1`, `earthring-v2`)

**Backward Compatibility:**
- Server supports 2-3 protocol versions simultaneously during transitions
- Deprecation timeline: Old versions deprecated with 6-month notice before removal
- Clients should upgrade to latest version
- Server logs version usage for monitoring and migration planning

**Version Numbering:**
- **Major versions** (`v1`, `v2`, etc.): Breaking changes requiring new version
- **Minor changes**: Handled within same version using optional fields
- Breaking changes include: Message structure changes, required field additions, type changes

**Benefits:**
- Clear version negotiation at connection time
- Server can reject incompatible clients immediately
- Simple to implement using standard WebSocket subprotocol
- Works well with multiple client types (web, light local, Unreal)
- Easy to debug (version visible in connection logs)

## Compression

### Request/Response Compression

- Support gzip/deflate compression
- Client indicates support via `Accept-Encoding` header
- Server compresses responses > 1KB

### Chunk Data Compression

**Detailed Specification**: See `07-streaming-system.md` Compression section for complete details.

**Summary**:
- **Geometry**: Custom binary format with gzip compression (gzip level 6)
- **Textures**: WebP format (85% quality, LOD-based resolution)
- **Metadata**: MessagePack format with gzip compression if >1KB
- **Transmission**: JSON wrapper with base64-encoded binary payloads
- **Base64 encoding**: Used for binary data in JSON messages
- **Client Libraries**: pako (gzip), @msgpack/msgpack (metadata)

## Open Questions

1. Should we use GraphQL for complex queries instead of REST?
2. How do we handle WebSocket reconnection and message queuing?
3. Should chunk data use binary protocol instead of JSON?
4. Should we support server-sent events (SSE) as alternative to WebSocket?

## Future Considerations

- GraphQL API for flexible queries
- gRPC for high-performance RPC calls
- Message queue integration (RabbitMQ, Kafka)
- API documentation (OpenAPI/Swagger)
- SDKs for different languages
- Webhook support for external integrations

