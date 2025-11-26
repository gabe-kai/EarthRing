-- Rollback: Drop new geometry indexes

DROP INDEX IF EXISTS idx_chunk_data_geometry_polar;
DROP INDEX IF EXISTS idx_zones_geometry_polar;

