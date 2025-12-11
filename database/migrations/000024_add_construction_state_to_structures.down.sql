-- Revert construction state fields from structures table

-- Drop index
DROP INDEX IF EXISTS idx_structures_construction_state;

-- Drop columns
ALTER TABLE structures DROP COLUMN IF EXISTS construction_duration_seconds;
ALTER TABLE structures DROP COLUMN IF EXISTS construction_completed_at;
ALTER TABLE structures DROP COLUMN IF EXISTS construction_started_at;
ALTER TABLE structures DROP COLUMN IF EXISTS construction_state;

