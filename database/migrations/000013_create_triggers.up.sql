-- Create database triggers
-- Automatically update timestamps and mark chunks as dirty when structures change

-- Function to update zone updated_at timestamp
CREATE OR REPLACE FUNCTION update_zone_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update zone updated_at on zone updates
DROP TRIGGER IF EXISTS zone_updated_at ON zones;
CREATE TRIGGER zone_updated_at
BEFORE UPDATE ON zones
FOR EACH ROW
EXECUTE FUNCTION update_zone_timestamp();

-- Function to mark chunks as dirty when structures change
CREATE OR REPLACE FUNCTION mark_chunk_dirty()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chunks 
    SET is_dirty = TRUE,
        last_modified = CURRENT_TIMESTAMP
    WHERE floor = NEW.floor
    AND chunk_index = FLOOR(ST_X(NEW.position) / 1000)::INTEGER % 264000;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to mark chunk dirty on structure insert/update
DROP TRIGGER IF EXISTS structure_chunk_dirty ON structures;
CREATE TRIGGER structure_chunk_dirty
AFTER INSERT OR UPDATE ON structures
FOR EACH ROW
EXECUTE FUNCTION mark_chunk_dirty();

