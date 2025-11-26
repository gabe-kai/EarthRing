-- Rollback: Clear new coordinate columns (set to NULL)

UPDATE players
SET 
    position_theta = NULL,
    position_r = NULL,
    position_z = NULL;

UPDATE zones
SET geometry_polar = NULL;

UPDATE chunk_data
SET geometry_polar = NULL;

