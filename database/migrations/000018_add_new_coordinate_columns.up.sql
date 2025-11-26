-- Add new coordinate columns for RingPolar coordinate system
-- This migration adds columns alongside existing legacy columns to allow gradual migration

-- Add RingPolar coordinate columns to players table
ALTER TABLE players
ADD COLUMN IF NOT EXISTS position_theta REAL,  -- Angle around ring in radians
ADD COLUMN IF NOT EXISTS position_r REAL,      -- Radial offset from centerline in meters
ADD COLUMN IF NOT EXISTS position_z REAL;      -- Vertical offset from equatorial plane in meters

-- Add comment explaining the new coordinate system
COMMENT ON COLUMN players.position_theta IS 'Angle around ring in radians (0 at Kongo Hub, wraps at ±π)';
COMMENT ON COLUMN players.position_r IS 'Radial offset from ring centerline in meters';
COMMENT ON COLUMN players.position_z IS 'Vertical offset from equatorial plane in meters';

-- Add RingPolar geometry column to zones table
ALTER TABLE zones
ADD COLUMN IF NOT EXISTS geometry_polar GEOMETRY(POLYGON, 0);

-- Add comment explaining the new geometry column
COMMENT ON COLUMN zones.geometry_polar IS 'Zone geometry in RingPolar coordinate system (theta, r, z)';

-- Add RingPolar geometry column to chunk_data table
ALTER TABLE chunk_data
ADD COLUMN IF NOT EXISTS geometry_polar GEOMETRY(POLYGON, 0);

-- Add comment explaining the new geometry column
COMMENT ON COLUMN chunk_data.geometry_polar IS 'Chunk geometry in RingPolar coordinate system (theta, r, z)';

