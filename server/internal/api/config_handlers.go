package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// ConfigHandlers handles configuration-related HTTP requests
type ConfigHandlers struct {
	colorPalettesPath string
	colorPalettes     map[string]interface{}
}

// NewConfigHandlers creates a new instance of ConfigHandlers
func NewConfigHandlers() *ConfigHandlers {
	// Get the server root directory
	// Try multiple possible paths depending on where the binary is run from
	possiblePaths := []string{
		filepath.Join("server", "config", "hub-color-palettes.json"),                                       // From project root
		filepath.Join("..", "server", "config", "hub-color-palettes.json"),                                 // From cmd/earthring-server/
		filepath.Join("config", "hub-color-palettes.json"),                                                 // If running from server/
		filepath.Join("server", "internal", "procedural", "..", "..", "config", "hub-color-palettes.json"), // From procedural/
	}

	var colorPalettesPath string
	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			colorPalettesPath = path
			break
		}
	}

	// If none found, use default
	if colorPalettesPath == "" {
		colorPalettesPath = filepath.Join("server", "config", "hub-color-palettes.json")
	}

	handlers := &ConfigHandlers{
		colorPalettesPath: colorPalettesPath,
		colorPalettes:     nil, // Load on first request
	}

	return handlers
}

// GetHubColorPalettes handles GET /api/config/hub-colors requests
// Returns the hub color palettes JSON file
func (h *ConfigHandlers) GetHubColorPalettes(w http.ResponseWriter, r *http.Request) {
	// Load palettes if not already loaded
	if h.colorPalettes == nil {
		if err := h.loadColorPalettes(); err != nil {
			log.Printf("Error loading color palettes: %v", err)
			http.Error(w, "Failed to load color palettes", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600") // Cache for 1 hour

	if err := json.NewEncoder(w).Encode(h.colorPalettes); err != nil {
		log.Printf("Error encoding color palettes: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// loadColorPalettes loads the color palettes JSON file
func (h *ConfigHandlers) loadColorPalettes() error {
	data, err := os.ReadFile(h.colorPalettesPath)
	if err != nil {
		return err
	}

	var palettes map[string]interface{}
	if err := json.Unmarshal(data, &palettes); err != nil {
		return err
	}

	h.colorPalettes = palettes
	return nil
}
