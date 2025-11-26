# Coordinate System Migration Status

## Overview

This document tracks the current status of the coordinate system migration from legacy X/Y/Z coordinates to ER0/EarthRing coordinates.

## Migration Progress

### ✅ Phase 1: Core Utilities - COMPLETED

- [x] Server-side coordinate utilities (`server/internal/ringmap/coordinates.go`)
- [x] Client-side coordinate utilities (`client-web/src/utils/coordinates-new.js`)
- [x] Unit tests for all conversion functions
- [x] Round-trip conversion validation

### ✅ Phase 2: Database Migration - COMPLETED

- [x] Migration 000018: Add new coordinate columns
- [x] Migration 000019: Create coordinate conversion functions
- [x] Migration 000020: Migrate existing player positions
- [x] Migration 000021: Create spatial indexes on new geometry columns

### ✅ Phase 3: Streaming System - COMPLETED

- [x] Updated `CameraPose` to support both legacy and new coordinates
- [x] Updated `ComputeChunkWindow` to use RingArc/RingPolar when available
- [x] Updated `ZoneBoundingBox` to support both coordinate systems
- [x] Updated `ComputeZoneBoundingBox` to handle new coordinates
- [x] All existing tests pass

### ✅ Phase 4: Chunk System - COMPLETED

- [x] Added `RingArcToChunkIndex` and `ChunkIndexToRingArc` functions
- [x] Added `RingPolarToChunkIndex` and `ChunkIndexToRingPolar` functions
- [x] Chunk indices can now be computed from RingArc/RingPolar coordinates

### ✅ Phase 5: Zone System - COMPLETED

- [x] Updated `ListZonesByArea` to support both coordinate systems
- [x] Added `ListZonesByRingArc` function for new coordinate queries
- [x] Updated `loadZonesForArea` in websocket handler to use new coordinates when available
- [x] Backward compatibility maintained
- [x] Hardened RingArc → legacy bounding box conversion to avoid invalid boxes near wrap boundaries
- [x] Updated zone streaming to return empty results (instead of errors) when degenerate boxes occur

### ✅ Phase 6: Kongo Station Positioning - COMPLETED

- [x] Created `server/internal/ringmap/stations.go` with ER0-anchored station positions
- [x] Kongo Hub positioned at ER0: (KongoHubRadius, 0, 0)
- [x] All 12 pillar hubs defined in RingArc coordinates
- [x] Conversion functions between station positions and ER0
- [x] Updated client-side stations utility to use RingArc coordinates

### ✅ Phase 7: Documentation - COMPLETED

- [x] Created migration plan documents
- [x] Updated `docs/02-map-system.md` with new coordinate system
- [x] Updated `README.md` with coordinate system overview
- [x] Updated coordinate system status document
- [x] Updated UI components to display new coordinates

## Current State

### Backward Compatibility

The system maintains full backward compatibility:
- Legacy coordinate system (X/Y/Z) still works
- New coordinate system is preferred when available
- Automatic conversion between systems
- Database stores both coordinate systems during transition

### Coordinate System Usage

**Server-Side:**
- Streaming system: Supports both legacy and new coordinates
- Chunk system: Supports both legacy and new coordinates
- Zone system: Supports both legacy and new coordinates
- Station system: Uses new RingArc coordinates

**Client-Side:**
- Coordinate utilities: New coordinate system available
- Station utilities: Updated to use RingArc coordinates
- Debug Info panel: Displays RingArc coordinates (s, θ, r, z)
- Admin Player pane: Uses RingArc coordinates for position updates
- ChunkManager: Uses RingArc internally and server-driven streaming for chunk windows (including wrapping across X=0). Fixed chunk rendering at theta ≈ ±π to use actual Three.js world-space camera position for wrapping calculations, ensuring continuous platform visibility across the wrap boundary.
- ZoneManager: Uses RingArc-derived windows for streaming/REST and wraps zone geometry relative to the camera, matching chunk behavior
- ZoneEditor: Uses camera-relative EarthRing coordinates and the same wrapping helpers as ZoneManager, so previews and final zones align even across the wrap point
- Legacy coordinates: Still supported for backward compatibility

**Database:**
- New columns: `position_theta`, `position_r`, `position_z`, `geometry_polar`
- Conversion functions: Available for legacy ↔ new conversion
- Data migration: Player positions migrated to new coordinates

## Next Steps

1. **Complete Documentation Updates**
   - Update all remaining documentation files
   - Create comprehensive coordinate system reference guide
   - Update API documentation

2. **Client-Side Migration** (Partial)
   - [x] Update Debug Info panel to display new coordinates
   - [x] Update Admin Player pane to use new coordinates
   - [ ] Update chunk manager to use new coordinates (utilities ready)
   - [ ] Update zone manager to use new coordinates (utilities ready)
   - [ ] Update camera controller to use new coordinates (utilities ready)
   - [ ] Update rendering utilities (utilities ready)

3. **Geometry Migration**
   - Implement full geometry conversion for zones and chunks
   - Populate `geometry_polar` columns in database
   - Update PostGIS queries to use new geometry columns

4. **Legacy System Removal** (Future)
   - After validation period, remove legacy coordinate columns
   - Remove legacy coordinate conversion code
   - Update all code to use new coordinates exclusively

## Testing Status

- ✅ Server-side coordinate conversion tests: All passing
- ✅ Client-side coordinate conversion tests: All passing
- ✅ Streaming system tests: All passing
- ✅ Database migrations: Applied successfully
- ⏳ Integration tests: Pending
- ⏳ End-to-end tests: Pending

## Known Issues

1. **Geometry Conversion**: PostGIS geometry conversion function is a placeholder. Full implementation needed for zone and chunk geometry migration.

2. **Performance**: Need to benchmark new coordinate system operations for performance impact.

## Migration Timeline

- **Started**: Current session
- **Phase 1-6**: Completed
- **Phase 7**: In progress
- **Estimated Completion**: TBD

## Notes

- All new code should use the new coordinate system
- Legacy code continues to work during transition
- Database stores both coordinate systems for safety
- Conversion functions ensure data consistency

