-- Remove role column from players table

DROP INDEX IF EXISTS idx_players_role;
ALTER TABLE players DROP COLUMN IF EXISTS role;

