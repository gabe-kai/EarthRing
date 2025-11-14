-- Drop player_actions table

DROP INDEX IF EXISTS idx_player_actions_timestamp;
DROP INDEX IF EXISTS idx_player_actions_type;
DROP INDEX IF EXISTS idx_player_actions_player;
DROP TABLE IF EXISTS player_actions;

