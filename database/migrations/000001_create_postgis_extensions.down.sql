-- Remove PostGIS extensions
-- Note: This will fail if any tables using PostGIS types exist

DROP EXTENSION IF EXISTS postgis_topology;
DROP EXTENSION IF EXISTS postgis;

