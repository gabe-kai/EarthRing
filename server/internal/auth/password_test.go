package auth

import (
	"testing"

	"github.com/earthring/server/internal/config"
)

func TestPasswordService_HashPassword(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			BCryptCost: 10,
		},
	}
	
	service := NewPasswordService(cfg)
	
	password := "TestPassword123!"
	hash, err := service.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() failed: %v", err)
	}
	
	if hash == "" {
		t.Error("HashPassword() returned empty hash")
	}
	
	if hash == password {
		t.Error("HashPassword() returned password as hash")
	}
}

func TestPasswordService_VerifyPassword(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			BCryptCost: 10,
		},
	}
	
	service := NewPasswordService(cfg)
	
	password := "TestPassword123!"
	hash, err := service.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() failed: %v", err)
	}
	
	// Correct password
	if !service.VerifyPassword(password, hash) {
		t.Error("VerifyPassword() failed for correct password")
	}
	
	// Incorrect password
	if service.VerifyPassword("WrongPassword123!", hash) {
		t.Error("VerifyPassword() succeeded for incorrect password")
	}
}

func TestPasswordService_ValidatePasswordStrength(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			BCryptCost: 10,
		},
	}
	
	service := NewPasswordService(cfg)
	
	tests := []struct {
		name    string
		password string
		wantErr bool
	}{
		{"valid password", "TestPassword123!", false},
		{"too short", "Short1!", true},
		{"no uppercase", "testpassword123!", true},
		{"no lowercase", "TESTPASSWORD123!", true},
		{"no number", "TestPassword!", true},
		{"no special", "TestPassword123", true},
		{"empty", "", true},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := service.ValidatePasswordStrength(tt.password)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidatePasswordStrength() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

