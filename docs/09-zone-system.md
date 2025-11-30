# Zone System Design

**Status**: ✅ **IMPLEMENTED** - Zone system is fully implemented with polygon creation, overlap detection, and client-side rendering.

**Related Documentation**:
- [Game Mechanics](10-game-mechanics.md) - Zone management mechanics
- [Database Schema](03-database-schema.md) - Zone data storage
- [Client Architecture](06-client-architecture.md) - Zone rendering implementation
- [Map System](02-map-system.md) - Coordinate system used for zones

## Table of Contents

- [Overview](#overview)
- [Zone Types](#zone-types)
  - [Player-Defined Zones](#player-defined-zones)
  - [System-Defined Zones](#system-defined-zones)
- [Zone Creation](#zone-creation)
  - [Polygon Definition](#polygon-definition)
  - [Zone Constraints](#zone-constraints)
- [Zone Coordinate Wrapping](#zone-coordinate-wrapping)
  - [Overview](#overview-1)
  - [Coordinate Storage](#coordinate-storage)
  - [Rendering Wrapping](#rendering-wrapping)
  - [Boundary Conditions](#boundary-conditions)
  - [Implementation Details](#implementation-details)
- [Transportation System](#transportation-system)
  - [Overview](#overview-2)
  - [Transportation Hierarchy](#transportation-hierarchy)
  - [Transportation Generation Algorithm](#transportation-generation-algorithm)
  - [Transportation Infrastructure Types](#transportation-infrastructure-types)
  - [Dynamic Infrastructure Adaptation](#dynamic-infrastructure-adaptation)
  - [Transportation Placement Rules](#transportation-placement-rules)
  - [Manual Infrastructure Placement](#manual-infrastructure-placement)
- [Zone-to-Zone Connectivity](#zone-to-zone-connectivity)
  - [Connectivity Analysis](#connectivity-analysis)
  - [NPC Pathfinding](#npc-pathfinding)
- [Zone Properties and Effects](#zone-properties-and-effects)
  - [Zone Properties](#zone-properties)
  - [Zone Effects](#zone-effects)
- [Zone Overlap and Conflicts](#zone-overlap-and-conflicts)
  - [Zone Overlap Policy](#zone-overlap-policy)
  - [Importance System](#importance-system)
  - [Conflict Resolution](#conflict-resolution)
  - [Overlap Benefits](#overlap-benefits)
- [Floor Spanning Zones](#floor-spanning-zones)
- [Zone Modifications](#zone-modifications)
  - [Editing Zones](#editing-zones)
  - [Zone Merging](#zone-merging)
  - [Zone Splitting](#zone-splitting)
- [Special Zone Rules](#special-zone-rules)
  - [Elevator Station Zones](#elevator-station-zones)
  - [Maglev Zone](#maglev-zone)
  - [Atlas Pillar Zones](#atlas-pillar-zones)
- [Performance Considerations](#performance-considerations)
  - [Zone Queries](#zone-queries)
  - [Transportation Generation](#transportation-generation)
  - [Zone Validation](#zone-validation)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The zone system allows players to define freeform polygon areas on the ring map, similar to Cities: Skylines but with more flexibility. Zones control what can be built, how NPCs behave, and how procedural generation works in those areas. Roads grow organically based on NPC traffic patterns rather than being manually placed.

## Zone Types

### Player-Defined Zones

Players can create zones of various types with freeform polygon shapes:

1. **Residential Zones**
   - Purpose: Housing for NPCs
   - Characteristics: Generates residential buildings, parks, schools
   - NPC Behavior: NPCs live here, commute to work zones
   - Density Levels: Low, Medium, High

2. **Commercial Zones**
   - Purpose: Shops, restaurants, entertainment
   - Characteristics: Generates stores, malls, restaurants
   - NPC Behavior: NPCs work here, visit for shopping/entertainment
   - Density Levels: Low, Medium, High

3. **Industrial Zones**
   - Purpose: Factories, warehouses, production
   - Characteristics: Generates industrial buildings, cargo facilities
   - NPC Behavior: NPCs work here, cargo operations
   - Density Levels: Low, Medium, High

4. **Mixed-Use Zones**
   - Purpose: Combination of residential and commercial
   - Characteristics: Buildings with shops on ground floor, apartments above
   - NPC Behavior: NPCs can live and work in same area
   - Density Levels: Low, Medium, High

5. **Cargo Loading/Unloading Zones**
   - Purpose: Designated cargo handling areas
   - Characteristics: Cargo docks, loading bays, storage
   - NPC Behavior: Cargo vehicles, workers
   - Special: Can connect to maglev for cargo transport

6. **Local Transit Zones**
   - Purpose: Secondary transportation networks
   - Characteristics: Roads, transit stops, parking
   - NPC Behavior: High traffic, transit usage
   - Special: Roads grow here based on traffic

7. **Park/Recreation Zones**
   - Purpose: Green spaces, recreation
   - Characteristics: Parks, playgrounds, sports facilities
   - NPC Behavior: NPCs visit for recreation, improves happiness
   - Special: No buildings, only recreational structures

8. **Restricted Zones**
   - Purpose: Prevent or limit procedural spawning
   - Characteristics: Red overlay indicating restricted area
   - NPC Behavior: No procedural generation, may limit NPC access
   - Special: Used to mark areas where procedural generation should not occur

9. **Special Purpose Zones**
   - Purpose: Custom player-defined purposes
   - Characteristics: Player-defined rules and properties
   - NPC Behavior: Customizable
   - Special: Maximum flexibility for player creativity

### System-Defined Zones

These zones have fixed layouts and cannot be modified by players:

1. **Elevator Station Zones** (Pillar/Elevator Hubs)
   - Fixed layout matching elevator station design
   - Contains elevator infrastructure and Atlas Pillars
   - May have some buildable areas for player structures
   - Maximum flare width: 25 km at station center
   - Flare length: 50 km (25 km each side)

2. **Restricted Zones (Per-Chunk)**
   - **Distribution**: One default restricted zone per chunk (not per floor)
   - **Purpose**: Prevent or limit procedural generation in specific areas
   - **Dimensions**: 
     - Length: Full chunk length (1000 meters)
     - Width: 20 meters (Y: -10 to +10, centered on ring)
   - **Generation**: Automatically generated by procedural service with each chunk
   - **Persistence**: Stored in database and linked to chunks via `chunk_data.zone_ids`
   - **Lifecycle**: Zones appear/disappear with their associated chunks
   - **Metadata**: Marked with `metadata.default_zone = 'true'` and `metadata.chunk_index`
   - **Note**: Previously implemented as full-ring maglev zones, now replaced with per-chunk zones for better granularity and performance

3. **Atlas Pillar Zones**
   - Fixed layout at pillar locations
   - Structural support areas
   - Details TBD based on pillar design

## Zone Creation

### Polygon Definition

Players define zones by drawing freeform polygons using various drawing tools in the zone editor.

#### Drawing Tools

The zone editor provides multiple tools for creating zones:

1. **Rectangle Tool**: Click and drag to create rectangular zones
2. **Circle Tool**: Click and drag to create circular zones (from center point)
3. **Polygon Tool**: Click multiple points to create custom polygon shapes
   - Click to place vertices
   - Right-click or double-click to finish polygon (minimum 3 vertices)
5. **Paintbrush Tool**: Click and drag to create freeform zones by painting
   - Brush size adjustable via UI control or keyboard shortcuts `[` and `]`
   - Default brush size: 10m radius
   - Single clicks create circular zones
   - Dragging creates continuous stroke zones with smooth connections
   - Closed loops (circles) are automatically detected and connected smoothly
   - Closed loop detection: Paths where first and last points are within 3x brush radius are treated as closed loops
6. **Select Tool**: Default tool for selecting existing zones (click zones to select them)

#### Tool Selection and Mouse Controls

- **Left Mouse Button**: Default select tool - click zones to select them, or use with drawing tools when a tool is active
- **Right Mouse Button**: Dismiss tool - returns to select mode when a zone drawing tool (circle, rectangle, etc.) is active
- **Tool Persistence**: Tool selection persists in localStorage and survives page refreshes

#### Drawing Interface

1. **Drawing Workflow**
   - Select a drawing tool from the toolbar
   - Click and drag (for Rectangle, Circle, Paintbrush) or click multiple points (for Polygon)
   - Preview appears while drawing and matches the final zone exactly (preview coordinates are aligned with the zone rendering coordinate system)
   - Preview is positioned precisely at the cursor location from the start of drawing
   - Release mouse or finish polygon to create zone
   - The preview and final zone both use the exact mouse release position for accurate placement
   - **Preview Accuracy**: All tools (Rectangle, Circle, Polygon, Paintbrush) generate previews using the exact same coordinate system as the final zone rendering:
     - Previews generate the exact absolute coordinates that will be stored in the database
     - Coordinates are wrapped relative to the camera using unwrapped camera position (matching zone-manager.js behavior)
     - Shape Y coordinates are always negated for fill shapes to ensure correct face orientation after rotation
     - Preview mesh position is set to `(0, floorHeight + 0.001, 0)` since geometry coordinates are already in world space
     - This ensures 100% match between preview and final rendered zone, with perfect cursor alignment
   - **Coordinate Validation**: The preview system includes automatic coordinate validation and correction:
     - Detects when coordinates are incorrectly wrapped (more than half the ring circumference from the camera)
     - Automatically corrects wrapped coordinates before creating preview geometry
     - Ensures previews appear consistently at all camera angles, including when pointing straight down
     - Debug logging can be enabled with `window.DEBUG_ZONE_PREVIEW = true` in the browser console for troubleshooting

2. **Paintbrush Tool Details**
   - **Closed Loop Detection**: Paths that form closed loops (where first and last points are within 3x brush radius) are automatically detected
   - **Smooth Connection**: For closed loops, the first and last points use the same perpendicular direction and identical positions to ensure seamless connection
   - **Stroke Generation**: The brush expands the path by the brush radius on both sides, creating a thick stroke polygon
   - **Single Clicks**: Create circular zones with the brush radius
   - **Dragging**: Creates continuous strokes with smooth curves at corners (perpendicular vectors are averaged at path points)

2. **Validation Rules**
   - Minimum 3 vertices (triangle) for polygon tool
   - Maximum vertices: TBD (performance consideration - needs testing with different clients)
   - Polygon must be simple (no self-intersections)
   - Polygon must be within valid map bounds (X coordinates in [0, 264,000,000), Y coordinates in [-2500, 2500])
   - Cannot overlap system zones (elevator stations, maglev)
   - Can overlap other player zones (see Zone Overlap section)

3. **Zone Properties**
   - Name (optional)
   - Zone type (residential, commercial, etc.)
   - Density level (low, medium, high)
   - Custom properties (JSONB field)

### Zone Constraints

- **Minimum Size**: TBD (e.g., 100m²)
- **Maximum Size**: TBD (performance consideration)
- **Distance from System Zones**: Must maintain buffer from maglev and elevator infrastructure
- **Ownership**: Player who creates zone owns it
- **Permissions**: Owner can modify, delete, or transfer ownership
- **Chunk Spanning**: Zones can span multiple chunks (e.g., a zone covering a 5-chunk-wide station)
- **Floor Spanning**: Special case - some buildings can span multiple floors, but each is a special case (see Floor Spanning Zones section)
- **Zone-Chunk Binding**: Default zones (restricted zones) are bound to specific chunks and appear/disappear with their associated chunks (see Zone-Chunk Binding section)

## Zone Coordinate Wrapping

### Overview

Zone coordinates are stored as absolute values in the database, but must be wrapped relative to the camera during rendering to ensure zones always appear at the copy closest to the camera. This prevents gaps and ensures seamless rendering at ring boundaries.

### Coordinate Storage

- **Database Storage**: Zone coordinates are stored as absolute values in the range `[0, 264,000,000)` meters
- **Coordinate System**: EarthRing coordinates (X = ring position, Y = width offset, Z = floor)
- **No Wrapping in Database**: Coordinates are stored without wrapping - a zone at position 263,999,000 is stored as-is, not wrapped to 0
- **Boundary Zones**: Zones at the ring boundary (chunk 0 and chunk 263999) are stored with their actual coordinates

### Rendering Wrapping

During rendering, zone coordinates are wrapped relative to the camera position:

1. **Unwrapped Camera Position**: The client uses the raw Three.js camera position (preserving negative values) converted to EarthRing coordinates
2. **Wrapping Function**: `normalizeRelativeToCamera(x, cameraX)` wraps zone coordinates relative to the camera:
   - Calculates the shortest path around the ring from camera to zone
   - Ensures zones always render at the copy closest to the camera
   - Handles negative camera positions (west of origin)
   - Handles positions beyond ring circumference

3. **Implementation**:
   ```javascript
   const wrapZoneX = (x) => {
     const wrapped = normalizeRelativeToCamera(x, cameraX);
     return wrapped;
   };
   ```

### Boundary Conditions

#### Ring Start (X = 0)

- Zones at position 0 render correctly when camera is at position 0
- Zones at position 0 also render when camera is at position 264,000,000 (wrapped)
- The wrapping function ensures the zone appears at the copy closest to the camera

#### Ring End (X = 264,000,000)

- Zones at position 264,000,000 (chunk 263999) render correctly
- These zones wrap to position 0 when camera is near the start
- The wrapping ensures seamless transition at the boundary

#### Negative Camera Positions

- Camera can be at negative positions (west of origin) when moving west
- Zones are wrapped relative to the unwrapped camera position
- This ensures zones render correctly even when camera is at negative positions

#### Preview Coordinate Validation

- **Issue**: At certain camera angles (especially when pointing straight down), coordinate normalization can sometimes wrap coordinates to the far side of the ring (e.g., `x: 264000023` instead of near the camera)
- **Solution**: The preview system (`updatePreview` in `zone-editor.js`) validates coordinates before creating preview geometry:
  - Calculates distance from camera for both start and end points
  - If distance exceeds half the ring circumference (132,000,000m), coordinates are automatically wrapped back to the correct side
  - This ensures previews always appear near the camera, regardless of camera angle
- **Debug Toggle**: Enable detailed logging with `window.DEBUG_ZONE_PREVIEW = true` in the browser console to troubleshoot coordinate wrapping issues

#### Zones Spanning Wrap Boundary

- Zones that span the wrap boundary (e.g., from 263,999,000 to 1,000) are handled correctly
- The wrapping function ensures all parts of the zone render at the copy closest to the camera
- Full-ring zones (spanning > 50% of ring) are cached and repositioned as camera moves

### Implementation Details

#### Client-Side (zone-manager.js)

1. **Camera Position Retrieval**:
   ```javascript
   // Get raw Three.js camera position (preserves negative values)
   const camera = this.sceneManager?.getCamera();
   const cameraThreeJSPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
   const cameraEarthRingPos = fromThreeJS(cameraThreeJSPos);
   const cameraX = cameraEarthRingPos.x || 0;
   ```

2. **Zone Coordinate Wrapping**:
   ```javascript
   const wrapZoneX = (x) => {
     const wrapped = normalizeRelativeToCamera(x, cameraX);
     return wrapped;
   };
   ```

3. **Full-Ring Zone Optimization**:
   - Zones spanning > 50% of ring are cached
   - Mesh geometry is reused, only position is updated
   - Reduces rendering overhead for large zones

#### Server-Side (zones.go)

1. **Coordinate Wrapping Functions**:
   - `wrapCoordinate(x)` - Wraps a single X coordinate to `[0, RingCircumference)`
   - `wrapGeoJSONCoordinates(geom)` - Wraps all X coordinates in a GeoJSON geometry

2. **Query Wrapping**:
   - Zone queries handle wrapped bounding boxes
   - When query range crosses the wrap boundary, the query is expanded to cover both sides

#### Relationship to Chunk Wrapping

- Zone wrapping uses the same logic as chunk wrapping
- Both use unwrapped camera position for consistency
- Ensures zones and chunks appear/disappear together at boundaries
- Prevents synchronization issues between zones and chunks

## Transportation System

[Rest of the document continues...]
