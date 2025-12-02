# EarthRing

A multi-genre game (city builder, light Sims elements, and racing) set on an orbital ring structure around Earth. The game features a database-driven architecture that separates data persistence from game clients, allowing the underlying engine and code to evolve while maintaining the same persistent world state.

## Project Overview

EarthRing is set on a massive orbital ring structure:
- **Circumference**: 264,000 km (seamlessly wraps around)
- **Base Width**: 400 meters (variable-width chunks based on station flares)
- **Station System**: 12 pillar/elevator hubs spaced ~22,000 km apart
  - Chunks flare from 400m base width to 25 km maximum width at hub centers
  - Chunks flare from 5 base levels to 15 levels at hub centers
  - Seam center plateau: the five chunk centers surrounding each pillar hub (two on either side of the seam plus the seam chunk itself) are clamped to the maximum width before tapering outward, guaranteeing a perfectly flush transition at chunk indices `...263998, 263999, 0, 1, 2...`
  - Smooth cosine-based transitions for the remainder of each flare zone
- **Gameplay**: City building, NPC simulation, and racing through player-built cities

### Coordinate System

**Status**: ✅ **MIGRATION COMPLETE** - The coordinate system has been migrated to ER0/EarthRing coordinates. Legacy coordinate support is maintained for backward compatibility.

- **ER0**: Earth-Centered, Earth-Fixed frame (origin at Earth's center)
- **RingPolar**: (theta, r, z) - angle around ring, radial offset, vertical offset
- **RingArc**: (s, r, z) - arc length along ring, radial offset, vertical offset
- **Kongo Hub**: Anchored to ER0 at (KongoHubRadius, 0, 0) = (6,878,137 m, 0, 0)

See [Coordinate System Migration](docs/refactor/coordinate-system-migration.md) and [Map System Design](docs/02-map-system.md#coordinate-system) for details.

## Current Client Features

- **Camera controls**: 
  - **WASD**: Move camera forward, left, backward, right (maintains elevation, horizontal movement only)
  - **Mouse Scroll Wheel**: Zoom in/out
  - **Middle Mouse Button (Hold)**: Rotate/orbit and tilt camera around target
  - **Right Mouse Button (Hold)**: Pan camera
  - **Left Mouse Button**: Select tool (default) - click zones to select them
  - **Q/E**: Rotate camera counter-clockwise/clockwise around target
  - **R/F**: Pan camera up/down (vertical movement)
  - **PageUp/PageDown**: Zoom in/out (keyboard alternative)
  - **Elevation-based speed**: Movement speed scales with camera height (slower near ground for precise building placement, faster at higher elevations for quick navigation)
  - Input is suppressed automatically while typing in UI fields
- **Zone tools & selection**:
  - **Left Mouse Button**: Default select tool - click zones to select, or use with drawing tools when a tool is active
  - **Right Mouse Button**: Dismiss tool - returns to select mode when a zone tool (circle, rectangle, etc.) is active
- **Seamless chunk wrapping**: The renderer shifts each chunk by whole ring circumferences so the camera always sees the nearest copy (e.g. chunk `263999` renders directly adjacent to chunk `0` with no gap or overlap).
- **Station flare visualization**: Variable-width geometry coming from the procedural service (including the pillar seam plateau) is rendered directly in the client, so narrow, wide, and taper segments all appear exactly as generated.
- **Chunk compression**: Geometry is compressed using custom binary format + gzip, achieving 2.6-3.1:1 compression ratios. Compression/decompression is automatic and transparent.
- **Zone overlays & toolbar**: Authenticated players can load nearby zones from the REST API and view them as world-anchored translucent polygons with colored outlines. A bottom toolbar provides zone type selection, drawing tools (Rectangle, Circle, Polygon, Paintbrush, Dezone), and controls for grid visibility and per-zone-type visibility (Residential, Commercial, Industrial, Mixed-Use, Park, Agricultural, Restricted, Dezone). Zones remain fully visible regardless of camera position, while the grid fades around the camera. Zone editor includes create, update, delete, and selection functionality with an info window for selected zones.
- **Procedural building generation**: Buildings are procedurally generated in industrial, commercial, and mixed-use zones at hub platforms. Buildings include simple window patterns and are validated to stay within zone boundaries. Structures persist with chunks and reload when chunks are loaded.
- **Active Floor System**: The player can select an active floor (-2 to +2) independent of camera elevation. All game content (chunks, zones, grid, buildings, NPCs) is loaded and rendered for the selected floor, allowing the camera to zoom out for a wider view while keeping actions on the chosen floor. The active floor can be changed using the `+`/`−` buttons in the zones toolbar (click "Z" icon to expand).
- **Chunk mesh reuse & precision fixes**: Chunk geometry is now rendered relative to each chunk’s local origin and we cache meshes while the camera is stable. This eliminated the far-side platform flicker and prevents precision loss when working ~132,000 km away from the origin.
- **Server-driven streaming**: The client subscribes to chunk/zone streams via `stream_subscribe` and sends `stream_update_pose` messages as the camera moves. The server computes chunk and zone deltas (added/removed) and streams them efficiently via `stream_delta` messages, eliminating the need for client-side chunk selection logic. Chunks automatically unload behind the camera as you move. See [Streaming System Documentation](docs/07-streaming-system.md) for complete details.
- **Authentication-aware streaming**: The render loop, chunk loader, and zone manager now defer all network calls until the user is logged in. No more "Not authenticated" spam on cold starts—the client just shows the auth UI until tokens are present.

## Prerequisites

**Verified Versions** (as of project setup):
- **Go**: 1.24.0 (required: 1.21+, CI uses 1.24)
- **Python**: 3.14.0 (required: 3.11+)
- **PostgreSQL**: 16.3 with PostGIS 3.5 (required: 14+ with PostGIS)
- **Node.js**: v24.11.0 (required: 18+)
- **Git**: 2.36.1+ (for version control)

**Development Tools**: Git, IDE/Editor (VS Code recommended), Database GUI (optional), Docker (optional)

## Quick Start

**Important**: All commands should be run from the project root directory (`EarthRing/`). The project root contains `README.md`, `docs/`, `server/`, `client-web/`, etc.

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd EarthRing
   ```
   
   **Note**: Ensure you're in the project root directory (`EarthRing/`) before running any commands. The project root is identifiable by the presence of `README.md`, `docs/`, `server/`, and `client-web/` directories.

2. **Run setup script** (installs dependencies)
   ```powershell
   # Windows PowerShell
   .\scripts\setup.ps1
   
   # Linux/Mac
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

3. **Configure environment variables**
   
   **Server configuration:**
   ```powershell
   # Copy example file and update with your values
   cd server
   Copy-Item .env.example .env
   # Edit .env and set:
   # - DB_PASSWORD (your PostgreSQL password)
   # - JWT_SECRET (generate with: openssl rand -hex 32)
   # - REFRESH_SECRET (generate with: openssl rand -hex 32)
   # - ENABLE_PERFORMANCE_PROFILING (optional, set to "true" to enable performance profiling)
   ```
   
   **Performance Profiling**: See [Performance Profiling Documentation](docs/PERFORMANCE_PROFILING.md) for details on enabling and using the performance profiling system.
   
   **Client configuration (optional):**
   ```powershell
   cd client-web
   Copy-Item .env.example .env.local
   # Edit .env.local if you need to change server URLs
   ```
   
   See `server/internal/config/README.md` for detailed configuration options.

4. **Set up the database**
   
   **Option A: Using the migration script (Recommended)**
   ```powershell
   # Windows PowerShell
   .\database\run_migrations.ps1 -Action up
   
   # Linux/Mac (if using golang-migrate)
   migrate -path database/migrations -database "postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable" up
   ```
   
   **Option B: Manual setup**
   ```sql
   psql -U postgres
   CREATE DATABASE earthring_dev;
   \c earthring_dev
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS postgis_topology;
   ```
   
   **Note**: The migration script (`database/run_migrations.ps1`) will automatically create the database if it doesn't exist and apply all migrations. See `database/migrations/README.md` for details.

5. **Verify installation**
   ```bash
   cd server && go test ./... && python -m pytest tests/test_basic.py -v
   cd ../client-web && npm test
   ```

### Development Commands

**Start servers:**
```bash
# Terminal 1: Go server
cd server
# Make sure .env file exists with required configuration
# Required: DB_PASSWORD, JWT_SECRET, REFRESH_SECRET
# Optional: ENABLE_PERFORMANCE_PROFILING=true (enables performance profiling)
go run cmd/earthring-server/main.go
# Runs on http://localhost:8080 (or port specified in SERVER_PORT)
# Provides REST API endpoints and WebSocket connections
# Performance profiling: Set ENABLE_PERFORMANCE_PROFILING=true to enable
#   - Tracks timing for streaming operations (subscriptions, pose updates, chunk loading, zone queries)
#   - Logs performance reports every 5 minutes
#   - See docs/PERFORMANCE_PROFILING.md for details

# Terminal 2: Python procedural generation service (required for chunk generation)
cd server
# Install Python dependencies first: pip install -r requirements.txt
python -m uvicorn internal.procedural.main:app --host 0.0.0.0 --port 8081 --reload
# Or use the script: ./scripts/run-procedural-service.ps1 (Windows) or ./scripts/run-procedural-service.sh (Linux/Mac)
# Runs on http://localhost:8081
# Go server will call this service for chunk generation

# Note for Windows users: If you encounter connection errors between Go server and Python service,
# set the PROCEDURAL_BASE_URL environment variable to use 127.0.0.1 instead of localhost:
# PowerShell: $env:PROCEDURAL_BASE_URL="http://127.0.0.1:8081"
# This avoids IPv6 localhost resolution issues on Windows.
# To make it permanent, add it to your system environment variables or create a .env file in the server directory.

# Terminal 3: Web client
cd client-web
npm run dev
# Runs on http://localhost:3000
# Authentication UI will appear on first load
```

**Authentication:**
- Register: `POST http://localhost:8080/api/auth/register`
- Login: `POST http://localhost:8080/api/auth/login`
- Refresh Token: `POST http://localhost:8080/api/auth/refresh` (with `Authorization: Bearer <refresh_token>` header)
- Logout: `POST http://localhost:8080/api/auth/logout`
- All authentication endpoints are protected by rate limiting (5 requests per minute per IP)

**Rate Limiting:**
- **Authentication endpoints**: 5 requests per minute per IP (register, login, refresh, logout)
- **Global limit**: 1000 requests per minute per IP (applied to all routes)
- **Per-user limit**: 500 requests per minute per user (for authenticated endpoints)
- All responses include rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)
- Rate limit exceeded returns `429 Too Many Requests` with retry-after information

**CORS:**
- CORS middleware configured for web client development
- Allowed origins: `http://localhost:3000`, `http://localhost:5173`, and localhost variants

**WebSocket:**
- WebSocket endpoint: `ws://localhost:8080/ws` (or `wss://` for HTTPS)
- Protocol version negotiation via `Sec-WebSocket-Protocol` header (`earthring-v1`)
- Authentication via JWT token (query parameter `?token=<jwt>` or `Authorization: Bearer <jwt>` header)
- Message format: JSON with `type`, `id`, and `data` fields
- Supported message types: `ping`, `pong`, `chunk_request`, `chunk_data`, `player_move`, `player_move_ack`, `error`
- Chunk requests: Send `chunk_request` with chunk IDs and LOD level, receive `chunk_data` response (up to 10 chunks per request)
- Automatic reconnection with exponential backoff
- Heartbeat/ping-pong mechanism (30s interval)

**Player Management:**
- Get current profile: `GET http://localhost:8080/api/players/me` (requires authentication)
- Get player profile: `GET http://localhost:8080/api/players/{player_id}` (requires authentication, own profile only)
- Update position: `PUT http://localhost:8080/api/players/{player_id}/position` (requires authentication, own profile only)
- Rate limit: 500 requests per minute per user

**Chunk Management:**
- Get chunk metadata: `GET http://localhost:8080/api/chunks/{chunk_id}` (format: "floor_chunk_index", e.g., "0_12345")
  - Note: Chunk indices are automatically wrapped (e.g., `0_264000` wraps to `0_0`, `0_-1` wraps to `0_263999`)
- Get chunk version: `GET http://localhost:8080/api/chunks/version` (no auth required, returns current version and history)
- Delete chunk: `DELETE http://localhost:8080/api/chunks/{chunk_id}` (format: "floor_chunk_index", e.g., "0_12345")
  - Deletes chunk and associated data from database
  - Chunk will be regenerated by procedural service on next request
  - Requires authentication
- Invalidate outdated chunks: `GET http://localhost:8080/api/chunks/invalidate-outdated?floor={floor}&chunk_index_start={start}&chunk_index_end={end}`
  - Bulk deletion of chunks with version < current version
  - Optional filtering by floor and chunk index range
  - Requires authentication
- Batch regenerate chunks: `POST http://localhost:8080/api/chunks/batch-regenerate`
  - Regenerates multiple chunks in background (async)
  - Accepts chunk IDs or filters (floor, chunk_index range)
  - Requires authentication
- Rate limit: 100 requests per minute per user
- Returns default metadata if chunk doesn't exist yet
- **Chunk Storage**: ✅ Implemented - Generated chunks are automatically stored in database with PostGIS geometry
- **Database Persistence**: Chunks persist across server restarts and are loaded from database before generating
- **Chunk Deletion**: ✅ Implemented - Chunks can be deleted via API or UI to force regeneration
- **Station Flares**: ✅ Implemented - Chunks have variable width (400m base → 25km at hubs) and variable height (5 base levels → 15 levels at hubs) based on distance from station centers
- **Version Management**: ✅ Implemented - Automatic version detection and regeneration, bulk invalidation, batch regeneration, version metadata storage

**Zone Management:**
- **Zones Toolbar**: Click the "Z" icon on the left side of the screen to expand the zones toolbar:
  - Grid visibility toggle (show/hide the 250m circular LineSegments grid with fade + LOD)
  - All Zones toggle (show/hide all zones at once)
  - Per-zone-type visibility toggles (Residential, Commercial, Industrial, Mixed-Use, Park, Agricultural, Restricted)
  - Each toggle shows current state (green "Hide" when visible, red "Show" when hidden)
- **Zone UI Panel**: Click the **Zones** button (user info bar) to launch the management panel:
  - Load & visualize nearby zones using `GET /api/zones/area` (automatically fetches zones around camera)
  - Create zones (GeoJSON polygons posted to `POST /api/zones`)
  - Get, update, or delete zones by ID
  - Fetch your zones via `GET /api/zones/owner/{owner_id}` for quick inspection
- **REST endpoints:**
  - `POST /api/zones` – create zone (auth required, validates GeoJSON and ownership)
  - `GET|PUT|DELETE /api/zones/{zone_id}` – manage a specific zone
  - `GET /api/zones/area?floor&min_x&min_y&max_x&max_y` – bounding-box query (used by overlays)
  - `GET /api/zones/owner/{owner_id}` – list zones for the authenticated owner (restricted to self)
- **Zone Types**: Residential (green), Commercial (blue), Industrial (orange), Mixed-Use (yellow-orange gradient), Park (light green), Agricultural (sienna brown), Restricted (red)
- **Rendering**: Zones are rendered as world-anchored translucent polygons with colored outlines, remaining fully visible regardless of camera position
- **Conflict Resolution**: Player-created zones always claim their selected space from the player's own zones of different types. Zones of the same type and owner automatically merge. System zones and other players' zones are protected from claims.
- **Rate limit**: 200 requests per minute per user; authentication required for all zone routes
- **Database Utilities** (psql commands):
  - Delete all zones from database:
    
    **Option 1: TRUNCATE with CASCADE (Recommended for clean reset)**
    
    This command deletes all zones, resets the sequence numbering (next zone will be ID 1), and cascades to related tables. This will also delete related records in `structures`, `roads`, and `npcs` that reference zones.
    
    ```powershell
    # Windows PowerShell
    $env:PGPASSWORD = "your_password"; psql -U postgres -d earthring_dev -c "TRUNCATE zones RESTART IDENTITY CASCADE;"
    
    # Or connect interactively:
    psql -U postgres -d earthring_dev
    TRUNCATE zones RESTART IDENTITY CASCADE;
    ```
    ```bash
    # Linux/Mac
    PGPASSWORD="your_password" psql -U postgres -d earthring_dev -c "TRUNCATE zones RESTART IDENTITY CASCADE;"
    
    # Or connect interactively:
    psql -U postgres -d earthring_dev
    TRUNCATE zones RESTART IDENTITY CASCADE;
    ```
    
    **Option 2: Selective DELETE (Preserves related records)**
    
    This approach preserves related records but clears their zone references. Note: This does NOT reset sequence numbering - the next zone will continue from the highest existing ID + 1. To reset numbering after DELETE, use `ALTER SEQUENCE zones_id_seq RESTART WITH 1;`
    
    ```powershell
    # Windows PowerShell
    $env:PGPASSWORD = "your_password"; psql -U postgres -d earthring_dev -c "UPDATE npcs SET home_zone_id = NULL, work_zone_id = NULL; DELETE FROM zones; ALTER SEQUENCE zones_id_seq RESTART WITH 1;"
    
    # Or connect interactively:
    psql -U postgres -d earthring_dev
    UPDATE npcs SET home_zone_id = NULL, work_zone_id = NULL;
    DELETE FROM zones;
    ALTER SEQUENCE zones_id_seq RESTART WITH 1;
    ```
    ```bash
    # Linux/Mac
    PGPASSWORD="your_password" psql -U postgres -d earthring_dev -c "UPDATE npcs SET home_zone_id = NULL, work_zone_id = NULL; DELETE FROM zones; ALTER SEQUENCE zones_id_seq RESTART WITH 1;"
    
    # Or connect interactively:
    psql -U postgres -d earthring_dev
    UPDATE npcs SET home_zone_id = NULL, work_zone_id = NULL;
    DELETE FROM zones;
    ALTER SEQUENCE zones_id_seq RESTART WITH 1;
    ```
    
    **Foreign Key Relationships:**
    - `structures.zone_id` → `zones.id` (ON DELETE SET NULL) - automatically cleared with DELETE
    - `roads.zone_id` → `zones.id` (ON DELETE SET NULL) - automatically cleared with DELETE
    - `npcs.home_zone_id` → `zones.id` (ON DELETE RESTRICT) - **must clear manually before DELETE**, or use TRUNCATE CASCADE
    - `npcs.work_zone_id` → `zones.id` (ON DELETE RESTRICT) - **must clear manually before DELETE**, or use TRUNCATE CASCADE

**Testing UI:**
- After logging in, click "Player" or "Chunks" buttons in the user info bar to test endpoints
- UI panels provide forms to test all endpoints with JSON result display
- Player position updates automatically move the camera to the new location with smooth animation
- Chunk panel includes delete functionality with confirmation dialog - deleted chunks are regenerated on next request
- **Version Management**: Outdated chunks automatically regenerate when requested via WebSocket. Use bulk invalidation API (`GET /api/chunks/invalidate-outdated`) or batch regeneration API (`POST /api/chunks/batch-regenerate`) for managing multiple chunks

**Run tests:**
```bash
cd server && go test ./... && python -m pytest
cd ../client-web && npm test
```

See [Testing Documentation](docs/tests/README.md) for comprehensive testing framework details, test utilities, and coverage information.

**Lint code:**
```bash
cd client-web && npm run lint
```

**Build for production:**
```bash
cd server && go build -o bin/earthring-server cmd/earthring-server/main.go
cd ../client-web && npm run build
```

## Project Structure

```
EarthRing/
├── README.md                          # This file
├── implementation-phases.md           # Implementation roadmap
├── MANUAL_TESTING_GUIDE.md            # Manual testing procedures and guidelines
├── .gitignore                         # Git ignore patterns
├── docs/                              # Design documentation
│   ├── 01-architecture-overview.md    # System architecture and technology stack
│   ├── 02-map-system.md               # Ring geometry, coordinate system, chunk specifications
│   ├── 03-database-schema.md          # Database schema and spatial data design
│   ├── 04-api-design.md               # REST and WebSocket API specifications
│   ├── 05-authentication-security.md  # Authentication and security implementation
│   ├── 06-client-architecture.md      # Web client architecture (Three.js)
│   ├── 07-streaming-system.md         # Chunk loading, streaming, compression
│   ├── 08-procedural-generation.md    # Procedural generation algorithms
│   ├── 09-zone-system.md              # Player-defined zones and road generation
│   ├── 10-game-mechanics.md           # City builder, Sims, and racing mechanics
│   ├── 11-microgravity-physics.md     # Microgravity physics implementation specification
│   ├── 12-npc-ai-pathfinding.md       # NPC AI and pathfinding algorithms specification
│   ├── 13-transportation-generation.md # Transportation generation algorithm specification
│   ├── DEPLOYMENT_CHECKLIST.md        # Deployment procedures
│   ├── DEVELOPER_WORKFLOW.md          # Developer workflow guidelines
│   ├── PERFORMANCE_PROFILING.md       # Performance profiling documentation
│   ├── minimap-system.md              # Minimap system design
│   ├── README.md                      # Documentation index
│   ├── bug_fixes/                     # Bug fix documentation
│   │   ├── WRAP_POINT_FIX_SUMMARY.md  # Summary of wrap point coordinate fixes
│   │   └── ZONE_TOOLS_WRAP_ANALYSIS.md # Analysis of zone tool wrapping issues
│   ├── performance/                   # Performance analysis
│   │   └── grid-overlay-performance-analysis.md # Grid overlay performance profiling
│   ├── refactor/                      # Refactoring documentation
│   │   ├── CLIENT_REFACTOR_STATUS.md  # Client refactoring status and progress
│   │   ├── client-server-responsibility.md # Client-server responsibility boundaries
│   │   ├── coordinate-system-migration.md # Coordinate system migration guide
│   │   ├── coordinate-system-status.md # Current coordinate system status
│   │   └── database-coordinate-migration.md # Database coordinate migration details
│   └── tests/                         # Testing documentation
│       ├── README.md                  # Testing documentation index
│       ├── integration-testing.md     # Integration testing guidelines
│       ├── minimap-test-coverage.md   # Minimap test coverage analysis
│       ├── testing-gap-analysis.md    # Testing gap analysis
│       ├── ui-test-coverage.md        # UI test coverage analysis
│       └── zone-system-test-coverage.md # Zone system test coverage analysis
├── server/                            # Go main server + Python procedural service
│   ├── cmd/earthring-server/         # Server entry point
│   │   ├── main.go
│   │   └── main_test.go
│   ├── internal/                      # Private application code
│   │   ├── api/                       # REST and WebSocket handlers
│   │   │   ├── admin_handlers.go      # Admin panel handlers
│   │   │   ├── admin_routes.go        # Admin routes
│   │   │   ├── auth_routes.go         # Authentication routes
│   │   │   ├── chunk_handlers.go      # Chunk CRUD handlers
│   │   │   ├── chunk_handlers_test.go # Chunk handler tests
│   │   │   ├── chunk_models.go        # Chunk data models
│   │   │   ├── chunk_routes.go        # Chunk routes
│   │   │   ├── cors.go                # CORS middleware
│   │   │   ├── player_handlers.go     # Player management handlers
│   │   │   ├── player_handlers_test.go # Player handler tests
│   │   │   ├── player_models.go       # Player data models
│   │   │   ├── player_routes.go       # Player routes
│   │   │   ├── ratelimit.go           # Rate limiting middleware
│   │   │   ├── ratelimit_test.go      # Rate limiting tests
│   │   │   ├── structure_handlers.go  # Structure CRUD handlers
│   │   │   ├── structure_handlers_test.go # Structure handler tests
│   │   │   ├── structure_integration_test.go # Structure integration tests
│   │   │   ├── structure_routes.go    # Structure routes
│   │   │   ├── websocket.go           # WebSocket server implementation
│   │   │   ├── websocket_test.go      # WebSocket unit tests
│   │   │   ├── websocket_integration_test.go # WebSocket integration tests
│   │   │   ├── zone_handlers.go       # Zone CRUD handlers
│   │   │   ├── zone_routes.go         # Zone routes
│   │   │   └── README.md               # API package documentation
│   │   ├── auth/                      # Authentication system
│   │   │   ├── handlers.go            # Auth handlers (register, login, refresh, logout)
│   │   │   ├── jwt.go                 # JWT token management
│   │   │   ├── jwt_test.go            # JWT token tests
│   │   │   ├── middleware.go          # Auth middleware
│   │   │   ├── models.go               # Auth data models
│   │   │   ├── password.go             # Password hashing (bcrypt)
│   │   │   ├── password_test.go       # Password hashing tests
│   │   │   ├── security_headers.go    # Security headers middleware
│   │   │   └── README.md               # Auth package documentation
│   │   ├── compression/               # Chunk compression format
│   │   │   ├── format.go              # Binary compression format
│   │   │   ├── format_test.go         # Compression format tests
│   │   │   ├── geometry.go            # Geometry compression
│   │   │   ├── geometry_test.go       # Geometry compression tests
│   │   │   └── README.md               # Compression documentation
│   │   ├── config/                     # Configuration management
│   │   │   ├── config.go              # Configuration loading and validation
│   │   │   ├── config_test.go         # Configuration tests
│   │   │   └── README.md               # Configuration documentation
│   │   ├── database/                  # Database access layer
│   │   │   ├── chunks.go              # Chunk storage and retrieval (PostGIS)
│   │   │   ├── chunks_test.go         # Chunk storage tests
│   │   │   ├── structures.go          # Structure storage and retrieval
│   │   │   ├── structures_test.go     # Structure storage tests
│   │   │   ├── structures_integration_test.go # Structure integration tests
│   │   │   ├── structures_validation_test.go # Structure validation tests
│   │   │   ├── zones.go               # Zone storage and retrieval (PostGIS)
│   │   │   ├── zones_test.go          # Zone storage tests
│   │   │   ├── migration_000022_test.go # Migration 22 tests
│   │   │   ├── migration_000023_test.go # Migration 23 tests
│   │   │   ├── schema_verification_test.go # Schema verification tests
│   │   │   └── README.md               # Database package documentation
│   │   ├── performance/               # Performance profiling
│   │   │   ├── profiler.go           # Performance profiler
│   │   │   └── profiler_test.go       # Performance profiler tests
│   │   ├── procedural/                # Procedural generation service
│   │   │   ├── main.py                # FastAPI application and endpoints
│   │   │   ├── config.py              # Configuration management
│   │   │   ├── seeds.py               # Seed generation utilities
│   │   │   ├── stations.py            # Station locations and flare calculations
│   │   │   ├── generation.py          # Chunk generation functions
│   │   │   ├── client.go              # Go client for calling Python service
│   │   │   ├── client_test.go         # Go client tests
│   │   │   ├── tests/                 # Python service tests
│   │   │   │   ├── test_api.py        # API endpoint tests
│   │   │   │   ├── test_generation.py # Chunk generation tests
│   │   │   │   ├── test_seeds.py      # Seed generation tests
│   │   │   │   └── test_stations.py   # Station calculation tests
│   │   │   └── README.md              # Procedural service documentation
│   │   ├── ringmap/                   # Map wrapping and spatial query utilities
│   │   │   ├── coordinates.go         # Coordinate conversion utilities
│   │   │   ├── coordinates_test.go    # Coordinate conversion tests
│   │   │   ├── spatial.go             # Spatial query utilities
│   │   │   ├── spatial_test.go        # Spatial query tests
│   │   │   ├── stations.go            # Station location utilities
│   │   │   ├── wrapping.go            # Position and chunk index wrapping logic
│   │   │   └── wrapping_test.go       # Wrapping logic tests
│   │   ├── streaming/                 # Streaming system
│   │   │   ├── manager.go             # Stream subscription manager
│   │   │   └── manager_test.go        # Stream manager tests
│   │   └── testutil/                  # Test utilities and helpers
│   │       ├── database.go            # Database test utilities
│   │       ├── fixtures.go            # Test fixtures
│   │       ├── http.go                # HTTP test utilities
│   │       ├── testutil_test.go       # Test utility tests
│   │       └── README.md               # Test utilities documentation
│   ├── scripts/                       # Utility scripts
│   │   ├── run-procedural-service.sh  # Run Python service (Linux/Mac)
│   │   └── run-procedural-service.ps1 # Run Python service (Windows)
│   ├── tests/                         # Python tests (pytest fixtures, integration tests)
│   │   ├── conftest.py                # Pytest configuration and fixtures
│   │   ├── test_basic.py              # Basic integration tests
│   │   ├── test_database.py           # Database integration tests
│   │   └── README.md                   # Python tests documentation
│   ├── go.mod                         # Go dependencies
│   ├── go.sum                         # Go dependency checksums
│   └── requirements.txt               # Python dependencies
├── client-web/                        # Three.js web client
│   ├── src/                           # Source code
│   │   ├── api/                       # API service modules
│   │   │   ├── chunk-service.js       # Chunk API service
│   │   │   ├── player-service.js      # Player API service
│   │   │   ├── structure-service.js   # Structure API service
│   │   │   └── zone-service.js        # Zone API service (CRUD, area queries)
│   │   ├── auth/                      # Authentication UI and service
│   │   │   ├── auth-service.js        # Authentication service (JWT, token management)
│   │   │   └── auth-ui.js             # Authentication UI components
│   │   ├── chunks/                    # Chunk management
│   │   │   ├── chunk-manager.js       # Chunk manager (loading, caching, rendering)
│   │   │   └── chunk-manager.test.js  # Chunk manager tests
│   │   ├── input/                     # Input handling
│   │   │   └── camera-controller.js   # Camera controller (OrbitControls integration)
│   │   ├── network/                   # WebSocket client and network utilities
│   │   │   └── websocket-client.js    # WebSocket client implementation
│   │   ├── rendering/                 # Rendering engine
│   │   │   ├── scene-manager.js       # Scene manager (scene, camera, renderer, lighting)
│   │   │   ├── grid-overlay.js         # Grid overlay (LineSegments grid w/ shader fade, centerline, LOD)
│   │   │   └── grid-overlay.test.js   # Grid overlay tests
│   │   ├── state/                     # Game state management
│   │   │   └── game-state.js          # Game state manager (chunks, player, connection, zones)
│   │   ├── structures/                # Structure management
│   │   │   ├── structure-manager.js    # Structure manager (loading, rendering)
│   │   │   └── structure-manager.test.js # Structure manager tests
│   │   ├── ui/                        # UI components
│   │   │   ├── admin-modal.js         # Admin panel modal
│   │   │   ├── bottom-toolbar.js      # Bottom toolbar with tabs
│   │   │   ├── chunk-ui.js            # Chunk management panel
│   │   │   ├── console.js              # Console UI component
│   │   │   ├── debug-info.js          # Debug info panel
│   │   │   ├── game-modal.js          # In-game modal system (confirmations, conflict resolution)
│   │   │   ├── info-box.js            # Info box for selected objects
│   │   │   ├── minimap.js             # Minimap component
│   │   │   ├── minimap.test.js        # Minimap tests
│   │   │   ├── player-ui.js            # Player management panel
│   │   │   ├── player-ui.test.js      # Player UI tests
│   │   │   ├── structure-ui.js         # Structure management panel
│   │   │   ├── zone-info-window.js    # Zone info window (selected zone details)
│   │   │   ├── zone-ui.js             # Zone management panel
│   │   │   ├── zones-toolbar.js       # Zones toolbar (grid and zone visibility controls)
│   │   │   └── zones-toolbar.test.js  # Zones toolbar tests
│   │   ├── utils/                     # Utility modules
│   │   │   ├── coordinates-new.js      # Coordinate conversion utilities (EarthRing ↔ Three.js ↔ Unreal)
│   │   │   ├── coordinates-new.test.js # Coordinate conversion tests
│   │   │   ├── decompression.js        # Chunk decompression utilities
│   │   │   ├── decompression.test.js   # Decompression tests
│   │   │   ├── rendering.js            # Rendering utilities with coordinate conversion integration
│   │   │   └── stations.js              # Station location utilities
│   │   ├── zones/                     # Zone management
│   │   │   ├── zone-editor.js         # Zone editor (drawing tools, preview, conflict resolution)
│   │   │   ├── zone-manager.js        # Zone manager (fetching, rendering, visibility)
│   │   │   └── zone-manager.test.js   # Zone manager tests
│   │   ├── main.js                    # Application entry point
│   │   ├── main.test.js               # Main entry point tests
│   │   ├── config.js                  # Client configuration
│   │   ├── test-utils.js              # Test utilities and mocks
│   │   └── test-utils.test.js         # Test utility tests
│   ├── assets/                        # Game assets (models, textures, shaders)
│   ├── public/                        # Static files
│   │   └── favicon.svg
│   ├── package.json                   # Node.js dependencies
│   ├── vite.config.js                 # Vite configuration
│   ├── vitest.config.js               # Vitest test configuration
│   └── vitest.setup.js                # Vitest setup file
├── database/                          # Database files
│   ├── schema/                        # SQL schema files (reference only)
│   │   └── init.sql                   # Initial database schema
│   ├── seeds/                         # Seed data
│   ├── migrations/                    # Migration scripts (23 migrations)
│   │   └── README.md                   # Migration documentation
│   ├── scripts/                       # Database utility scripts
│   │   ├── fix_torus_overlap_detection.sql # Fix for torus overlap detection issues
│   │   ├── verify_and_fix_normalize_for_intersection.sql # Verify and fix normalize_for_intersection function
│   │   └── README.md                   # Database scripts documentation
│   ├── migrate.ps1                   # PowerShell migration runner (alternative)
│   ├── migrate.sh                     # Shell migration runner (alternative)
│   └── run_migrations.ps1            # PowerShell migration runner
├── scripts/                           # Utility scripts
│   ├── setup.ps1                       # Setup script (Windows)
│   ├── setup.sh                       # Setup script (Linux/Mac)
│   └── pre-commit-checks.ps1          # Pre-commit validation script
├── .github/                           # GitHub Actions workflows
│   └── workflows/                      # CI/CD pipeline (Go, Python, JavaScript, Database)
└── tests/                             # Integration and E2E tests (future)
```

## Development Workflow

**Important**: Always run git commands from the project root directory (`EarthRing/`).

1. **Create a feature branch**
   ```bash
   # Ensure you're in the project root
   cd EarthRing  # or: cd "C:\Users\gabek\Cursor Projects\EarthRing" on Windows
   git checkout -b feature/your-feature-name
   ```

2. **Make code changes** with proper documentation
   - Follow code documentation standards (see Pre-Commit Checks below)
   - Write tests for new functionality

3. **Update design documentation** if architecture changes
   - Architecture: `docs/01-architecture-overview.md`
   - Database: `docs/03-database-schema.md`
   - API: `docs/04-api-design.md`
   - Game Mechanics: `docs/10-game-mechanics.md`
   - Client: `docs/06-client-architecture.md`

4. **Run tests before committing**
   ```bash
   # Run all tests
   cd server && go test ./... && python -m pytest
   cd ../client-web && npm test
   
   # Or use test utilities for integration tests
   # See server/internal/testutil/README.md and server/tests/README.md
   ```

5. **Commit and push**
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin feature/your-feature-name
   ```

6. **Create pull request** → Code review → Merge to `main`

## Pre-Commit Checks

All code must be properly documented and follow project standards:

- **Code Documentation**: All functions, methods, and public APIs must have documentation comments
- **Documentation Updates**: Update relevant design docs when architecture changes
- **README Updates**: Update README if structure, setup, or dependencies change
- **Tests**: All new functionality should have tests
- **Test Utilities**: Use test utilities from `server/internal/testutil/` and `client-web/src/test-utils.js` for consistency

See the design documentation in `docs/` for detailed specifications.

### Testing Framework

The project includes comprehensive testing utilities:

- **Go**: Test utilities in `server/internal/testutil/` (database helpers, HTTP test helpers, fixtures)
- **Python**: Pytest fixtures in `server/tests/conftest.py` (database connections, test data generators)
- **JavaScript**: Test utilities in `client-web/src/test-utils.js` (mocks, fixtures)

See `server/internal/testutil/README.md` and `server/tests/README.md` for detailed usage.

**Test Documentation**: All test-related documentation is organized in `docs/tests/`. See `docs/tests/README.md` for details.

### Authentication and Security

The server includes a complete authentication and security system:

- **JWT Authentication**: Access tokens (15 min expiration) and refresh tokens (7 days expiration)
- **Password Security**: bcrypt hashing (cost 12) with strong password requirements (8+ chars, uppercase, lowercase, number, special)
- **Rate Limiting**: Multi-tier rate limiting:
  - Global: 1000 requests/minute per IP
  - Authentication endpoints: 5 requests/minute per IP
  - Per-user: 500 requests/minute per user (for authenticated endpoints)
- **Security Headers**: HSTS, XSS protection, content type options, frame options, referrer policy
- **CORS Support**: Configured for web client development (localhost:3000, localhost:5173)
- **Input Validation**: Server-side validation for all inputs using `validator/v10`
- **Token Refresh**: Automatic token refresh with rotation for enhanced security

See `server/internal/auth/README.md` and `server/internal/api/README.md` for detailed documentation.

## Known Issues

None currently. All previously documented issues have been resolved.

## Documentation

Comprehensive design documentation is available in the `docs/` directory:

- **01-architecture-overview.md**: System architecture and technology stack
- **02-map-system.md**: Ring geometry, coordinate system, chunk specifications
- **03-database-schema.md**: Database schema and spatial data design
- **04-api-design.md**: REST and WebSocket API specifications
- **05-authentication-security.md**: Authentication and security implementation
- **06-client-architecture.md**: Web client architecture (Three.js)
- **07-streaming-system.md**: Chunk loading, streaming, compression
- **08-procedural-generation.md**: Procedural generation algorithms
- **09-zone-system.md**: Player-defined zones and road generation
- **10-game-mechanics.md**: City builder, Sims, and racing mechanics
- **11-microgravity-physics.md**: Microgravity physics implementation specification
- **12-npc-ai-pathfinding.md**: NPC AI and pathfinding algorithms specification
- **13-transportation-generation.md**: Transportation generation algorithm specification

See `implementation-phases.md` for the implementation roadmap and planning details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.

## License

See [LICENSE](LICENSE) for license information.
