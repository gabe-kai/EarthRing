# Architecture Overview

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
  - [High-Level Design](#high-level-design)
  - [Core Principles](#core-principles)
- [Technology Stack](#technology-stack)
  - [Server](#server)
  - [Database](#database)
  - [Communication Protocols](#communication-protocols)
  - [Client Strategy](#client-strategy)
- [System Components](#system-components)
  - [Server Components](#server-components)
  - [Client Components](#client-components)
- [Data Flow](#data-flow)
  - [Initial Connection](#initial-connection)
  - [Ongoing Gameplay](#ongoing-gameplay)
  - [Chunk Streaming](#chunk-streaming)
- [Scalability Considerations](#scalability-considerations)
  - [Horizontal Scaling](#horizontal-scaling)
  - [Performance Optimization](#performance-optimization)
- [Security Considerations](#security-considerations)
- [Design Decisions](#design-decisions)
  - [Conflict Resolution](#conflict-resolution)
  - [Chunk Versioning](#chunk-versioning)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

EarthRing is a multi-genre game (city builder, light Sims elements, and racing) set on an orbital ring structure around Earth. The architecture is designed to separate data persistence from game clients, allowing the underlying engine and code to evolve while maintaining the same persistent world state.

## System Architecture

### High-Level Design

The system follows a **server-client architecture** with clear separation of concerns:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Web Client  │     │ Light Client│     │ Unreal Client│
│  (Initial)  │     │  (Future)   │     │   (Future)  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Server    │
                    │  (Go + Python)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Database   │
                    │ (PostgreSQL)│
                    └─────────────┘
```

### Core Principles

1. **Data Persistence**: All game state, map data, and player progress stored in database
2. **Client Agnostic**: Server API designed to support multiple client types
3. **Real-time Updates**: WebSocket for live game state synchronization
4. **Scalability**: Architecture supports horizontal scaling of server instances
5. **Modularity**: Clear boundaries between systems allow independent evolution

## Technology Stack

### Server

**Architecture: Hybrid Approach**

**Main Server: Go**
- Excellent concurrency for handling multiple clients
- Strong performance for real-time game server
- Good ecosystem for WebSocket and database connectivity
- Cross-platform deployment
- Handles all client connections, game state management, and real-time operations

**Procedural Generation Service: Python**
- Rapid development and prototyping for complex algorithms
- Rich ecosystem for data processing and procedural generation
- Better suited for algorithmic work (terrain generation, NPC population distribution, city growth)
- Can scale independently from main server
- Communicates with main server via REST API (FastAPI framework)
- **Status**: ✅ Implemented (Phase 1: basic ring floor geometry with station flares, full generation with buildings in Phase 2)

**Decision**: Use Go for the main game server (performance-critical real-time operations) and Python for the procedural generation service (algorithm-heavy work). This separation allows independent scaling and optimization of each service.

### Database

**Primary Choice: PostgreSQL with PostGIS**

**Rationale**:
- **PostGIS Extension**: Essential for spatial data (zones, structures, map chunks)
- **Relational Model**: Well-suited for structured game data (players, zones, structures)
- **ACID Compliance**: Ensures data integrity for player actions
- **JSON Support**: Can store flexible game state where needed
- **Performance**: Excellent indexing and query optimization
- **Maturity**: Battle-tested for production systems

**Key Features**:
- Spatial indexing for efficient chunk queries
- Geometry types for zone polygons
- Point-in-polygon queries for zone lookups
- Distance calculations for map wrapping

**Alternative Considerations**:
- **MongoDB**: Good for document storage but lacks robust spatial capabilities without additional tools
- **Redis**: Excellent for caching but not suitable as primary data store
- **Hybrid Approach**: PostgreSQL for persistent data, Redis for session/cache layer

### Communication Protocols

#### REST API
- **Purpose**: Stateful operations, initial data loading, administrative actions
- **Use Cases**:
  - Player authentication
  - Loading initial game state
  - Zone creation/modification
  - Structure placement
  - Player profile management
- **Format**: JSON over HTTP/HTTPS

#### WebSocket
- **Purpose**: Real-time bidirectional communication
- **Use Cases**:
  - Chunk streaming
  - Player movement updates
  - NPC activity updates
  - Zone changes from other players
  - Racing events
  - Live notifications
- **Format**: JSON messages over WebSocket protocol

### Client Strategy

#### Phase 1: Web Client (Initial)
- **Technology**: Three.js (see Client Architecture doc for rationale)
- **Rationale**: 
  - No installation required
  - Rapid iteration and updates
  - Cross-platform compatibility
  - Good performance for initial game mechanics
  - Full 3D rendering capabilities
- **Limitations**: 
  - Graphics quality limited by browser capabilities
  - Network dependency

#### Phase 2: Light Local Client (Future)
- **Technology**: Electron or native application with web rendering
- **Rationale**:
  - Better performance than browser
  - Can cache assets locally
  - More control over rendering pipeline
  - Still uses web technologies for faster development

#### Phase 3: Heavy Local Client (Future)
- **Technology**: Unreal Engine
- **Rationale**:
  - Maximum graphics fidelity
  - Advanced lighting and effects
  - Better physics simulation
  - Professional game engine features
- **Considerations**:
  - Requires graphics abstraction layer
  - More complex development
  - Larger download size

## System Components

### Server Components

1. **Game Server**
   - Handles client connections
   - Manages game state
   - Processes player actions
   - Coordinates multiplayer interactions

2. **Chunk Manager**
   - Manages map chunk loading/unloading
   - Handles chunk streaming to clients
   - Coordinates procedural generation

3. **Zone System**
   - Validates zone creation
   - Manages zone properties
   - Handles road generation logic

4. **Database Layer**
   - Data access abstraction
   - Query optimization
   - Transaction management
   - **Chunk Storage**: ✅ Implemented (`server/internal/database/chunks.go`)
     - Chunk metadata and geometry persistence
     - PostGIS geometry storage for spatial queries
     - Automatic storage of generated chunks
     - Database-first loading strategy
     - Chunk deletion with transaction safety (forces regeneration on next request)

5. **Procedural Generation Service** (Python)
   - Generates procedural structures
   - Manages NPC populations (future)
   - Handles city growth algorithms (future)
   - Communicates with main server via REST API (FastAPI framework)
   - Runs on port 8081 (configurable via `PROCEDURAL_SERVICE_PORT`)
   - Can be scaled independently based on generation workload
   - **Status**: ✅ Implemented (Phase 1: basic service with ring floor geometry and station flares)

### Client Components

1. **Rendering Engine**
   - 3D scene rendering
   - Camera management
   - Lighting and effects

2. **Network Layer**
   - WebSocket connection management
   - REST API client
   - Message queuing and handling

3. **Game State Manager**
   - Local state cache
   - Synchronization with server
   - Conflict resolution

4. **Input Handler**
   - User input processing
   - Action queuing
   - UI interaction

5. **Chunk Loader**
   - Chunk request management
   - Asset loading
   - Memory management

## Data Flow

### Initial Connection
1. Client connects via WebSocket
2. Client authenticates via REST API
3. Server sends initial chunk data for player's location
4. Client renders initial view
5. Client requests additional chunks as needed

### Ongoing Gameplay
1. Player actions sent via WebSocket
2. Server validates and processes actions
3. Server updates database
4. Server broadcasts changes to affected clients
5. Clients update local state and render

### Chunk Streaming
1. Client requests chunks based on viewport
2. Server queries database for chunk data
3. Server sends chunk geometry and metadata
4. Client caches and renders chunks
5. Client unloads distant chunks

## Scalability Considerations

### Horizontal Scaling
- Stateless server design (session data in database/Redis)
- Load balancer for multiple server instances
- Database connection pooling
- Chunk data can be cached in Redis for frequently accessed areas
- Procedural generation service can scale independently based on workload
- In-memory event handling (no message queue initially; can add later if needed)

### Performance Optimization
- Spatial indexing for efficient chunk queries
- LOD (Level of Detail) system for different client types
- Chunk preloading based on player movement prediction
- Compression for chunk data transmission

## Security Considerations

- Authentication and authorization for player actions
- Rate limiting to prevent abuse
- Input validation on server side
- SQL injection prevention (parameterized queries)
- XSS prevention in client-side rendering
- Secure WebSocket connections (WSS)

## Design Decisions

### Conflict Resolution

**Decision**: Only one player can modify a section at a time. A "section" is defined as:
- Several chunks at a time (for small-scale edits)
- A whole station (elevator station areas)
- A ring segment between stations (large-scale zone modifications)
- A segment of a ring segment (sub-sections for granular control)

This exclusive modification approach prevents conflicts by ensuring players cannot simultaneously modify overlapping areas. Players must acquire a "lock" on a section before making changes, which is released when modifications are complete or after a timeout period.

### Chunk Versioning

**Decision**: Chunk data will be versioned to support:
- **Rollbacks**: Ability to revert chunks to previous states if needed
- **History Replay**: Ability to replay the history of a chunk to see how it evolved over time

Each chunk modification creates a new version, maintaining a complete history. This enables:
- Debugging and troubleshooting
- Undo/redo functionality
- Time-lapse visualization of city growth
- Audit trails for player actions
- Recovery from errors or malicious actions

## Open Questions

None - all major architectural decisions have been made.

## Future Considerations

- Microservices architecture if system grows complex
- CDN for static assets (textures, models)
- Analytics service for gameplay metrics
- Admin tools and moderation system
- Replay system for racing events
- Cross-platform mobile clients

