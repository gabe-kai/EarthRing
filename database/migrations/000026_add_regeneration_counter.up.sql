-- Add regeneration counter table for complete structure regeneration
-- This counter is incremented each time complete regeneration is performed
-- and is used in the seed calculation to ensure different building placements

CREATE TABLE IF NOT EXISTS structure_regeneration_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    regeneration_counter INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial row if it doesn't exist
INSERT INTO structure_regeneration_config (id, regeneration_counter, updated_at)
VALUES (1, 0, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

