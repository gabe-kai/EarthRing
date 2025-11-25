-- Remove default maglev restricted zones
-- This deletes the default zones created by the up migration

-- Delete zones by matching the metadata that identifies them as default maglev zones
DELETE FROM zones
WHERE is_system_zone = TRUE
  AND zone_type = 'restricted'
  AND metadata->>'default_zone' = 'true'
  AND metadata->>'maglev_zone' = 'true'
  AND floor IN (-2, -1, 0, 1, 2);

