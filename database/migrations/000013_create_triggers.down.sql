-- Drop database triggers and functions

DROP TRIGGER IF EXISTS structure_chunk_dirty ON structures;
DROP FUNCTION IF EXISTS mark_chunk_dirty();
DROP TRIGGER IF EXISTS zone_updated_at ON zones;
DROP FUNCTION IF EXISTS update_zone_timestamp();

