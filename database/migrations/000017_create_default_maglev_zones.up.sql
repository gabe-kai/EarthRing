-- Create default maglev restricted zones
-- These zones reserve space for the maglev train and loading/unloading equipment
-- on every floor of the ring

-- REQUIRES: 000003_create_zones_table (zones table must exist)
-- CREATES: 5 default Restricted zones (one for each floor: -2, -1, 0, 1, 2)

-- Maglev zone specifications:
-- - Width: 20m (Y: -10 to +10)
-- - Length: Full ring (X: 0 to 264,000,000)
-- - Type: Restricted (prevents building)
-- - System zone: Yes (protected from player modifications)

-- Delete any existing default maglev zones first (for idempotency)
DELETE FROM zones
WHERE is_system_zone = TRUE
  AND zone_type = 'restricted'
  AND metadata->>'default_zone' = 'true'
  AND metadata->>'maglev_zone' = 'true'
  AND floor IN (-2, -1, 0, 1, 2);

-- Create zone for each floor
INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
VALUES
  -- Floor -2
  (
    'Maglev Transit Zone (Floor -2)',
    'restricted',
    ST_MakePolygon(
      ST_MakeLine(ARRAY[
        ST_MakePoint(0, -10),           -- Bottom-left
        ST_MakePoint(264000000, -10),   -- Bottom-right
        ST_MakePoint(264000000, 10),    -- Top-right
        ST_MakePoint(0, 10),            -- Top-left
        ST_MakePoint(0, -10)            -- Close polygon
      ])
    ),
    -2,
    NULL,  -- System zone, no owner
    TRUE,  -- is_system_zone
    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
    '{"default_zone": true, "maglev_zone": true}'::jsonb
  ),
  -- Floor -1
  (
    'Maglev Transit Zone (Floor -1)',
    'restricted',
    ST_MakePolygon(
      ST_MakeLine(ARRAY[
        ST_MakePoint(0, -10),
        ST_MakePoint(264000000, -10),
        ST_MakePoint(264000000, 10),
        ST_MakePoint(0, 10),
        ST_MakePoint(0, -10)
      ])
    ),
    -1,
    NULL,
    TRUE,
    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
    '{"default_zone": true, "maglev_zone": true}'::jsonb
  ),
  -- Floor 0 (primary floor with maglev rail)
  (
    'Maglev Transit Zone (Floor 0)',
    'restricted',
    ST_MakePolygon(
      ST_MakeLine(ARRAY[
        ST_MakePoint(0, -10),
        ST_MakePoint(264000000, -10),
        ST_MakePoint(264000000, 10),
        ST_MakePoint(0, 10),
        ST_MakePoint(0, -10)
      ])
    ),
    0,
    NULL,
    TRUE,
    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
    '{"default_zone": true, "maglev_zone": true}'::jsonb
  ),
  -- Floor +1
  (
    'Maglev Transit Zone (Floor +1)',
    'restricted',
    ST_MakePolygon(
      ST_MakeLine(ARRAY[
        ST_MakePoint(0, -10),
        ST_MakePoint(264000000, -10),
        ST_MakePoint(264000000, 10),
        ST_MakePoint(0, 10),
        ST_MakePoint(0, -10)
      ])
    ),
    1,
    NULL,
    TRUE,
    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
    '{"default_zone": true, "maglev_zone": true}'::jsonb
  ),
  -- Floor +2
  (
    'Maglev Transit Zone (Floor +2)',
    'restricted',
    ST_MakePolygon(
      ST_MakeLine(ARRAY[
        ST_MakePoint(0, -10),
        ST_MakePoint(264000000, -10),
        ST_MakePoint(264000000, 10),
        ST_MakePoint(0, 10),
        ST_MakePoint(0, -10)
      ])
    ),
    2,
    NULL,
    TRUE,
    '{"purpose": "maglev_transit", "description": "Reserved space for maglev train and loading/unloading equipment"}'::jsonb,
    '{"default_zone": true, "maglev_zone": true}'::jsonb
  );

