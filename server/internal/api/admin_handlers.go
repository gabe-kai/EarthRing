package api

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/database"
)

// AdminHandlers handles admin operations
type AdminHandlers struct {
	db     *sql.DB
	cfg    *config.Config
	zones  *database.ZoneStorage
	chunks *database.ChunkStorage
}

// NewAdminHandlers creates a new AdminHandlers instance
func NewAdminHandlers(db *sql.DB, cfg *config.Config) *AdminHandlers {
	return &AdminHandlers{
		db:     db,
		cfg:    cfg,
		zones:  database.NewZoneStorage(db),
		chunks: database.NewChunkStorage(db),
	}
}

// GetZoneCount handles GET /api/admin/zones/count
func (h *AdminHandlers) GetZoneCount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	count, err := h.zones.CountZones()
	if err != nil {
		log.Printf("Error counting zones: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to count zones")
		return
	}

	response := map[string]interface{}{
		"success": true,
		"count":   count,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode zone count response: %v", err)
	}
}

// ResetAllZones handles DELETE /api/admin/zones/reset?cascade=true|false
// cascade=true: TRUNCATE CASCADE (clean reset, deletes all zones, resets sequence, cascades to related tables)
// cascade=false: DELETE with manual cleanup (preserves related records but clears zone references)
func (h *AdminHandlers) ResetAllZones(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Parse cascade query parameter (default to false for backward compatibility)
	cascade := r.URL.Query().Get("cascade") == "true"

	mode := "preserve related records"
	if cascade {
		mode = "clean reset (CASCADE)"
	}
	log.Printf("Admin: Resetting all zones database (mode: %s)...", mode)

	deletedCount, err := h.zones.DeleteAllZones(cascade)
	if err != nil {
		log.Printf("Error resetting zones: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to reset zones database")
		return
	}

	log.Printf("✓ Successfully deleted %d zones from database (mode: %s)", deletedCount, mode)

	response := map[string]interface{}{
		"success":       true,
		"message":       "All zones deleted successfully",
		"deleted_count": deletedCount,
		"mode":          mode,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode reset zones response: %v", err)
	}
}

// ResetAllChunks handles DELETE /api/admin/chunks/reset
func (h *AdminHandlers) ResetAllChunks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	log.Printf("Admin: Resetting all chunks database...")

	deletedCount, err := h.chunks.DeleteAllChunks()
	if err != nil {
		log.Printf("Error resetting chunks: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to reset chunks database")
		return
	}

	log.Printf("✓ Successfully deleted %d chunks from database", deletedCount)

	response := map[string]interface{}{
		"success":       true,
		"message":       "All chunks deleted successfully. They will be regenerated on next request.",
		"deleted_count": deletedCount,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode reset chunks response: %v", err)
	}
}
