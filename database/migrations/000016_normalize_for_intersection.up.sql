-- Create function to normalize wrapped geometries for intersection checking
-- This preserves interior rings (holes) unlike normalize_zone_geometry_for_area
CREATE OR REPLACE FUNCTION normalize_for_intersection(geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circ CONSTANT NUMERIC := 264000000;
    half_ring CONSTANT NUMERIC := 132000000;
    span NUMERIC;
    max_x NUMERIC;
BEGIN
    -- Skip NULL or empty geometries
    IF geom IS NULL OR ST_IsEmpty(geom) THEN
        RETURN geom;
    END IF;
    
    -- Calculate span and max X coordinate
    span := ST_XMax(geom) - ST_XMin(geom);
    max_x := ST_XMax(geom);
    
    -- Normalize if:
    -- 1. Span > half_ring (definitely wraps), OR
    -- 2. Max X > half_ring (stored with wrapped coordinates, e.g., from a merge)
    -- This handles merged geometries that are stored with wrapped coordinates like 264000024
    -- After merging, geometries may be stored with coordinates > half_ring even if span is small
    -- We need to normalize these to negative coordinates for proper intersection checking
    IF span > half_ring OR max_x > half_ring THEN
        -- Continue to normalization logic below
    ELSE
        -- Not wrapped - return as-is
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
                -- Ensure ring is closed by adding first point at end if not already closed
                -- ST_DumpRings returns closed rings, but ST_DumpPoints may not include duplicate closing point
                ST_AddPoint(
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
                    ),
                    -- Add first point at end to ensure closure
                    (SELECT 
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
                        LIMIT 1
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
                    -- Validate before creating polygon with holes
                    CASE
                        WHEN (SELECT shifted_ring FROM exterior_ring) IS NULL THEN NULL
                        WHEN NOT ST_IsClosed((SELECT shifted_ring FROM exterior_ring)) THEN NULL
                        ELSE
                            ST_MakePolygon(
                                (SELECT shifted_ring FROM exterior_ring),
                                (SELECT holes FROM interior_rings_agg)
                            )
                    END
                ELSE
                    -- Validate before creating simple polygon
                    CASE
                        WHEN (SELECT shifted_ring FROM exterior_ring) IS NULL THEN NULL
                        WHEN NOT ST_IsClosed((SELECT shifted_ring FROM exterior_ring)) THEN NULL
                        ELSE
                            ST_MakePolygon((SELECT shifted_ring FROM exterior_ring))
                    END
            END
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

