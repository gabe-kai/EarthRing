# Zone System Design

## Table of Contents

- [Overview](#overview)
- [Zone Types](#zone-types)
  - [Player-Defined Zones](#player-defined-zones)
  - [System-Defined Zones](#system-defined-zones)
- [Zone Creation](#zone-creation)
  - [Polygon Definition](#polygon-definition)
  - [Zone Constraints](#zone-constraints)
- [Transportation System](#transportation-system)
  - [Overview](#overview-1)
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

2. **Maglev Transit Zone**
   - Continuous zone running full ring length
   - Reserved for high-speed maglev tracks
   - Width: ~100 meters (centered on ring)
   - Cannot be built upon
   - Connects all elevator stations

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
3. **Torus Tool**: Click and drag to create torus-shaped zones
4. **Polygon Tool**: Click multiple points to create custom polygon shapes
   - Click to place vertices
   - Right-click or double-click to finish polygon (minimum 3 vertices)
5. **Paintbrush Tool**: Click and drag to create freeform zones by painting
6. **Select Tool**: Default tool for selecting existing zones (click zones to select them)

#### Tool Selection and Mouse Controls

- **Left Mouse Button**: Default select tool - click zones to select them, or use with drawing tools when a tool is active
- **Right Mouse Button**: Dismiss tool - returns to select mode when a zone drawing tool (circle, rectangle, etc.) is active
- **Tool Persistence**: Tool selection persists in localStorage and survives page refreshes

#### Drawing Interface

1. **Drawing Workflow**
   - Select a drawing tool from the toolbar
   - Click and drag (for Rectangle, Circle, Torus, Paintbrush) or click multiple points (for Polygon)
   - Preview appears while drawing
   - Release mouse or finish polygon to create zone

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

## Transportation System

### Overview

EarthRing emphasizes pedestrian-friendly, compact city design with minimal personal autos. The transportation system grows organically based on NPC traffic patterns, prioritizing walking and public transit over private vehicles.

### Transportation Hierarchy

1. **Foot Traffic** (Default)
   - Primary mode of transportation in city areas
   - Compact city design optimized for walking
   - No infrastructure required

2. **Conveyor Sidewalks** (Short Distance, Heavy Traffic)
   - Moving walkways for high-traffic short routes
   - Generated automatically based on traffic density
   - Width: 3-5 meters
   - Speed: Walking speed × 1.5-2

3. **Tram-Loops** (Very Heavy Traffic, Medium Distance)
   - Circular/loop transit routes for medium-distance travel
   - Generated for high-traffic corridors
   - Width: 6-8 meters (tram tracks + platform)
   - Speed: Medium
   - Stops at regular intervals

4. **Maglev** (Long Distance Between Stations)
   - High-speed transit between stations
   - Continuous zone running full ring length
   - System-defined infrastructure

5. **Road Lanes** (Hub and Regional Stations Only)
   - Personal autos, buses, short-distance cargo carriers
   - Only at pillar/elevator hubs and regional hubs
   - Not in general city areas
   - Width: Variable based on vehicle type

6. **Bike/Skate Lanes**
   - Dedicated lanes for bicycles and personal mobility devices
   - Integrated into transportation network
   - Width: 2-3 meters

## Transportation Generation Algorithm

### Overview

Transportation infrastructure is not manually placed by players. Instead, it grows organically based on NPC traffic patterns. The system analyzes where NPCs frequently travel and generates appropriate transportation infrastructure along those paths.

### Traffic Analysis

1. **Data Collection**
   - Track NPC movement paths over time
   - Store paths in `npc_traffic` table
   - Aggregate by frequency and recency
   - Weight recent traffic more heavily

2. **Traffic Density Calculation**
   ```python
   def calculate_traffic_density(path_segments, time_window):
       """Calculate traffic density for path segments"""
       recent_paths = filter_by_time(path_segments, time_window)
       density_map = {}
       for path in recent_paths:
           for segment in path.segments:
               density_map[segment] += path.frequency
       return density_map
   ```

3. **Transportation Generation Thresholds**
   - **Very High Traffic, Medium Distance**: Generate tram-loop
   - **High Traffic, Short Distance**: Generate conveyor sidewalk
   - **Medium Traffic**: Generate bike/skate lane
   - **Low Traffic**: Foot traffic only (no infrastructure)
   - **Hub/Regional Stations**: Generate road lanes (autos, buses, cargo)
   - **Note**: See `13-transportation-generation.md` for detailed threshold values and implementation specifications

### Transportation Growth Process

1. **Initial Generation**
   - Analyze existing NPC traffic data
   - Identify high-traffic corridors and distances
   - Generate appropriate transportation infrastructure:
     - Tram-loops for very heavy, medium-distance routes
     - Conveyor sidewalks for heavy, short-distance routes
     - Bike/skate lanes for medium traffic
     - Road lanes only at hub/regional stations
   - Connect to existing transportation network

2. **Continuous Growth and Adaptation**
   - Monitor NPC traffic patterns
   - Update traffic density periodically: **In-game week** (not daily)
   - Traffic patterns require sustained activity over a week to trigger changes
   - Prevents temporary events (like ball games) from causing infrastructure changes
   - **Lane Widening**: Existing infrastructure widens as traffic increases
   - **Infrastructure Upgrading**: When traffic exceeds capacity, upgrade to next level:
     - Foot traffic → Bike/skate lane (narrow) → Bike/skate lane (wider) → Conveyor sidewalk → Tram-loop
     - Road lanes widen, then upgrade to tram/conveyor if traffic very high
   - **Downgrading**: Infrastructure downgrades or narrows when traffic decreases
   - Remove unused infrastructure

3. **Network Connectivity**
   - Ensure transportation connects zones
   - Connect to maglev stations
   - Connect to hub/regional stations (where road lanes exist)
   - Maintain network connectivity
   - Prioritize pedestrian connectivity

### Transportation Infrastructure Types

1. **Foot Traffic** (Default)
   - No infrastructure required
   - Primary mode in city areas
   - Compact, walkable design

2. **Conveyor Sidewalks**
   - Width: 3-5 meters (can widen up to 6-8 meters with multiple parallel conveyors)
   - Speed: Walking speed × 1.5-2
   - Use: Short distance, heavy traffic routes
   - Generated when: High traffic density over short distances
   - Upgrades from: Bike/skate lanes at maximum width
   - Upgrades to: Tram-loop when traffic exceeds capacity
   - **Direction**: Single direction
   - **Bidirectional**: If both directions needed, add another conveyor on opposite side of road

3. **Tram-Loops**
   - Width: 6-8 meters (can widen up to 10-12 meters with wider platforms/multiple tracks)
   - Speed: Medium (faster than walking/conveyor)
   - Use: Very heavy traffic, medium distance routes
   - Generated when: Very high traffic density over medium distances
   - Upgrades from: Conveyor sidewalks at maximum width, or road lanes at hubs
   - **Route Type**: Linear loops - back and forth along two lanes of a single stretch of road
   - **Future**: Can expand to more complex routes later if necessary
   - Stops: Regular intervals along route

4. **Bike/Skate Lanes**
   - Width: 2-3 meters (can widen up to 4-5 meters with multiple lanes)
   - Speed: Low-medium
   - Use: Medium traffic routes, personal mobility
   - Generated when: Moderate traffic density
   - Upgrades from: Foot traffic
   - Upgrades to: Conveyor sidewalk when traffic exceeds capacity
   - Integrated: Can run alongside other infrastructure

5. **Road Lanes** (Hub/Regional Stations Only)
   - Width: Variable (3-4 meters per lane, can add more lanes as traffic increases)
   - Lanes: Multiple lanes for different vehicle types
   - Speed: Variable (low to medium)
   - Use: Personal autos, buses, short-distance cargo carriers
   - Location: Only at pillar/elevator hubs and regional hubs
   - Types:
     - **Auto Lanes**: Personal vehicles (minimal use)
     - **Bus Lanes**: Public transit buses
     - **Cargo Lanes**: Short-distance cargo carriers
   - **Upgrades**: When traffic exceeds road capacity, can upgrade to tram-loop or conveyor sidewalk
   - **Widening**: Lanes widen by adding more parallel lanes as traffic increases

6. **Maglev** (System-Defined)
   - Width: ~100 meters (centered on ring)
   - Speed: Very high
   - Use: Long-distance travel between stations
   - Continuous zone running full ring length

### Dynamic Infrastructure Adaptation

**Lane Widening Mechanism**:
- Infrastructure starts at minimum width for its type
- As traffic increases, lanes widen incrementally
- Width increases in steps (e.g., 0.5m increments)
- Maximum width before upgrade depends on infrastructure type:
  - Bike/skate lanes: Up to 4-5 meters (2-3 lanes)
  - Conveyor sidewalks: Up to 6-8 meters (multiple parallel conveyors)
  - Tram-loops: Up to 10-12 meters (wider platforms, multiple tracks)
  - Road lanes: Up to 4 meters per lane (multiple lanes)

**Infrastructure Upgrade Progression**:
- When traffic exceeds capacity of current infrastructure type, upgrade to next level:
  1. **Foot Traffic** → **Bike/Skate Lane** (narrow, 2m)
  2. **Bike/Skate Lane** (narrow) → **Bike/Skate Lane** (wider, up to 4-5m)
  3. **Bike/Skate Lane** (at max width) → **Conveyor Sidewalk** (3-5m)
  4. **Conveyor Sidewalk** (at max width) → **Tram-Loop** (6-8m)
  5. **Road Lanes** (at max width) → **Tram-Loop** or **Conveyor Sidewalk** (if traffic very high)

**Upgrade Conditions**:
- Traffic density exceeds current infrastructure capacity
- Traffic sustained at high level for threshold period (e.g., 24-48 hours)
- Upgrade replaces existing infrastructure (no duplication)
- Smooth transition: Old infrastructure removed, new infrastructure added

**Downgrade Conditions**:
- Traffic decreases below threshold for current infrastructure type
- Traffic sustained at low level for threshold period
- Infrastructure narrows first, then downgrades if traffic continues low
- Prevents infrastructure from being removed too quickly (hysteresis)

### Transportation Placement Rules

- Transportation infrastructure follows NPC traffic paths
- Respects zone boundaries (can cross but maintain zone identity)
- Avoids player-placed structures
- Connects to existing transportation network
- **Dynamic Adaptation**: Infrastructure widens and upgrades based on traffic
- Road lanes only generated at hub/regional stations
- Prioritizes pedestrian connectivity
- Compact design minimizes infrastructure footprint
- Infrastructure adapts organically to traffic patterns

### Manual Infrastructure Placement

**Decision**: Players with special roles can manually place transportation infrastructure.

**Role System**:
- **Infrastructure Manager Role**: Special role (lighter than admin, but with infrastructure permissions)
- Allows manual placement of transportation infrastructure
- Can override automatic generation
- Can create custom routes and connections
- Useful for planning and optimization

**Manual Placement Rules**:
- Must still use valid infrastructure types
- Must respect zone boundaries and system zones
- Can create routes not generated automatically
- Can modify existing infrastructure
- Changes affect NPC pathfinding and traffic patterns

## Zone-to-Zone Connectivity

### Connectivity Analysis

The system analyzes how zones connect:

1. **Direct Connections**
   - Zones share a boundary
   - Transportation infrastructure connects zones directly

2. **Indirect Connections**
   - Zones connected via intermediate zones
   - Path through transportation network

3. **Maglev Connections**
   - Zones near elevator stations
   - Can use maglev for long-distance travel

### NPC Pathfinding

NPCs use zone connectivity and transportation network for pathfinding:

1. **Zone-Level Pathfinding**
   - Find path through zone network
   - Use A* or similar algorithm
   - Consider zone types (residential → commercial → work)
   - Prioritize walking paths

2. **Transportation-Level Pathfinding**
   - Find path along transportation network
   - Consider transportation types and speeds:
     - Foot traffic (default, slowest)
     - Bike/skate lanes (medium speed)
     - Conveyor sidewalks (faster, short distance)
     - Tram-loops (faster, medium distance)
     - Road lanes (only at hubs, variable speed)
     - Maglev (fastest, long distance)
   - Avoid congestion
   - Prefer public transit over personal vehicles

3. **Hybrid Pathfinding**
   - Combine zone and transportation pathfinding
   - Use maglev for long distances
   - Optimize for time/distance
   - Consider transportation availability (tram schedules, etc.)
   - Default to walking when no infrastructure available

## Zone Area Calculation

### Area Calculation Implementation

Zone areas are calculated using PostGIS `ST_Area()` function, which returns the area in square meters. The area is automatically computed and included in all zone responses.

**Area Calculation Details:**
- **PostGIS Function**: `ST_Area()` calculates the area of polygon geometries
- **Unit**: Square meters (m²)
- **Normalization**: Zones that wrap around the X axis (crossing from near X=0 to near X=264,000,000) are normalized before area calculation to prevent incorrect area measurements

### Wrap-Around Area Fix

**Problem**: When a zone wraps around the X axis (e.g., a circle drawn at world origin with coordinates spanning from near 0 to near 264,000,000), PostGIS calculates the area as if the polygon spans the entire ring width, resulting in billions of m² instead of the correct area.

**Solution**: A PostGIS function `normalize_zone_geometry_for_area()` was created to normalize coordinates before area calculation:
- Detects when coordinates span more than half the ring circumference (132,000,000m)
- Shifts coordinates that are > half_ring by subtracting the ring circumference (264,000,000m)
- Makes coordinates contiguous so PostGIS calculates area correctly
- Applied automatically to all zone area calculations

**Example**: A 30m diameter circle at world origin:
- **Before fix**: Area calculated as billions of m² (incorrect)
- **After fix**: Area calculated as ~707 m² (π × 15², correct)

**Implementation**: Migration `000015_normalize_zone_geometry_for_area` creates the normalization function, and all zone queries (`CreateZone`, `GetZoneByID`, `UpdateZone`, `ListZonesByArea`, `ListZonesByOwner`) use `ST_Area(normalize_zone_geometry_for_area(geometry))` instead of `ST_Area(geometry)`.

## Zone Properties and Effects

### Zone Properties

Each zone has properties that affect gameplay:

- **Density**: Low, Medium, High (affects building density)
- **Height Limit**: Maximum building height
- **Building Style**: Modern, Classic, Futuristic, etc.
- **NPC Population**: Target population for the zone
- **Resource Production**: What resources the zone produces
- **Resource Consumption**: What resources the zone consumes

### Zone Effects

Zones affect various game systems:

1. **Procedural Generation**
   - Buildings generated match zone type and density
   - Building styles match zone properties
   - NPCs spawned based on zone type

2. **NPC Behavior**
   - NPCs choose homes in residential zones
   - NPCs choose work in commercial/industrial zones
   - NPCs visit commercial zones for shopping
   - NPCs visit park zones for recreation

3. **Racing** (Illegal Street Racing)
   - Zones affect route generation through existing infrastructure
   - Dense zones create challenging, technical race routes
   - Open zones allow high-speed sections
   - Transportation infrastructure type determines racing characteristics

## Zone Overlap and Conflicts

### Zone Overlap Policy

**Decision**: Zones are allowed to overlap with other player zones. Conflicts are resolved using an importance system.

### Importance System

Each zone has an **importance level** that determines conflict resolution:
- **System Zones**: Highest importance (elevator stations, maglev, Atlas Pillars)
- **High Importance**: Critical infrastructure, major zones
- **Medium Importance**: Standard player zones (default)
- **Low Importance**: Temporary or experimental zones

### Conflict Resolution

When two zones overlap and have conflicting rules:

1. **Different Importance Levels**: Higher importance zone takes precedence in overlap area
2. **Same Importance Level**: 
   - System randomly determines winner (simulated "court ruling")
   - Result is deterministic (same seed = same result)
   - Both zones remain, but one's rules apply in overlap area
   - Players can see which zone "won" the conflict

**Implementation**:
- Conflict detection on zone creation/modification
- Importance comparison
- Random determination if same importance
- Visual indication of conflict resolution in UI

### Overlap Benefits

- Allows creative zone combinations
- Players can experiment with overlapping zones
- Creates interesting gameplay dynamics
- Simulates real-world property disputes

## Floor Spanning Zones

**Decision**: Floor-spanning zones are a special case, handled building-by-building.

**Implementation**:
- Not a general zone feature
- Specific buildings can be designated as floor-spanning
- Each floor-spanning building is handled as a special case
- Zones on different floors can reference the same building
- Building-specific rules determine how floors interact

**Examples**:
- A skyscraper spanning multiple station levels
- A building with ground floor commercial and upper floors residential
- Each case handled individually based on building design

## Zone Modifications

### Editing Zones

Players can modify their zones:

1. **Resize**: Adjust polygon vertices
2. **Change Type**: Convert zone to different type
3. **Change Density**: Adjust density level
4. **Change Properties**: Modify custom properties
5. **Delete**: Remove zone via zone editor panel (structures may be affected)
   - Delete button available in zone list
   - Confirmation dialog prevents accidental deletion
   - Zone removed from scene and game state immediately

### Zone Merging

- Players can merge adjacent zones of same type
- Merged zones combine properties
- Polygon union operation

### Zone Splitting

- Players can split zones into multiple zones
- Polygon division operation
- Properties distributed or copied

## Special Zone Rules

### Elevator Station Zones

- Fixed geometry matching station design
- Some areas may be buildable (TBD)
- Roads must connect to station
- Maglev access points

### Maglev Zone

- No building allowed
- Roads can cross but not block
- Access points at regular intervals
- Continuous track requirement

### Atlas Pillar Zones

- Fixed geometry (TBD)
- Structural requirements
- May have buildable areas
- Roads must respect pillar structure

## Client-Side Implementation

### Zone Rendering Architecture

**Current Implementation** (see `docs/06-client-architecture.md` for full details):

- **World-Anchored Meshes**: Zones are rendered as separate Three.js meshes positioned at their actual world coordinates, not relative to the camera. This ensures zones stay fixed to their locations on the ring.

- **Ring Wrapping**: Zones wrap around the 264,000 km ring circumference using the same logic as chunks. The `wrapZoneX()` function calculates the shortest path around the ring, ensuring zones always render at the copy closest to the camera.

- **Coordinate Conversion**: Zone coordinates (EarthRing X/Y/Z) are converted to Three.js coordinates:
  - EarthRing X (ring position) → Three.js X (right)
  - EarthRing Y (width) → Three.js Z (forward)  
  - EarthRing Z (floor) → Three.js Y (up) via `floor * DEFAULT_FLOOR_HEIGHT`

- **Shape Geometry Creation**: Zones use `THREE.ShapeGeometry` created from `THREE.Shape` objects:
  - Shape is created in the XY plane using `worldPos.x` (EarthRing X) and `worldPos.z` (EarthRing Y) as coordinates
  - Shape is then rotated -90° around X-axis to lie flat on the ring floor
  - **Negative Y Coordinate Handling**: When EarthRing Y coordinates are negative (Y- side of ring), the shape's Y coordinate (`worldPos.z`) is negated before creating the shape. This ensures correct face orientation after rotation, preventing zones from appearing mirrored on the opposite side of the Y-axis.

- **Fetching Strategy**: Zones are fetched via `GET /api/zones/area` with a bounding box around the camera (default: 5000m ring, 3000m width). Fetching is throttled to once per 4 seconds to prevent excessive API calls.

- **Visibility System**: Two-level visibility control:
  - Global visibility: All zones on/off
  - Per-type visibility: Individual zone types can be shown/hidden independently
  - Zones toolbar provides UI controls for both levels

- **Grid Overlay Separation**: Grid is rendered separately as a circular canvas texture that fades at edges. Zones are NOT part of the grid texture, allowing zones to remain fully visible while grid fades.

### Zone Type Support

**Implemented Zone Types:**
- `residential` - Green overlay
- `commercial` - Blue overlay
- `industrial` - Orange overlay
- `mixed-use` / `mixed_use` - Yellow-orange gradient overlay
- `park` - Light green overlay
- `restricted` - Red overlay (prevents procedural spawning)

**Adding New Zone Types:**
1. Add color/style to `ZONE_STYLES` in `zone-manager.js`
2. Add to `zoneTypeVisibility` Map in constructor
3. Add to zones toolbar `zoneTypes` array
4. Update server-side validation if needed

### Troubleshooting Client-Side Issues

**Zones Not Appearing:**
- Check authentication: User must be logged in
- Check fetch throttling: Wait 4 seconds between manual fetches
- Check visibility: Both global and per-type visibility must be enabled
- Check console: Use `zoneManager.logZoneState()` for debug info
- Verify zone data: Check `gameStateManager.getAllZones()` for cached zones

**Zones Moving with Camera:**
- Indicates ring wrapping logic failure
- Verify camera position retrieval: `cameraController.getEarthRingPosition()`
- Check that zone coordinates are in EarthRing space before wrapping

**Performance Issues:**
- Current implementation handles ~100 zones efficiently
- Each zone creates 2-3 meshes (fill + outline per polygon)
- Reduce fetch range or increase throttle if needed
- Monitor mesh count: `zoneManager.zoneMeshes.size`

## Performance Considerations

### Zone Queries

- Spatial indexing (GIST) for fast point-in-polygon queries
- Cache zone lookups for frequently accessed positions
- Batch zone queries when possible
- Client-side fetch throttling (4 second minimum between requests)

### Client-Side Rendering

- Zone meshes use `depthWrite: false` and `depthTest: false` to prevent z-fighting
- Render order: Zones (`renderOrder = 5`) above grid (`renderOrder = 1`)
- Mesh cleanup: Zones are properly disposed when removed
- Performance target: ~100 zones rendered simultaneously without frame drops

### Transportation Generation

- Incremental transportation generation (don't regenerate entire network)
- Cache transportation network data
- Update transportation infrastructure in background process
- Limit generation frequency
- Prioritize pedestrian infrastructure over vehicle infrastructure

### Zone Validation

- Validate polygons on creation/modification
- Check for overlaps and conflicts
- Optimize validation algorithms
- Server-side validation ensures GeoJSON validity before storage

## Open Questions

1. What is the maximum number of vertices per zone polygon? (Needs performance testing with different clients - web, light local, Unreal)
2. ~~What are the exact traffic thresholds for generating each transportation type?~~ **RESOLVED** - See `13-transportation-generation.md` for detailed threshold values and implementation specifications
3. How should we handle zone boundaries at chunk boundaries? (Zones can span chunks - implementation details TBD)

## Future Considerations

- Zone templates for quick creation
- Zone sharing between players
- Zone marketplace (buy/sell zones)
- Dynamic zone effects based on player actions
- Zone statistics and analytics
- Zone-based events and challenges

