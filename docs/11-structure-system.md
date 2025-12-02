# Structure System Design

**Status**: ✅ **IMPLEMENTED** - Structure system is fully implemented with CRUD operations, validation (collision detection, height limits, zone access rules), and client-side rendering.

**Related Documentation**:
- [Database Schema](03-database-schema.md) - Structure table and spatial queries
- [API Design](04-api-design.md) - Structure API endpoints
- [Zone System](09-zone-system.md) - Zone relationships and access rules
- [Client Architecture](06-client-architecture.md) - Client-side rendering
- [Map System](02-map-system.md) - Coordinate systems and floating origin pattern

## Table of Contents

- [Overview](#overview)
- [Structure Types](#structure-types)
- [Structure Properties](#structure-properties)
- [Structure Placement](#structure-placement)
- [Validation Rules](#validation-rules)
  - [Position Bounds](#position-bounds)
  - [Zone Relationships](#zone-relationships)
  - [Collision Detection](#collision-detection)
  - [Height Limit Enforcement](#height-limit-enforcement)
  - [Zone Access Rules](#zone-access-rules)
- [Client-Side Rendering](#client-side-rendering)
  - [Floating Origin Pattern](#floating-origin-pattern)
  - [Geometry Generation](#geometry-generation)
  - [Materials and Colors](#materials-and-colors)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Performance Considerations](#performance-considerations)
- [Future Enhancements](#future-enhancements)

## Overview

The structure system allows players to place and manage structures (buildings, decorations, furniture, vehicles, roads) on the EarthRing. Structures are validated for placement rules, collision detection, height limits, and zone compatibility. The system supports both player-placed and procedurally-generated structures.

**Key Features**:
- **CRUD Operations**: Create, read, update, and delete structures
- **Spatial Validation**: Position bounds, zone relationships, collision detection
- **Height Limits**: Type-specific maximum heights with floor range validation
- **Zone Access Rules**: Restricted zone blocking and zone type compatibility
- **Client Rendering**: Floating origin pattern for precision at large distances
- **Dynamic Geometry**: Structure-specific geometry based on type and properties

## Structure Types

The system supports the following structure types:

### Buildings
- **Purpose**: Residential, commercial, industrial structures
- **Default Dimensions**: 20m × 20m × 20m (width × depth × height)
- **Default Max Height**: 300m (15 floors)
- **Default Collision Radius**: 10m
- **Allowed Zones**: residential, commercial, industrial, mixed-use, agricultural, cargo
- **Geometry**: Rectangular prisms (`THREE.BoxGeometry`)

### Decorations
- **Purpose**: Decorative elements, monuments, art
- **Default Dimensions**: 5m × 5m × 5m
- **Default Max Height**: 20m
- **Default Collision Radius**: 2.5m
- **Allowed Zones**: All zones except restricted
- **Geometry**: Cylinders (`THREE.CylinderGeometry`)

### Furniture
- **Purpose**: Small furniture items, benches, tables
- **Default Dimensions**: 2m × 2m × 2m
- **Default Max Height**: 5m
- **Default Collision Radius**: 1m
- **Allowed Zones**: All zones except restricted
- **Geometry**: Small boxes (`THREE.BoxGeometry`)

### Vehicles
- **Purpose**: Player vehicles, NPC vehicles
- **Default Dimensions**: 4m × 8m × 2m (width × depth × height)
- **Default Max Height**: 5m
- **Default Collision Radius**: 4m
- **Allowed Zones**: industrial, agricultural, cargo
- **Geometry**: Elongated boxes (`THREE.BoxGeometry`)

### Roads
- **Purpose**: Transportation infrastructure (primarily procedural)
- **Default Dimensions**: 10m × 0.2m × 0.1m
- **Default Max Height**: 0.5m
- **Default Collision Radius**: 5m
- **Allowed Zones**: transit zones (primarily procedural)
- **Geometry**: Flat planes (`THREE.PlaneGeometry`)
- **Note**: Manual road placement may not be available in the final version

## Structure Properties

Structures can have custom properties stored as JSONB in the database:

```json
{
  "height": 50.0,              // Custom height in meters
  "width": 15.0,               // Custom width in meters
  "depth": 15.0,                // Custom depth in meters
  "collision_radius": 7.5,      // Custom collision radius in meters
  "max_height": 100.0,          // Custom maximum height in meters
  "color": "#888888",           // Custom material color (hex)
  "metalness": 0.5,             // Custom material metalness (0-1)
  "roughness": 0.8              // Custom material roughness (0-1)
}
```

**Property Priority**:
1. Custom properties override defaults
2. If a property is not specified, the type-specific default is used
3. If no type-specific default exists, a global default is used

## Structure Placement

### Position Coordinates

Structures are positioned using EarthRing coordinates:
- **X (Ring Position)**: Arc length along the ring in meters, range `[0, 264,000,000)`
- **Y (Width Position)**: Offset from ring centerline in meters, range `[-2,500, +2,500]`
- **Z (Floor)**: Floor/level number, range `[-2, 15]`

### Rotation and Scale

- **Rotation**: Rotation around Y-axis in degrees, range `[-360, 360]`
- **Scale**: Uniform scale factor, must be `> 0`

### Zone Relationships

Structures can optionally be associated with a zone:
- If `zone_id` is provided, the structure must be:
  - Within the zone's geometry (`ST_Contains`)
  - On the same floor as the zone
  - Compatible with the zone type (see [Zone Access Rules](#zone-access-rules))

## Validation Rules

### Position Bounds

Structures must be placed within valid coordinate bounds:
- **X coordinate**: `[0, 264,000,000)` (ring circumference)
- **Y coordinate**: `[-2,500, +2,500]` (max width offset)
- **Floor**: `[-2, 15]` (valid floor range)

**Error Messages**:
- `"x coordinate out of bounds: {value} (allowed 0..264000000)"`
- `"y coordinate out of bounds: {value} (allowed ±2500)"`
- `"floor must be between -2 and 15"`

### Zone Relationships

If a structure is associated with a zone (`zone_id` is set), the server validates:
1. The zone exists
2. The structure's floor matches the zone's floor
3. The structure's position is within the zone's geometry (`ST_Contains`)

**Error Messages**:
- `"zone {id} not found or structure position ({x}, {y}) is not within zone {id} on floor {floor}"`

### Collision Detection

Structures cannot overlap with other structures on the same floor. The system uses PostGIS `ST_DWithin` to efficiently query for nearby structures.

**Collision Radius**:
- Determined by structure type and scale
- Formula: `collisionRadius = (defaultRadius || customRadius) * scale`
- Default collision radii:
  - Buildings: 10m
  - Decorations: 2.5m
  - Furniture: 1m
  - Vehicles: 4m
  - Roads: 5m

**Collision Check**:
- Queries for structures within `collisionRadius` distance on the same floor
- Uses PostGIS `ST_DWithin(position, otherPosition, collisionRadius)`
- Excludes the structure itself when updating

**Error Messages**:
- `"structure would collide with existing structure {id} at position ({x}, {y})"`

**Implementation** (`server/internal/database/structures.go`):
```go
func (s *StructureStorage) checkCollisions(
    structureType string,
    position Position,
    floor int,
    properties json.RawMessage,
    scale float64,
    excludeID *int64,
) error {
    collisionRadius := getCollisionRadius(structureType, properties, scale)
    // Query for nearby structures using ST_DWithin
    // Return error if collision detected
}
```

### Height Limit Enforcement

Structures must respect type-specific maximum heights and floor range limits.

**Height Calculation**:
- Extracted from `properties.height` or defaults to `FloorHeight` (20m)
- Scaled by structure `scale`: `effectiveHeight = height * scale`

**Maximum Heights**:
- Default maximum heights by type:
  - Buildings: 300m (15 floors)
  - Decorations: 20m
  - Furniture: 5m
  - Vehicles: 5m
  - Roads: 0.5m
- Can be overridden via `properties.max_height`

**Floor Range Validation**:
- Structures cannot extend beyond valid floor range `[-2, 15]`
- Formula: `floorsNeeded = ceil(effectiveHeight / FloorHeight)`
- Structure spans floors: `[floor, floor + floorsNeeded - 1]`
- Validation: `floor + floorsNeeded - 1 <= MaxFloor (15)`

**Error Messages**:
- `"structure height {height}m exceeds maximum allowed height {maxHeight}m for type {type}"`
- `"structure on floor {floor} with height {height}m would extend beyond maximum floor {maxFloor}"`

**Implementation** (`server/internal/database/structures.go`):
```go
func validateHeight(
    structureType string,
    floor int,
    properties json.RawMessage,
    scale float64,
) error {
    height := getStructureHeight(properties)
    maxHeight := getMaxHeight(structureType, properties)
    effectiveHeight := height * scale
    
    if effectiveHeight > maxHeight {
        return fmt.Errorf("height exceeds maximum")
    }
    
    floorsNeeded := int(math.Ceil(effectiveHeight / FloorHeight))
    if floor + floorsNeeded - 1 > MaxFloor {
        return fmt.Errorf("would extend beyond maximum floor")
    }
    
    return nil
}
```

### Zone Access Rules

Structures must comply with zone access rules based on zone type and structure type.

#### Restricted Zones

**Rule**: No structures can be placed in restricted zones.

**Purpose**: Restricted zones are used to prevent procedural generation in specific areas (e.g., maglev transit corridors).

**Error Message**: `"structures cannot be placed in restricted zones (zone {id} is restricted)"`

#### Zone Type Compatibility

Structures must be compatible with the zone type they are placed in:

| Structure Type | Allowed Zone Types |
|---------------|-------------------|
| **Building** | residential, commercial, industrial, mixed-use, agricultural, cargo |
| **Decoration** | All zones except restricted |
| **Furniture** | All zones except restricted |
| **Vehicle** | industrial, agricultural, cargo |
| **Road** | transit (primarily procedural) |

**Special Rules**:
- **Parks**: Only decorations and furniture allowed (no buildings)
- **Transit Zones**: Only decorations and furniture allowed (no buildings)
- **Mixed-Use Zones**: Buildings, decorations, and furniture allowed

**Error Message**: `"structure type '{type}' is not allowed in zone type '{zoneType}' (allowed types: {allowed})"`

**Implementation** (`server/internal/database/structures.go`):
```go
func validateZoneTypeCompatibility(zoneType string, structureType string) error {
    normalizedZoneType := strings.ToLower(strings.ReplaceAll(zoneType, "_", "-"))
    normalizedStructureType := strings.ToLower(structureType)
    
    allowedStructures := map[string][]string{
        "residential":   {"building", "decoration", "furniture"},
        "commercial":    {"building", "decoration", "furniture"},
        "industrial":    {"building", "decoration", "furniture", "vehicle"},
        "mixed-use":     {"building", "decoration", "furniture"},
        "park":          {"decoration", "furniture"},
        "cargo":         {"building", "decoration", "furniture", "vehicle"},
        "transit":       {"decoration", "furniture"},
    }
    
    // Check if structure type is allowed in zone type
    // Return error if not allowed
}
```

**Note**: Structures without a `zone_id` are not subject to zone access rules. This allows flexibility for structures placed outside of zones.

## Client-Side Rendering

### Floating Origin Pattern

Structures use a floating origin pattern to maintain floating-point precision at large distances from the Three.js world origin (0,0,0). This prevents flickering and "double layer" artifacts at distant pillar hubs (e.g., X=22,000,000m).

**Problem**: When rendering geometry far from the Three.js origin, floating-point precision can degrade, causing visual artifacts like flickering, "z-fighting", or "double-layer" effects.

**Solution**: 
1. The structure group is positioned at the camera's X position (`structureOriginX = cameraX`)
2. All structure vertices are built relative to this origin (subtract `structureOriginX`)
3. This keeps vertex coordinates small (typically -500m to +500m), maintaining precision

**Implementation** (`client-web/src/structures/structure-manager.js`):
```javascript
// Wrap structure position relative to camera (for floating origin)
const wrappedAbsolute = normalizeRelativeToCamera(structureX, cameraX);

// Convert wrapped absolute coordinate to Three.js coordinates
const earthRingPos = {
  x: wrappedAbsolute,
  y: structureY,
  z: floorHeight,
};
const threeJSPosWorld = toThreeJS(earthRingPos);

// Convert structureOriginX (camera X) to Three.js coordinates
const originEarthRingPos = {
  x: structureOriginX,
  y: 0,
  z: 0,
};
const threeJSOrigin = toThreeJS(originEarthRingPos);

// Calculate local position in Three.js space
const localOffset = {
  x: threeJSPosWorld.x - threeJSOrigin.x,
  y: threeJSPosWorld.y - threeJSOrigin.y,
  z: threeJSPosWorld.z - threeJSOrigin.z,
};

// Set group position using floating origin pattern
structureGroup.position.set(
  threeJSOrigin.x + localOffset.x,
  threeJSPosWorld.y,
  threeJSPosWorld.z
);
```

**See Also**: [Map System: Floating Origin Pattern](02-map-system.md#floating-origin-pattern), [Zone System: Floating Origin Pattern](09-zone-system.md#floating-origin-pattern-solution-for-flickering-at-distant-hubs)

### Geometry Generation

Structures are rendered with type-specific geometry:

**Buildings**: `THREE.BoxGeometry(width, height, depth)`
- Rectangular prisms
- Dimensions from properties or defaults

**Decorations**: `THREE.CylinderGeometry(radius, radius, height, 8)`
- Cylindrical shapes
- Radius = `min(width, depth) / 2`

**Furniture**: `THREE.BoxGeometry(width, height, depth)`
- Small boxes
- Dimensions from properties or defaults

**Vehicles**: `THREE.BoxGeometry(width, height, depth)`
- Elongated boxes
- Dimensions from properties or defaults

**Roads**: `THREE.PlaneGeometry(width, depth)`
- Flat planes
- Dimensions from properties or defaults

**Implementation** (`client-web/src/structures/structure-manager.js`):
```javascript
createStructureGeometry(structureType, dimensions) {
  const { width, depth, height } = dimensions;
  
  switch (structureType) {
    case 'building':
      return new THREE.BoxGeometry(width, height, depth);
    case 'decoration':
      const radius = Math.min(width, depth) / 2;
      return new THREE.CylinderGeometry(radius, radius, height, 8);
    case 'furniture':
      return new THREE.BoxGeometry(width, height, depth);
    case 'vehicle':
      return new THREE.BoxGeometry(width, height, depth);
    case 'road':
      return new THREE.PlaneGeometry(width, depth);
    default:
      return new THREE.BoxGeometry(width, height, depth);
  }
}
```

### Materials and Colors

Structures use `THREE.MeshStandardMaterial` with type-specific colors:

| Structure Type | Default Color | Metalness | Roughness |
|---------------|--------------|-----------|-----------|
| **Building** | `0x888888` (Gray) | 0.3 | 0.7 |
| **Decoration** | `0x00ff00` (Green) | 0.3 | 0.7 |
| **Furniture** | `0xff8800` (Orange) | 0.3 | 0.7 |
| **Vehicle** | `0x0000ff` (Blue) | 0.3 | 0.7 |
| **Road** | `0x444444` (Dark Gray) | 0.3 | 0.7 |

**Custom Materials**: Structures can specify custom material properties in `properties`:
- `color`: Hex color string (e.g., `"#888888"`)
- `metalness`: 0-1 value
- `roughness`: 0-1 value

**Shadows**: All structures cast and receive shadows (`castShadow = true`, `receiveShadow = true`).

## API Endpoints

### Create Structure

```
POST /api/structures
Headers: Authorization: Bearer {access_token}
Body: {
  "structure_type": "building",
  "position": {"x": 12345, "y": 100},
  "floor": 0,
  "rotation": 45,
  "scale": 1.0,
  "zone_id": 456,
  "properties": {
    "height": 50,
    "width": 15,
    "depth": 15
  }
}
Response: {
  "id": 789,
  "structure_type": "building",
  "position": {"x": 12345, "y": 100},
  "floor": 0,
  "rotation": 45,
  "scale": 1.0,
  "zone_id": 456,
  "properties": {...},
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Validation**: All validation rules are applied (position bounds, zone relationships, collisions, height limits, zone access rules).

**Error Responses**:
- `400 Bad Request`: Validation error (position bounds, rotation, scale, structure_type)
- `409 Conflict`: Collision detected
- `400 Bad Request`: Height limit exceeded
- `400 Bad Request`: Zone access rule violation

### Get Structure

```
GET /api/structures/{structure_id}
Headers: Authorization: Bearer {access_token}
Response: {
  "id": 789,
  "structure_type": "building",
  "position": {"x": 12345, "y": 100},
  "properties": {...},
  "model_data": {...}
}
```

### Update Structure

```
PUT /api/structures/{structure_id}
Headers: Authorization: Bearer {access_token}
Body: {
  "position": {"x": 12350, "y": 105},
  "rotation": 90,
  "properties": {
    "height": 60
  }
}
Response: {
  "id": 789,
  "structure_type": "building",
  "position": {"x": 12350, "y": 105},
  "rotation": 90,
  "updated_at": "2024-01-01T01:00:00Z"
}
```

**Validation**: All validation rules are applied to updated fields.

### Delete Structure

```
DELETE /api/structures/{structure_id}
Headers: Authorization: Bearer {access_token}
Response: 204 No Content
```

## Database Schema

### Structures Table

```sql
CREATE TABLE structures (
    id SERIAL PRIMARY KEY,
    structure_type VARCHAR(50) NOT NULL,
    position GEOMETRY(POINT, 0) NOT NULL,  -- EarthRing (x, y) in meters
    floor INTEGER DEFAULT 0 NOT NULL,       -- Floor/level (-2..15)
    rotation REAL DEFAULT 0,                -- Degrees
    scale REAL DEFAULT 1.0,
    owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
    is_procedural BOOLEAN DEFAULT FALSE,
    procedural_seed INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB,
    model_data JSONB
);

CREATE INDEX idx_structures_position ON structures USING GIST(position);
CREATE INDEX idx_structures_owner ON structures(owner_id);
CREATE INDEX idx_structures_zone ON structures(zone_id);
CREATE INDEX idx_structures_floor ON structures(floor);
CREATE INDEX idx_structures_type ON structures(structure_type);
```

**Position Storage**: `position` is stored as `GEOMETRY(POINT, 0)` with:
- X coordinate: Ring position in meters `[0, 264,000,000)`
- Y coordinate: Width offset in meters `[-2,500, +2,500]`

**Spatial Indexing**: GIST index on `position` enables efficient spatial queries for collision detection and zone relationships.

## Performance Considerations

### Spatial Queries

Collision detection uses PostGIS `ST_DWithin` for efficient spatial queries:
- Indexed with GIST on `position`
- Queries are limited to the same floor
- Distance threshold is the collision radius

### Client-Side Rendering

**Floating Origin Pattern**: Prevents precision loss at large distances, eliminating the need for frequent re-rendering due to flickering.

**Geometry Caching**: Structure geometry is created once and reused unless dimensions change.

**Material Reuse**: Materials are created per structure but could be optimized to share materials by type.

### Future Optimizations

- **LOD (Level of Detail)**: Implement LOD for structures based on distance from camera
- **Frustum Culling**: Only render structures within the camera's view frustum
- **Instancing**: Use instanced rendering for procedurally-generated structures of the same type
- **Occlusion Culling**: Skip rendering structures occluded by other geometry

## Future Enhancements

### Planned Features

1. **3D Model Support**: Replace placeholder geometry with actual 3D models
   - Support for GLTF/GLB model formats
   - Model loading and caching
   - Animation support

2. **Structure Variants**: Multiple visual variants per structure type
   - Procedural variation based on seed
   - Player-selected variants
   - Cultural style variations

3. **Structure Functionality**: Functional structures with game mechanics
   - Resource production/consumption
   - NPC capacity and behavior
   - Interactive elements

4. **Structure Upgrades**: Allow players to upgrade structures
   - Height increases
   - Functionality improvements
   - Visual enhancements

5. **Structure Templates**: Pre-defined structure templates
   - Quick placement of common structures
   - Template library
   - Custom template creation

### Road Access Rules

**Current Status**: Road access rules are not implemented. Buildings can be placed without road access, and roads will build to connect to new structures.

**Future Consideration**: May implement road access rules in the future, but this is not a current requirement.

## Testing

### Unit Tests

**Location**: `server/internal/database/structures_validation_test.go`

**Test Coverage**:
- `TestStructureStorage_ValidationPositionBounds`: Position bounds validation
- `TestStructureStorage_CollisionDetection`: Collision detection with various scenarios
- `TestStructureStorage_HeightValidation`: Height limit enforcement
- `TestStructureStorage_ZoneAccessRules`: Zone access rules (restricted zones, zone type compatibility)

**Test Helpers**:
- `createStructuresTable`: Creates structures table for testing
- `truncateStructuresTable`: Cleans up test data
- `createZonesTable`: Creates zones table for testing
- `truncateZonesTable`: Cleans up zone test data
- `createTestZone`: Creates a test zone with PostGIS geometry

### Integration Tests

Structure system integration is tested through:
- API endpoint tests
- Client-server interaction tests
- Spatial query performance tests

## Related Systems

### Zone System

Structures are validated against zones for:
- Position containment (`ST_Contains`)
- Zone type compatibility
- Restricted zone blocking

**See**: [Zone System Design](09-zone-system.md)

### Procedural Generation

Structures can be procedurally generated:
- Marked with `is_procedural = true`
- Uses `procedural_seed` for deterministic generation
- Must pass all validation rules

**See**: [Procedural Generation](08-procedural-generation.md)

### Chunk System

Structures are associated with chunks for:
- Efficient loading and streaming
- Spatial organization
- Performance optimization

**See**: [Streaming System](07-streaming-system.md)

