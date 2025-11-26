-- Create spatial indexes on new RingPolar geometry columns
-- These indexes enable efficient spatial queries using the new coordinate system

-- Create index on zones.geometry_polar
CREATE INDEX IF NOT EXISTS idx_zones_geometry_polar 
ON zones USING GIST(geometry_polar)
WHERE geometry_polar IS NOT NULL;

-- Create index on chunk_data.geometry_polar
CREATE INDEX IF NOT EXISTS idx_chunk_data_geometry_polar 
ON chunk_data USING GIST(geometry_polar)
WHERE geometry_polar IS NOT NULL;

-- Add comments to indexes
COMMENT ON INDEX idx_zones_geometry_polar IS 'Spatial index on zones geometry in RingPolar coordinate system';
COMMENT ON INDEX idx_chunk_data_geometry_polar IS 'Spatial index on chunk_data geometry in RingPolar coordinate system';

