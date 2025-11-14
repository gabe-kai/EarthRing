-- Create player_actions table
-- Audit log of player actions for debugging and rollback capability

CREATE TABLE IF NOT EXISTS player_actions (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    action_type VARCHAR(50) NOT NULL, -- 'zone_create', 'structure_place', etc.
    action_data JSONB NOT NULL, -- Action-specific data
    position POINT, -- Where action occurred
    floor INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    result VARCHAR(50) -- 'success', 'failure', 'pending'
);

CREATE INDEX IF NOT EXISTS idx_player_actions_player ON player_actions(player_id);
CREATE INDEX IF NOT EXISTS idx_player_actions_type ON player_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_player_actions_timestamp ON player_actions(timestamp DESC);

