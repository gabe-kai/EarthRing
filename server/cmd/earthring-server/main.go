package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/earthring/server/internal/config"
	"github.com/gorilla/websocket"
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

	// Set up routes
	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/ws", websocketHandler)

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
	fmt.Fprintf(w, `{"status":"ok","service":"earthring-server"}`)
}

// websocketHandler handles WebSocket connection upgrades.
// Currently accepts all origins (TODO: implement proper origin checking in Phase 1).
// Connection is established but message handling is not yet implemented (TODO: Phase 1).
func websocketHandler(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			// TODO: Implement proper origin checking (Phase 1)
			return true
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("WebSocket connection established")
	// TODO: Implement WebSocket message handling (Phase 1)
}

