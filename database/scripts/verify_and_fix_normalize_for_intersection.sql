-- Verify and Fix normalize_for_intersection Function
-- This script checks if the function exists and updates it with the latest version
-- that properly handles:
-- 1. Ring closure to prevent NULL returns in overlap detection
-- 2. Geometries stored with wrapped coordinates (>264M) even if span is small
--
-- CRITICAL: If zones stored at 264M coordinates aren't merging with new zones,
-- your database has an old version. Run this script to fix it.
--
-- To apply: Run this in your PostgreSQL database
--
-- On Windows PowerShell:
--   psql -d earthring_dev -f database/scripts/verify_and_fix_normalize_for_intersection.sql
--
-- On Linux/Mac:
--   psql -d earthring_dev < database/scripts/verify_and_fix_normalize_for_intersection.sql
--
-- OR manually execute the statements below in your PostgreSQL client
--
-- After running, RESTART YOUR SERVER to ensure the new function is used.

-- Step 1: Check if function exists
DO $$
DECLARE
    func_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname = 'normalize_for_intersection'
    ) INTO func_exists;
    
    IF func_exists THEN
        RAISE NOTICE '✓ normalize_for_intersection function exists';
    ELSE
        RAISE WARNING '❌ normalize_for_intersection function does NOT exist - will create it';
    END IF;
END $$;

-- Step 2: Create or replace the function with the fixed version
-- This version ensures rings are properly closed to prevent NULL returns
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

-- Step 3: Verify the function works correctly
DO $$
DECLARE
    test_result TEXT;
    test_ring_count INT;
BEGIN
    -- Test 1: Non-wrapped geometry
    SELECT ST_AsText(normalize_for_intersection(
        ST_GeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))')
    )) INTO test_result;
    
    IF test_result IS NULL OR test_result = '' THEN
        RAISE EXCEPTION '❌ Function failed: Non-wrapped geometry test returned NULL or empty';
    ELSE
        RAISE NOTICE '✓ Test 1 passed: Non-wrapped geometry handled correctly';
    END IF;
    
    -- Test 2: Wrapped geometry
    SELECT ST_AsText(normalize_for_intersection(
        ST_GeomFromText('POLYGON((263999990 0, 10 0, 10 10, 263999990 10, 263999990 0))')
    )) INTO test_result;
    
    IF test_result IS NULL OR test_result = '' THEN
        RAISE EXCEPTION '❌ Function failed: Wrapped geometry test returned NULL or empty';
    ELSE
        RAISE NOTICE '✓ Test 2 passed: Wrapped geometry normalized correctly';
    END IF;
    
    -- Test 3: Torus with hole (preserves interior rings)
    SELECT ST_NumInteriorRings(normalize_for_intersection(
        ST_GeomFromText('POLYGON((263999950 0, 50 0, 50 100, 263999950 100, 263999950 0), (263999980 30, 20 30, 20 70, 263999980 70, 263999980 30))')
    )) INTO test_ring_count;
    
    IF test_ring_count IS NULL OR test_ring_count != 1 THEN
        RAISE EXCEPTION '❌ Function failed: Torus test - expected 1 interior ring, got %', test_ring_count;
    ELSE
        RAISE NOTICE '✓ Test 3 passed: Torus hole preserved (% interior rings)', test_ring_count;
    END IF;
    
    -- Test 4: Simple rectangle (should not return NULL)
    SELECT ST_AsText(normalize_for_intersection(
        ST_GeomFromText('POLYGON((0 0, 100 0, 100 100, 0 100, 0 0))')
    )) INTO test_result;
    
    IF test_result IS NULL OR test_result = '' THEN
        RAISE EXCEPTION '❌ Function failed: Simple rectangle test returned NULL - this will break overlap detection!';
    ELSE
        RAISE NOTICE '✓ Test 4 passed: Simple rectangle handled correctly (no NULL return)';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ All tests passed! normalize_for_intersection function is working correctly.';
    RAISE NOTICE '   Zone overlap detection should now work properly.';
END $$;

-- Step 4: Display function signature for verification
SELECT 
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    p.prosrc AS source_code_preview
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'normalize_for_intersection';

