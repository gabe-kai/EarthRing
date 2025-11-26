# Database Coordinate System Migration Plan

## Overview

This document outlines the database migration strategy for transitioning from the legacy coordinate system to the new ER0/EarthRing coordinate system.

## Current Database Schema

### Players Table
- `current_position POINT` - Legacy (x, y) coordinates
- `current_floor INTEGER` - Floor/level

### Zones Table
- `geometry GEOMETRY(POLYGON, 0)` - PostGIS polygon using legacy (x, y) coordinates
- `floor INTEGER` - Floor/level

### Chunk Data Table
- `geometry GEOMETRY(POLYGON, 0)` - PostGIS polygon using legacy (x, y) coordinates

## Migration Strategy

### Phase 1: Add New Coordinate Columns (Non-Breaking)

Add new columns to store RingPolar/RingArc coordinates alongside legacy coordinates:
- `players.position_theta REAL` - Angle around ring in radians
- `players.position_r REAL` - Radial offset from centerline
- `players.position_z REAL` - Vertical offset from equatorial plane
- `zones.geometry_polar GEOMETRY(POLYGON, 0)` - Geometry in RingPolar coordinates
- `chunk_data.geometry_polar GEOMETRY(POLYGON, 0)` - Geometry in RingPolar coordinates

**Rationale**: Adding columns allows gradual migration without breaking existing code.

### Phase 2: Create Conversion Functions

Create PostgreSQL functions to convert between coordinate systems:
- `legacy_to_ring_polar(x REAL, y REAL, z REAL) RETURNS (theta REAL, r REAL, z REAL)`
- `ring_polar_to_legacy(theta REAL, r REAL, z REAL) RETURNS (x REAL, y REAL, z REAL)`
- `legacy_geometry_to_polar(geometry) RETURNS geometry` - Convert PostGIS geometry

**Rationale**: Centralized conversion logic ensures consistency.

### Phase 3: Migrate Existing Data

Populate new columns from existing data:
- Convert all `players.current_position` to RingPolar
- Convert all `zones.geometry` to `geometry_polar`
- Convert all `chunk_data.geometry` to `geometry_polar`

**Rationale**: Ensures all data is available in both coordinate systems during transition.

### Phase 4: Update Indexes

Create new spatial indexes on polar geometry columns:
- `idx_zones_geometry_polar ON zones USING GIST(geometry_polar)`
- `idx_chunk_data_geometry_polar ON chunk_data USING GIST(geometry_polar)`

**Rationale**: Maintains query performance with new coordinate system.

### Phase 5: Update Application Code

Update server-side code to use new coordinate columns:
- Update `server/internal/database/players.go`
- Update `server/internal/database/zones.go`
- Update `server/internal/database/chunks.go`

**Rationale**: Application code must use new coordinates for new data.

### Phase 6: Remove Legacy Columns (Breaking)

After validation period, remove legacy columns:
- Remove `players.current_position`
- Remove `zones.geometry` (rename `geometry_polar` to `geometry`)
- Remove `chunk_data.geometry` (rename `geometry_polar` to `geometry`)

**Rationale**: Clean up after successful migration.

## Migration Files

### Migration 000018: Add New Coordinate Columns

**File**: `000018_add_new_coordinate_columns.up.sql`

Adds new columns for RingPolar coordinates:
- `players.position_theta`, `position_r`, `position_z`
- `zones.geometry_polar`
- `chunk_data.geometry_polar`

### Migration 000019: Create Conversion Functions

**File**: `000019_create_coordinate_conversion_functions.up.sql`

Creates PostgreSQL functions for coordinate conversion.

### Migration 000020: Migrate Existing Data

**File**: `000020_migrate_existing_coordinates.up.sql`

Populates new columns from existing data using conversion functions.

### Migration 000021: Create New Indexes

**File**: `000021_create_polar_geometry_indexes.up.sql`

Creates spatial indexes on new geometry columns.

## Rollback Strategy

Each migration includes a corresponding `.down.sql` file for rollback:
- Migration 000021: Drop new indexes
- Migration 000020: Clear new coordinate columns
- Migration 000019: Drop conversion functions
- Migration 000018: Drop new columns

## Testing Strategy

1. **Unit Tests**: Test conversion functions with known values
2. **Integration Tests**: Test data migration on sample dataset
3. **Validation Tests**: Verify round-trip conversions (legacy → polar → legacy)
4. **Performance Tests**: Compare query performance with new indexes

## Risk Mitigation

1. **Data Loss**: Create full database backup before migration
2. **Performance**: Monitor query performance after index creation
3. **Compatibility**: Maintain legacy columns during transition period
4. **Rollback**: Test rollback procedures before production migration

## Timeline

- **Phase 1-2**: 1 day (Add columns, create functions)
- **Phase 3**: 1-2 days (Migrate data, depends on data volume)
- **Phase 4**: 0.5 days (Create indexes)
- **Phase 5**: 2-3 days (Update application code)
- **Phase 6**: 1 day (Remove legacy columns, after validation)

**Total Estimated Time**: 5-8 days

## Notes

- Migration should be done during low-traffic period
- Monitor database performance during and after migration
- Keep legacy columns for at least one release cycle for rollback capability
- Coordinate with application deployment to ensure code and database are in sync

