package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
)

// SetupPlayerRoutes registers player management routes.
func SetupPlayerRoutes(mux *http.ServeMux, db *sql.DB, cfg *config.Config) {
	handlers := NewPlayerHandlers(db, cfg)

	// Create auth handlers for middleware
	jwtService := auth.NewJWTService(cfg)
	passwordService := auth.NewPasswordService(cfg)
	authHandlers := auth.NewAuthHandlers(db, jwtService, passwordService)

	// Apply authentication middleware to all player routes
	authMiddleware := authHandlers.AuthMiddleware

	// Apply per-user rate limiting (500 requests per minute per user)
	userRateLimit := UserRateLimitMiddleware(500, 1*time.Minute)

	// Handler that routes based on path
	playerHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/players")
		path = strings.Trim(path, "/")
		parts := strings.Split(path, "/")

		switch {
		case r.Method == "GET" && path == "me":
			handlers.GetCurrentPlayerProfile(w, r)
		case r.Method == "GET" && len(parts) == 1 && parts[0] != "":
			// Extract player_id from path and set it in request context
			// We'll parse it in the handler
			r.URL.Path = "/api/players/" + parts[0]
			handlers.GetPlayerProfile(w, r)
		case r.Method == "PUT" && len(parts) == 2 && parts[1] == "position":
			// Extract player_id from path
			r.URL.Path = "/api/players/" + parts[0] + "/position"
			handlers.UpdatePlayerPosition(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	// Apply middleware chain
	authenticatedHandler := authMiddleware(playerHandler)
	rateLimitedHandler := userRateLimit(authenticatedHandler)

	// Register routes with /api/players prefix
	mux.Handle("/api/players/", rateLimitedHandler)
	mux.Handle("/api/players", rateLimitedHandler) // Handle /api/players without trailing slash
}
