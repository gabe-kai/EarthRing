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
- **Go**: 1.25.3 (required: 1.21+)
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

3. **Set up the database**
   ```sql
   psql -U postgres
   CREATE DATABASE earthring_dev;
   \c earthring_dev
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS postgis_topology;
   ```

4. **Verify installation**
   ```bash
   cd server && go test ./... && python -m pytest tests/test_basic.py -v
   cd ../client-web && npm test
   ```

### Development Commands

**Start servers:**
```bash
# Terminal 1: Go server
cd server
go run cmd/earthring-server/main.go
# Runs on http://localhost:8080

# Terminal 2: Web client
cd client-web
npm run dev
# Runs on http://localhost:3000 (proxies /api and /ws to server)
```

**Run tests:**
```bash
cd server && go test ./... && python -m pytest
cd ../client-web && npm test
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
│   │   ├── api/                       # REST and WebSocket handlers
│   │   ├── database/                  # Database access layer
│   │   ├── game/                      # Core game logic (zones, structures, chunks, npcs, racing)
│   │   ├── procedural/                # Procedural generation (Python)
│   │   └── auth/                      # Authentication
│   ├── pkg/                           # Public library code
│   ├── migrations/                    # Database migrations
│   ├── config/                        # Configuration files
│   ├── tests/                         # Python tests
│   ├── go.mod                         # Go dependencies
│   └── requirements.txt               # Python dependencies
├── client-web/                        # Three.js web client
│   ├── src/                           # Source code (network, state, rendering, input, chunks, ui)
│   ├── assets/                        # Game assets (models, textures, shaders)
│   ├── public/                        # Static files
│   ├── package.json                   # Node.js dependencies
│   └── vite.config.js                 # Vite configuration
├── database/                          # Database files
│   ├── schema/                        # SQL schema files
│   ├── seeds/                         # Seed data
│   └── migrations/                    # Migration scripts
├── scripts/                           # Utility scripts (setup.sh, setup.ps1)
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
   cd server && go test ./... && python -m pytest
   cd ../client-web && npm test
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

See the design documentation in `docs/` for detailed specifications.

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
