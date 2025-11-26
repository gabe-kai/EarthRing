-- Migrate existing data from legacy coordinates to RingPolar coordinates
-- This migration populates the new coordinate columns from existing data

-- Migrate player positions
UPDATE players
SET 
    position_theta = legacy_x_to_theta(ST_X(current_position::geometry)::REAL),
    position_r = ST_Y(current_position::geometry)::REAL,  -- Legacy Y maps to R
    position_z = current_floor::REAL                  -- Legacy Z (floor) maps to Z
WHERE current_position IS NOT NULL;

-- Note: Zone and chunk geometry migration is more complex and requires
-- transforming each vertex of the polygon. This is a placeholder that
-- will need to be implemented based on the actual geometry structure.
-- 
-- For zones, we would need to:
-- 1. Extract all points from the geometry using ST_DumpPoints
-- 2. Convert each point's (x, y) to (theta, r) using legacy_x_to_theta
-- 3. Reconstruct the polygon using ST_MakePolygon
--
-- This is complex and may require a PL/pgSQL function or application-level migration.
-- For now, we'll leave geometry_polar columns NULL and populate them in a future migration
-- or through application-level conversion.

-- TODO: Implement full geometry migration for zones and chunks
-- This may require:
-- 1. A more sophisticated geometry transformation function
-- 2. Application-level migration script
-- 3. Or a combination of both

-- Log migration status
DO $$
DECLARE
    players_migrated INTEGER;
    players_total INTEGER;
BEGIN
    SELECT COUNT(*) INTO players_total FROM players WHERE current_position IS NOT NULL;
    SELECT COUNT(*) INTO players_migrated FROM players 
    WHERE current_position IS NOT NULL 
    AND position_theta IS NOT NULL 
    AND position_r IS NOT NULL 
    AND position_z IS NOT NULL;
    
    RAISE NOTICE 'Migrated % out of % player positions', players_migrated, players_total;
END $$;

