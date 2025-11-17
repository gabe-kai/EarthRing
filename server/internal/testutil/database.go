package testutil

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

var (
	envLoaded  bool
	envLoadMux sync.Mutex
)

// loadEnv loads .env file if not already loaded
// This ensures .env is loaded before reading environment variables
// Tries multiple common locations: current directory, server/, and ../server/
func loadEnv() {
	envLoadMux.Lock()
	defer envLoadMux.Unlock()

	if envLoaded {
		return
	}

	// Try multiple paths for .env file
	// Get current working directory (tests may run from various locations)
	cwd, err := os.Getwd()
	if err != nil {
		cwd = "."
	}

	envPaths := []string{
		".env",                                 // Current directory
		filepath.Join(cwd, ".env"),             // Absolute path from current directory
		"../../.env",                           // From server/internal/api or server/internal/...
		"../../../server/.env",                 // From server/internal/api to server/
		filepath.Join(cwd, "..", "..", ".env"), // From server/internal/... to server/
		filepath.Join(cwd, "..", "..", "..", "server", ".env"), // From any subdirectory to server/
		"server/.env",    // Relative from project root
		"../server/.env", // Relative from subdirectories
	}

	var loaded bool
	var lastErr error
	for _, path := range envPaths {
		if err := godotenv.Load(path); err == nil {
			loaded = true
			log.Printf("Loaded .env file from: %s", path)
			break
		} else {
			lastErr = err
		}
	}

	if !loaded {
		// Log a warning if .env doesn't exist, but continue
		// Environment variables can still be set directly
		log.Printf("Warning: .env file not found for tests (tried: %v, last error: %v). Using environment variables or defaults.", envPaths, lastErr)
	}

	envLoaded = true
}

// TestDBConfig holds test database configuration
type TestDBConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	Database string
	SSLMode  string
}

// DefaultTestDBConfig returns a default test database configuration
// Automatically loads .env file if present
func DefaultTestDBConfig() TestDBConfig {
	loadEnv() // Ensure .env is loaded before reading environment variables

	return TestDBConfig{
		Host:     getEnv("TEST_DB_HOST", "localhost"),
		Port:     getIntEnv("TEST_DB_PORT", 5432),
		User:     getEnv("TEST_DB_USER", "postgres"),
		Password: getEnv("TEST_DB_PASSWORD", "postgres"),
		Database: getEnv("TEST_DB_NAME", "earthring_test"),
		SSLMode:  getEnv("TEST_DB_SSLMODE", "disable"),
	}
}

// DatabaseURL returns a PostgreSQL connection string
func (c TestDBConfig) DatabaseURL() string {
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

// SetupTestDB creates a test database connection and sets up PostGIS
// Returns a connection that should be closed after tests
func SetupTestDB(t *testing.T) *sql.DB {
	cfg := DefaultTestDBConfig()

	// Connect to postgres database first to create test database
	adminURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/postgres?sslmode=%s",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.SSLMode,
	)

	adminDB, err := sql.Open("postgres", adminURL)
	if err != nil {
		t.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer adminDB.Close()

	// Create test database if it doesn't exist
	_, err = adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s", cfg.Database))
	if err != nil {
		// Database might already exist, which is fine
		t.Logf("Test database creation: %v (may already exist)", err)
	}

	// Connect to test database
	db, err := sql.Open("postgres", cfg.DatabaseURL())
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}

	// Set up PostGIS extension
	_, err = db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
	if err != nil {
		t.Fatalf("Failed to create PostGIS extension: %v", err)
	}

	// Verify connection
	if err := db.Ping(); err != nil {
		t.Fatalf("Failed to ping test database: %v", err)
	}

	return db
}

// CleanupTestDB drops all tables in the test database
// Useful for integration tests that need a clean slate
func CleanupTestDB(t *testing.T, db *sql.DB) {
	tables := []string{
		"player_actions",
		"racing_results",
		"racing_events",
		"npcs",
		"npc_traffic",
		"roads",
		"chunk_data",
		"chunks",
		"structures",
		"zones",
		"players",
	}

	for _, table := range tables {
		_, err := db.Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", table))
		if err != nil {
			t.Logf("Warning: Failed to drop table %s: %v", table, err)
		}
	}
}

// RunMigrations applies all migrations to the test database
func RunMigrations(t *testing.T, db *sql.DB, migrationsPath string) {
	// This is a placeholder - in a real implementation, you'd use a migration library
	// For now, migrations are tested separately in the database.yml workflow
	t.Log("Migrations should be run separately using the migration scripts")
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// getIntEnv gets an integer environment variable or returns a default value
func getIntEnv(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	var intValue int
	if _, err := fmt.Sscanf(value, "%d", &intValue); err != nil {
		return defaultValue
	}
	return intValue
}
