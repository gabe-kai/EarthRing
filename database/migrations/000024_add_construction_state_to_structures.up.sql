-- Add construction state fields to structures table
-- This enables client-side animation of building construction and demolition

-- Add construction state column (pending, constructing, completed, demolishing, demolished)
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_state VARCHAR(20) DEFAULT 'completed';

-- Add construction start time
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_started_at TIMESTAMP;

-- Add construction completion time (calculated from started_at + duration)
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_completed_at TIMESTAMP;

-- Add construction duration in seconds (default: 5 minutes = 300 seconds for buildings)
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_duration_seconds INTEGER DEFAULT 300;

-- Add index on construction_state for efficient queries
CREATE INDEX IF NOT EXISTS idx_structures_construction_state ON structures(construction_state);

-- Update existing structures to have 'completed' state and set timestamps
UPDATE structures 
SET 
  construction_state = 'completed',
  construction_started_at = created_at,
  construction_completed_at = created_at,
  construction_duration_seconds = 300
WHERE construction_state IS NULL OR construction_state = 'completed';

