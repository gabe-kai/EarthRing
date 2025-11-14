-- Create zones table
-- Stores zone definitions as polygons. Zones can be player-defined or system-defined

CREATE TABLE IF NOT EXISTS zones (
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

CREATE INDEX IF NOT EXISTS idx_zones_geometry ON zones USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_zones_type ON zones(zone_type);
CREATE INDEX IF NOT EXISTS idx_zones_owner ON zones(owner_id);
CREATE INDEX IF NOT EXISTS idx_zones_floor ON zones(floor);

