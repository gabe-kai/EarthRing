package api

import (
	"net/http"
)

// SetupConfigRoutes registers configuration routes (no auth required for public config)
func SetupConfigRoutes(mux *http.ServeMux) {
	handlers := NewConfigHandlers()

	// Public endpoint - no auth required for configuration data
	mux.HandleFunc("/api/config/hub-colors", handlers.GetHubColorPalettes)
}
