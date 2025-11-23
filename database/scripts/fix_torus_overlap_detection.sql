-- Fix for torus overlap detection issue
-- This creates a function that properly normalizes wrapped geometries (including toruses with holes)
-- for intersection checking, preventing non-overlapping zones from incorrectly merging.
--
-- To apply: Run this in your PostgreSQL database
-- psql -d earthring_dev < fix_torus_overlap_detection.sql
--
-- OR manually execute the CREATE FUNCTION statement below in your PostgreSQL client

CREATE OR REPLACE FUNCTION normalize_for_intersection(geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circ CONSTANT NUMERIC := 264000000;
    half_ring CONSTANT NUMERIC := 132000000;
    span NUMERIC;
BEGIN
    -- Skip NULL or empty geometries
    IF geom IS NULL OR ST_IsEmpty(geom) THEN
        RETURN geom;
    END IF;
    
    -- Calculate span
    span := ST_XMax(geom) - ST_XMin(geom);
    
    -- If span <= half_ring, geometry doesn't wrap - return as-is
    IF span <= half_ring THEN
        RETURN geom;
    END IF;
    
    -- Geometry wraps - normalize using ST_DumpRings to preserve holes
    RETURN (
        WITH 
        rings AS (
            SELECT 
                (ST_DumpRings(geom)).path[1] AS ring_index,
                (ST_DumpRings(geom)).geom AS ring_geom
        ),
        shifted_rings AS (
            SELECT 
                ring_index,
                ST_MakeLine(
                    ARRAY(
                        SELECT 
                            ST_MakePoint(
                                CASE 
                                    WHEN ST_X((dp).geom) > half_ring
                                    THEN ST_X((dp).geom) - ring_circ
                                    ELSE ST_X((dp).geom)
                                END,
                                ST_Y((dp).geom)
                            )
                        FROM ST_DumpPoints(ring_geom) AS dp
                        ORDER BY (dp).path[1]
                    )
                ) AS shifted_ring
            FROM rings
        ),
        exterior_ring AS (
            SELECT shifted_ring FROM shifted_rings WHERE ring_index = 0
        ),
        interior_rings_agg AS (
            SELECT ARRAY_AGG(shifted_ring ORDER BY ring_index) AS holes
            FROM shifted_rings WHERE ring_index > 0
        )
        SELECT 
            CASE 
                WHEN EXISTS(SELECT 1 FROM shifted_rings WHERE ring_index > 0) THEN
                    ST_MakePolygon(
                        (SELECT shifted_ring FROM exterior_ring),
                        (SELECT holes FROM interior_rings_agg)
                    )
                ELSE
                    ST_MakePolygon((SELECT shifted_ring FROM exterior_ring))
            END
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Verify the function was created successfully
SELECT 'normalize_for_intersection function created successfully!' AS status;

