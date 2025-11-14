-- Drop npc_traffic table

DROP INDEX IF EXISTS idx_npc_traffic_frequency;
DROP INDEX IF EXISTS idx_npc_traffic_floor;
DROP INDEX IF EXISTS idx_npc_traffic_path;
DROP TABLE IF EXISTS npc_traffic;

