-- Revert removal of full-ring maglev zones
-- This migration restores the old full-ring zones (for rollback purposes)
-- Note: In practice, zones are now generated per-chunk, so this is mainly for migration rollback

-- Recreate the old full-ring zones (one per floor)
-- This matches the zones created by 000017_create_default_maglev_zones.up.sql
INSERT INTO zones (name, zone_type, geometry, floor, owner_id, is_system_zone, properties, metadata)
VALUES
  -- Floor -2
  (
    'Maglev Transit Zone (Floor -2)',
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
    -2,
    NULL,
    TRUE,
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
  -- Floor 0
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
  )
ON CONFLICT DO NOTHING;

