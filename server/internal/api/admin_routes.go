package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
)

// SetupAdminRoutes registers admin management routes.
func SetupAdminRoutes(mux *http.ServeMux, db *sql.DB, cfg *config.Config) {
	handlers := NewAdminHandlers(db, cfg)

	jwtService := auth.NewJWTService(cfg)
	passwordService := auth.NewPasswordService(cfg)
	authHandlers := auth.NewAuthHandlers(db, jwtService, passwordService)

	authMiddleware := authHandlers.AuthMiddleware
	userRateLimit := UserRateLimitMiddleware(10, 1*time.Minute) // Lower rate limit for admin operations

	adminHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/admin")
		path = strings.Trim(path, "/")

		switch {
		case r.Method == http.MethodGet && path == "zones/count":
			handlers.GetZoneCount(w, r)
		case r.Method == http.MethodDelete && path == "zones/reset":
			handlers.ResetAllZones(w, r)
		case r.Method == http.MethodDelete && path == "chunks/reset":
			handlers.ResetAllChunks(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	authenticated := authMiddleware(adminHandler)
	rateLimited := userRateLimit(authenticated)

	mux.Handle("/api/admin/", rateLimited)
	mux.Handle("/api/admin", rateLimited)
}
