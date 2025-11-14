-- Create npc_traffic table
-- Stores NPC movement patterns used for road generation

CREATE TABLE IF NOT EXISTS npc_traffic (
    id SERIAL PRIMARY KEY,
    floor INTEGER DEFAULT 0 NOT NULL,
    start_position POINT NOT NULL,
    end_position POINT NOT NULL,
    path GEOMETRY(LINESTRING, 0), -- Actual path taken
    frequency INTEGER DEFAULT 1, -- How often this path is used
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    npc_type VARCHAR(50) -- 'pedestrian', 'vehicle', 'cargo', etc.
);

CREATE INDEX IF NOT EXISTS idx_npc_traffic_path ON npc_traffic USING GIST(path);
CREATE INDEX IF NOT EXISTS idx_npc_traffic_floor ON npc_traffic(floor);
CREATE INDEX IF NOT EXISTS idx_npc_traffic_frequency ON npc_traffic(frequency DESC);

