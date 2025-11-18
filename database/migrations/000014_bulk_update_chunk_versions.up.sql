-- Migration: Bulk update chunk versions
-- This migration provides a function to bulk update chunk versions without deletion
-- Useful for version migrations when you want to mark chunks as outdated

-- Function to update chunk versions in bulk
CREATE OR REPLACE FUNCTION update_chunk_versions(
    target_version INTEGER,
    floor_filter INTEGER DEFAULT NULL,
    chunk_index_start INTEGER DEFAULT NULL,
    chunk_index_end INTEGER DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE chunks
    SET version = target_version,
        last_modified = CURRENT_TIMESTAMP,
        is_dirty = TRUE
    WHERE version < target_version
        AND (floor_filter IS NULL OR floor = floor_filter)
        AND (chunk_index_start IS NULL OR chunk_index >= chunk_index_start)
        AND (chunk_index_end IS NULL OR chunk_index <= chunk_index_end);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT update_chunk_versions(2); -- Update all chunks with version < 2 to version 2
-- SELECT update_chunk_versions(2, 0); -- Update all chunks on floor 0
-- SELECT update_chunk_versions(2, 0, 0, 100); -- Update chunks 0-100 on floor 0

