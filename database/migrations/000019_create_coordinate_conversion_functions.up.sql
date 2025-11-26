-- Create PostgreSQL functions for coordinate system conversion
-- These functions convert between legacy (x, y, z) and RingPolar (theta, r, z) coordinate systems

-- Constants for coordinate conversion
DO $$
BEGIN
    -- Ring circumference in meters (264,000 km)
    -- This is used in conversion calculations
    -- Note: We can't create constants in PostgreSQL, so we'll use them inline in functions
END $$;

-- Function: Convert legacy X position to theta (angle in radians)
-- Legacy X=0 corresponds to Kongo Hub (theta=0)
-- Legacy X increases eastward, so theta = (X / RingCircumference) * 2π
CREATE OR REPLACE FUNCTION legacy_x_to_theta(legacy_x REAL)
RETURNS REAL AS $$
DECLARE
    ring_circumference CONSTANT NUMERIC := 264000000.0;
    theta REAL;
    wrapped_x NUMERIC;
BEGIN
    -- Wrap legacy X to [0, RingCircumference) using MOD function with NUMERIC
    wrapped_x := MOD(MOD(legacy_x::NUMERIC, ring_circumference) + ring_circumference, ring_circumference);
    
    -- Convert to theta: theta = (X / C) * 2π, then shift to [-π, π)
    theta := (wrapped_x::REAL / ring_circumference::REAL) * 2 * PI();
    theta := MOD(theta::NUMERIC + PI()::NUMERIC, 2 * PI()::NUMERIC)::REAL - PI();
    
    RETURN theta;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Convert theta (angle in radians) to legacy X position
-- Legacy X = (theta / 2π) * RingCircumference, wrapped to [0, RingCircumference)
CREATE OR REPLACE FUNCTION theta_to_legacy_x(theta REAL)
RETURNS REAL AS $$
DECLARE
    ring_circumference CONSTANT NUMERIC := 264000000.0;
    normalized_theta REAL;
    legacy_x NUMERIC;
BEGIN
    -- Normalize theta to [0, 2π)
    normalized_theta := theta;
    IF normalized_theta < 0 THEN
        normalized_theta := normalized_theta + 2 * PI();
    END IF;
    
    -- Convert to legacy X
    legacy_x := (normalized_theta::NUMERIC / (2 * PI()::NUMERIC)) * ring_circumference;
    legacy_x := MOD(MOD(legacy_x, ring_circumference) + ring_circumference, ring_circumference);
    
    RETURN legacy_x::REAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Convert legacy position (x, y, z) to RingPolar (theta, r, z)
-- Legacy Y (width position) maps to R (radial offset)
-- Legacy Z (floor/level) maps to Z (vertical offset)
CREATE OR REPLACE FUNCTION legacy_to_ring_polar(
    legacy_x REAL,
    legacy_y REAL,
    legacy_z REAL,
    OUT theta REAL,
    OUT r REAL,
    OUT z REAL
)
RETURNS RECORD AS $$
BEGIN
    theta := legacy_x_to_theta(legacy_x);
    r := legacy_y;  -- Legacy Y (width position) maps to R (radial offset)
    z := legacy_z;  -- Legacy Z (floor/level) maps to Z (vertical offset)
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Convert RingPolar (theta, r, z) to legacy position (x, y, z)
CREATE OR REPLACE FUNCTION ring_polar_to_legacy(
    theta REAL,
    r REAL,
    z REAL,
    OUT legacy_x REAL,
    OUT legacy_y REAL,
    OUT legacy_z REAL
)
RETURNS RECORD AS $$
BEGIN
    legacy_x := theta_to_legacy_x(theta);
    legacy_y := r;  -- Legacy Y is the radial offset (R)
    legacy_z := z;  -- Legacy Z is the vertical offset (Z)
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Convert a PostGIS geometry from legacy coordinates to RingPolar
-- This function transforms all coordinate pairs in the geometry
CREATE OR REPLACE FUNCTION legacy_geometry_to_polar(legacy_geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    ring_circumference CONSTANT REAL := 264000000.0;
    transformed_geom GEOMETRY;
BEGIN
    -- For now, we'll use a simple transformation
    -- In practice, this would need to handle each coordinate pair
    -- This is a placeholder - actual implementation would need to:
    -- 1. Extract all coordinate pairs from the geometry
    -- 2. Convert each (x, y) to (theta, r) using legacy_x_to_theta
    -- 3. Reconstruct the geometry with new coordinates
    
    -- For polygons, we need to transform each vertex
    -- This is complex and may require using ST_DumpPoints and ST_MakePolygon
    
    -- Placeholder: return the geometry as-is for now
    -- TODO: Implement full geometry transformation
    RETURN legacy_geom;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add comments to functions
COMMENT ON FUNCTION legacy_x_to_theta(REAL) IS 'Converts legacy X position (0 to 264,000,000) to theta angle in radians';
COMMENT ON FUNCTION theta_to_legacy_x(REAL) IS 'Converts theta angle in radians to legacy X position';
COMMENT ON FUNCTION legacy_to_ring_polar(REAL, REAL, REAL) IS 'Converts legacy position (x, y, z) to RingPolar (theta, r, z)';
COMMENT ON FUNCTION ring_polar_to_legacy(REAL, REAL, REAL) IS 'Converts RingPolar (theta, r, z) to legacy position (x, y, z)';
COMMENT ON FUNCTION legacy_geometry_to_polar(GEOMETRY) IS 'Converts PostGIS geometry from legacy coordinates to RingPolar (placeholder - needs full implementation)';

