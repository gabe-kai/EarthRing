package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/earthring/server/internal/config"
)

// SetupChunkRoutes registers chunk metadata routes.
func SetupChunkRoutes(mux *http.ServeMux, db *sql.DB, cfg *config.Config) {
	handlers := NewChunkHandlers(db, cfg)
	authMiddleware := setupAuthMiddleware(db, cfg)

	// Apply per-user rate limiting (100 requests per minute per user for chunk requests)
	userRateLimit := UserRateLimitMiddleware(100, 1*time.Minute)

	// Handler that routes based on path and method
	chunkHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/chunks")
		path = strings.Trim(path, "/")

		if r.Method == "GET" && path == "version" {
			// Version endpoint (no auth required)
			handlers.GetChunkVersion(w, r)
		} else if r.Method == "GET" && path == "invalidate-outdated" {
			// Bulk invalidation endpoint
			handlers.InvalidateOutdatedChunks(w, r)
		} else if r.Method == "POST" && path == "batch-regenerate" {
			// Batch regeneration endpoint
			handlers.BatchRegenerateChunks(w, r)
		} else if r.Method == "GET" && path != "" {
			// Extract chunk_id from path
			handlers.GetChunkMetadata(w, r)
		} else if r.Method == "DELETE" && path != "" {
			// Delete chunk
			handlers.DeleteChunk(w, r)
		} else {
			http.NotFound(w, r)
		}
	})

	// Apply middleware chain
	authenticatedHandler := authMiddleware(chunkHandler)
	rateLimitedHandler := userRateLimit(authenticatedHandler)

	// Register routes with /api/chunks prefix
	mux.Handle("/api/chunks/", rateLimitedHandler)
	mux.Handle("/api/chunks", rateLimitedHandler) // Handle /api/chunks without trailing slash
}
