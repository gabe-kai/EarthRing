package auth

import (
	"time"
)

// User represents a player/user in the system
type User struct {
	ID               int64      `json:"id" db:"id"`
	Username         string     `json:"username" db:"username"`
	Email            string     `json:"email" db:"email"`
	PasswordHash     string     `json:"-" db:"password_hash"`
	Role             string     `json:"role" db:"role"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	LastLogin        *time.Time `json:"last_login,omitempty" db:"last_login"`
	Level            int        `json:"level" db:"level"`
	ExperiencePoints int64      `json:"experience_points" db:"experience_points"`
	CurrencyAmount   int64      `json:"currency_amount" db:"currency_amount"`
}

// RegisterRequest represents a user registration request
type RegisterRequest struct {
	Username string `json:"username" validate:"required,min=3,max=32"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

// LoginRequest represents a user login request
type LoginRequest struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// TokenResponse represents a token response
type TokenResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	UserID       int64     `json:"user_id"`
	Username     string    `json:"username"`
	Role         string    `json:"role"`
}

// RefreshRequest represents a token refresh request
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
	Code    string `json:"code,omitempty"`
}
