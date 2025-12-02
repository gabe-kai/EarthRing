package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/database"
	"github.com/earthring/server/internal/procedural"
	"github.com/earthring/server/internal/ringmap"
)

// CurrentGeometryVersion must match CURRENT_GEOMETRY_VERSION in procedural/generation.py
// Version history:
//
//	1: Initial rectangular geometry (4 vertices, 2 faces)
//	2: Smooth curved geometry with 50m sample intervals (42 vertices, 40 faces)
//	3: Phase 2 - Added building generation (grid-based city generation with buildings)
//	4: Phase 2 - Added building variability (discrete floor heights, building subtypes, varied footprints)
//	5: Phase 2 - Fixed building heights to be 5, 10, 15, or 20m (within single 20m level)
const CurrentGeometryVersion = 5

// ChunkHandlers handles chunk-related HTTP requests.
type ChunkHandlers struct {
	db               *sql.DB
	config           *config.Config
	proceduralClient *procedural.ProceduralClient
}

// NewChunkHandlers creates a new instance of ChunkHandlers.
func NewChunkHandlers(db *sql.DB, cfg *config.Config) *ChunkHandlers {
	return &ChunkHandlers{
		db:               db,
		config:           cfg,
		proceduralClient: procedural.NewProceduralClient(cfg),
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

	floor, err := strconv.Atoi(chunkParts[0])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid floor in chunk ID")
		return
	}
	var chunkIndex int
	chunkIndex, err = strconv.Atoi(chunkParts[1])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid chunk_index in chunk ID")
		return
	}

	// Wrap chunk index to valid range (handles wrapping around ring)
	wrappedChunkIndex, err := ringmap.ValidateChunkIndex(chunkIndex)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, fmt.Sprintf("Invalid chunk_index: %v", err))
		return
	}
	chunkIndex = wrappedChunkIndex

	// Query chunk metadata from database
	var metadata ChunkMetadata
	query := `
		SELECT floor, chunk_index, version, last_modified, is_dirty
		FROM chunks
		WHERE floor = $1 AND chunk_index = $2
	`
	err = h.db.QueryRow(query, floor, chunkIndex).Scan(
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
	if err := json.NewEncoder(w).Encode(metadata); err != nil {
		log.Printf("Failed to encode chunk metadata: %v", err)
	}
}

// DeleteChunk handles DELETE /api/chunks/{chunk_id} requests.
// Deletes a chunk and its associated data from the database.
// This will cause the procedural service to regenerate the chunk on next request.
func (h *ChunkHandlers) DeleteChunk(w http.ResponseWriter, r *http.Request) {
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

	floor, err := strconv.Atoi(chunkParts[0])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid floor in chunk ID")
		return
	}
	var chunkIndex int
	chunkIndex, err = strconv.Atoi(chunkParts[1])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid chunk_index in chunk ID")
		return
	}

	// Wrap chunk index to valid range (handles wrapping around ring)
	wrappedChunkIndex, err := ringmap.ValidateChunkIndex(chunkIndex)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, fmt.Sprintf("Invalid chunk_index: %v", err))
		return
	}
	chunkIndex = wrappedChunkIndex

	// Delete chunk from database
	storage := database.NewChunkStorage(h.db)
	log.Printf("Deleting chunk %s (floor=%d, chunk_index=%d)", chunkID, floor, chunkIndex)
	err = storage.DeleteChunk(floor, chunkIndex)
	if err != nil {
		// Check if chunk doesn't exist
		if strings.Contains(err.Error(), "chunk not found") {
			log.Printf("Chunk %s not found in database", chunkID)
			respondWithError(w, http.StatusNotFound, err.Error())
			return
		}
		log.Printf("Error deleting chunk %s: %v", chunkID, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to delete chunk")
		return
	}

	log.Printf("✓ Successfully deleted chunk %s (floor=%d, chunk_index=%d) - will be regenerated on next request", chunkID, floor, chunkIndex)

	// Return success response
	response := map[string]interface{}{
		"success":  true,
		"message":  fmt.Sprintf("Chunk %s deleted successfully. It will be regenerated on next request.", chunkID),
		"chunk_id": chunkID,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode delete chunk response: %v", err)
	}
}

// GetChunkVersion returns the current geometry version
func (h *ChunkHandlers) GetChunkVersion(w http.ResponseWriter, r *http.Request) {
	// No authentication required for version endpoint (public info)
	response := map[string]interface{}{
		"current_version": CurrentGeometryVersion,
		"version_history": []map[string]interface{}{
			{
				"version":         1,
				"description":     "Initial rectangular geometry (4 vertices, 2 faces)",
				"sample_interval": nil,
			},
			{
				"version":         2,
				"description":     "Smooth curved geometry with 50m sample intervals (42 vertices, 40 faces)",
				"sample_interval": 50.0,
			},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode version response: %v", err)
	}
}

// InvalidateOutdatedChunks invalidates all chunks with version < CurrentGeometryVersion
// This forces regeneration of outdated chunks on next request
func (h *ChunkHandlers) InvalidateOutdatedChunks(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user from context (set by AuthMiddleware)
	_, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Get optional query parameters for filtering
	floorStr := r.URL.Query().Get("floor")
	chunkIndexStartStr := r.URL.Query().Get("chunk_index_start")
	chunkIndexEndStr := r.URL.Query().Get("chunk_index_end")

	storage := database.NewChunkStorage(h.db)

	// Build query to find outdated chunks
	query := `
		SELECT floor, chunk_index, id
		FROM chunks
		WHERE version < $1
	`
	args := []interface{}{CurrentGeometryVersion}
	argIndex := 2

	if floorStr != "" {
		floor, err := strconv.Atoi(floorStr)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid floor parameter")
			return
		}
		query += fmt.Sprintf(" AND floor = $%d", argIndex)
		args = append(args, floor)
		argIndex++
	}

	if chunkIndexStartStr != "" {
		start, err := strconv.Atoi(chunkIndexStartStr)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid chunk_index_start parameter")
			return
		}
		query += fmt.Sprintf(" AND chunk_index >= $%d", argIndex)
		args = append(args, start)
		argIndex++
	}

	if chunkIndexEndStr != "" {
		end, err := strconv.Atoi(chunkIndexEndStr)
		if err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid chunk_index_end parameter")
			return
		}
		query += fmt.Sprintf(" AND chunk_index <= $%d", argIndex)
		args = append(args, end)
		argIndex++
	}

	// Execute query (argIndex was incremented above if needed, read it to avoid ineffassign warning)
	_ = argIndex
	rows, err := h.db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying outdated chunks: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to query outdated chunks")
		return
	}
	defer func() {
		if err := rows.Close(); err != nil {
			log.Printf("Error closing rows: %v", err)
		}
	}()

	var deletedCount int
	var failedCount int
	var chunks []map[string]interface{}

	for rows.Next() {
		var floor, chunkIndex int
		var chunkID int64
		if err := rows.Scan(&floor, &chunkIndex, &chunkID); err != nil {
			log.Printf("Error scanning chunk row: %v", err)
			failedCount++
			continue
		}

		// Delete the chunk
		if err := storage.DeleteChunk(floor, chunkIndex); err != nil {
			log.Printf("Failed to delete outdated chunk %d_%d: %v", floor, chunkIndex, err)
			failedCount++
			continue
		}

		deletedCount++
		chunks = append(chunks, map[string]interface{}{
			"chunk_id":    fmt.Sprintf("%d_%d", floor, chunkIndex),
			"floor":       floor,
			"chunk_index": chunkIndex,
		})
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating chunk rows: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to process chunks")
		return
	}

	log.Printf("✓ Invalidated %d outdated chunks (failed: %d)", deletedCount, failedCount)

	// Return success response
	response := map[string]interface{}{
		"success":       true,
		"message":       fmt.Sprintf("Invalidated %d outdated chunks. They will be regenerated on next request.", deletedCount),
		"deleted_count": deletedCount,
		"failed_count":  failedCount,
		"chunks":        chunks,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode invalidation response: %v", err)
	}
}

// BatchRegenerateChunksRequest represents a request to batch regenerate chunks
type BatchRegenerateChunksRequest struct {
	ChunkIDs        []string `json:"chunk_ids,omitempty"`         // Specific chunk IDs to regenerate
	Floor           *int     `json:"floor,omitempty"`             // Filter by floor
	ChunkIndexStart *int     `json:"chunk_index_start,omitempty"` // Start of chunk index range
	ChunkIndexEnd   *int     `json:"chunk_index_end,omitempty"`   // End of chunk index range
	LODLevel        string   `json:"lod_level,omitempty"`         // LOD level for regeneration
	MaxChunks       int      `json:"max_chunks,omitempty"`        // Maximum chunks to process (default: 100)
}

// BatchRegenerateChunks regenerates multiple chunks in the background
// This endpoint accepts chunk IDs or filters and regenerates them asynchronously
func (h *ChunkHandlers) BatchRegenerateChunks(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user from context (set by AuthMiddleware)
	_, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Parse request body
	var req BatchRegenerateChunksRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Set defaults
	if req.LODLevel == "" {
		req.LODLevel = "medium"
	}
	if req.MaxChunks <= 0 {
		req.MaxChunks = 100 // Default limit
	}
	if req.MaxChunks > 1000 {
		req.MaxChunks = 1000 // Hard limit
	}

	// Validate LOD level
	if req.LODLevel != "low" && req.LODLevel != "medium" && req.LODLevel != "high" {
		respondWithError(w, http.StatusBadRequest, "Invalid LOD level (must be 'low', 'medium', or 'high')")
		return
	}

	storage := database.NewChunkStorage(h.db)
	var chunksToRegenerate []map[string]int // []{floor, chunk_index}

	// Build list of chunks to regenerate
	if len(req.ChunkIDs) > 0 {
		// Process specific chunk IDs
		for _, chunkID := range req.ChunkIDs {
			parts := strings.Split(chunkID, "_")
			if len(parts) != 2 {
				continue
			}
			floor, err1 := strconv.Atoi(parts[0])
			chunkIndex, err2 := strconv.Atoi(parts[1])
			if err1 != nil || err2 != nil {
				continue
			}
			chunksToRegenerate = append(chunksToRegenerate, map[string]int{
				"floor":       floor,
				"chunk_index": chunkIndex,
			})
		}
	} else {
		// Build query based on filters
		query := `SELECT floor, chunk_index FROM chunks WHERE 1=1`
		args := []interface{}{}
		argIndex := 1

		if req.Floor != nil {
			query += fmt.Sprintf(" AND floor = $%d", argIndex)
			args = append(args, *req.Floor)
			argIndex++
		}

		if req.ChunkIndexStart != nil {
			query += fmt.Sprintf(" AND chunk_index >= $%d", argIndex)
			args = append(args, *req.ChunkIndexStart)
			argIndex++
		}

		if req.ChunkIndexEnd != nil {
			query += fmt.Sprintf(" AND chunk_index <= $%d", argIndex)
			args = append(args, *req.ChunkIndexEnd)
			argIndex++
		}

		// Use current argIndex for LIMIT placeholder (read argIndex to avoid ineffassign warning)
		limitParamIndex := argIndex
		query += fmt.Sprintf(" LIMIT $%d", limitParamIndex)
		args = append(args, req.MaxChunks)

		rows, err := h.db.Query(query, args...)
		if err != nil {
			log.Printf("Error querying chunks for batch regeneration: %v", err)
			respondWithError(w, http.StatusInternalServerError, "Failed to query chunks")
			return
		}
		defer func() {
			if err := rows.Close(); err != nil {
				log.Printf("Error closing rows: %v", err)
			}
		}()

		for rows.Next() {
			var floor, chunkIndex int
			if err := rows.Scan(&floor, &chunkIndex); err != nil {
				continue
			}
			chunksToRegenerate = append(chunksToRegenerate, map[string]int{
				"floor":       floor,
				"chunk_index": chunkIndex,
			})
		}
		if err := rows.Err(); err != nil {
			log.Printf("Error iterating chunk rows: %v", err)
			respondWithError(w, http.StatusInternalServerError, "Failed to process chunks")
			return
		}
	}

	if len(chunksToRegenerate) == 0 {
		respondWithError(w, http.StatusBadRequest, "No chunks found to regenerate")
		return
	}

	// Limit to max chunks
	if len(chunksToRegenerate) > req.MaxChunks {
		chunksToRegenerate = chunksToRegenerate[:req.MaxChunks]
	}

	// Start background regeneration (non-blocking)
	// In a production system, you'd use a proper job queue, but for now we'll do it in a goroutine
	go func() {
		regeneratedCount := 0
		failedCount := 0
		for _, chunk := range chunksToRegenerate {
			floor := chunk["floor"]
			chunkIndex := chunk["chunk_index"]

			// Delete chunk to force regeneration
			if err := storage.DeleteChunk(floor, chunkIndex); err != nil {
				log.Printf("Failed to delete chunk %d_%d for regeneration: %v", floor, chunkIndex, err)
				failedCount++
				continue
			}

			// Generate and store the regenerated chunk
			genResponse, err := h.proceduralClient.GenerateChunk(floor, chunkIndex, req.LODLevel, nil)
			if err != nil {
				log.Printf("Failed to regenerate chunk %d_%d: %v", floor, chunkIndex, err)
				failedCount++
				continue
			}

			if genResponse == nil || !genResponse.Success {
				log.Printf("Chunk generation failed for %d_%d", floor, chunkIndex)
				failedCount++
				continue
			}

			// Store the regenerated chunk
			if err := storage.StoreChunk(floor, chunkIndex, genResponse, nil); err != nil {
				log.Printf("Failed to store regenerated chunk %d_%d: %v", floor, chunkIndex, err)
				failedCount++
				continue
			}

			regeneratedCount++
			if regeneratedCount%10 == 0 {
				log.Printf("Batch regeneration progress: %d/%d chunks regenerated", regeneratedCount, len(chunksToRegenerate))
			}
		}
		log.Printf("✓ Batch regeneration complete: %d regenerated, %d failed", regeneratedCount, failedCount)
	}()

	// Return immediate response
	response := map[string]interface{}{
		"success":     true,
		"message":     fmt.Sprintf("Started batch regeneration of %d chunks in background", len(chunksToRegenerate)),
		"chunk_count": len(chunksToRegenerate),
		"lod_level":   req.LODLevel,
		"status":      "processing",
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted) // 202 Accepted for async operations
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode batch regeneration response: %v", err)
	}
}
