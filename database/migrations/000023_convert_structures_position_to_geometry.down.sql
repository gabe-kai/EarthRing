-- Revert structures.position from PostGIS GEOMETRY(POINT, 0) back to PostgreSQL POINT

-- First, add a temporary column with the old type
ALTER TABLE structures ADD COLUMN position_old POINT;

-- Convert existing GEOMETRY data back to POINT
-- PostGIS POINT to PostgreSQL POINT: use ST_X and ST_Y
UPDATE structures 
SET position_old = POINT(
    ST_X(position)::float,
    ST_Y(position)::float
)
WHERE position IS NOT NULL;

-- Drop the old column
ALTER TABLE structures DROP COLUMN position;

-- Rename the new column to the original name
ALTER TABLE structures RENAME COLUMN position_old TO position;

-- Recreate the GIST index on the POINT column
DROP INDEX IF EXISTS idx_structures_position;
CREATE INDEX idx_structures_position ON structures USING GIST(position);

-- Add NOT NULL constraint back
ALTER TABLE structures ALTER COLUMN position SET NOT NULL;

