-- Remove old full-ring maglev zones
-- These zones are being replaced by per-chunk restricted zones
-- that are generated automatically when chunks are created

-- Delete the old full-ring maglev zones (one per floor)
DELETE FROM zones
WHERE is_system_zone = TRUE
  AND zone_type = 'restricted'
  AND metadata->>'default_zone' = 'true'
  AND metadata->>'maglev_zone' = 'true'
  AND metadata->>'chunk_index' IS NULL  -- Only delete full-ring zones (no chunk_index)
  AND floor IN (-2, -1, 0, 1, 2);

