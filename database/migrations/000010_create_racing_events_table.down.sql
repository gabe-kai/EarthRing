-- Drop racing_events table

DROP INDEX IF EXISTS idx_racing_status;
DROP INDEX IF EXISTS idx_racing_creator;
DROP INDEX IF EXISTS idx_racing_start_point;
DROP INDEX IF EXISTS idx_racing_route;
DROP TABLE IF EXISTS racing_events;

