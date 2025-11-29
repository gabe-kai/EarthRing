-- Convert structures.position from PostgreSQL POINT to PostGIS GEOMETRY(POINT, 0)
-- This allows us to use PostGIS functions like ST_X, ST_Y, ST_MakePoint, etc.

-- First, add a temporary column with the new type
ALTER TABLE structures ADD COLUMN position_new GEOMETRY(POINT, 0);

-- Convert existing POINT data to GEOMETRY
-- PostgreSQL POINT type text format is "(x,y)", we need to convert to PostGIS "POINT(x y)" format
-- Extract coordinates using substring and regex, then create geometry with ST_MakePoint
UPDATE structures 
SET position_new = ST_SetSRID(
    ST_MakePoint(
        (regexp_match(position::text, '\(([^,]+),([^)]+)\)'))[1]::float,
        (regexp_match(position::text, '\(([^,]+),([^)]+)\)'))[2]::float
    ),
    0
)
WHERE position IS NOT NULL;

-- Drop the old column
ALTER TABLE structures DROP COLUMN position;

-- Rename the new column to the original name
ALTER TABLE structures RENAME COLUMN position_new TO position;

-- Recreate the GIST index on the new geometry column
DROP INDEX IF EXISTS idx_structures_position;
CREATE INDEX idx_structures_position ON structures USING GIST(position);

-- Add NOT NULL constraint back
ALTER TABLE structures ALTER COLUMN position SET NOT NULL;

