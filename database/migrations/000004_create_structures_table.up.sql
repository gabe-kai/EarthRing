-- Create structures table
-- Stores player-placed and procedural structures (buildings, objects, etc.)

CREATE TABLE IF NOT EXISTS structures (
    id SERIAL PRIMARY KEY,
    structure_type VARCHAR(50) NOT NULL, -- 'building', 'road', 'decoration', etc.
    position POINT NOT NULL, -- (ring_position, width_position)
    floor INTEGER DEFAULT 0 NOT NULL,
    rotation REAL DEFAULT 0, -- Rotation in degrees
    scale REAL DEFAULT 1.0,
    owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
    is_procedural BOOLEAN DEFAULT FALSE,
    procedural_seed INTEGER, -- Seed for procedural generation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    properties JSONB, -- Structure-specific data (height, materials, etc.)
    model_data JSONB -- 3D model reference or data
);

CREATE INDEX IF NOT EXISTS idx_structures_position ON structures USING GIST(position);
CREATE INDEX IF NOT EXISTS idx_structures_owner ON structures(owner_id);
CREATE INDEX IF NOT EXISTS idx_structures_zone ON structures(zone_id);
CREATE INDEX IF NOT EXISTS idx_structures_floor ON structures(floor);
CREATE INDEX IF NOT EXISTS idx_structures_type ON structures(structure_type);

