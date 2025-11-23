# Zone Merging Wrap-Point Fix Summary

## Problem

Zone merging was failing when zones crossed the X-axis wrap boundary (0/264,000 km boundary). Zones like rectangles spanning from X=15 to X=263,999,970 (wrapping around the boundary) could not be merged with overlapping zones. The issue manifested in two ways:

1. **Initial attempt**: Using `normalize_zone_geometry_for_area()` in the transformation pipeline caused "The 'coordinates' in GeoJSON are not sufficiently nested" errors
2. **Second attempt**: Trying to shift entire geometries resulted in incorrect merged shapes (missing overlaps, no fills)

## Root Cause

### Why normalize_zone_geometry_for_area() Fails

The `normalize_zone_geometry_for_area()` function (in `database/migrations/000015_normalize_zone_geometry_for_area.up.sql`) works by:
1. Converting geometry to GeoJSON
2. Manipulating the JSON coordinate arrays
3. Converting back to geometry

This process creates geometry structures that are valid for area calculations but become **corrupted** when further transformed with `ST_Translate`, `ST_Union`, and `ST_AsGeoJSON`.

### Why Geometry-Level Shifting Fails

For wrapped geometries (e.g., rectangle from X=15 to X=263,999,970), we need to shift **individual coordinates**, not the entire geometry. A geometry-level `ST_Translate` would shift all coordinates equally, failing to make the geometry contiguous.

## Solution

Use **ST_DumpPoints + ST_MakePolygon** for per-coordinate normalization using pure PostGIS geometry operations:

### Key Changes

**Implemented per-coordinate normalization** (`server/internal/database/zones.go`) using PostGIS geometry operations:

**Before (BROKEN approaches):**
```
Approach 1: normalize_zone_geometry_for_area (JSON manipulation)
→ Caused "coordinates not sufficiently nested" errors

Approach 2: ST_Translate entire geometries
→ Created incorrect merged shapes (missing overlaps, no fills)
```

**After (WORKING):**
```sql
-- Extract points, shift X coordinates > half_ring, rebuild polygon
ST_MakePolygon(
    ST_MakeLine(
        ARRAY(
            SELECT ST_MakePoint(
                CASE 
                    WHEN ST_X(point) > 132000000 THEN ST_X(point) - 264000000
                    ELSE ST_X(point)
                END,
                ST_Y(point)
            )
            FROM ST_DumpPoints(ST_ExteriorRing(geom))
        )
    )
)
```

**Key Insights:**
1. `normalize_zone_geometry_for_area()` should ONLY be used for area calculations, never in transformation pipelines
2. Wrapped geometries require **per-coordinate** shifting, not geometry-level shifting
3. PostGIS geometry operations preserve structure better than JSON manipulation

2. **Pattern Consistency**: The new approach follows the same pattern as:
   - `client-web/src/utils/coordinates.js` - `wrapRingPosition()`
   - `client-web/src/zones/zone-editor.js` - Circle wrap handling
   - `client-web/src/chunks/chunk-manager.js` - Chunk wrapping
   - `server/internal/ringmap/wrapping.go` - Server-side position wrapping

3. **Updated Test** (`server/internal/database/zones_test.go`):
   - Enabled previously skipped `TestZoneStorage_MergeWrappedZones` test
   - Updated comments to reflect the fix

### How It Works

The working solution uses **ST_DumpPoints + ST_MakePolygon** for per-coordinate normalization:

1. **Load geometries** - Load and validate all input geometries with `ST_MakeValid`
2. **Detect wrapping** - Check if any geometry has `span > half_ring (132,000 km)`
   ```sql
   EXISTS(SELECT 1 WHERE ST_XMax(geom) - ST_XMin(geom) > 132000000.0)
   ```
3. **Per-coordinate normalization** - If wrapping detected, rebuild each polygon:
   ```sql
   ST_MakePolygon(
       ST_MakeLine(
           ARRAY(
               SELECT ST_MakePoint(
                   CASE 
                       WHEN ST_X((dp).geom) > 132000000.0 
                       THEN ST_X((dp).geom) - 264000000.0
                       ELSE ST_X((dp).geom)
                   END,
                   ST_Y((dp).geom)
               )
               FROM ST_DumpPoints(ST_ExteriorRing(geom)) AS dp
           )
       )
   )
   ```
4. **Find bounds** - Determine min/max X across normalized geometries
5. **Align to positive space** - Shift all geometries to eliminate negative coordinates:
   ```sql
   ST_Translate(geom, -LEAST(min_x, 0.0), 0.0)
   ```
6. **Union** - Merge geometries in aligned space using `ST_Union`
7. **Handle MultiPolygon** - Use `ST_UnaryUnion`, or take largest component if still multi
8. **Shift back** - Reverse the alignment shift:
   ```sql
   ST_Translate(geom, LEAST(min_x, 0.0), 0.0)
   ```
9. **Wrap** - Simple modulo-style wrapping to [0, 264000000) range:
   ```sql
   WHEN ST_XMin(geom) < 0 THEN ST_Translate(geom, 264000000.0, 0.0)
   WHEN ST_XMax(geom) >= 264000000 THEN ST_Translate(geom, -264000000.0, 0.0)
   ```
10. **Validate** - Use `ST_MakeValid()` to ensure clean geometry
11. **Convert to GeoJSON** - Final conversion with validation checks

### Example: Rectangle Wrapping Around Boundary

For a rectangle from X=15 to X=263,999,970 (wraps around):
- **Before normalization**: X range [15, 263,999,970], span = 263,999,955 (> half_ring)
- **After per-coordinate shift**: X=263,999,970 becomes -30, range now [15, -30] (contiguous!)
- **After alignment**: Shift by -15 → range [0, -45]
- **After union with circle**: Merged correctly
- **After shift back + wrap**: Back to valid [0, 264000000) range

### Benefits

- ✅ **Pure PostGIS geometry operations** - Uses ST_DumpPoints, ST_MakePoint, ST_MakeLine, ST_MakePolygon - no JSON manipulation
- ✅ **Per-coordinate normalization** - Shifts individual coordinates, handles complex wrapped geometries correctly
- ✅ **No coordinate structure corruption** - Avoids the JSON->Geom->JSON conversion issues that plague `normalize_zone_geometry_for_area()`
- ✅ **Correct merged shapes** - Produces proper union results with correct overlaps and fills
- ✅ **Maintains geometry validity** - Structure remains valid through all transformations
- ✅ **Follows codebase pattern** - Wrap detection (span > half_ring) consistent with client-side approach
- ✅ **Tested and working** - Successfully merges wrapped rectangle with overlapping circle

## Files Modified

1. `server/internal/database/zones.go` - Simplified zone merging query
2. `server/internal/database/zones_test.go` - Enabled wrapped zone merge test

## Testing

### Automated Tests

Run the zone merging tests:
```powershell
cd server
go test ./internal/database -v -run TestZoneStorage_Merge
```

Specifically test wrapped zones:
```powershell
go test ./internal/database -v -run TestZoneStorage_MergeWrappedZones
```

### Manual Testing (Verified Working)

1. Create a rectangle zone near the wrap boundary (e.g., X: 15 to 263,999,970)
2. Create an overlapping circle zone
3. The zones should merge into a single polygon with correct shape:
   - Rectangle portion fully rendered with fill
   - Circle portion fully rendered with fill
   - Overlap area included in merged zone
   - No missing sections or outline-only artifacts

**Result**: ✅ Successfully tested - zones merge correctly with proper shapes

## Related Code References

- **Coordinate wrapping**: `client-web/src/utils/coordinates.js:153-156` - `wrapRingPosition()`
- **Chunk wrapping**: `client-web/src/chunks/chunk-manager.js:496-497` - Chunk offset calculation
- **Zone rendering wrapping**: `client-web/src/zones/zone-manager.js:254-266` - `wrapZoneX()`
- **Zone editor wrapping**: `client-web/src/zones/zone-editor.js:1216-1272` - Circle boundary crossing
- **Server wrapping**: `server/internal/ringmap/wrapping.go:14-21` - `WrapPosition()`
- **Database normalization**: `database/migrations/000015_normalize_zone_geometry_for_area.up.sql:10-140`

## Implementation Pattern

This fix establishes the correct approach for **server-side geometry operations** on wrapped zones:

### For Database/PostGIS Operations (Zone Merging, etc.)

```
1. Detect if any geometry crosses wrap boundary (span > RING_CIRCUMFERENCE / 2)
2. If crossing, use ST_DumpPoints + ST_MakePolygon to shift INDIVIDUAL COORDINATES:
   - Extract all points from polygon
   - Shift points where X > half_ring by -ring_circumference
   - Rebuild polygon from shifted points
3. Perform operation (ST_Union, etc.) in normalized space
4. Shift result back and wrap to [0, RING_CIRCUMFERENCE) using modulo arithmetic
```

**Key principle**: For complex operations (union, intersection, etc.), use **per-coordinate normalization** with PostGIS geometry operations, not JSON manipulation.

### For Simple Operations (Area Calculation)

```
Use normalize_zone_geometry_for_area() - it's safe for read-only operations
```

### For Client-Side Rendering

```
Use wrapRingPosition() and chunk offset calculations (already implemented)
```

This pattern ensures consistent, correct behavior across the codebase while avoiding the pitfalls of JSON-based coordinate manipulation in transformation pipelines.

