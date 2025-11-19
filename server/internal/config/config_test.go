package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	// Set required environment variables
	_ = os.Setenv("DB_PASSWORD", "test_password")
	_ = os.Setenv("JWT_SECRET", "test_jwt_secret")
	_ = os.Setenv("REFRESH_SECRET", "test_refresh_secret")
	defer func() {
		_ = os.Unsetenv("DB_PASSWORD")
		_ = os.Unsetenv("JWT_SECRET")
		_ = os.Unsetenv("REFRESH_SECRET")
	}()

	config, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	// Test default values
	if config.Server.Port != "8080" {
		t.Errorf("Expected default port 8080, got %s", config.Server.Port)
	}

	if config.Database.Host != "localhost" {
		t.Errorf("Expected default database host localhost, got %s", config.Database.Host)
	}

	if config.Auth.BCryptCost != 10 {
		t.Errorf("Expected default BCrypt cost 10, got %d", config.Auth.BCryptCost)
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		config  *Config
		wantErr bool
	}{
		{
			name: "valid config",
			config: &Config{
				Database: DatabaseConfig{Password: "test"},
				Auth: AuthConfig{
					JWTSecret:     "test",
					RefreshSecret: "test",
				},
			},
			wantErr: false,
		},
		{
			name: "missing DB password",
			config: &Config{
				Database: DatabaseConfig{Password: ""},
				Auth: AuthConfig{
					JWTSecret:     "test",
					RefreshSecret: "test",
				},
			},
			wantErr: true,
		},
		{
			name: "missing JWT secret",
			config: &Config{
				Database: DatabaseConfig{Password: "test"},
				Auth: AuthConfig{
					JWTSecret:     "",
					RefreshSecret: "test",
				},
			},
			wantErr: true,
		},
		{
			name: "missing refresh secret",
			config: &Config{
				Database: DatabaseConfig{Password: "test"},
				Auth: AuthConfig{
					JWTSecret:     "test",
					RefreshSecret: "",
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestDatabaseURL(t *testing.T) {
	dbConfig := DatabaseConfig{
		Host:     "localhost",
		Port:     5432,
		User:     "postgres",
		Password: "testpass",
		Database: "earthring_dev",
		SSLMode:  "disable",
	}

	expected := "postgres://postgres:testpass@localhost:5432/earthring_dev?sslmode=disable"
	got := dbConfig.DatabaseURL()

	if got != expected {
		t.Errorf("DatabaseURL() = %v, want %v", got, expected)
	}
}

func TestIsDevelopment(t *testing.T) {
	tests := []struct {
		name     string
		env      string
		expected bool
	}{
		{"development", "development", true},
		{"production", "production", false},
		{"staging", "staging", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ServerConfig{Environment: tt.env}
			if config.IsDevelopment() != tt.expected {
				t.Errorf("IsDevelopment() = %v, want %v", config.IsDevelopment(), tt.expected)
			}
		})
	}
}

func TestIsProduction(t *testing.T) {
	tests := []struct {
		name     string
		env      string
		expected bool
	}{
		{"development", "development", false},
		{"production", "production", true},
		{"staging", "staging", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := ServerConfig{Environment: tt.env}
			if config.IsProduction() != tt.expected {
				t.Errorf("IsProduction() = %v, want %v", config.IsProduction(), tt.expected)
			}
		})
	}
}

func TestGetDurationEnv(t *testing.T) {
	tests := []struct {
		name         string
		envValue     string
		defaultValue time.Duration
		expected     time.Duration
	}{
		{"valid duration", "30s", 15 * time.Second, 30 * time.Second},
		{"empty env", "", 15 * time.Second, 15 * time.Second},
		{"invalid duration", "invalid", 15 * time.Second, 15 * time.Second},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.envValue != "" {
				_ = os.Setenv("TEST_DURATION", tt.envValue)
				defer func() {
					_ = os.Unsetenv("TEST_DURATION")
				}()
			}
			got := getDurationEnv("TEST_DURATION", tt.defaultValue)
			if got != tt.expected {
				t.Errorf("getDurationEnv() = %v, want %v", got, tt.expected)
			}
		})
	}
}
