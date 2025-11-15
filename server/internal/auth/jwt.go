package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/earthring/server/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

// Claims represents JWT claims structure
type Claims struct {
	jwt.RegisteredClaims

	// Custom claims
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"` // "player", "admin", "infrastructure_manager"
}

// JWTService handles JWT token operations
type JWTService struct {
	accessSecret  []byte
	refreshSecret []byte
	accessExpiry  time.Duration
	refreshExpiry time.Duration
}

// NewJWTService creates a new JWT service with configuration
func NewJWTService(cfg *config.Config) *JWTService {
	return &JWTService{
		accessSecret:  []byte(cfg.Auth.JWTSecret),
		refreshSecret: []byte(cfg.Auth.RefreshSecret),
		accessExpiry:  cfg.Auth.JWTExpiration,
		refreshExpiry: cfg.Auth.RefreshExpiration,
	}
}

// GenerateAccessToken generates a new access token for a user
func (s *JWTService) GenerateAccessToken(userID int64, username, role string) (string, error) {
	now := time.Now()
	expiresAt := now.Add(s.accessExpiry)

	// Generate unique token ID
	tokenID, err := generateTokenID()
	if err != nil {
		return "", fmt.Errorf("failed to generate token ID: %w", err)
	}

	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "earthring-server",
			Subject:   fmt.Sprintf("%d", userID),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        tokenID,
		},
		UserID:   userID,
		Username: username,
		Role:     role,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.accessSecret)
}

// GenerateRefreshToken generates a new refresh token
func (s *JWTService) GenerateRefreshToken(userID int64) (string, error) {
	now := time.Now()
	expiresAt := now.Add(s.refreshExpiry)

	// Generate unique token ID
	tokenID, err := generateTokenID()
	if err != nil {
		return "", fmt.Errorf("failed to generate token ID: %w", err)
	}

	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "earthring-server",
			Subject:   fmt.Sprintf("%d", userID),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        tokenID,
		},
		UserID: userID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.refreshSecret)
}

// ValidateAccessToken validates an access token and returns the claims
func (s *JWTService) ValidateAccessToken(tokenString string) (*Claims, error) {
	return s.validateToken(tokenString, s.accessSecret)
}

// ValidateRefreshToken validates a refresh token and returns the claims
func (s *JWTService) ValidateRefreshToken(tokenString string) (*Claims, error) {
	return s.validateToken(tokenString, s.refreshSecret)
}

// validateToken validates a JWT token with the given secret
func (s *JWTService) validateToken(tokenString string, secret []byte) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	// Validate issuer
	if claims.Issuer != "earthring-server" {
		return nil, errors.New("invalid token issuer")
	}

	return claims, nil
}

// generateTokenID generates a unique token ID
func generateTokenID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// GetTokenExpiration returns the expiration time for access tokens
func (s *JWTService) GetTokenExpiration() time.Duration {
	return s.accessExpiry
}
