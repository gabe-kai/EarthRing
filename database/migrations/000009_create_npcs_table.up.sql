-- Create npcs table
-- Stores NPC (non-player character) data for Sims-like elements

CREATE TABLE IF NOT EXISTS npcs (
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

CREATE INDEX IF NOT EXISTS idx_npcs_position ON npcs USING GIST(position);
CREATE INDEX IF NOT EXISTS idx_npcs_home_zone ON npcs(home_zone_id);
CREATE INDEX IF NOT EXISTS idx_npcs_floor ON npcs(floor);

