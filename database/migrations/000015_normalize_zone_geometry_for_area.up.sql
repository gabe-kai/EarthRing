-- Create function to normalize zone geometry coordinates before area calculation
-- This fixes the issue where zones crossing the X axis (wrapping around) are calculated incorrectly
--
-- The problem: When a zone wraps around the X axis (e.g., has coordinates near 0 and near 264000000),
-- PostGIS calculates the area as if the polygon spans the entire ring width, giving billions of m²
--
-- The solution: Normalize coordinates so they're contiguous before calculating area.
-- If coordinates span > half the ring (132000000m), shift coordinates that are > half_ring by subtracting ring_circumference.

CREATE OR REPLACE FUNCTION normalize_zone_geometry_for_area(geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circumference CONSTANT NUMERIC := 264000000;
    half_ring CONSTANT NUMERIC := 132000000;
    min_x NUMERIC;
    max_x NUMERIC;
    span NUMERIC;
    geom_type TEXT;
    geom_json JSONB;
    coords JSONB;
    ring JSONB;
    normalized_rings JSONB := '[]'::JSONB;
    point JSONB;
    x NUMERIC;
    y NUMERIC;
    i INTEGER;
    j INTEGER;
    normalized_coords JSONB;
BEGIN
    -- Only process if geometry is valid
    IF geom IS NULL OR ST_IsEmpty(geom) THEN
        RETURN geom;
    END IF;
    
    -- Find min and max X coordinates
    min_x := ST_XMin(geom);
    max_x := ST_XMax(geom);
    span := max_x - min_x;
    
    -- If span <= half ring, geometry is already normalized (doesn't wrap around)
    IF span <= half_ring THEN
        RETURN geom;
    END IF;
    
    -- Geometry wraps around - normalize coordinates
    -- Convert to GeoJSON, normalize X coordinates where X > half_ring, then convert back
    geom_json := ST_AsGeoJSON(geom)::JSONB;
    geom_type := geom_json->>'type';
    
    IF geom_type = 'Polygon' THEN
        -- Process polygon rings (first is outer, rest are holes)
        coords := geom_json->'coordinates';
        FOR i IN 0..jsonb_array_length(coords) - 1 LOOP
            ring := coords->i;
            normalized_coords := '[]'::JSONB;
            
            -- Normalize each point in the ring
            FOR j IN 0..jsonb_array_length(ring) - 1 LOOP
                point := ring->j;
                x := (point->0)::NUMERIC;
                y := (point->1)::NUMERIC;
                
                -- If X > half_ring, shift it by subtracting ring_circumference
                IF x > half_ring THEN
                    x := x - ring_circumference;
                END IF;
                
                -- Build array of [x, y] and add to normalized_coords
                normalized_coords := normalized_coords || jsonb_build_array(jsonb_build_array(x, y));
            END LOOP;
            
            -- normalized_coords is now an array of points [[x,y], [x,y], ...]
            -- Add it as a ring to normalized_rings
            normalized_rings := normalized_rings || jsonb_build_array(normalized_coords);
        END LOOP;
        
        -- Rebuild geometry from normalized coordinates
        geom_json := jsonb_build_object(
            'type', 'Polygon',
            'coordinates', normalized_rings
        );
        
        RETURN ST_SetSRID(ST_GeomFromGeoJSON(geom_json::TEXT), 0);
        
    ELSIF geom_type = 'MultiPolygon' THEN
        -- Process multiple polygons
        coords := geom_json->'coordinates';
        normalized_rings := '[]'::JSONB;
        
        -- For each polygon
        FOR i IN 0..jsonb_array_length(coords) - 1 LOOP
            ring := coords->i; -- This is actually a polygon (array of rings)
            normalized_coords := '[]'::JSONB;
            
            -- For each ring in the polygon
            FOR j IN 0..jsonb_array_length(ring) - 1 LOOP
                DECLARE
                    ring_points JSONB := ring->j;
                    normalized_ring_points JSONB := '[]'::JSONB;
                    k INTEGER;
                    point_x NUMERIC;
                    point_y NUMERIC;
                    point_coord JSONB;
                BEGIN
                    -- Normalize each point in the ring
                    FOR k IN 0..jsonb_array_length(ring_points) - 1 LOOP
                        point_coord := ring_points->k;
                        point_x := (point_coord->0)::NUMERIC;
                        point_y := (point_coord->1)::NUMERIC;
                        
                        -- If X > half_ring, shift it by subtracting ring_circumference
                        IF point_x > half_ring THEN
                            point_x := point_x - ring_circumference;
                        END IF;
                        
                        normalized_ring_points := normalized_ring_points || jsonb_build_array(point_x, point_y);
                    END LOOP;
                    
                    normalized_coords := normalized_coords || jsonb_build_array(normalized_ring_points);
                END;
            END LOOP;
            
            normalized_rings := normalized_rings || jsonb_build_array(normalized_coords);
        END LOOP;
        
        -- Rebuild geometry from normalized coordinates
        geom_json := jsonb_build_object(
            'type', 'MultiPolygon',
            'coordinates', normalized_rings
        );
        
        RETURN ST_SetSRID(ST_GeomFromGeoJSON(geom_json::TEXT), 0);
        
    ELSE
        -- Unsupported geometry type, return original
        RETURN geom;
    END IF;
    
END;
$$ LANGUAGE plpgsql IMMUTABLE;

