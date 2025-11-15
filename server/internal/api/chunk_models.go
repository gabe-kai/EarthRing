package api

import "time"

// ChunkMetadata represents metadata for a chunk.
type ChunkMetadata struct {
	ID           string     `json:"id"`            // Format: "floor_chunk_index" (e.g., "0_12345")
	Floor        int        `json:"floor"`
	ChunkIndex   int        `json:"chunk_index"`  // 0 to 263,999
	Version      int        `json:"version"`
	LastModified time.Time `json:"last_modified"`
	IsDirty      bool       `json:"is_dirty"`     // Needs regeneration
}

