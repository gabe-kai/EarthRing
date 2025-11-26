# Coordinate System Migration Plan

## Overview

This document outlines the migration from the legacy coordinate system to the new ER0/EarthRing coordinate system.

## New Coordinate Systems

### 1. ER0: Earth-Centered, Earth-Fixed Frame

**Definition:**
- Origin: (0,0,0) = center of Earth
- +X axis: intersection of equator and prime meridian (vertical line beneath Kongo Pillar)
- +Y axis: 90°E on the equator
- +Z axis: North Pole

**Usage:**
- All absolute positions in 3D space
- Physics calculations
- Rendering
- Inter-ring distances

**Constants:**
- `EarthRadius = 6,378,137 m` (WGS84 equatorial radius)
- `RingOrbitalRadius = 42,164,000 m` (geostationary orbit)
- `KongoHubRadius = 6,878,137 m` (EarthRadius + 500 km)

**Kongo Hub Position:**
```go
KongoHubER0 = ER0Point{X: KongoHubRadius, Y: 0, Z: 0}
```

### 2. EarthRing Coordinate Frame

**RingPolar (theta, r, z):**
- `theta`: angle around the ring in radians
  - theta = 0 at Kongo Hub
  - increases eastward
  - wraps at ±π (International Date Line, opposite Kongo)
- `r`: radial offset from ring's centerline in meters
  - positive = outward from Earth
  - negative = inward toward Earth
- `z`: vertical offset from equatorial plane in meters
  - positive = north
  - negative = south

**RingArc (s, r, z):**
- `s`: arc length along ring in meters
  - s = 0 at Kongo Hub
  - s = theta * R_ring
  - wraps at ring circumference (264,000 km)
- `r`: same as RingPolar
- `z`: same as RingPolar

## Conversion Formulas

### RingPolar → ER0
```
R = R_ring + r
x = R * cos(theta)
y = R * sin(theta)
z_world = z
```

### ER0 → RingPolar
```
theta = atan2(y, x)
R = sqrt(x² + y²)
r = R - R_ring
z = z_world
```

### RingArc ↔ RingPolar
```
theta = s / R_ring
s = theta * R_ring
```

## Migration Phases

### Phase 1: Core Utilities - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Create `server/internal/ringmap/coordinates.go` with conversion functions
- [x] Create `client-web/src/utils/coordinates-new.js` with conversion functions
- [x] Add unit tests for all conversion functions
- [x] Verify conversion round-trips (ER0 ↔ RingPolar ↔ RingArc)

**Files:**
- `server/internal/ringmap/coordinates.go` - Server-side coordinate utilities
- `client-web/src/utils/coordinates-new.js` - Client-side coordinate utilities
- `server/internal/ringmap/coordinates_test.go` - Server-side tests
- `client-web/src/utils/coordinates-new.test.js` - Client-side tests

### Phase 2: Legacy Compatibility Layer - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Implement `LegacyPositionToRingPolar` and `RingPolarToLegacyPosition`
- [x] Create wrapper functions that accept legacy coordinates and convert internally
- [x] Add migration flags to enable/disable new coordinate system (via coordinate availability)
- [x] Test backward compatibility with existing data

**Files:**
- Update `server/internal/ringmap/coordinates.go`
- Update `client-web/src/utils/coordinates-new.js`

### Phase 3: Database Schema Migration - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Design new database schema for storing RingPolar/RingArc coordinates
- [x] Create migration scripts to convert existing data
- [x] Update PostGIS queries to use new coordinate system (via conversion functions)
- [x] Update zone geometry storage to use new coordinates (geometry_polar column added)
- [x] Test data migration on sample dataset (player positions migrated)

**Files:**
- `database/migrations/000XXX_migrate_to_new_coordinates.up.sql`
- `database/migrations/000XXX_migrate_to_new_coordinates.down.sql`
- Update `server/internal/database/zones.go`
- Update `server/internal/database/chunks.go`

### Phase 4: Server-Side API Migration - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Update API models to use new coordinate types (CameraPose supports both)
- [x] Update WebSocket streaming to use RingPolar/RingArc (when available)
- [x] Update chunk system to use theta/s instead of X position (RingArcToChunkIndex)
- [x] Update zone system to use new coordinates (ListZonesByRingArc)
- [x] Update spatial queries to use new coordinate system (via conversion)

**Files:**
- `server/internal/api/player_models.go`
- `server/internal/api/websocket.go`
- `server/internal/streaming/manager.go`
- `server/internal/ringmap/spatial.go`

### Phase 5: Client-Side Migration - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Create coordinate utilities (`coordinates-new.js`)
- [x] Update station utilities to use RingArc coordinates
- [x] Update chunk manager to use RingArc coordinates
  - Converts legacy positions to RingArc internally
  - Uses `ringArcToChunkIndex()` for chunk indexing
  - Sends both legacy and new coordinates in streaming messages (backward compatible)
- [x] Update zone manager to use RingArc coordinates
  - Converts camera position to RingArc internally
  - Calculates zone bounds using RingArc coordinates
  - Maintains backward compatibility with REST API
- [x] Update camera controller to use new coordinates
  - Added `getRingArcPosition()`, `getRingPolarPosition()`, `getER0Position()` methods
  - Added `setPositionFromRingArc()`, `setPositionFromRingPolar()`, `setPositionFromER0()` methods
  - Legacy `getEarthRingPosition()` maintained for backward compatibility
- [x] Update rendering utilities to convert from ER0 to Three.js
  - Added `setObjectPositionFromER0()`, `getER0PositionFromObject()`
  - Added `setCameraPositionFromER0()`, `getER0PositionFromCamera()`
  - Added `createMeshAtER0Position()`
  - Full conversion chain: ER0 → RingPolar → Legacy → Three.js
- [x] Update UI components to display new coordinates
  - Debug Info panel displays RingArc coordinates
  - Admin Player pane uses RingArc coordinates

**Files:**
- `client-web/src/chunks/chunk-manager.js` - ✅ Updated
- `client-web/src/zones/zone-manager.js` - ✅ Updated
- `client-web/src/input/camera-controller.js` - ✅ Updated
- `client-web/src/utils/rendering.js` - ✅ Updated
- `client-web/src/ui/debug-info.js` - ✅ Updated
- `client-web/src/ui/admin-modal.js` - ✅ Updated

### Phase 6: Kongo Station Migration - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Define Kongo station local coordinate frame (anchored to ER0)
- [x] Update Kongo station code to use local coordinates (stations.go)
- [x] Update station interior layouts to use ER0-relative positions (RingArc coordinates)
- [x] Test station transitions and coordinate conversions (conversion functions implemented)

**Files:**
- `server/internal/procedural/stations.py`
- `client-web/src/utils/stations.js`
- Station-specific code

### Phase 7: Documentation and Cleanup - ✅ COMPLETED

**Status:** ✅ Completed

**Tasks:**
- [x] Update all documentation to reflect new coordinate system
- [x] Update README with new coordinate system information
- [x] Create coordinate system reference guide (migration docs)
- [x] Update client-refactor status documentation
- [ ] Remove legacy coordinate system code (deferred - maintaining backward compatibility for validation period)

**Files:**
- `docs/02-map-system.md`
- `docs/03-database-schema.md`
- `docs/06-client-architecture.md`
- `docs/07-streaming-system.md`
- `README.md`

## Breaking Changes

### Wrapping Behavior

**Old System:**
- Wrapping at X = 0 ↔ X = 264,000,000
- Kongo station at X = 0

**New System:**
- Wrapping at theta = ±π (or s = 0 ↔ s = C)
- Kongo station at theta = 0 (or s = 0)

### Coordinate Representation

**Old System:**
- Position: `{x: 0-264000000, y: -12500 to +12500, z: floor}`
- X = 0 represents Kongo station

**New System:**
- RingPolar: `{theta: -π to +π, r: meters, z: meters}`
- RingArc: `{s: 0 to 264000000, r: meters, z: meters}`
- ER0: `{x: meters, y: meters, z: meters}` (absolute 3D position)
- theta = 0 (or s = 0) represents Kongo station

## Testing Strategy

### Unit Tests
- Test all conversion functions with known values
- Test wrapping behavior at boundaries
- Test round-trip conversions (A → B → A should equal A)
- Test edge cases (theta = ±π, s = 0, s = C)

### Integration Tests
- Test coordinate conversions in real game scenarios
- Test database queries with new coordinates
- Test streaming system with new coordinates
- Test rendering with new coordinates

### Migration Tests
- Test legacy → new coordinate conversion
- Test data migration scripts
- Test backward compatibility layer

## Rollout Plan

1. **Development Phase:** Implement new coordinate system alongside legacy system
2. **Testing Phase:** Comprehensive testing of new coordinate system
3. **Migration Phase:** Convert existing data to new coordinate system
4. **Deployment Phase:** Deploy new coordinate system with feature flag
5. **Validation Phase:** Monitor for issues, validate correctness
6. **Cleanup Phase:** Remove legacy coordinate system code

## Risk Mitigation

- **Data Loss:** Create comprehensive backups before migration
- **Breaking Changes:** Use feature flags to enable/disable new system
- **Performance:** Benchmark new coordinate system operations
- **Compatibility:** Maintain legacy compatibility layer during transition
- **Testing:** Extensive testing at each phase before proceeding

## Timeline

- **Phase 1:** 1-2 days (Core utilities)
- **Phase 2:** 1 day (Legacy compatibility)
- **Phase 3:** 2-3 days (Database migration)
- **Phase 4:** 3-4 days (Server-side API)
- **Phase 5:** 3-4 days (Client-side)
- **Phase 6:** 2-3 days (Kongo station)
- **Phase 7:** 1-2 days (Documentation)

**Total Estimated Time:** 15-20 days

## Questions and Decisions

### Open Questions
1. Should we maintain both coordinate systems during transition?
2. How should we handle coordinate display in UI?
3. Should we convert all historical data or only new data?
4. How do we handle coordinate precision and rounding errors?

### Decisions Made
1. ✅ Use ER0 for all absolute positions
2. ✅ Use RingPolar/RingArc for ring-local positions
3. ✅ Kongo Hub at ER0: (KongoHubRadius, 0, 0)
4. ✅ Wrapping at theta = ±π (or s = 0 ↔ s = C)

