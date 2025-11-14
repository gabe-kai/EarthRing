-- Create chunks table
-- Stores chunk metadata and references to chunk data

CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    floor INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL, -- 0 to 263,999
    version INTEGER DEFAULT 1, -- For versioning/rollbacks
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_dirty BOOLEAN DEFAULT FALSE, -- Needs regeneration
    procedural_seed INTEGER,
    metadata JSONB, -- Chunk-level metadata
    UNIQUE(floor, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_floor_index ON chunks(floor, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_dirty ON chunks(is_dirty);

