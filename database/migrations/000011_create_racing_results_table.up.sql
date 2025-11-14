-- Create racing_results table
-- Stores illegal street race results and leaderboards

CREATE TABLE IF NOT EXISTS racing_results (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES racing_events(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id),
    finish_time INTERVAL, -- Race completion time
    position INTEGER, -- Final position
    checkpoint_times INTERVAL[], -- Times at each checkpoint
    vehicle_data JSONB, -- Vehicle used, modifications, etc.
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_racing_results_event ON racing_results(event_id);
CREATE INDEX IF NOT EXISTS idx_racing_results_player ON racing_results(player_id);
CREATE INDEX IF NOT EXISTS idx_racing_results_time ON racing_results(finish_time);

