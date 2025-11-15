package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
)

// SetupAuthRoutes sets up authentication routes with rate limiting
func SetupAuthRoutes(mux *http.ServeMux, db *sql.DB, cfg *config.Config) {
	// Create services
	jwtService := auth.NewJWTService(cfg)
	passwordService := auth.NewPasswordService(cfg)
	authHandlers := auth.NewAuthHandlers(db, jwtService, passwordService)

	// Rate limit configuration for auth endpoints
	// 5 requests per minute per IP for authentication endpoints
	authRateLimit := RateLimitMiddleware(5, 1*time.Minute)

	// Register routes with rate limiting
	mux.Handle("/api/auth/register", authRateLimit(http.HandlerFunc(authHandlers.Register)))
	mux.Handle("/api/auth/login", authRateLimit(http.HandlerFunc(authHandlers.Login)))
	mux.Handle("/api/auth/refresh", authRateLimit(http.HandlerFunc(authHandlers.Refresh)))
	mux.Handle("/api/auth/logout", authRateLimit(http.HandlerFunc(authHandlers.Logout)))
}

// SecurityHeadersMiddleware wraps auth.SecurityHeadersMiddleware for use in main
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return auth.SecurityHeadersMiddleware(next)
}
