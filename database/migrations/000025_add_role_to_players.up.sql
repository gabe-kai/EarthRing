-- Add role column to players table
-- Default role is 'player', but can be set to 'admin' for administrative users

ALTER TABLE players
ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'player' NOT NULL;

-- Create index for role lookups
CREATE INDEX IF NOT EXISTS idx_players_role ON players(role);

-- Update any existing NULL roles to 'player' (shouldn't happen due to NOT NULL default, but just in case)
UPDATE players SET role = 'player' WHERE role IS NULL;

