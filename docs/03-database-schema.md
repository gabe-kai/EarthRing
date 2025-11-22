# Database Schema

## Table of Contents

- [Overview](#overview)
- [Database Setup](#database-setup)
  - [PostGIS Extension](#postgis-extension)
  - [What PostGIS Provides](#what-postgis-provides)
  - [Why PostGIS for EarthRing](#why-postgis-for-earthring)
  - [Performance Benefits](#performance-benefits)
  - [Example Use Cases in EarthRing](#example-use-cases-in-earthring)
- [Coordinate System](#coordinate-system)
- [Core Tables](#core-tables)
  - [Players](#players)
  - [Zones](#zones)
  - [Structures](#structures)
  - [Chunks](#chunks)
  - [Chunk Data](#chunk-data)
  - [Roads](#roads)
  - [NPC Traffic Data](#npc-traffic-data)
  - [NPCs](#npcs)
  - [Racing Events](#racing-events)
  - [Racing Results](#racing-results)
  - [Player Actions](#player-actions)
- [Spatial Queries](#spatial-queries)
  - [Common Spatial Operations](#common-spatial-operations)
    - [Find Zone at Position](#find-zone-at-position)
    - [Get Structures in Chunk](#get-structures-in-chunk)
    - [Find Nearby Roads](#find-nearby-roads)
    - [Get NPC Traffic Density for Road Generation](#get-npc-traffic-density-for-road-generation)
- [Data Relationships](#data-relationships)
- [Data Integrity](#data-integrity)
  - [Constraints](#constraints)
  - [Triggers](#triggers)
- [Performance Optimization](#performance-optimization)
  - [Indexing Strategy](#indexing-strategy)
  - [Partitioning Considerations](#partitioning-considerations)
- [Backup and Recovery](#backup-and-recovery)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The database schema uses PostgreSQL with PostGIS extension for spatial data. All game state, map data, player progress, and zone definitions are stored here, allowing the game engine to evolve while maintaining persistent data.

## Database Setup

### PostGIS Extension

PostGIS is a spatial database extension for PostgreSQL that adds support for geographic objects and spatial queries. It's essential for EarthRing's massive spatial data requirements.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
```

#### What PostGIS Provides

**1. Spatial Data Types**:
- **GEOMETRY**: Stores 2D/3D geometric shapes (points, lines, polygons)
- **GEOGRAPHY**: Stores geographic coordinates on Earth's surface (for Earth observation features)
- **RASTER**: Stores raster/imagery data (for future Earth observation)

**2. Spatial Indexing**:
- **GIST (Generalized Search Tree)**: High-performance spatial indexes for fast geometric queries
- Enables efficient point-in-polygon queries (finding zones at positions)
- Fast distance calculations and nearest-neighbor searches
- Critical for querying the massive 264,000 km ring efficiently

**3. Spatial Functions**:
- **ST_Contains**: Check if a point is inside a polygon (zone lookups)
- **ST_DWithin**: Find objects within a distance (nearby structures, roads)
- **ST_Distance**: Calculate distances between geometries
- **ST_Intersects**: Check if geometries overlap (chunk-zone intersections)
- **ST_MakePoint**: Create point geometries from coordinates
- **ST_MakeEnvelope**: Create bounding boxes for queries

**4. Coordinate System Support**:
- **SRID (Spatial Reference System Identifier)**: Handles coordinate system transformations
- Supports custom coordinate systems (like our ring coordinate system)
- Can transform between coordinate systems if needed

#### Why PostGIS for EarthRing

**1. Massive Spatial Scale**:
- Ring is 264,000 km long with 264,000 chunks
- Thousands of zones, structures, and roads
- PostGIS spatial indexes make queries fast even at this scale

**2. Complex Spatial Queries**:
- Finding zones at specific positions (point-in-polygon)
- Finding structures within chunks
- Finding nearby roads for pathfinding
- Calculating NPC traffic density for road generation
- All require efficient spatial operations

**3. Zone System**:
- Zones are freeform polygons (not simple rectangles)
- Need to check if points are inside complex polygon shapes
- PostGIS handles arbitrary polygon geometries efficiently

**4. Road Generation**:
- Roads follow NPC traffic paths (complex linestrings)
- Need to find nearby roads, calculate distances
- PostGIS provides efficient spatial analysis

**5. Chunk Management**:
- Chunks overlap with zones (spatial intersection queries)
- Need to find which zones affect which chunks
- PostGIS handles spatial relationships efficiently

**6. Future Features**:
- Earth observation (geographic coordinates)
- Distance calculations with map wrapping
- Spatial analytics and visualization

#### Performance Benefits

- **Spatial Indexes**: GIST indexes make spatial queries orders of magnitude faster
- **Optimized Algorithms**: PostGIS uses optimized geometric algorithms
- **Batch Operations**: Efficient bulk spatial operations
- **Query Optimization**: PostgreSQL query planner optimizes spatial queries

#### Example Use Cases in EarthRing

1. **Zone Lookup**: "What zone is at position (12345, 100)?"
   - Uses `ST_Contains` with spatial index
   - Fast even with thousands of zones

2. **Chunk-Zone Intersection**: "Which zones overlap chunk 12345?"
   - Uses `ST_Intersects` with spatial index
   - Critical for chunk generation

3. **Nearby Structures**: "Find all structures within 100m of position X"
   - Uses `ST_DWithin` with spatial index
   - Fast nearest-neighbor search

4. **Road Pathfinding**: "Find roads near this position"
   - Uses `ST_DWithin` on road linestrings
   - Efficient for NPC pathfinding

5. **Traffic Analysis**: "Find all NPC paths in this area"
   - Uses spatial bounding box queries
   - Fast aggregation for road generation

### Coordinate System

Using a custom coordinate system for the ring:
- **SRID**: Custom (or use 4326 with transformation)
- **Units**: Meters
- **X-axis**: Ring position (0 to 264,000,000)
- **Y-axis**: Width position (-12,500 to +12,500 for pillar hubs)
- **Z-axis**: Floor/level (integer)

**Note**: PostGIS supports custom coordinate systems, allowing us to use our ring-specific coordinate system while still benefiting from spatial indexing and queries.

## Core Tables

### Players

Stores player account information and progression.

```sql
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    level INTEGER DEFAULT 1,
    experience_points BIGINT DEFAULT 0,
    currency_amount BIGINT DEFAULT 0,
    current_position POINT, -- Ring position (x, y)
    current_floor INTEGER DEFAULT 0,
    metadata JSONB -- Flexible storage for game-specific data
);

CREATE INDEX idx_players_username ON players(username);
CREATE INDEX idx_players_email ON players(email);
```

**Note on POINT Type Queries:**
PostgreSQL's native `POINT` type is **not a composite type**, so you cannot use dot notation like `(current_position).x` or `(current_position).y`. To extract coordinates from a POINT type:

- **Use PostGIS functions** (recommended, since PostGIS is installed):
  ```sql
  SELECT ST_X(current_position::geometry) AS x,
         ST_Y(current_position::geometry) AS y
  FROM players
  WHERE id = $1;
  ```
  
- **Handle NULL values** properly:
  ```sql
  SELECT CASE WHEN current_position IS NULL 
         THEN NULL 
         ELSE ST_X(current_position::geometry) 
       END AS x
  FROM players;
  ```

- **Insert/Update POINT values**:
  ```sql
  UPDATE players 
  SET current_position = POINT($1, $2)
  WHERE id = $3;
  ```

**Common Mistake:** Using `(current_position).x` will produce error: `column notation .x applied to type point, which is not a composite type`

### Zones

Stores zone definitions as polygons. Zones can be player-defined or system-defined (elevator stations, maglev tracks, etc.).

```sql
CREATE TABLE zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    zone_type VARCHAR(50) NOT NULL, -- 'residential', 'commercial', 'industrial', 
                                    -- 'elevator_station', 'maglev', 'cargo', 'transit', etc.
    geometry GEOMETRY(POLYGON, 0) NOT NULL, -- PostGIS polygon
    floor INTEGER DEFAULT 0 NOT NULL,
    owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    is_system_zone BOOLEAN DEFAULT FALSE, -- True for elevator stations, maglev, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB, -- Zone-specific properties (density, rules, etc.)
    metadata JSONB
);

CREATE INDEX idx_zones_geometry ON zones USING GIST(geometry);
CREATE INDEX idx_zones_type ON zones(zone_type);
CREATE INDEX idx_zones_owner ON zones(owner_id);
CREATE INDEX idx_zones_floor ON zones(floor);
```

**Zone Area Calculation:**
- Zone areas are calculated using PostGIS `ST_Area()` function
- **Function**: `normalize_zone_geometry_for_area(geometry)` - Normalizes coordinates for zones that wrap around the X axis before area calculation
- **Implementation**: Created in migration `000015_normalize_zone_geometry_for_area`
- **Usage**: All zone queries use `ST_Area(normalize_zone_geometry_for_area(geometry))` instead of `ST_Area(geometry)` to handle wrap-around cases correctly
- **Purpose**: Fixes bug where zones crossing X axis (0/264,000,000 boundary) calculated area incorrectly (billions of m² instead of correct area)
- **IMPORTANT**: This function should ONLY be used for read-only operations (area calculation, distance checks, etc.). Do NOT use it in transformation pipelines (merge, union, etc.) as the JSON manipulation creates structures that corrupt when further transformed. For merging wrapped zones, use `ST_DumpPoints` + `ST_MakePolygon` instead. See `WRAP_POINT_FIX_SUMMARY.md` for details.

### Structures

Stores player-placed and procedural structures (buildings, objects, etc.).

```sql
CREATE TABLE structures (
    id SERIAL PRIMARY KEY,
    structure_type VARCHAR(50) NOT NULL, -- 'building', 'road', 'decoration', etc.
    position POINT NOT NULL, -- (ring_position, width_position)
    floor INTEGER DEFAULT 0 NOT NULL,
    rotation REAL DEFAULT 0, -- Rotation in degrees
    scale REAL DEFAULT 1.0,
    owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
    is_procedural BOOLEAN DEFAULT FALSE,
    procedural_seed INTEGER, -- Seed for procedural generation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB, -- Structure-specific data (height, materials, etc.)
    model_data JSONB -- 3D model reference or data
);

CREATE INDEX idx_structures_position ON structures USING GIST(position);
CREATE INDEX idx_structures_owner ON structures(owner_id);
CREATE INDEX idx_structures_zone ON structures(zone_id);
CREATE INDEX idx_structures_floor ON structures(floor);
CREATE INDEX idx_structures_type ON structures(structure_type);
```

### Chunks

Stores chunk metadata and references to chunk data.

```sql
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,
    floor INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL, -- 0 to 263,999
    version INTEGER DEFAULT 1, -- For versioning/rollbacks
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_dirty BOOLEAN DEFAULT FALSE, -- Needs regeneration
    procedural_seed INTEGER,
    metadata JSONB, -- Chunk-level metadata
    UNIQUE(floor, chunk_index)
);

CREATE INDEX idx_chunks_floor_index ON chunks(floor, chunk_index);
CREATE INDEX idx_chunks_dirty ON chunks(is_dirty);
```

### Chunk Data

Stores actual chunk geometry and content. Separated from metadata for performance.

**Decision**: Use PostGIS geometry types for chunk storage to enable efficient spatial queries and operations.

**Implementation Status**: ✅ **IMPLEMENTED**
- Storage layer (`server/internal/database/chunks.go`) provides full CRUD operations
- Chunks automatically stored after generation via procedural service
- Geometry stored as PostGIS POLYGON for spatial queries
- Client-friendly geometry format stored in `terrain_data` JSONB field
- Transaction-safe operations ensure data consistency

```sql
CREATE TABLE chunk_data (
    chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    geometry GEOMETRY(POLYGON, 0) NOT NULL, -- PostGIS polygon geometry for chunk boundary
    geometry_detail GEOMETRY(MULTIPOLYGON, 0), -- Detailed geometry for complex chunks (optional)
    structure_ids INTEGER[], -- Array of structure IDs in this chunk
    zone_ids INTEGER[], -- Array of zone IDs overlapping this chunk
    npc_data JSONB, -- NPC population and traffic data
    terrain_data JSONB, -- Terrain heightmap, materials, etc.
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chunk_data_geometry ON chunk_data USING GIST(geometry);
CREATE INDEX idx_chunk_data_geometry_detail ON chunk_data USING GIST(geometry_detail) WHERE geometry_detail IS NOT NULL;
```

**Rationale**:
- PostGIS geometry types enable efficient spatial queries (intersections, distance calculations)
- Spatial indexes (GIST) provide fast lookups even with 264,000+ chunks
- Standardized format allows use of PostGIS function library
- Can leverage PostGIS compression if needed for large/complex geometries
- If detailed geometry becomes too complex for PostGIS, store simplified version in `geometry` and detailed version separately

### Roads

Stores road network data. Roads are generated based on NPC traffic patterns.

```sql
CREATE TABLE roads (
    id SERIAL PRIMARY KEY,
    road_type VARCHAR(50) NOT NULL, -- 'maglev', 'local', 'highway', etc.
    geometry GEOMETRY(LINESTRING, 0) NOT NULL, -- Road centerline
    floor INTEGER DEFAULT 0 NOT NULL,
    width REAL NOT NULL, -- Road width in meters
    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
    traffic_density REAL DEFAULT 0, -- NPC traffic intensity
    last_traffic_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB -- Road properties (lanes, speed limit, etc.)
);

CREATE INDEX idx_roads_geometry ON roads USING GIST(geometry);
CREATE INDEX idx_roads_zone ON roads(zone_id);
CREATE INDEX idx_roads_floor ON roads(floor);
```

### NPC Traffic Data

Stores NPC movement patterns used for road generation.

```sql
CREATE TABLE npc_traffic (
    id SERIAL PRIMARY KEY,
    floor INTEGER DEFAULT 0 NOT NULL,
    start_position POINT NOT NULL,
    end_position POINT NOT NULL,
    path GEOMETRY(LINESTRING, 0), -- Actual path taken
    frequency INTEGER DEFAULT 1, -- How often this path is used
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    npc_type VARCHAR(50) -- 'pedestrian', 'vehicle', 'cargo', etc.
);

CREATE INDEX idx_npc_traffic_path ON npc_traffic USING GIST(path);
CREATE INDEX idx_npc_traffic_floor ON npc_traffic(floor);
CREATE INDEX idx_npc_traffic_frequency ON npc_traffic(frequency DESC);
```

### NPCs

Stores NPC (non-player character) data for Sims-like elements.

```sql
CREATE TABLE npcs (
    id SERIAL PRIMARY KEY,
    npc_type VARCHAR(50) NOT NULL, -- 'resident', 'worker', 'visitor', etc.
    position POINT NOT NULL,
    floor INTEGER DEFAULT 0 NOT NULL,
    home_zone_id INTEGER REFERENCES zones(id),
    work_zone_id INTEGER REFERENCES zones(id),
    current_activity VARCHAR(100),
    needs JSONB, -- Sims-like needs (hunger, happiness, etc.)
    schedule JSONB, -- Daily routine
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB
);

CREATE INDEX idx_npcs_position ON npcs USING GIST(position);
CREATE INDEX idx_npcs_home_zone ON npcs(home_zone_id);
CREATE INDEX idx_npcs_floor ON npcs(floor);
```

### Racing Events

Stores illegal street racing event data. Racing uses existing city infrastructure - no dedicated tracks.

```sql
CREATE TABLE racing_events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    route_geometry GEOMETRY(LINESTRING, 0) NOT NULL, -- Race route through existing infrastructure
    floor INTEGER DEFAULT 0 NOT NULL,
    created_by INTEGER REFERENCES players(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'active', 'completed'
    start_point POINT NOT NULL, -- Starting location
    end_point POINT NOT NULL, -- Finish location
    checkpoints POINT[], -- Optional checkpoints along route
    properties JSONB -- Race rules, vehicle types, route generation method, etc.
);

CREATE INDEX idx_racing_route ON racing_events USING GIST(route_geometry);
CREATE INDEX idx_racing_start_point ON racing_events USING GIST(start_point);
CREATE INDEX idx_racing_creator ON racing_events(created_by);
CREATE INDEX idx_racing_status ON racing_events(status);
```

**Note**: Routes are generated dynamically from existing transportation infrastructure. The `route_geometry` represents the path through the city, not a dedicated track.

### Racing Results

Stores illegal street race results and leaderboards.

```sql
CREATE TABLE racing_results (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES racing_events(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id),
    finish_time INTERVAL, -- Race completion time
    position INTEGER, -- Final position
    checkpoint_times INTERVAL[], -- Times at each checkpoint
    vehicle_data JSONB, -- Vehicle used, modifications, etc.
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_racing_results_event ON racing_results(event_id);
CREATE INDEX idx_racing_results_player ON racing_results(player_id);
CREATE INDEX idx_racing_results_time ON racing_results(finish_time);
```

### Player Actions

Audit log of player actions for debugging and rollback capability.

```sql
CREATE TABLE player_actions (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    action_type VARCHAR(50) NOT NULL, -- 'zone_create', 'structure_place', etc.
    action_data JSONB NOT NULL, -- Action-specific data
    position POINT, -- Where action occurred
    floor INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    result VARCHAR(50) -- 'success', 'failure', 'pending'
);

CREATE INDEX idx_player_actions_player ON player_actions(player_id);
CREATE INDEX idx_player_actions_type ON player_actions(action_type);
CREATE INDEX idx_player_actions_timestamp ON player_actions(timestamp DESC);
```

## Spatial Queries

### Common Spatial Operations

#### Find Zone at Position

```sql
SELECT * FROM zones 
WHERE floor = ? 
AND ST_Contains(geometry, ST_MakePoint(?, ?))
ORDER BY is_system_zone DESC, created_at ASC
LIMIT 1;
```

#### Get Structures in Chunk

```sql
SELECT s.* FROM structures s
WHERE s.floor = ?
AND ST_X(s.position) >= ? * 1000
AND ST_X(s.position) < (? + 1) * 1000
AND s.zone_id IN (
    SELECT id FROM zones 
    WHERE floor = ? 
    AND geometry && ST_MakeEnvelope(? * 1000, -2500, (? + 1) * 1000, 2500, 0)
);
```

#### Find Nearby Roads

```sql
SELECT * FROM roads
WHERE floor = ?
AND ST_DWithin(geometry, ST_MakePoint(?, ?), ?)
ORDER BY ST_Distance(geometry, ST_MakePoint(?, ?))
LIMIT ?;
```

#### Get NPC Traffic Density for Road Generation

```sql
SELECT 
    ST_X(start_position) as start_x,
    ST_Y(start_position) as start_y,
    ST_X(end_position) as end_x,
    ST_Y(end_position) as end_y,
    SUM(frequency) as total_frequency
FROM npc_traffic
WHERE floor = ?
AND ST_X(start_position) BETWEEN ? AND ?
GROUP BY start_position, end_position
ORDER BY total_frequency DESC;
```

## Data Relationships

```
players
  ├── zones (owner_id)
  ├── structures (owner_id)
  ├── racing_events (created_by)
  └── player_actions (player_id)

zones
  ├── structures (zone_id)
  ├── roads (zone_id)
  └── npcs (home_zone_id, work_zone_id)

chunks
  └── chunk_data (chunk_id)

racing_events
  └── racing_results (event_id)
```

## Data Integrity

### Constraints

- Zone polygons must be valid geometries
- Structures must be within valid coordinate ranges
- Chunk indices must be in range [0, 263999]
- Positions must wrap correctly (handled in application layer)

### Triggers

```sql
-- Update zone updated_at timestamp
CREATE OR REPLACE FUNCTION update_zone_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zone_updated_at
BEFORE UPDATE ON zones
FOR EACH ROW
EXECUTE FUNCTION update_zone_timestamp();

-- Mark chunks as dirty when structures change
CREATE OR REPLACE FUNCTION mark_chunk_dirty()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chunks 
    SET is_dirty = TRUE,
        last_modified = CURRENT_TIMESTAMP
    WHERE floor = NEW.floor
    AND chunk_index = FLOOR(ST_X(NEW.position) / 1000)::INTEGER % 264000;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER structure_chunk_dirty
AFTER INSERT OR UPDATE ON structures
FOR EACH ROW
EXECUTE FUNCTION mark_chunk_dirty();
```

## Performance Optimization

### Indexing Strategy

1. **Spatial Indexes**: GIST indexes on all geometry columns
2. **Composite Indexes**: (floor, chunk_index) for chunk lookups
3. **Partial Indexes**: For frequently queried subsets
4. **Expression Indexes**: For computed values

### Partitioning Considerations

For very large tables, consider partitioning:
- `player_actions` by timestamp (monthly partitions)
- `npc_traffic` by floor
- `structures` by chunk_index ranges

## Backup and Recovery

- Regular PostgreSQL backups
- Point-in-time recovery capability
- Export spatial data to standard formats (GeoJSON, Shapefile)
- Version control for schema changes

## Open Questions

1. How do we handle versioning of chunk data for rollbacks?
2. Should NPC data be stored in database or generated on-demand?
3. Do we need a separate table for procedural generation seeds?
4. How should we handle large binary assets (textures, models)?

## Future Considerations

- Full-text search on zone names and descriptions
- Time-series data for analytics (player activity, zone growth)
- Replication for read scaling
- Archival strategy for old player actions
- Support for user-generated content (custom models, textures)

