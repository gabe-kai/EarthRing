# Map System Design

## Table of Contents

- [Overview](#overview)
- [Ring Geometry](#ring-geometry)
  - [Dimensions](#dimensions)
  - [Coordinate System](#coordinate-system)
  - [Primary Coordinate: Ring Position (X)](#primary-coordinate-ring-position-x)
  - [Secondary Coordinate: Width Position (Y)](#secondary-coordinate-width-position-y)
  - [Vertical Coordinate: Floor/Level (Z)](#vertical-coordinate-floorlevel-z)
- [Coordinate System Convention](#coordinate-system-convention)
  - [Rendering Engine Conversions](#rendering-engine-conversions)
- [Station System](#station-system)
  - [Station Types](#station-types)
  - [Station Geometry](#station-geometry)
  - [Station Locations](#station-locations)
- [Atlas Pillars](#atlas-pillars)
- [Chunk System](#chunk-system)
  - [Chunk Dimensions](#chunk-dimensions)
  - [Chunk Identification](#chunk-identification)
  - [Chunk Boundaries](#chunk-boundaries)
  - [Chunk Data Structure](#chunk-data-structure)
- [Map Wrapping](#map-wrapping)
  - [Wrapping Logic](#wrapping-logic)
  - [Wrapping Considerations](#wrapping-considerations)
- [Zone Layout](#zone-layout)
  - [Zone Types](#zone-types)
  - [Zone Distribution](#zone-distribution)
- [Procedural Generation vs. Player-Placed Structures](#procedural-generation-vs-player-placed-structures)
  - [Procedural Generation](#procedural-generation)
  - [Player-Placed Structures](#player-placed-structures)
  - [Hybrid Approach](#hybrid-approach)
- [Spatial Queries](#spatial-queries)
  - [Common Operations](#common-operations)
- [Performance Considerations](#performance-considerations)
  - [Chunk Loading](#chunk-loading)
  - [Spatial Indexing](#spatial-indexing)
  - [Caching](#caching)
- [Orbital Mechanics and Lighting](#orbital-mechanics-and-lighting)
  - [Ring Position](#ring-position)
  - [Coordinate Reference Point](#coordinate-reference-point)
  - [Lighting System](#lighting-system)
  - [Exterior Lighting (Viewing Stations, Open Areas)](#exterior-lighting-viewing-stations-open-areas)
  - [Interior Lighting (Enclosed Structures)](#interior-lighting-enclosed-structures)
  - [Lighting Implementation](#lighting-implementation)
- [Special Structure Loading](#special-structure-loading)
  - [Station Transitions (Smooth)](#station-transitions-smooth)
  - [Building/Arcology Interior Transitions (Loading Screen)](#buildingarcology-interior-transitions-loading-screen)
- [Vertical Stacking (Multi-Floor System)](#vertical-stacking-multi-floor-system)
  - [Building Model](#building-model)
  - [Floor Management](#floor-management)
  - [Floor Height Specifications](#floor-height-specifications)
  - [Station Level Height](#station-level-height)
  - [Main Ring Structure](#main-ring-structure)
  - [Station Vertical Flaring](#station-vertical-flaring)
  - [Building Floor Height](#building-floor-height)
  - [Height Relationships](#height-relationships)
- [Implementation Considerations](#implementation-considerations)
- [Chunk Boundary Handling at Stations](#chunk-boundary-handling-at-stations)
  - [Design Decision: Hybrid Variable-Width Chunks](#design-decision-hybrid-variable-width-chunks)
  - [Implementation](#implementation)
  - [Vertical Flaring Considerations](#vertical-flaring-considerations)
  - [Performance Optimizations](#performance-optimizations)
  - [Benefits](#benefits)
- [Atmospheric Scattering Model](#atmospheric-scattering-model)
  - [Design Decision: Tiered Atmospheric Scattering](#design-decision-tiered-atmospheric-scattering)
  - [Client-Specific Models](#client-specific-models)
    - [Web Client (Three.js) - Simplified Model](#web-client-threejs---simplified-model)
    - [Light Local Client (Electron/Native) - Enhanced Model](#light-local-client-electronnative---enhanced-model)
    - [Heavy Local Client (Unreal Engine) - Physically-Based Model](#heavy-local-client-unreal-engine---physically-based-model)
  - [Shared Parameters](#shared-parameters)
  - [Implementation Strategy](#implementation-strategy)
  - [Performance Considerations](#performance-considerations-1)
  - [Visual Consistency](#visual-consistency)
  - [Aerial Perspective](#aerial-perspective)
  - [Dynamic Weather Effects](#dynamic-weather-effects)
  - [Eclipse Events](#eclipse-events)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The EarthRing map represents an orbital ring structure around Earth, consisting of multiple "floors" or levels. The map is designed as a continuous loop that wraps around, allowing seamless traversal and maglev train loops.

## Ring Geometry

### Dimensions

- **Circumference**: 264,000 km (full ring length)
- **Base Width**: 400 meters (standard ring width)
- **Station Flare Widths**: 
  - Pillar/Elevator Hubs: 25 km maximum width
  - Regional Hubs: 16 km maximum width
  - Local Stations: 5 km maximum width
- **Number of Pillar/Elevator Hubs**: 12 major hubs
- **Hub Spacing**: ~22,000 km apart (264,000 km / 12)

### Coordinate System

#### Primary Coordinate: Ring Position (X)
- **Range**: 0 to 264,000,000 meters (0 to 264,000 km)
- **Unit**: Meters
- **Reference Point**: X = 0 is positioned directly above the Prime Meridian (0° longitude) at the equator (Gulf of Guinea)
- **Wrapping**: Position wraps using modulo operation
  - Formula: `wrapped_position = position % 264000000`
  - Example: Position 264,000,100 wraps to 100
- **Orbital Context**: Ring is in geostationary orbit at ~35,786 km altitude (see Orbital Mechanics section)

#### Secondary Coordinate: Width Position (Y)
- **Range**: 
  - Standard ring: -200 to +200 meters
  - Local stations: -2,500 to +2,500 meters (5 km total width)
  - Regional hubs: -8,000 to +8,000 meters (16 km total width)
  - Pillar/Elevator hubs: -12,500 to +12,500 meters (25 km total width)
- **Unit**: Meters
- **Origin**: Center of ring (0 = center line)
- **Negative**: "North" side of ring
- **Positive**: "South" side of ring

#### Vertical Coordinate: Floor/Level (Z)
- **Range**: Integer values representing different floors
- **Unit**: Floor number (0 = ground/main floor)
- **Future**: Multiple floors can be added for vertical expansion

### Coordinate System Convention

**EarthRing Standard Convention**:
- **X-axis**: Ring position (East-West, 0 to 264,000 km)
- **Y-axis**: Width position (North-South, -2,500 to +2,500 m)
- **Z-axis**: Floor/Level (Elevation, integer floor numbers)

This convention matches **PostGIS** spatial database conventions (X/Y horizontal, Z vertical), which is used for all server-side and database operations.

#### Rendering Engine Conversions

Different 3D rendering engines use different coordinate conventions, requiring conversion when rendering:

**Three.js (Web Client)**:
- Convention: Y-up, Z-forward
  - X: Right
  - Y: Up (elevation)
  - Z: Forward (depth)
- **Conversion Required**: 
  ```javascript
  // EarthRing (X, Y, Z) -> Three.js (X, Y, Z)
  threejs_x = earthring_x;  // Ring position maps to X
  threejs_y = earthring_z * floor_height;  // Floor maps to Y (up)
  threejs_z = earthring_y;  // Width maps to Z (forward)
  ```

**Unreal Engine (Future Client)**:
- Convention: Z-up, Y-forward
  - X: Right
  - Y: Forward (depth)
  - Z: Up (elevation)
- **Conversion Required**:
  ```cpp
  // EarthRing (X, Y, Z) -> Unreal (X, Y, Z)
  unreal_x = earthring_x;  // Ring position maps to X
  unreal_y = earthring_y;  // Width maps to Y (forward)
  unreal_z = earthring_z * floor_height;  // Floor maps to Z (up)
  ```

**Conversion Strategy**:
- All game logic, database, and API use EarthRing convention (X=ring, Y=width, Z=floor)
- Conversion happens only at the rendering layer boundary
- Graphics abstraction layer (see Client Architecture doc) handles conversions
- Conversion functions should be centralized and well-documented
- Consider using a coordinate transform matrix for efficiency

**Implementation Status**: ✅ **IMPLEMENTED** - Coordinate conversion utilities are available in `client-web/src/utils/coordinates.js`. See [Client Architecture](../docs/06-client-architecture.md#utility-modules) for details.

**Important**: This conversion is **only** for rendering. All game logic, database queries, API responses, and internal calculations use the EarthRing convention (X=ring position, Y=width, Z=floor).

### Station System

The ring features three types of stations, each with different sizes and purposes. All stations use a **dual-flare geometry** that smoothly transitions both horizontally (width) and vertically (height) from the base ring dimensions to their maximum dimensions at the station center.

#### Station Types

1. **Pillar/Elevator Hubs**
   - **Purpose**: Major transportation and cargo hubs with space elevators and Atlas Pillars
   - **Maximum Flare Width**: 25 km (12,500 m radius from center)
   - **Maximum Flare Height**: 15 levels (10 additional levels beyond base 5)
   - **Flare Length**: 50 km (25 km before and after station center)
   - **Features**: Space elevator infrastructure, pillar structural supports, cargo terminals, major metropolis areas
   - **Distribution**: 12 hubs positioned at regular intervals (~22,000 km apart)

2. **Regional Hubs**
   - **Purpose**: Secondary transportation and commercial hubs
   - **Maximum Flare Width**: 16 km (8,000 m radius from center)
   - **Maximum Flare Height**: 11 levels (6 additional levels beyond base 5)
   - **Flare Length**: 32 km (16 km before and after station center)
   - **Features**: Regional transit connections, commercial districts, smaller cargo facilities
   - **Distribution**: Multiple hubs positioned between pillar hubs

3. **Local Stations**
   - **Purpose**: Local access points and small communities
   - **Maximum Flare Width**: 5 km (2,500 m radius from center)
   - **Maximum Flare Height**: 7 levels (2 additional levels beyond base 5)
   - **Flare Length**: 10 km (5 km before and after station center)
   - **Features**: Local transit stops, small commercial areas, residential access points
   - **Distribution**: Many stations distributed throughout the ring

#### Station Geometry

**Status**: ✅ **IMPLEMENTED** - Station flare calculations (`server/internal/procedural/stations.py`) provide variable-width and variable-height chunks based on distance from station centers.

All stations use a smooth **dual-flare transition** (both horizontal and vertical) from the base ring dimensions to their maximum dimensions at the station center. The flare shape uses a cosine-based smooth transition for both axes.

**Base Ring Dimensions**:
- **Base Width**: 400 meters
- **Base Height**: 5 levels (Levels -2, -1, 0, +1, +2)

**Flare Width Calculation** (generalized for all station types): ✅ **IMPLEMENTED**

**Implementation**: `stations.calculate_flare_width()` in `server/internal/procedural/stations.py`

```
distance_from_center = |position - station_center|
flare_radius = station_type.max_flare_radius  // 12,500, 8,000, or 2,500
flare_length = station_type.flare_length  // 50,000, 32,000, or 10,000
base_width = 400
flare_range = flare_length / 2

if distance_from_center <= flare_range:
    // Pillar/elevator hubs have a flat plateau at the center
    // Plateau covers ±2.5 km (5 chunks: -2, -1, 0, +1, +2 relative to station center)
    plateau_radius = 2500.0 if station_type is PILLAR_ELEVATOR_HUB else 0.0
    
    if plateau_radius > 0.0 && distance_from_center <= plateau_radius:
        // Within plateau: full maximum width
        width = flare_radius * 2.0
    else:
        // After plateau: smooth cosine taper
        effective_range = flare_range - plateau_radius
        adjusted_distance = max(distance_from_center - plateau_radius, 0.0)
        normalized_distance = adjusted_distance / effective_range
        flare_contribution = (1 + cos(π * normalized_distance)) / 2
        max_width = flare_radius * 2.0
        width = base_width + (max_width - base_width) * flare_contribution
else:
    // Outside flare zone - base width
    width = base_width
```

**Features**:
- Automatically calculates chunk width based on distance from nearest station
- Supports ring wrapping (distance calculations account for ring boundaries)
- Cosine-based smooth transitions for seamless geometry
- **Pillar hub plateau**: Five center chunks (indices ...263998, 263999, 0, 1, 2...) at pillar hubs receive maximum width before tapering, ensuring perfect seam alignment
- Currently implements 12 pillar/elevator hubs (regional hubs and local stations can be added)

**Flare Height Calculation** (generalized for all station types): ✅ **IMPLEMENTED**

**Implementation**: `stations.calculate_flare_levels()` in `server/internal/procedural/stations.py`

```
distance_from_center = |position - station_center|
max_levels = station_type.max_levels  // 15, 11, or 7
base_levels = 5
flare_length = station_type.flare_length  // Same as width flare

if distance_from_center <= flare_length / 2:
    // Within flare zone - smooth transition
    normalized_distance = distance_from_center / (flare_length / 2)
    additional_levels = (max_levels - base_levels) * (1 - cos(π * normalized_distance)) / 2
    total_levels = base_levels + additional_levels
else:
    // Outside flare zone - base levels
    total_levels = base_levels
```

**Features**:
- Automatically calculates chunk levels based on distance from nearest station
- Returns integer number of levels (5 base, up to 15 at pillar/elevator hub centers)
- Integrated into chunk generation (`get_chunk_levels()` function)
- Chunk metadata includes `chunk_levels` field

**Utility Space in Sloping Areas**:
- The sloping exterior areas created by vertical flaring are designated as **utility space**
- Utility space contains infrastructure, utilities, structural supports, and cannot be built upon by players
- Only the flat, horizontal sections at each level are buildable space
- Utility space provides realistic structural support for the flared station geometry

**Station-Specific Calculations**:

**Pillar/Elevator Hub**:
- Flare radius: 12,500 m
- Flare length: 50,000 m (25 km each side)
- Maximum width at center: 25,000 m
- Maximum levels at center: 15 levels (Levels -7 through +7)
- Additional levels: 10 levels beyond base 5

**Regional Hub**:
- Flare radius: 8,000 m
- Flare length: 32,000 m (16 km each side)
- Maximum width at center: 16,000 m
- Maximum levels at center: 11 levels (Levels -5 through +5)
- Additional levels: 6 levels beyond base 5

**Local Station**:
- Flare radius: 2,500 m
- Flare length: 10,000 m (5 km each side)
- Maximum width at center: 5,000 m
- Maximum levels at center: 7 levels (Levels -3 through +3)
- Additional levels: 2 levels beyond base 5

#### Station Locations

**Status**: ✅ **IMPLEMENTED** - Station locations defined in `server/internal/procedural/stations.py`

**Pillar/Elevator Hubs** (12 stations at regular intervals): ✅ **IMPLEMENTED**
```
Hub 0:  Position 0 km (0 meters)
Hub 1:  Position 22,000 km (22,000,000 meters)
Hub 2:  Position 44,000 km (44,000,000 meters)
Hub 3:  Position 66,000 km (66,000,000 meters)
Hub 4:  Position 88,000 km (88,000,000 meters)
Hub 5:  Position 110,000 km (110,000,000 meters)
Hub 6:  Position 132,000 km (132,000,000 meters)
Hub 7:  Position 154,000 km (154,000,000 meters)
Hub 8:  Position 176,000 km (176,000,000 meters)
Hub 9:  Position 198,000 km (198,000,000 meters)
Hub 10: Position 220,000 km (220,000,000 meters)
Hub 11: Position 242,000 km (242,000,000 meters)
```

**Implementation Details**:
- Station positions stored in `PILLAR_HUB_POSITIONS` list
- Station objects created in `PILLAR_STATIONS` list
- `find_nearest_station()` function locates nearest station with ring wrapping support
- Distance calculations account for ring boundaries

**Regional Hubs and Local Stations**: ⏳ **PENDING** - Can be added based on gameplay needs and player development patterns. Station type definitions (`REGIONAL_HUB`, `LOCAL_STATION`) are ready for use.

### Atlas Pillars

Atlas Pillars are structural supports located at Pillar/Elevator Hubs. They provide critical structural support for the ring and integrate with space elevator infrastructure. Each pillar hub contains multiple Atlas Pillars with fixed layouts that cannot be modified by players. Detailed pillar designs will be specified in future design documents.

## Chunk System

### Chunk Dimensions

- **Length (East-West)**: 1 km (1,000 meters)
- **Width (North-South)**: Variable based on position
  - Standard ring: 400 meters
  - At local stations: Up to 5 km (5,000 meters)
  - At regional hubs: Up to 16 km (16,000 meters)
  - At pillar/elevator hubs: Up to 25 km (25,000 meters)

### Chunk Identification

Chunks are identified by:
- **Chunk Index**: Integer representing position along ring
  - Formula: `chunk_index = floor(ring_position / 1000) % 264000` (modulo for wrapping)
  - Range: 0 to 263,999 (264,000 chunks total)
- **Floor/Level**: Integer for vertical level (default: 0)

**Chunk ID Format**: `{floor}_{chunk_index}`
Example: `0_12345` = Floor 0, Chunk 12345

### Chunk Boundaries

- **Start Position**: `chunk_index * 1000`
- **End Position**: `(chunk_index + 1) * 1000`
- **Width**: Determined by position (400m or flared at stations)

### Chunk Data Structure

Each chunk contains:
- **Geometry**: Terrain mesh, structures, roads
- **Metadata**: 
  - Zone assignments, ownership, modification timestamps
  - Width values: `start_width`, `center_width`, `end_width` (for variable-width handling)
  - Level counts: `start_levels`, `center_levels`, `end_levels` (for vertical flaring)
  - Station information: `station_type`, `station_center`, `distance_from_station` (if in flare zone)
- **Procedural Data**: Seed values for procedural generation
- **Player Structures**: List of player-placed buildings/objects
- **NPC Data**: Traffic patterns, population density

## Map Wrapping

**Status**: ✅ **IMPLEMENTED** - Server-side wrapping logic (`server/internal/ringmap/`) provides comprehensive position and chunk index wrapping.

### Wrapping Logic

The map wraps seamlessly at the 264,000 km boundary. The server automatically wraps all positions and chunk indices to ensure seamless traversal around the ring.

**Server Implementation** (`server/internal/ringmap/wrapping.go`):
- `WrapPosition()` - Wraps ring positions to [0, 264,000,000)
- `WrapChunkIndex()` - Wraps chunk indices to [0, 264,000)
- `PositionToChunkIndex()` - Converts positions to chunk indices with wrapping
- `Distance()` - Calculates shortest distance between positions (accounts for wrapping)
- `ValidateChunkIndex()` - Validates and wraps chunk indices
- `ValidatePosition()` - Validates and wraps positions

**Integration Points**:
- **Chunk Requests**: Chunk indices are automatically wrapped in WebSocket and REST handlers
- **Player Positions**: Ring positions (X coordinate) are wrapped when updating player position
- **Distance Calculations**: All distance calculations account for ring wrapping

**Example Wrapping Behavior**:
```go
// Position wrapping
WrapPosition(264000100)  // Returns 100
WrapPosition(-1000)     // Returns 263999000

// Chunk index wrapping
WrapChunkIndex(264000)  // Returns 0
WrapChunkIndex(-1)      // Returns 263999

// Distance calculation (accounts for wrapping)
Distance(1000, 263999000)  // Returns 2000 (wrapped path is shorter)
```

### Wrapping Considerations

1. **Visual Continuity**: Chunk 0 and chunk 263,999 connect seamlessly ✅
2. **Distance Calculations**: Shortest path accounts for wrapping ✅
   - Server automatically calculates shortest distance (direct or wrapped)
3. **Maglev Trains**: Can run continuously in loops (wrapping ensures seamless loops)
4. **Player Movement**: Smooth transition when crossing boundary ✅
   - Positions are automatically wrapped on update
5. **Chunk Requests**: Out-of-range chunk indices are wrapped, not rejected
   - Example: Requesting chunk `0_264000` wraps to chunk `0_0`
   - Example: Requesting chunk `0_-1` wraps to chunk `0_263999`

## Zone Layout

### Zone Types

The ring is divided into different zone types:

1. **Pillar/Elevator Hub Zones**
   - Fixed layout at each pillar/elevator hub
   - Contains space elevator infrastructure and Atlas Pillars
   - Maximum flare width: 25 km
   - Can contain player-built structures in designated areas
   - Special rules for hub layouts

2. **Regional Hub Zones**
   - Areas around regional hub centers
   - Maximum flare width: 16 km
   - Can contain player-built structures
   - Regional transit connections and commercial districts

3. **Local Station Zones**
   - Areas around local station centers
   - Maximum flare width: 5 km
   - Can contain player-built structures
   - Local transit stops and small communities

4. **Maglev Transit Zone**
   - Continuous zone running full ring length
   - Reserved for high-speed maglev tracks
   - Width: ~100 meters (centered)
   - Cannot be built upon

5. **Cargo Loading/Unloading Zones**
   - Designated areas for cargo operations
   - Player-defined locations
   - Typically near pillar/elevator hubs, regional hubs, or industrial zones

6. **Local Transit Zones**
   - Secondary transportation networks
   - Player-defined
   - Roads grow organically based on NPC traffic

7. **City Structure Zones**
   - Residential, commercial, industrial areas
   - Player-defined polygons
   - Freeform shapes (not constrained to roads)

8. **Atlas Pillar Zones**
   - Fixed layouts at pillar/elevator hub locations
   - Structural support areas within hub flare zones
   - Cannot be modified by players

### Zone Distribution

- **Maglev Zone**: Continuous, ~100m wide, centered on ring
- **Pillar/Elevator Hubs**: 12 hubs, each with 25 km maximum flare width (50 km flare length)
- **Regional Hubs**: Multiple hubs, each with 16 km maximum flare width (32 km flare length)
- **Local Stations**: Many stations, each with 5 km maximum flare width (10 km flare length)
- **Atlas Pillars**: Located within pillar/elevator hubs, fixed layouts
- **Remaining Space**: Available for player-defined zones

## Procedural Generation vs. Player-Placed Structures

### Procedural Generation

**Use Cases**:
- Initial terrain and basic infrastructure
- Background buildings in unzoned areas
- NPC populations and traffic patterns
- Natural city growth in zoned areas
- Atmospheric details (signs, decorations)

**Characteristics**:
- Deterministic (seed-based)
- Can be regenerated if needed
- Lower detail for performance
- Fills gaps between player structures

### Player-Placed Structures

**Use Cases**:
- Custom buildings and landmarks
- Player-designed zones
- Important infrastructure
- Racing track elements
- Personal structures

**Characteristics**:
- Stored in database with full details
- Higher detail and customization
- Cannot be procedurally overwritten
- Ownership and permissions tracked

### Hybrid Approach

- Player zones define areas where procedural generation follows specific rules
- Procedural generation fills in details within player zones
- Player structures take priority over procedural ones
- Procedural generation adapts to player zone boundaries

## Spatial Queries

**Status**: ✅ **IMPLEMENTED** - Spatial query utilities (`server/internal/ringmap/spatial.go`) provide distance-based queries with ring wrapping support.

### Implementation

**Spatial Query Utilities**:
- `SpatialQuery` - Database-backed spatial query handler
- `FindNearbyPlayers()` - Finds players within a specified distance, accounting for ring wrapping
- `ChunksInRange()` - Finds chunk indices within a distance of a position (handles wrapping)

**Features**:
- **Ring-Aware Distance**: All distance calculations account for ring wrapping
- **Chunk Range Queries**: Find chunks within a distance, useful for chunk loading optimization
- **Nearby Player Queries**: Find players within range with accurate distance calculations
- **Wrapping Support**: Queries correctly handle positions near ring boundaries

**Example Usage**:
```go
// Find players within 1000 meters
spatialQuery := ringmap.NewSpatialQuery(db)
players, err := spatialQuery.FindNearbyPlayers(5000.0, 0.0, 0, 1000)

// Find chunks within 2000 meters
chunks := ringmap.ChunksInRange(5000.0, 2000)
```

### Common Operations

1. **Get Chunk for Position**
   ```sql
   SELECT * FROM chunks 
   WHERE floor = ? AND chunk_index = FLOOR(? / 1000) % 264000
   ```

2. **Get Chunks in Range**
   ```sql
   SELECT * FROM chunks 
   WHERE floor = ? 
   AND chunk_index BETWEEN ? AND ?
   ```

3. **Find Zone at Position**
   ```sql
   SELECT * FROM zones 
   WHERE floor = ? 
   AND ST_Contains(geometry, ST_MakePoint(?, ?))
   ```

4. **Get Nearby Structures**
   ```sql
   SELECT * FROM structures 
   WHERE floor = ? 
   AND ST_DWithin(position, ST_MakePoint(?, ?), ?)
   ```

## Performance Considerations

### Chunk Loading ✅ **IMPLEMENTED**

**Status**: ✅ **IMPLEMENTED** - Chunk loading system is fully functional with compression support.

**Features**:
- Position-based chunk requests (converts ring position to chunk indices)
- Automatic geometry compression on server (2.6-3.1:1 compression ratios)
- Automatic geometry decompression on client (<3ms per chunk)
- Seam-aware rendering (chunks wrap correctly at ring boundaries)
- Database-first loading strategy (generates only if not found)
- Chunk deletion support (forces regeneration on next request)

**Compression Details**: See `docs/07-streaming-system.md` for complete compression specification.

### Chunk Loading (Original Specification)
- Load chunks in viewport plus buffer zone
- Unload chunks beyond threshold distance
- Preload chunks in movement direction

### Spatial Indexing
- Use PostGIS spatial indexes (GIST) on geometry columns
- Index chunk positions for fast lookups
- Index zone polygons for point-in-polygon queries

### Caching
- Cache frequently accessed chunks
- Cache zone lookups
- Invalidate cache on modifications

## Orbital Mechanics and Lighting

### Ring Position

The EarthRing is positioned in **geostationary orbit** above Earth's equator:
- **Orbital Altitude**: ~35,786 km above Earth's surface
- **Orbital Radius**: ~42,164 km from Earth's center
- **Orbital Period**: 24 hours (synchronous with Earth's rotation)
- **Orbital Inclination**: 0° (equatorial orbit)

### Coordinate Reference Point

- **X = 0**: Positioned directly above the **Prime Meridian** (0° longitude) at the equator
- **Geographic Location**: Gulf of Guinea, off the coast of Africa
- **Ring Orientation**: Ring plane is parallel to Earth's equatorial plane

This means:
- The ring maintains a fixed position relative to Earth's surface
- X = 0 km on the ring is always above 0° longitude
- The ring rotates once per day to maintain geostationary position
- Players can use Earth's surface as a reference point for navigation

### Lighting System

The lighting system varies based on player location and structure type:

#### Exterior Lighting (Viewing Stations, Open Areas)

When players are in exterior areas (viewing stations, open platforms, etc.):
- **Sunlight**: Realistic sunlight based on orbital position and time
- **Earth Shine**: Reflected light from Earth below (or above, depending on viewing angle)
- **Atmospheric Effects**: Sunlight is filtered through Earth's atmosphere
  - Atmospheric scattering affects color temperature
  - Atmospheric absorption reduces intensity
  - Horizon glow from Earth's atmosphere
- **Earth Shadow**: When ring passes through Earth's shadow (eclipse), lighting changes accordingly
- **Starfield**: Visible stars and celestial objects in the background

**Lighting Calculation**:
- Sun position based on orbital mechanics and time of day
- Earth's position relative to ring (always below/above)
- Atmospheric scattering model for realistic color and intensity
- Earth shine calculation based on Earth's albedo and phase

#### Interior Lighting (Enclosed Structures)

When players are inside enclosed structures:
- **Artificial Lighting**: Mimics exterior lighting conditions
- **Dynamic Adjustment**: Interior lights adjust brightness and color temperature to match exterior conditions
- **Day/Night Cycle**: Interior lighting follows the same day/night cycle as exterior
- **Player Control**: Players can override artificial lighting with custom lighting systems

**Interior Lighting Rules**:
- Brightness matches exterior sunlight intensity (scaled appropriately)
- Color temperature matches exterior light color
- Transitions smoothly between day and night
- Windows and transparent surfaces show exterior lighting conditions

#### Lighting Implementation

- **Time Synchronization**: All clients use synchronized time based on orbital position
- **Per-Chunk Lighting**: Each chunk calculates lighting based on its position on the ring
- **Caching**: Lighting calculations can be cached and updated periodically
- **Performance**: Use simplified lighting models for distant chunks, full calculations for player's area

### Special Structure Loading

**Decision**: Chunk size remains fixed at 1 km length for the main ring map. The system distinguishes between two types of structures:

1. **Stations** (part of main ring map): Stations are integrated into the main ring map and use smooth transitions
2. **Building/Structure Interiors** (separate maps): Any building, residence, or structure can load separate interior maps with loading screens

#### Station Transitions (Smooth)

Stations (pillar/elevator hubs, regional hubs, local stations) are part of the main ring map:
- **No Loading Screen**: Stations are seamlessly integrated into the ring map
- **Smooth Transition**: Players move smoothly between ring segments and station areas
- **Same Map System**: Stations use the same chunk system and coordinate space as the ring
- **Geometry Continuity**: Station geometry connects seamlessly with ring geometry

**Station Areas Include**:
- Station platforms and public areas
- Maglev stations and transit areas
- Station infrastructure (all part of main map)

#### Building/Arcology Interior Transitions (Loading Screen)

Any building, residence, or structure with an interior can use a separate interior map:
- **No Size Threshold**: Any structure can have a separate interior map, from individual residences to large arcologies
- **Door Access Required**: Separate interior maps require a door or entry point for access
- **Loading Screen**: Entering/exiting through a door triggers a loading screen
- **Separate Map**: Interior maps are separate from the main ring map
- **Different Scale**: Interior maps can have different scales and layouts
- **On-Demand Loading**: Interior maps are loaded on-demand and cached
- **Return to Ring**: Exiting returns to the main ring map at the entry door/point

**Examples of Structures Using Interior Maps**:
- Individual residences (any size)
- Commercial buildings
- Industrial facilities
- Large buildings with multiple explorable floors
- Arcology complexes with extensive interiors
- Elevator shafts (separate maps for vertical travel)
- Cargo facilities with interior spaces
- Player-created structures with interiors

**Multiple Interior Maps**:
- Large or complex buildings may require multiple interior maps
- Each interior map represents a distinct area or section of the building
- **All interior map transitions use loading screens** (same as ring-to-interior transitions)
- Example: A large arcology might have separate maps for residential floors, commercial floors, and utility areas

**Transition Behavior** (All Interior Map Transitions):
- **Entering from Ring**: Approach door → Loading screen → Load interior map → Render interior
- **Exiting to Ring**: Approach door → Loading screen → Unload interior map → Return to ring map at entry door
- **Between Interiors**: Approach door → Loading screen → Unload current interior → Load new interior map
- **Consistent Experience**: All map transitions (ring-to-interior, interior-to-ring, interior-to-interior) use the same loading screen mechanism
- **Caching**: Interior maps are cached to reduce loading times on re-entry

## Vertical Stacking (Multi-Floor System)

**Decision**: Vertical stacking of zones on different floors is supported, but follows a **The Sims-style** building model.

### Building Model

- **One Buildable Floor at a Time**: Players can only build/modify one floor at a time
- **Floor Switching**: Players switch their view to the floor they want to build on
- **Floor View Modes**: 
  - **Current Floor View**: See and build on selected floor
  - **Multi-Floor View**: See all floors in wireframe/transparent mode for reference
- **Floor Selection**: UI allows easy switching between floors

### Floor Management

- **Floor Numbers**: Floors are numbered (0 = primary/main floor, positive = above, negative = below)
- **Main Ring Structure**: The main ring is 5 levels thick (Levels -2, -1, 0, +1, +2), with Level 0 containing the maglev rail
- **Station Vertical Flaring**: Stations flare vertically from the base 5 levels to additional levels at the center:
  - Pillar/Elevator Hubs: Up to 15 levels at center (Levels -7 through +7)
  - Regional Hubs: Up to 11 levels at center (Levels -5 through +5)
  - Local Stations: Up to 7 levels at center (Levels -3 through +3)
- **Zone Stacking**: Zones can be placed on different floors
- **Structure Stacking**: Structures can span multiple floors or be floor-specific

### Floor Height Specifications

#### Station Level Height

Stations (pillar/elevator hubs, regional hubs, local stations) use a standard level height:
- **Total Level Height**: 20 meters per level
  - **Foundation Floor**: 4 meters (contains infrastructure, utilities, structural supports)
  - **Buildable Space**: 16 meters (for buildings, equipment, and player structures)

This allows stations to have substantial infrastructure while maintaining consistent vertical spacing.

#### Main Ring Structure

The main ring (non-station areas) is **5 levels thick**:
- **Level -2**: Lower level (below primary floor)
- **Level -1**: Lower level (below primary floor)
- **Level 0**: Primary floor (contains maglev rail and main ring infrastructure)
- **Level +1**: Upper level (above primary floor)
- **Level +2**: Upper level (above primary floor)

**Total Main Ring Height**: 100 meters (5 levels × 20 meters per level)

The maglev rail runs through Level 0 (the primary floor) along the entire ring length.

#### Station Vertical Flaring

Stations use **vertical flaring** that matches their horizontal flaring pattern. The number of levels increases toward the station center, creating a smooth transition from the base 5 levels to the maximum levels at the center.

**Vertical Flare Pattern**:
- At station edges (where horizontal flare begins): 5 levels (base ring height)
- At station center: Maximum levels based on station type
- Transition: Smooth cosine-based curve matching horizontal flare

**Utility Space**:
- The sloping exterior areas created by vertical flaring are designated as **utility space**
- Utility space is non-buildable and contains:
  - Structural supports
  - Infrastructure and utilities
  - Ventilation and environmental systems
  - Maintenance access
- Only the flat, horizontal sections at each level are buildable by players
- Utility space provides realistic structural support for the flared geometry

**Station-Specific Vertical Structure**:

**Pillar/Elevator Hub** (at center):
- Levels -7 through +7 (15 levels total)
- Total height: 300 meters at center
- Tapers to 5 levels (100 meters) at flare edges

**Regional Hub** (at center):
- Levels -5 through +5 (11 levels total)
- Total height: 220 meters at center
- Tapers to 5 levels (100 meters) at flare edges

**Local Station** (at center):
- Levels -3 through +3 (7 levels total)
- Total height: 140 meters at center
- Tapers to 5 levels (100 meters) at flare edges

#### Building Floor Height

Buildings constructed within the ring (player-built structures) use a different floor height standard:
- **Standard Floor Height**: 4 meters per floor
  - **Floor Thickness**: 1 meter (structural floor/ceiling)
  - **Living Space**: 3 meters (usable vertical space between floors)

This provides comfortable living/working space while maintaining efficient use of vertical space. Buildings can stack multiple floors, with each floor being 4 meters tall (1m structure + 3m space).

#### Height Relationships

- **Station Levels**: 20m each (4m foundation + 16m buildable)
- **Building Floors**: 4m each (1m structure + 3m space)
- **Compatibility**: Buildings can be constructed within station buildable space (16m), allowing for up to 4 building floors per station level (4 floors × 4m = 16m)

### Implementation Considerations

- **Rendering**: Only render the active floor in full detail, other floors in simplified form
- **Collision**: Structures on different floors don't interfere with each other
- **NPCs**: NPCs can move between floors via stairs/elevators
- **Zones**: Zones are floor-specific, but can reference zones on other floors

## Chunk Boundary Handling at Stations

### Design Decision: Hybrid Variable-Width Chunks

**Decision**: Use a hybrid approach combining variable-width storage with procedural calculation to handle chunk boundaries at stations where width changes due to flaring.

**Problem**: Chunks have a fixed length of 1 km, but width varies smoothly from 400m (base ring) to up to 25km (at station centers) due to horizontal flaring. Adjacent chunks will have different widths, requiring seamless boundary connections, efficient storage, and accurate geometry generation.

### Implementation

The hybrid approach combines variable-width storage with procedural calculation:

1. **Storage**: Store width at chunk boundaries and center
2. **Calculation**: Use stored values for queries and indexing
3. **Rendering**: Calculate smooth width transitions procedurally within chunk
4. **Caching**: Cache calculated widths for frequently accessed chunks

**Implementation Details**:

```python
class ChunkMetadata:
    chunk_index: int
    floor: int
    start_position: float  # Ring position at chunk start
    center_position: float  # Ring position at chunk center
    end_position: float  # Ring position at chunk end
    
    # Stored width values (calculated once, cached)
    start_width: float
    center_width: float
    end_width: float
    
    # Station information (if in flare zone)
    station_type: Optional[str]  # 'pillar', 'regional', 'local', None
    station_center: Optional[float]  # Position of station center
    distance_from_station: Optional[float]  # Distance from station center

def get_chunk_width_at_position(chunk: ChunkMetadata, position_in_chunk: float) -> float:
    """Calculate width at any position within chunk using interpolation"""
    # Normalize position (0.0 to 1.0 within chunk)
    t = position_in_chunk / 1000.0
    
    # Interpolate between start, center, and end widths
    if t < 0.5:
        # Between start and center
        return lerp(chunk.start_width, chunk.center_width, t * 2)
    else:
        # Between center and end
        return lerp(chunk.center_width, chunk.end_width, (t - 0.5) * 2)
```

**Boundary Matching**:
- Chunk N's end_width must match Chunk N+1's start_width
- Validate on chunk creation/modification
- **Tolerance**: 0.1 meters for floating-point precision validation
- If boundary widths differ by more than tolerance, flag as error and require correction

**Spatial Queries**:
- Use stored width values for bounding box calculations
- Index chunks by position and approximate width
- Filter chunks by width range before detailed geometry checks

### Vertical Flaring Considerations

The same approach applies to vertical flaring (number of levels):
- Store level count at chunk boundaries and center
- Interpolate level count within chunk
- Ensure level boundaries match between adjacent chunks
- Handle level transitions smoothly

### Performance Optimizations

1. **Width Caching**: Cache calculated widths for frequently accessed chunks
2. **Batch Calculation**: Pre-calculate widths for chunks in flare zones during generation
3. **Lazy Evaluation**: Calculate width only when chunk is loaded/accessed
4. **Spatial Indexing**: Use approximate width in spatial indexes for fast filtering

### Benefits

This approach balances:
- **Accuracy**: Precise representation of flare geometry
- **Storage Efficiency**: Only stores 3 width values per chunk (start, center, end)
- **Performance**: Cached values enable fast queries and indexing
- **Seamless Boundaries**: Explicit boundary matching ensures smooth transitions
- **Flexibility**: Works with existing chunk system and supports future optimizations

## Atmospheric Scattering Model

### Design Decision: Tiered Atmospheric Scattering

**Decision**: Use different atmospheric scattering models for each client type, optimized for their performance capabilities while maintaining visual consistency.

**Context**: The ring is at ~35,786 km altitude, viewing Earth below. Atmospheric scattering affects:
- Sunlight color and intensity filtering through Earth's atmosphere
- Horizon glow from Earth's atmosphere
- Earth shine (reflected light from Earth)
- Day/night transitions and eclipse effects

### Client-Specific Models

#### Web Client (Three.js) - Simplified Model

**Model**: Pre-computed Lookup Table (LUT) with Rayleigh approximation

**Implementation**:
- **Pre-computed LUT**: Generate atmospheric color/intensity lookup table based on sun angle
- **Rayleigh Approximation**: Simple wavelength-dependent scattering (blue sky effect)
- **Color Temperature**: Adjust light color based on sun position (warm at sunrise/sunset, cool at noon)
- **Horizon Glow**: Simple gradient overlay for Earth's horizon
- **Performance**: Very fast, minimal GPU cost

**Details**:
- LUT indexed by sun elevation angle (0-180°)
- Stores RGB color and intensity multiplier
- Updated periodically (not per-frame)
- Uses simple cosine-based scattering approximation
- Earth shine: Simple ambient light based on Earth phase

**Advantages**:
- Very low performance cost
- Works well in browsers
- Good visual quality for web constraints
- Easy to implement

**Limitations**:
- Less accurate than physically-based models
- Fixed atmospheric conditions (no weather effects)
- Simplified horizon glow

#### Light Local Client (Electron/Native) - Enhanced Model

**Model**: Real-time Rayleigh/Mie scattering with simplified calculations

**Implementation**:
- **Rayleigh Scattering**: Real-time calculation for blue sky effect
- **Mie Scattering**: Simplified forward scattering for horizon glow
- **Atmospheric Density**: Variable based on viewing angle and sun position
- **Color Temperature**: Dynamic calculation based on atmospheric path length
- **Earth Shine**: More accurate calculation based on Earth albedo and phase

**Details**:
- Real-time scattering calculations (simplified formulas)
- Single-scattering approximation (no multiple scattering)
- Pre-computed atmospheric density profile
- Dynamic color temperature based on sun angle
- Enhanced horizon glow with proper scattering

**Advantages**:
- Better visual quality than web client
- Still performant for local client
- More accurate atmospheric effects
- Dynamic day/night transitions

**Limitations**:
- More GPU intensive than web model
- Single-scattering only (no multiple scattering)
- Simplified atmospheric density model

#### Heavy Local Client (Unreal Engine) - Physically-Based Model

**Model**: Full physically-based atmospheric scattering with multiple scattering

**Implementation**:
- **Volumetric Atmosphere**: Unreal's Sky Atmosphere system or custom volumetric fog
- **Multiple Scattering**: Full multiple scattering calculations
- **Rayleigh/Mie Scattering**: Accurate wavelength-dependent scattering
- **Atmospheric Density**: Height-based density with proper falloff
- **Aerial Perspective**: Distance-based color shift for objects
- **Earth Shine**: Accurate calculation with proper albedo and phase

**Details**:
- Use Unreal Engine's Sky Atmosphere component or custom volumetric solution
- Full multiple scattering for realistic light transport
- Proper atmospheric density profile (exponential falloff)
- Dynamic weather effects (if implemented)
- Advanced post-processing for atmospheric effects
- Volumetric fog for atmospheric depth

**Advantages**:
- Maximum visual fidelity
- Physically accurate atmospheric effects
- Supports advanced features (volumetric fog, weather)
- Professional-quality rendering

**Limitations**:
- Highest GPU cost
- Requires powerful hardware
- More complex implementation

### Shared Parameters

All clients use the same base parameters (from server or shared config):
- **Earth Radius**: ~6,371 km
- **Atmosphere Height**: ~100 km (effective scattering height)
- **Rayleigh Scattering Coefficient**: Standard Earth values
- **Mie Scattering Coefficient**: Standard Earth values
- **Sun Position**: Calculated from orbital mechanics
- **Earth Albedo**: ~0.3 (for Earth shine calculations)

### Implementation Strategy

1. **Server-Side Calculation**: Sun position and orbital mechanics calculated server-side, sent to clients
2. **Client-Side Rendering**: Each client implements its appropriate scattering model
3. **Graphics Abstraction**: Scattering model abstracted through graphics layer
4. **Fallback**: Web client model used as fallback if performance issues occur

### Performance Considerations

- **Web Client**: LUT updates every 1-5 seconds (not per-frame)
- **Light Client**: Scattering calculations every frame, but simplified
- **Unreal Client**: Full real-time volumetric calculations
- **LOD**: Use simplified models for distant chunks/objects
- **Caching**: Cache atmospheric calculations when possible

### Visual Consistency

While models differ in complexity, they should produce visually consistent results:
- Same color temperature transitions (warm to cool)
- Similar horizon glow appearance
- Consistent day/night cycle
- Matching Earth shine intensity

This ensures players have similar visual experience regardless of client type, with quality scaling based on capabilities.

### Aerial Perspective

**Decision**: Atmospheric scattering affects the appearance of the ring structure itself, creating aerial perspective effects.

**Implementation**:
- **Distance-Based Color Shift**: Objects farther from camera shift toward atmospheric color (blue/white)
- **Contrast Reduction**: Distant objects have reduced contrast due to atmospheric scattering
- **Ring Structure**: The ring itself shows atmospheric effects when viewed from a distance
- **Client-Specific**: 
  - Web Client: Simple distance-based color tinting
  - Light Client: Enhanced contrast reduction and color shift
  - Unreal Client: Full volumetric aerial perspective with proper scattering

**Benefits**:
- More realistic depth perception
- Better sense of scale for the massive ring
- Enhanced visual immersion
- Consistent with viewing from orbital altitude

### Dynamic Weather Effects

**Decision**: Support dynamic weather effects (clouds, storms) that affect atmospheric scattering.

**Implementation**:
- **Weather System**: Server tracks weather patterns and sends updates to clients
- **Atmospheric Modulation**: Weather affects scattering coefficients and color
- **Clouds**: Dense clouds reduce sunlight intensity and shift color temperature
- **Storms**: Enhanced atmospheric effects during storms
- **Client-Specific**:
  - Web Client: Simple color/intensity modulation based on weather
  - Light Client: Enhanced weather effects with cloud shadows
  - Unreal Client: Full volumetric clouds and weather integration

**Benefits**:
- Dynamic, living world
- Enhanced gameplay (weather affects visibility, racing conditions)
- More immersive experience
- Adds variety to visual presentation

### Eclipse Events

**Decision**: Eclipse events are location-based and purely visual. The ring is always partially in Earth's shadow - some areas are always eclipsed while others are always in sunlight, based on the player's viewing position relative to Earth and the sun.

**Eclipse Characteristics**:
- **Location-Based**: Eclipse state depends on player's position on the ring relative to Earth and sun
- **Continuous State**: Some parts of the ring are always in eclipse (umbra/penumbra), others always in sunlight
- **Visual Effect**: Dramatic reduction in sunlight in shadowed areas, enhanced Earth shine, visible starfield
- **Purely Visual**: No gameplay mechanics affected by eclipse (for now)

**Implementation**:

**Eclipse Calculation**:
- Calculate sun position relative to Earth and ring
- Determine which side of Earth is facing the sun (day side) and which is facing away (night side)
- Ring areas on the night side of Earth are in eclipse
- Ring areas on the day side of Earth are in sunlight
- Transition zone (penumbra) creates smooth gradient between lit and shadowed areas

**Eclipse Phases** (based on position):

1. **Sunlit Area** (Day side of Earth):
   - Full sunlight intensity
   - Normal color temperature
   - Standard atmospheric scattering
   - Normal Earth shine

2. **Transition Zone** (Penumbra):
   - Gradual reduction in sunlight intensity
   - Color temperature shifts toward cooler tones
   - Earth shine becomes more prominent
   - Atmospheric scattering reduces (less sunlight to scatter)

3. **Eclipsed Area** (Night side of Earth):
   - Minimal direct sunlight (only scattered light from Earth's atmosphere)
   - Earth shine is primary light source
   - Starfield becomes clearly visible
   - Ring structure appears dimly lit by Earth shine
   - Atmospheric scattering nearly absent (no direct sunlight)

**Client-Specific Handling**:

**Web Client**:
- Calculate eclipse state based on player position
- Smooth interpolation between pre-computed lighting states
- LUT-based transition (eclipse state in LUT based on position)
- Enhanced Earth shine in shadowed areas
- Simple starfield overlay in eclipse zones

**Light Client**:
- Real-time lighting calculations with position-based eclipse factor
- Dynamic Earth shine intensity based on position
- Enhanced starfield rendering in shadowed areas
- Smooth transitions between lit and shadowed zones

**Unreal Client**:
- Full volumetric atmosphere with position-based eclipse shadow
- Accurate Earth shadow projection based on player position
- Enhanced volumetric Earth shine in shadowed areas
- High-quality starfield rendering
- Advanced post-processing for eclipse effects

**Performance Considerations**:
- Eclipse state calculated per-player based on position
- Can cache eclipse calculations for nearby chunks
- Smooth transitions prevent jarring lighting changes
- Position-based calculation allows efficient updates

**Visual Impact**:
- Creates dramatic visual contrast between lit and shadowed areas
- Players can see the "terminator line" (day/night boundary) on Earth
- Adds realism to the orbital environment
- Enhances sense of scale and position in space

**Future Considerations**:
- Eclipse effects are currently purely visual
- May add gameplay mechanics in the future (reduced visibility, special events)
- Could add dynamic eclipse events (moon shadows, etc.)

## Open Questions

1. Should we add dynamic eclipse events (moon shadows, etc.) in addition to the continuous Earth shadow?
2. How should we handle transitions when players move between lit and shadowed areas of the ring?

## Future Considerations

- Procedural generation of ring structure details
- Weather systems that wrap around the ring
- Advanced atmospheric scattering models for more realistic lighting
- Earth observation features (players can observe Earth's surface)
- Support for ring expansion (adding new sections)
- Dynamic interior map generation for procedural structures

