-- Create roads table
-- Stores road network data. Roads are generated based on NPC traffic patterns.

CREATE TABLE IF NOT EXISTS roads (
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

CREATE INDEX IF NOT EXISTS idx_roads_geometry ON roads USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_roads_zone ON roads(zone_id);
CREATE INDEX IF NOT EXISTS idx_roads_floor ON roads(floor);

