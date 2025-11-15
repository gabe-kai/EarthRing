package api

import "time"

// PlayerProfile represents a player's profile information.
type PlayerProfile struct {
	ID               int64      `json:"id"`
	Username         string     `json:"username"`
	Level            int        `json:"level"`
	ExperiencePoints int64      `json:"experience_points"`
	CurrencyAmount   int64      `json:"currency_amount"`
	CurrentPosition  *Position  `json:"current_position,omitempty"`
	CurrentFloor     int        `json:"current_floor"`
	CreatedAt        time.Time  `json:"created_at"`
	LastLogin        *time.Time `json:"last_login,omitempty"`
}

// Position represents a 2D position on the ring.
type Position struct {
	X float64 `json:"x"` // Ring position (0 to 264,000,000 meters)
	Y float64 `json:"y"` // Width position (-12,500 to +12,500 meters)
}

// UpdatePositionRequest represents a request to update a player's position.
type UpdatePositionRequest struct {
	Position Position `json:"position"`
	Floor    int      `json:"floor"`
}

// UpdatePositionResponse represents the response after updating a player's position.
type UpdatePositionResponse struct {
	Success  bool     `json:"success"`
	Position Position `json:"position"`
	Floor    int      `json:"floor"`
}
