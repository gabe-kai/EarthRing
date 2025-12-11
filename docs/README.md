# EarthRing Documentation Index

This document provides a comprehensive index of all EarthRing project documentation organized by category and purpose.

**Quick Links**:
- [Architecture & Design](#architecture--design-documents)
- [System Specifications](#system-specifications)
- [Game Mechanics](#game-mechanics)
- [Implementations](#implementations)
- [Development & Operations](#development--operations)
- [Testing](#testing-documentation)
- [Reference](#reference-documentation)

---

## Architecture & Design Documents

Core system architecture and design documentation.

### 01. Architecture Overview
**File**: [`01-architecture-overview.md`](01-architecture-overview.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: High-level system architecture, technology stack, component design, and core principles.  
**Key Topics**: Server-client architecture, data flow, scalability, security, design decisions

### 02. Map System
**File**: [`02-map-system.md`](02-map-system.md)  
**Status**: ✅ **IMPLEMENTED** (Coordinate System Migration Complete)  
**Description**: Ring geometry, coordinate systems (ER0, RingPolar, RingArc), chunk system, zone layout, and minimap.  
**Key Topics**: Coordinate systems, chunk dimensions, station flares, map wrapping, procedural generation integration  
**Related**: [Coordinate System Migration](refactor/coordinate-system-migration.md)

### 03. Database Schema
**File**: [`03-database-schema.md`](03-database-schema.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Complete database schema with PostGIS support, table definitions, spatial queries, and relationships.  
**Key Topics**: Core tables (players, zones, structures, chunks, NPCs), spatial queries, data integrity, performance optimization

### 04. API Design
**File**: [`04-api-design.md`](04-api-design.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: REST API endpoints and WebSocket protocol specifications.  
**Key Topics**: REST endpoints, WebSocket messages, server-driven streaming (`stream_subscribe`, `stream_update_pose`, `stream_delta`), rate limiting, versioning  
**Related**: [Streaming System](07-streaming-system.md)

### 05. Authentication & Security
**File**: [`05-authentication-security.md`](05-authentication-security.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Authentication architecture, security measures, and best practices.  
**Key Topics**: JWT tokens, refresh tokens, rate limiting, input validation, SQL injection prevention, XSS prevention, WebSocket security

### 06. Client Architecture
**File**: [`06-client-architecture.md`](06-client-architecture.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Web client architecture, rendering pipeline, state management, and UI system.  
**Key Topics**: Three.js rendering, chunk/zone loading, server-driven streaming, authentication-aware operations, graphics abstraction  
**Related**: [Streaming System](07-streaming-system.md)

### 07. Streaming System
**File**: [`07-streaming-system.md`](07-streaming-system.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Server-driven chunk and zone streaming system with compression and LOD.  
**Key Topics**: Server-driven streaming contracts, chunk deltas, compression (geometry, textures, metadata), bandwidth management, caching  
**Related**: [API Design](04-api-design.md), [Client Architecture](06-client-architecture.md)

---

## System Specifications

Detailed specifications for system components.

### 08. Procedural Generation
**File**: [`08-procedural-generation.md`](08-procedural-generation.md)  
**Status**: ✅ **PARTIALLY IMPLEMENTED** (Phase 1: Service + Station Flares Complete)  
**Description**: Seed-based deterministic generation system for cities, buildings, and structures.  
**Key Topics**: Seed hierarchy, building generation, window lighting, cultural styles, LOD, player action integration  
**Note**: Phase 1 (service + station flares) is complete. Full building generation is planned for Phase 2.

### 09. Zone System
**File**: [`09-zone-system.md`](09-zone-system.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Zone creation, management, overlap detection, and client-side rendering.  
**Key Topics**: Zone types, polygon definition, overlap detection, area calculation, floor spanning, transportation integration  
**Related**: [Game Mechanics](10-game-mechanics.md), [Database Schema](03-database-schema.md)

### 11. Structure System
**File**: [`11-structure-system.md`](11-structure-system.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Structure placement, validation, and rendering system with collision detection, height limits, zone access rules, and floating origin rendering.  
**Key Topics**: Structure types, validation rules (collision, height, zone access), client-side rendering (floating origin pattern), API endpoints, database schema  
**Related**: [Database Schema](03-database-schema.md), [Client Architecture](06-client-architecture.md), [Zone System](09-zone-system.md)

---

## Game Mechanics

Game design specifications and mechanics documentation.

### 10. Game Mechanics
**File**: [`10-game-mechanics.md`](10-game-mechanics.md)  
**Status**: 📋 **DESIGN SPECIFICATION**  
**Description**: Comprehensive game mechanics covering city building, NPCs, racing, and multi-genre integration.  
**Key Topics**: City builder mechanics, NPC system (two-tier complexity), illegal city racing, law enforcement, continuous world time  
**Related**: [NPC AI](12-npc-ai-pathfinding.md), [Microgravity Physics](11-microgravity-physics.md), [Transportation](13-transportation-generation.md)

### 11. Microgravity Physics
**File**: [`11-microgravity-physics.md`](11-microgravity-physics.md)  
**Status**: 📋 **DESIGN SPECIFICATION**  
**Description**: Realistic microgravity physics implementation specification for racing and movement.  
**Key Topics**: Velocity control, momentum conservation, ballistic trajectories, collision detection, wall kicks, vehicle physics, damage system  
**Related**: [Game Mechanics](10-game-mechanics.md), [Map System](02-map-system.md)

### 12. NPC AI and Pathfinding
**File**: [`12-npc-ai-pathfinding.md`](12-npc-ai-pathfinding.md)  
**Status**: 📋 **DESIGN SPECIFICATION**  
**Description**: Two-tier NPC complexity system and multi-modal pathfinding specification.  
**Key Topics**: Abstract mass NPCs, detailed individual NPCs, A* pathfinding, zone-level pathfinding, transportation network pathfinding, favoritism system  
**Related**: [Game Mechanics](10-game-mechanics.md), [Zone System](09-zone-system.md), [Transportation](13-transportation-generation.md)

### 13. Transportation Generation
**File**: [`13-transportation-generation.md`](13-transportation-generation.md)  
**Status**: 📋 **DESIGN SPECIFICATION**  
**Description**: Organic transportation infrastructure generation based on NPC traffic patterns.  
**Key Topics**: Traffic data collection, density calculation, infrastructure thresholds, upgrade/downgrade system, lane widening, network connectivity  
**Related**: [NPC AI](12-npc-ai-pathfinding.md), [Zone System](09-zone-system.md), [Game Mechanics](10-game-mechanics.md)

---

## Development & Operations

Development workflow, deployment, and operational documentation.

### Developer Workflow
**File**: [`DEVELOPER_WORKFLOW.md`](DEVELOPER_WORKFLOW.md)  
**Status**: ✅ **ACTIVE**  
**Description**: Development workflow, coding standards, testing strategy, and best practices.  
**Key Topics**: Git workflow, code style, testing strategy, database migrations, documentation organization

### Deployment Checklist
**File**: [`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md)  
**Status**: ✅ **ACTIVE**  
**Description**: Pre-deployment checklist and deployment procedures.

### Performance Profiling
**File**: [`PERFORMANCE_PROFILING.md`](PERFORMANCE_PROFILING.md)  
**Status**: ✅ **IMPLEMENTED**  
**Description**: Performance profiling system implementation and usage guide.  
**Key Topics**: Profiling architecture, metrics collection, analysis tools, performance targets

### Implementation Phases
**File**: [`../implementation-phases.md`](../implementation-phases.md) (in project root)  
**Status**: ✅ **ACTIVE**  
**Description**: Detailed implementation roadmap with phases, priorities, and dependencies.  
**Key Topics**: Phase breakdown, feature priorities, deliverables, dependencies

---

## Implementations

Completed feature implementations with technical details and migration guides.

### Building Construction & Demolition Animations
**File**: [`implementations/building-construction-animations.md`](implementations/building-construction-animations.md)  
**Status**: ✅ **COMPLETED** (December 2024)  
**Description**: Real-time building construction and demolition animations with server-state tracking. Includes multi-zone type support and automatic chunk/zone reloading.  
**Key Topics**: Construction animations, demolition animations, database schema changes, WebSocket synchronization, admin reload improvements  
**Related**: [Building Construction Animation Strategies](strategies/building-construction-animation.md), [Structure System](11-structure-system.md)

### Structure Animation System Analysis
**File**: [`implementations/structure-animation-system-analysis.md`](implementations/structure-animation-system-analysis.md)  
**Status**: ✅ **COMPLETED** (December 2024)  
**Description**: Comprehensive analysis of the structure animation system, including timing defaults, animation techniques, trigger points, and future extensibility for per-structure build times and requirements.  
**Key Topics**: Construction timing (5 min placeholder), demolition timing (7.5s), animation techniques, database integration, future enhancements  
**Related**: [Building Construction Animations](implementations/building-construction-animations.md), [Structure System](11-structure-system.md)

---

## Testing Documentation

Test strategies, coverage analysis, and testing utilities.

**Main Index**: [`tests/README.md`](tests/README.md)

### Test Coverage Analysis
- [`tests/minimap-test-coverage.md`](tests/minimap-test-coverage.md) - Minimap component test coverage
- [`tests/zone-system-test-coverage.md`](tests/zone-system-test-coverage.md) - Zone system test coverage
- [`tests/procedural-generation-test-coverage.md`](tests/procedural-generation-test-coverage.md) - Procedural generation test coverage
- [`tests/ui-test-coverage.md`](tests/ui-test-coverage.md) - UI component test coverage

### Testing Strategies
- [`tests/integration-testing.md`](tests/integration-testing.md) - Integration testing plans
- [`tests/testing-gap-analysis.md`](tests/testing-gap-analysis.md) - Testing gaps and recommendations

---

## Reference Documentation

Reference materials, refactoring notes, bug fixes, and feature-specific docs.

### Feature Documentation
- [`minimap-system.md`](minimap-system.md) - Minimap system design and implementation

### Refactoring Documentation
Located in [`refactor/`](refactor/):
- [`coordinate-system-migration.md`](refactor/coordinate-system-migration.md) - Coordinate system migration process
- [`coordinate-system-status.md`](refactor/coordinate-system-status.md) - Current coordinate system implementation status
- [`database-coordinate-migration.md`](refactor/database-coordinate-migration.md) - Database coordinate migration details
- [`CLIENT_REFACTOR_STATUS.md`](refactor/CLIENT_REFACTOR_STATUS.md) - Client refactoring status
- [`client-server-responsibility.md`](refactor/client-server-responsibility.md) - Responsibility separation

### Bug Fixes
Located in [`bug_fixes/`](bug_fixes/):
- [`WRAP_POINT_FIX_SUMMARY.md`](bug_fixes/WRAP_POINT_FIX_SUMMARY.md) - Wrap point fix analysis
- [`ZONE_TOOLS_WRAP_ANALYSIS.md`](bug_fixes/ZONE_TOOLS_WRAP_ANALYSIS.md) - Zone tools wrap analysis

### Performance Analysis
Located in [`performance/`](performance/):
- [`grid-overlay-performance-analysis.md`](performance/grid-overlay-performance-analysis.md) - Grid overlay performance analysis

### Documentation Analysis
- [`DOCUMENTATION_REVIEW_2024.md`](DOCUMENTATION_REVIEW_2024.md) - Comprehensive documentation review and gap analysis (December 2024)

---

## Documentation Status Guide

- ✅ **IMPLEMENTED** - Feature/system is fully implemented and documented
- ✅ **PARTIALLY IMPLEMENTED** - Feature is partially implemented (status details in document)
- ✅ **ACTIVE** - Documentation is actively maintained and current
- 📋 **DESIGN SPECIFICATION** - Design specification for planned features (implementation status varies)

---

## Getting Started

**New to the project?** Start with:
1. [Architecture Overview](01-architecture-overview.md) - Understand the system design
2. [README.md](../README.md) (project root) - Quick start guide and project overview
3. [Developer Workflow](DEVELOPER_WORKFLOW.md) - Development setup and workflow

**Implementing a feature?** Check:
- [Implementation Phases](../implementation-phases.md) - Feature roadmap and priorities
- Relevant design documents (numbered 01-13)
- [Testing Documentation](tests/README.md) - Testing strategies and coverage

**Working on a specific system?** See:
- System-specific documentation (numbered 01-13)
- Feature-specific docs (minimap-system.md, etc.)
- Related refactoring/bug fix documentation

---

## Documentation Maintenance

This index should be updated when:
- New documentation files are added
- Documentation status changes (e.g., from DESIGN to IMPLEMENTED)
- Major documentation reorganization occurs

**Last Updated**: 2024-12-19

