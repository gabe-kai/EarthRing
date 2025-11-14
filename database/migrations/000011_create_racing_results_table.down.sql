-- Drop racing_results table

DROP INDEX IF EXISTS idx_racing_results_time;
DROP INDEX IF EXISTS idx_racing_results_player;
DROP INDEX IF EXISTS idx_racing_results_event;
DROP TABLE IF EXISTS racing_results;

