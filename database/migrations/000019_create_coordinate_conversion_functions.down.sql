-- Rollback: Drop coordinate conversion functions

DROP FUNCTION IF EXISTS legacy_geometry_to_polar(GEOMETRY);
DROP FUNCTION IF EXISTS ring_polar_to_legacy(REAL, REAL, REAL);
DROP FUNCTION IF EXISTS legacy_to_ring_polar(REAL, REAL, REAL);
DROP FUNCTION IF EXISTS theta_to_legacy_x(REAL);
DROP FUNCTION IF EXISTS legacy_x_to_theta(REAL);

