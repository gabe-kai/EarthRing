package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config holds all configuration for the EarthRing server
type Config struct {
	Server     ServerConfig
	Database   DatabaseConfig
	Auth       AuthConfig
	Procedural ProceduralConfig
	Logging    LoggingConfig
}

// ServerConfig holds server-specific configuration
type ServerConfig struct {
	Host         string
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
	Environment  string
}

// DatabaseConfig holds database connection configuration
type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	SSLMode         string
	MaxConnections  int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// AuthConfig holds authentication configuration
type AuthConfig struct {
	JWTSecret         string
	JWTExpiration     time.Duration
	RefreshSecret     string
	RefreshExpiration time.Duration
	BCryptCost        int
}

// ProceduralConfig holds procedural generation service configuration
type ProceduralConfig struct {
	BaseURL    string
	Timeout    time.Duration
	RetryCount int
}

// LoggingConfig holds logging configuration
type LoggingConfig struct {
	Level      string
	Format     string
	OutputPath string
}

// Load reads configuration from environment variables and .env file
// It returns a Config struct with all settings populated
// The .env file is loaded from the current working directory
func Load() (*Config, error) {
	// Try to load .env file (ignore error if it doesn't exist)
	// godotenv.Load() looks for .env in the current working directory
	if err := godotenv.Load(); err != nil {
		// Log a warning if .env doesn't exist, but continue
		// Environment variables can still be set directly
		log.Printf("Warning: .env file not found (this is OK if using environment variables): %v", err)
	}

	config := &Config{
		Server: ServerConfig{
			Host:         getEnv("SERVER_HOST", "0.0.0.0"),
			Port:         getEnv("SERVER_PORT", "8080"),
			ReadTimeout:  getDurationEnv("SERVER_READ_TIMEOUT", 15*time.Second),
			WriteTimeout: getDurationEnv("SERVER_WRITE_TIMEOUT", 15*time.Second),
			IdleTimeout:  getDurationEnv("SERVER_IDLE_TIMEOUT", 60*time.Second),
			Environment:  getEnv("ENVIRONMENT", "development"),
		},
		Database: DatabaseConfig{
			Host:            getEnv("DB_HOST", "localhost"),
			Port:            getIntEnv("DB_PORT", 5432),
			User:            getEnv("DB_USER", "postgres"),
			Password:        getEnv("DB_PASSWORD", ""),
			Database:        getEnv("DB_NAME", "earthring_dev"),
			SSLMode:         getEnv("DB_SSLMODE", "disable"),
			MaxConnections:  getIntEnv("DB_MAX_CONNECTIONS", 25),
			MaxIdleConns:    getIntEnv("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime: getDurationEnv("DB_CONN_MAX_LIFETIME", 5*time.Minute),
		},
		Auth: AuthConfig{
			JWTSecret:         getEnv("JWT_SECRET", ""),
			JWTExpiration:     getDurationEnv("JWT_EXPIRATION", 15*time.Minute),
			RefreshSecret:     getEnv("REFRESH_SECRET", ""),
			RefreshExpiration: getDurationEnv("REFRESH_EXPIRATION", 7*24*time.Hour),
			BCryptCost:        getIntEnv("BCRYPT_COST", 10),
		},
		Procedural: ProceduralConfig{
			// Use 127.0.0.1 instead of localhost for better Windows compatibility (avoids IPv6 issues)
			BaseURL:    getEnv("PROCEDURAL_BASE_URL", "http://127.0.0.1:8081"),
			Timeout:    getDurationEnv("PROCEDURAL_TIMEOUT", 30*time.Second),
			RetryCount: getIntEnv("PROCEDURAL_RETRY_COUNT", 3),
		},
		Logging: LoggingConfig{
			Level:      getEnv("LOG_LEVEL", "info"),
			Format:     getEnv("LOG_FORMAT", "json"),
			OutputPath: getEnv("LOG_OUTPUT_PATH", ""),
		},
	}

	// Validate required configuration
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("configuration validation failed: %w", err)
	}

	return config, nil
}

// Validate checks that all required configuration values are set
func (c *Config) Validate() error {
	if c.Database.Password == "" {
		return fmt.Errorf("DB_PASSWORD is required")
	}
	if c.Auth.JWTSecret == "" {
		return fmt.Errorf("JWT_SECRET is required")
	}
	if c.Auth.RefreshSecret == "" {
		return fmt.Errorf("REFRESH_SECRET is required")
	}
	return nil
}

// DatabaseURL returns a PostgreSQL connection string
func (c *DatabaseConfig) DatabaseURL() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		c.User,
		c.Password,
		c.Host,
		c.Port,
		c.Database,
		c.SSLMode,
	)
}

// IsDevelopment returns true if running in development mode
func (c *ServerConfig) IsDevelopment() bool {
	return c.Environment == "development"
}

// IsProduction returns true if running in production mode
func (c *ServerConfig) IsProduction() bool {
	return c.Environment == "production"
}

// Helper functions for environment variable access

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func getIntEnv(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	intValue, err := strconv.Atoi(value)
	if err != nil {
		log.Printf("Warning: invalid integer value for %s: %s, using default: %d", key, value, defaultValue)
		return defaultValue
	}
	return intValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		log.Printf("Warning: invalid duration value for %s: %s, using default: %v", key, value, defaultValue)
		return defaultValue
	}
	return duration
}
