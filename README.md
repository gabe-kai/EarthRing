# EarthRing

A multi-genre game (city builder, light Sims elements, and racing) set on an orbital ring structure around Earth. The game features a database-driven architecture that separates data persistence from game clients, allowing the underlying engine and code to evolve while maintaining the same persistent world state.

## Project Overview

EarthRing is set on a massive orbital ring structure:
- **Circumference**: 264,000 km
- **Base Width**: 400 meters
- **Elevator Stations**: 12 pillar/elevator hubs spaced ~22,000 km apart, flaring to 25 km maximum width
- **Gameplay**: City building, NPC simulation, and racing through player-built cities

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
   ```
   
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
go run cmd/earthring-server/main.go
# Runs on http://localhost:8080 (or port specified in SERVER_PORT)
# Provides REST API endpoints and WebSocket connections

# Terminal 2: Python procedural generation service (required for Phase 2+)
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
- Rate limit: 100 requests per minute per user
- Returns default metadata if chunk doesn't exist yet
- **Chunk Storage**: ✅ Implemented - Generated chunks are automatically stored in database with PostGIS geometry
- **Database Persistence**: Chunks persist across server restarts and are loaded from database before generating

**Testing UI:**
- After logging in, click "Player" or "Chunks" buttons in the user info bar to test endpoints
- UI panels provide forms to test all endpoints with JSON result display

**Run tests:**
```bash
cd server && go test ./... && python -m pytest
cd ../client-web && npm test
```

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
├── .gitignore                         # Git ignore patterns
├── docs/                              # Design documentation (13 documents)
│   ├── 01-architecture-overview.md
│   ├── 02-map-system.md
│   ├── 03-database-schema.md
│   ├── 04-api-design.md
│   ├── 05-authentication-security.md
│   ├── 06-client-architecture.md
│   ├── 07-streaming-system.md
│   ├── 08-procedural-generation.md
│   ├── 09-zone-system.md
│   └── 10-game-mechanics.md
├── server/                            # Go main server + Python procedural service
│   ├── cmd/earthring-server/         # Server entry point
│   ├── internal/                      # Private application code
│   │   ├── api/                       # REST and WebSocket handlers, rate limiting, CORS, player/chunk endpoints
│   │   ├── database/                  # Database access layer
│   │   │   ├── chunks.go              # Chunk storage and retrieval (PostGIS geometry, persistence)
│   │   │   ├── chunks_test.go         # Chunk storage tests
│   │   │   └── README.md              # Database package documentation
│   │   ├── game/                      # Core game logic (zones, structures, chunks, npcs, racing)
│   │   ├── procedural/                # Procedural generation service
│   │   │   ├── main.py                # FastAPI application and endpoints
│   │   │   ├── config.py              # Configuration management
│   │   │   ├── seeds.py               # Seed generation utilities
│   │   │   ├── generation.py         # Chunk generation functions
│   │   │   ├── client.go              # Go client for calling Python service
│   │   │   ├── tests/                 # Python service tests
│   │   │   └── README.md              # Procedural service documentation
│   │   ├── auth/                      # Authentication (JWT, password hashing, middleware)
│   │   ├── config/                    # Configuration management
│   │   └── testutil/                  # Test utilities and helpers
│   ├── scripts/                       # Utility scripts
│   │   ├── run-procedural-service.sh  # Run Python service (Linux/Mac)
│   │   └── run-procedural-service.ps1 # Run Python service (Windows)
│   ├── pkg/                           # Public library code
│   ├── migrations/                    # Database migrations
│   ├── config/                        # Configuration files
│   ├── tests/                         # Python tests (pytest fixtures, integration tests)
│   ├── go.mod                         # Go dependencies
│   └── requirements.txt               # Python dependencies
├── client-web/                        # Three.js web client
│   ├── src/                           # Source code (network, state, rendering, input, chunks, ui)
│   │   ├── api/                       # API service modules (player, chunk)
│   │   ├── auth/                      # Authentication UI and service
│   │   ├── network/                   # WebSocket client and network utilities
│   │   ├── rendering/                 # Rendering engine
│   │   │   └── scene-manager.js       # Scene manager (scene, camera, renderer, lighting)
│   │   ├── input/                     # Input handling
│   │   │   └── camera-controller.js   # Camera controller (OrbitControls integration)
│   │   ├── state/                     # Game state management
│   │   │   └── game-state.js          # Game state manager (chunks, player, connection)
│   │   ├── chunks/                    # Chunk management
│   │   │   └── chunk-manager.js       # Chunk manager (loading, caching, rendering)
│   │   ├── ui/                        # UI components (player panel, chunk panel)
│   │   ├── utils/                     # Utility modules
│   │   │   ├── coordinates.js         # Coordinate conversion utilities (EarthRing ↔ Three.js ↔ Unreal)
│   │   │   └── rendering.js           # Rendering utilities with coordinate conversion integration
│   │   ├── config.js                  # Client configuration
│   │   └── test-utils.js              # Test utilities and mocks
│   ├── assets/                        # Game assets (models, textures, shaders)
│   ├── public/                        # Static files
│   ├── package.json                   # Node.js dependencies
│   └── vite.config.js                 # Vite configuration
├── database/                          # Database files
│   ├── schema/                        # SQL schema files (reference only)
│   ├── seeds/                         # Seed data
│   ├── migrations/                    # Migration scripts (13 migrations)
│   └── run_migrations.ps1            # PowerShell migration runner
├── scripts/                           # Utility scripts (setup.sh, setup.ps1)
├── .github/                           # GitHub Actions workflows
│   └── workflows/                     # CI/CD pipeline (Go, Python, JavaScript, Database)
└── tests/                             # Integration and E2E tests
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
