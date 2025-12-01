package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/earthring/server/internal/config"
)

// SetupZoneRoutes registers zone management routes.
func SetupZoneRoutes(mux *http.ServeMux, db *sql.DB, cfg *config.Config) {
	handlers := NewZoneHandlers(db, cfg)
	authMiddleware := setupAuthMiddleware(db, cfg)
	userRateLimit := UserRateLimitMiddleware(200, 1*time.Minute)

	zoneHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/zones")
		path = strings.Trim(path, "/")

		switch {
		case r.Method == http.MethodPost && path == "":
			handlers.CreateZone(w, r)
		case r.Method == http.MethodGet && path == "area":
			handlers.ListZonesByArea(w, r)
		case r.Method == http.MethodGet && strings.HasPrefix(path, "owner/"):
			handlers.ListZonesByOwner(w, r)
		case r.Method == http.MethodGet && path != "":
			handlers.GetZone(w, r)
		case r.Method == http.MethodPut && path != "":
			handlers.UpdateZone(w, r)
		case r.Method == http.MethodDelete && path != "":
			handlers.DeleteZone(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	authenticated := authMiddleware(zoneHandler)
	rateLimited := userRateLimit(authenticated)

	mux.Handle("/api/zones/", rateLimited)
	mux.Handle("/api/zones", rateLimited)
}
