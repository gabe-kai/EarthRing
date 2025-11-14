-- Create chunk_data table
-- Stores actual chunk geometry and content. Separated from metadata for performance.

CREATE TABLE IF NOT EXISTS chunk_data (
    chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    geometry GEOMETRY(POLYGON, 0) NOT NULL, -- PostGIS polygon geometry for chunk boundary
    geometry_detail GEOMETRY(MULTIPOLYGON, 0), -- Detailed geometry for complex chunks (optional)
    structure_ids INTEGER[], -- Array of structure IDs in this chunk
    zone_ids INTEGER[], -- Array of zone IDs overlapping this chunk
    npc_data JSONB, -- NPC population and traffic data
    terrain_data JSONB, -- Terrain heightmap, materials, etc.
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunk_data_geometry ON chunk_data USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_chunk_data_geometry_detail ON chunk_data USING GIST(geometry_detail) WHERE geometry_detail IS NOT NULL;

