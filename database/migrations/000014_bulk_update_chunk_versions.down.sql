-- Rollback: Remove bulk update function
DROP FUNCTION IF EXISTS update_chunk_versions(INTEGER, INTEGER, INTEGER, INTEGER);

