-- Rollback: Remove new coordinate columns

ALTER TABLE players
DROP COLUMN IF EXISTS position_theta,
DROP COLUMN IF EXISTS position_r,
DROP COLUMN IF EXISTS position_z;

ALTER TABLE zones
DROP COLUMN IF EXISTS geometry_polar;

ALTER TABLE chunk_data
DROP COLUMN IF EXISTS geometry_polar;

