package auth

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
)

// AuthHandlers handles authentication HTTP endpoints
type AuthHandlers struct {
	db              *sql.DB
	jwtService      *JWTService
	passwordService *PasswordService
	validator       *validator.Validate
}

// NewAuthHandlers creates a new auth handlers instance
func NewAuthHandlers(db *sql.DB, jwtService *JWTService, passwordService *PasswordService) *AuthHandlers {
	return &AuthHandlers{
		db:              db,
		jwtService:      jwtService,
		passwordService: passwordService,
		validator:       validator.New(),
	}
}

// Register handles user registration
// POST /api/auth/register
func (h *AuthHandlers) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "InvalidRequest", "Invalid request body")
		return
	}

	// Validate input
	if err := h.validator.Struct(req); err != nil {
		h.sendValidationError(w, err)
		return
	}

	// Validate username format (alphanumeric, underscore, hyphen, 3-32 chars)
	if len(req.Username) < 3 || len(req.Username) > 32 {
		h.sendError(w, http.StatusBadRequest, "InvalidUsername", "Username must be between 3 and 32 characters")
		return
	}

	// Validate password strength
	if err := h.passwordService.ValidatePasswordStrength(req.Password); err != nil {
		h.sendError(w, http.StatusBadRequest, "InvalidPassword", err.Error())
		return
	}

	// Check if username already exists
	var existingID int64
	err := h.db.QueryRow("SELECT id FROM players WHERE username = $1", req.Username).Scan(&existingID)
	if err == nil {
		h.sendError(w, http.StatusConflict, "UsernameExists", "Username already exists")
		return
	} else if err != sql.ErrNoRows {
		log.Printf("Error checking username: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to check username")
		return
	}

	// Check if email already exists
	err = h.db.QueryRow("SELECT id FROM players WHERE email = $1", req.Email).Scan(&existingID)
	if err == nil {
		h.sendError(w, http.StatusConflict, "EmailExists", "Email already exists")
		return
	} else if err != sql.ErrNoRows {
		log.Printf("Error checking email: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to check email")
		return
	}

	// Hash password
	passwordHash, err := h.passwordService.HashPassword(req.Password)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to process password")
		return
	}

	// Create user (role column doesn't exist yet, will default to "player" in code)
	now := time.Now()
	var userID int64
	err = h.db.QueryRow(
		`INSERT INTO players (username, email, password_hash, created_at)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id`,
		req.Username, req.Email, passwordHash, now,
	).Scan(&userID)
	if err != nil {
		log.Printf("Error creating user: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to create user")
		return
	}

	// Generate tokens
	accessToken, err := h.jwtService.GenerateAccessToken(userID, req.Username, "player")
	if err != nil {
		log.Printf("Error generating access token: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to generate token")
		return
	}

	refreshToken, err := h.jwtService.GenerateRefreshToken(userID)
	if err != nil {
		log.Printf("Error generating refresh token: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to generate refresh token")
		return
	}

	// Send response
	expiresAt := time.Now().Add(h.jwtService.GetTokenExpiration())
	h.sendTokenResponse(w, http.StatusCreated, TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
		UserID:       userID,
		Username:     req.Username,
		Role:         "player",
	})
}

// Login handles user login
// POST /api/auth/login
func (h *AuthHandlers) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "InvalidRequest", "Invalid request body")
		return
	}

	// Validate input
	if err := h.validator.Struct(req); err != nil {
		h.sendValidationError(w, err)
		return
	}

	// Get user from database (role defaults to "player" since column doesn't exist yet)
	var user User
	user.Role = "player" // Default role until role column is added
	err := h.db.QueryRow(
		"SELECT id, username, email, password_hash FROM players WHERE username = $1",
		req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash)

	if err == sql.ErrNoRows {
		h.sendError(w, http.StatusUnauthorized, "InvalidCredentials", "Invalid username or password")
		return
	} else if err != nil {
		log.Printf("Error querying user: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to authenticate")
		return
	}

	// Verify password
	if !h.passwordService.VerifyPassword(req.Password, user.PasswordHash) {
		h.sendError(w, http.StatusUnauthorized, "InvalidCredentials", "Invalid username or password")
		return
	}

	// Generate tokens
	accessToken, err := h.jwtService.GenerateAccessToken(user.ID, user.Username, user.Role)
	if err != nil {
		log.Printf("Error generating access token: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to generate token")
		return
	}

	refreshToken, err := h.jwtService.GenerateRefreshToken(user.ID)
	if err != nil {
		log.Printf("Error generating refresh token: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to generate refresh token")
		return
	}

	// Send response
	expiresAt := time.Now().Add(h.jwtService.GetTokenExpiration())
	h.sendTokenResponse(w, http.StatusOK, TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
		UserID:       user.ID,
		Username:     user.Username,
		Role:         user.Role,
	})
}

// Refresh handles token refresh
// POST /api/auth/refresh
func (h *AuthHandlers) Refresh(w http.ResponseWriter, r *http.Request) {
	// Get refresh token from Authorization header or body
	var refreshToken string

	// Try Authorization header first
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && parts[0] == "Bearer" {
			refreshToken = parts[1]
		}
	}

	// If not in header, try body
	if refreshToken == "" {
		var req RefreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			refreshToken = req.RefreshToken
		}
	}

	if refreshToken == "" {
		h.sendError(w, http.StatusBadRequest, "InvalidRequest", "Refresh token required")
		return
	}

	// Validate refresh token
	claims, err := h.jwtService.ValidateRefreshToken(refreshToken)
	if err != nil {
		h.sendError(w, http.StatusUnauthorized, "InvalidToken", "Invalid or expired refresh token")
		return
	}

	// Get user from database to ensure still exists (role defaults to "player")
	var user User
	user.Role = "player" // Default role until role column is added
	err = h.db.QueryRow(
		"SELECT id, username FROM players WHERE id = $1",
		claims.UserID,
	).Scan(&user.ID, &user.Username)

	if err == sql.ErrNoRows {
		h.sendError(w, http.StatusUnauthorized, "UserNotFound", "User no longer exists")
		return
	} else if err != nil {
		log.Printf("Error querying user: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to refresh token")
		return
	}

	// Generate new access token
	accessToken, err := h.jwtService.GenerateAccessToken(user.ID, user.Username, user.Role)
	if err != nil {
		log.Printf("Error generating access token: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to generate token")
		return
	}

	// Generate new refresh token (rotation)
	newRefreshToken, err := h.jwtService.GenerateRefreshToken(user.ID)
	if err != nil {
		log.Printf("Error generating refresh token: %v", err)
		h.sendError(w, http.StatusInternalServerError, "InternalError", "Failed to generate refresh token")
		return
	}

	// Send response
	expiresAt := time.Now().Add(h.jwtService.GetTokenExpiration())
	h.sendTokenResponse(w, http.StatusOK, TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		ExpiresAt:    expiresAt,
		UserID:       user.ID,
		Username:     user.Username,
		Role:         user.Role,
	})
}

// Logout handles user logout
// POST /api/auth/logout
func (h *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	// For stateless JWT, logout is primarily client-side
	// Server can optionally blacklist tokens (requires Redis/database)
	// For now, just return success - client should discard tokens

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Logged out successfully",
	})
}

// Helper methods

func (h *AuthHandlers) sendTokenResponse(w http.ResponseWriter, status int, response TokenResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response)
}

func (h *AuthHandlers) sendError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   code,
		Message: message,
		Code:    code,
	})
}

func (h *AuthHandlers) sendValidationError(w http.ResponseWriter, err error) {
	var validationErrors []string
	var ve validator.ValidationErrors
	if errors.As(err, &ve) {
		for _, fe := range ve {
			validationErrors = append(validationErrors, fmt.Sprintf("%s: %s", fe.Field(), getValidationMessage(fe)))
		}
	}

	h.sendError(w, http.StatusBadRequest, "ValidationError", strings.Join(validationErrors, "; "))
}

func getValidationMessage(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "is required"
	case "email":
		return "must be a valid email"
	case "min":
		return fmt.Sprintf("must be at least %s characters", fe.Param())
	case "max":
		return fmt.Sprintf("must be at most %s characters", fe.Param())
	case "alphanum":
		return "must contain only alphanumeric characters"
	default:
		return fmt.Sprintf("failed validation: %s", fe.Tag())
	}
}
