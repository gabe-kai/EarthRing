package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
)

// ChunkHandlers handles chunk-related HTTP requests.
type ChunkHandlers struct {
	db     *sql.DB
	config *config.Config
}

// NewChunkHandlers creates a new instance of ChunkHandlers.
func NewChunkHandlers(db *sql.DB, cfg *config.Config) *ChunkHandlers {
	return &ChunkHandlers{
		db:     db,
		config: cfg,
	}
}

// GetChunkMetadata handles GET /api/chunks/{chunk_id} requests.
// Returns metadata for a specific chunk.
// chunk_id format: "floor_chunk_index" (e.g., "0_12345")
func (h *ChunkHandlers) GetChunkMetadata(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user from context (set by AuthMiddleware)
	_, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Extract chunk ID from URL path
	// Path format: /api/chunks/{chunk_id}
	path := r.URL.Path
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "chunks" {
		respondWithError(w, http.StatusBadRequest, "Invalid path")
		return
	}
	chunkID := parts[2]
	if chunkID == "" {
		respondWithError(w, http.StatusBadRequest, "Chunk ID is required")
		return
	}

	// Parse chunk ID format: "floor_chunk_index"
	chunkParts := strings.Split(chunkID, "_")
	if len(chunkParts) != 2 {
		respondWithError(w, http.StatusBadRequest, "Invalid chunk ID format (expected: floor_chunk_index)")
		return
	}

	var floor, chunkIndex int
	if _, err := fmt.Sscanf(chunkParts[0], "%d", &floor); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid floor in chunk ID")
		return
	}
	if _, err := fmt.Sscanf(chunkParts[1], "%d", &chunkIndex); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid chunk_index in chunk ID")
		return
	}

	// Validate chunk_index range (0 to 263,999)
	if chunkIndex < 0 || chunkIndex > 263999 {
		respondWithError(w, http.StatusBadRequest, "Invalid chunk_index (must be 0-263999)")
		return
	}

	// Query chunk metadata from database
	var metadata ChunkMetadata
	query := `
		SELECT floor, chunk_index, version, last_modified, is_dirty
		FROM chunks
		WHERE floor = $1 AND chunk_index = $2
	`
	err := h.db.QueryRow(query, floor, chunkIndex).Scan(
		&metadata.Floor,
		&metadata.ChunkIndex,
		&metadata.Version,
		&metadata.LastModified,
		&metadata.IsDirty,
	)
	if err == sql.ErrNoRows {
		// Chunk doesn't exist yet - return default metadata
		// This is acceptable for chunks that haven't been generated yet
		metadata = ChunkMetadata{
			ID:           chunkID,
			Floor:        floor,
			ChunkIndex:   chunkIndex,
			Version:      1,
			LastModified: time.Time{}, // Zero time
			IsDirty:      false,
		}
	} else if err != nil {
		log.Printf("Error querying chunk metadata: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve chunk metadata")
		return
	} else {
		// Set the ID
		metadata.ID = chunkID
	}

	// Return JSON response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(metadata)
}

