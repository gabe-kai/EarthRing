package auth

import (
	"testing"
	"time"

	"github.com/earthring/server/internal/config"
)

func TestJWTService_GenerateAccessToken(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test_jwt_secret_key_32_bytes_long!!",
			RefreshSecret: "test_refresh_secret_key_32_bytes_long!!",
			JWTExpiration: 15 * time.Minute,
		},
	}

	service := NewJWTService(cfg)

	token, err := service.GenerateAccessToken(123, "testuser", "player")
	if err != nil {
		t.Fatalf("GenerateAccessToken() failed: %v", err)
	}

	if token == "" {
		t.Error("GenerateAccessToken() returned empty token")
	}

	// Validate the token
	claims, err := service.ValidateAccessToken(token)
	if err != nil {
		t.Fatalf("ValidateAccessToken() failed: %v", err)
	}

	if claims.UserID != 123 {
		t.Errorf("Expected UserID 123, got %d", claims.UserID)
	}

	if claims.Username != "testuser" {
		t.Errorf("Expected Username 'testuser', got %s", claims.Username)
	}

	if claims.Role != "player" {
		t.Errorf("Expected Role 'player', got %s", claims.Role)
	}

	if claims.Issuer != "earthring-server" {
		t.Errorf("Expected Issuer 'earthring-server', got %s", claims.Issuer)
	}
}

func TestJWTService_GenerateRefreshToken(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:         "test_jwt_secret_key_32_bytes_long!!",
			RefreshSecret:     "test_refresh_secret_key_32_bytes_long!!",
			RefreshExpiration: 7 * 24 * time.Hour,
		},
	}

	service := NewJWTService(cfg)

	token, err := service.GenerateRefreshToken(123)
	if err != nil {
		t.Fatalf("GenerateRefreshToken() failed: %v", err)
	}

	if token == "" {
		t.Error("GenerateRefreshToken() returned empty token")
	}

	// Validate the token
	claims, err := service.ValidateRefreshToken(token)
	if err != nil {
		t.Fatalf("ValidateRefreshToken() failed: %v", err)
	}

	if claims.UserID != 123 {
		t.Errorf("Expected UserID 123, got %d", claims.UserID)
	}
}

func TestJWTService_ValidateAccessToken_InvalidToken(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test_jwt_secret_key_32_bytes_long!!",
			RefreshSecret: "test_refresh_secret_key_32_bytes_long!!",
		},
	}

	service := NewJWTService(cfg)

	_, err := service.ValidateAccessToken("invalid.token.here")
	if err == nil {
		t.Error("ValidateAccessToken() should fail for invalid token")
	}
}

func TestJWTService_TokenExpiration(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test_jwt_secret_key_32_bytes_long!!",
			RefreshSecret: "test_refresh_secret_key_32_bytes_long!!",
			JWTExpiration: 15 * time.Minute,
		},
	}

	service := NewJWTService(cfg)

	expiry := service.GetTokenExpiration()
	if expiry != 15*time.Minute {
		t.Errorf("Expected expiration 15m, got %v", expiry)
	}
}
