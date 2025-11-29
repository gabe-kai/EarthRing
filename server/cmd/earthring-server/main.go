package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/earthring/server/internal/api"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/performance"
	_ "github.com/lib/pq"
)

// main starts the EarthRing game server.
// It loads configuration, sets up HTTP routes for health checks and WebSocket connections,
// then starts listening on the configured port.
func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Set up HTTP server with timeouts
	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	// Set up database connection
	db, err := setupDatabase(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("Error closing database connection: %v", err)
		}
	}()

	// Set up performance profiler
	profiler := performance.NewProfiler(cfg.Performance.Enabled)
	if cfg.Performance.Enabled {
		log.Printf("Performance profiling enabled")
		// Log periodic reports every 5 minutes
		go func() {
			ticker := time.NewTicker(5 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				profiler.LogReport()
			}
		}()
	}

	// Set up WebSocket handlers
	wsHandlers := api.NewWebSocketHandlers(db, cfg, profiler)
	go wsHandlers.GetHub().Run()

	// Set up routes
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/favicon.ico", faviconHandler)
	mux.HandleFunc("/ws", wsHandlers.HandleWebSocket)

	// Set up authentication routes (includes rate limiting)
	api.SetupAuthRoutes(mux, db, cfg)

	// Set up player management routes
	api.SetupPlayerRoutes(mux, db, cfg)

	// Set up chunk metadata routes
	api.SetupChunkRoutes(mux, db, cfg)
	api.SetupZoneRoutes(mux, db, cfg)
	api.SetupStructureRoutes(mux, db, cfg)

	// Set up admin routes
	api.SetupAdminRoutes(mux, db, cfg)

	// Apply global rate limiting (1000 requests per minute per IP)
	// This applies to all routes after auth routes are set up
	globalRateLimit := api.RateLimitMiddleware(1000, 1*time.Minute)
	handler := globalRateLimit(mux)

	// Apply CORS middleware (must be before security headers for OPTIONS requests)
	handler = api.CORSMiddleware(handler)

	// Apply security headers to all routes
	server.Handler = api.SecurityHeadersMiddleware(handler)

	log.Printf("EarthRing server starting on %s:%s (environment: %s)",
		cfg.Server.Host, cfg.Server.Port, cfg.Server.Environment)

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

// healthHandler responds to health check requests.
// Returns a JSON response indicating the server is running.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := fmt.Fprintf(w, `{"status":"ok","service":"earthring-server"}`); err != nil {
		log.Printf("Error writing health check response: %v", err)
	}
}

// faviconHandler responds to favicon requests.
// Returns 204 No Content to suppress 404 errors in browser console.
func faviconHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// setupDatabase creates a database connection using configuration
func setupDatabase(cfg *config.Config) (*sql.DB, error) {
	db, err := sql.Open("postgres", cfg.Database.DatabaseURL())
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(cfg.Database.MaxConnections)
	db.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	db.SetConnMaxLifetime(cfg.Database.ConnMaxLifetime)

	return db, nil
}
