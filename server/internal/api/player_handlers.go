package api

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
)

// PlayerHandlers handles player-related HTTP requests.
type PlayerHandlers struct {
	db     *sql.DB
	config *config.Config
}

// NewPlayerHandlers creates a new instance of PlayerHandlers.
func NewPlayerHandlers(db *sql.DB, cfg *config.Config) *PlayerHandlers {
	return &PlayerHandlers{
		db:     db,
		config: cfg,
	}
}

// GetPlayerProfile handles GET /api/players/{player_id} requests.
// Returns the player's profile information.
func (h *PlayerHandlers) GetPlayerProfile(w http.ResponseWriter, r *http.Request) {
	// Extract player ID from URL path
	// Path format: /api/players/{player_id}
	path := r.URL.Path
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "players" {
		respondWithError(w, http.StatusBadRequest, "Invalid path")
		return
	}
	playerIDStr := parts[2]
	playerID, err := strconv.ParseInt(playerIDStr, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid player ID")
		return
	}

	// Get authenticated user from context (set by AuthMiddleware)
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Check if user is requesting their own profile or has permission
	// For now, only allow users to view their own profile
	if authUserID != playerID {
		respondWithError(w, http.StatusForbidden, "You can only view your own profile")
		return
	}

	// Query player from database
	var profile PlayerProfile
	var posX, posY sql.NullFloat64
	var lastLogin sql.NullTime

	query := `
		SELECT id, username, level, experience_points, currency_amount,
		       CASE WHEN current_position IS NULL THEN NULL ELSE ST_X(current_position::geometry) END,
		       CASE WHEN current_position IS NULL THEN NULL ELSE ST_Y(current_position::geometry) END,
		       current_floor, created_at, last_login
		FROM players
		WHERE id = $1
	`
	err = h.db.QueryRow(query, playerID).Scan(
		&profile.ID,
		&profile.Username,
		&profile.Level,
		&profile.ExperiencePoints,
		&profile.CurrencyAmount,
		&posX,
		&posY,
		&profile.CurrentFloor,
		&profile.CreatedAt,
		&lastLogin,
	)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Player not found")
		return
	}
	if err != nil {
		log.Printf("Error querying player profile: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve player profile")
		return
	}

	// Set position if available
	if posX.Valid && posY.Valid {
		profile.CurrentPosition = &Position{
			X: posX.Float64,
			Y: posY.Float64,
		}
	}

	// Set last login if available
	if lastLogin.Valid {
		profile.LastLogin = &lastLogin.Time
	}

	// Return JSON response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(profile)
}

// GetCurrentPlayerProfile handles GET /api/players/me requests.
// Returns the current authenticated player's profile.
func (h *PlayerHandlers) GetCurrentPlayerProfile(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user from context
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Query player from database
	var profile PlayerProfile
	var posX, posY sql.NullFloat64
	var lastLogin sql.NullTime

	query := `
		SELECT id, username, level, experience_points, currency_amount,
		       CASE WHEN current_position IS NULL THEN NULL ELSE ST_X(current_position::geometry) END,
		       CASE WHEN current_position IS NULL THEN NULL ELSE ST_Y(current_position::geometry) END,
		       current_floor, created_at, last_login
		FROM players
		WHERE id = $1
	`
	err := h.db.QueryRow(query, authUserID).Scan(
		&profile.ID,
		&profile.Username,
		&profile.Level,
		&profile.ExperiencePoints,
		&profile.CurrencyAmount,
		&posX,
		&posY,
		&profile.CurrentFloor,
		&profile.CreatedAt,
		&lastLogin,
	)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Player not found")
		return
	}
	if err != nil {
		log.Printf("Error querying player profile: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve player profile")
		return
	}

	// Set position if available
	if posX.Valid && posY.Valid {
		profile.CurrentPosition = &Position{
			X: posX.Float64,
			Y: posY.Float64,
		}
	}

	// Set last login if available
	if lastLogin.Valid {
		profile.LastLogin = &lastLogin.Time
	}

	// Return JSON response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(profile)
}

// UpdatePlayerPosition handles PUT /api/players/{player_id}/position requests.
// Updates the player's current position and floor.
func (h *PlayerHandlers) UpdatePlayerPosition(w http.ResponseWriter, r *http.Request) {
	// Extract player ID from URL path
	// Path format: /api/players/{player_id}/position
	path := r.URL.Path
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "players" || parts[3] != "position" {
		respondWithError(w, http.StatusBadRequest, "Invalid path")
		return
	}
	playerIDStr := parts[2]
	playerID, err := strconv.ParseInt(playerIDStr, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid player ID")
		return
	}

	// Get authenticated user from context
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Check if user is updating their own position
	if authUserID != playerID {
		respondWithError(w, http.StatusForbidden, "You can only update your own position")
		return
	}

	// Parse request body
	var req UpdatePositionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Validate position
	// X should be between 0 and 264,000,000 (ring circumference)
	if req.Position.X < 0 || req.Position.X > 264000000 {
		respondWithError(w, http.StatusBadRequest, "Invalid X position (must be 0-264000000)")
		return
	}
	// Y should be reasonable (within ring width, but we'll be lenient for now)
	// Floor should be reasonable (-2 to 15 based on schema)
	if req.Floor < -2 || req.Floor > 15 {
		respondWithError(w, http.StatusBadRequest, "Invalid floor (must be -2 to 15)")
		return
	}

	// Update player position in database
	// PostgreSQL POINT type: (x, y)
	query := `
		UPDATE players
		SET current_position = POINT($1, $2),
		    current_floor = $3
		WHERE id = $4
		RETURNING id
	`
	var updatedID int64
	err = h.db.QueryRow(query, req.Position.X, req.Position.Y, req.Floor, playerID).Scan(&updatedID)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Player not found")
		return
	}
	if err != nil {
		log.Printf("Error updating player position: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to update player position")
		return
	}

	// Return success response
	response := UpdatePositionResponse{
		Success:  true,
		Position: req.Position,
		Floor:    req.Floor,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// respondWithError sends an error response in JSON format.
func respondWithError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

