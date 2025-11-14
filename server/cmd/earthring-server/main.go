package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/websocket"
)

// main starts the EarthRing game server.
// It sets up HTTP routes for health checks and WebSocket connections,
// then starts listening on the configured port (default: 8080).
func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/ws", websocketHandler)

	log.Printf("EarthRing server starting on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
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

