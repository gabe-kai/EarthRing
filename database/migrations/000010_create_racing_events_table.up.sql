-- Create racing_events table
-- Stores illegal street racing event data. Racing uses existing city infrastructure - no dedicated tracks.

CREATE TABLE IF NOT EXISTS racing_events (
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

CREATE INDEX IF NOT EXISTS idx_racing_route ON racing_events USING GIST(route_geometry);
CREATE INDEX IF NOT EXISTS idx_racing_start_point ON racing_events USING GIST(start_point);
CREATE INDEX IF NOT EXISTS idx_racing_creator ON racing_events(created_by);
CREATE INDEX IF NOT EXISTS idx_racing_status ON racing_events(status);

