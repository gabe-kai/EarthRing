package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/earthring/server/internal/config"
)

// SetupStructureRoutes registers structure management routes.
func SetupStructureRoutes(mux *http.ServeMux, db *sql.DB, cfg *config.Config) {
	handlers := NewStructureHandlers(db, cfg)
	authMiddleware := setupAuthMiddleware(db, cfg)
	userRateLimit := UserRateLimitMiddleware(200, 1*time.Minute)

	structureHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/structures")
		path = strings.Trim(path, "/")

		switch {
		case r.Method == http.MethodPost && path == "":
			handlers.CreateStructure(w, r)
		case r.Method == http.MethodPost && path == "regenerate":
			handlers.CompleteRegeneration(w, r)
		case r.Method == http.MethodGet && path == "area":
			handlers.ListStructuresByArea(w, r)
		case r.Method == http.MethodGet && strings.HasPrefix(path, "owner/"):
			handlers.ListStructuresByOwner(w, r)
		case r.Method == http.MethodGet && path != "":
			handlers.GetStructure(w, r)
		case r.Method == http.MethodPut && path != "":
			handlers.UpdateStructure(w, r)
		case r.Method == http.MethodDelete && path == "all":
			handlers.DeleteAllStructures(w, r)
		case r.Method == http.MethodDelete && path == "all/procedural":
			handlers.DeleteAllProceduralStructures(w, r)
		case r.Method == http.MethodDelete && path != "":
			handlers.DeleteStructure(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	authenticated := authMiddleware(structureHandler)
	rateLimited := userRateLimit(authenticated)

	mux.Handle("/api/structures/", rateLimited)
	mux.Handle("/api/structures", rateLimited)
}
