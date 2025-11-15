package testutil

import (
	"database/sql"
	"fmt"
	"os"
	"testing"

	_ "github.com/lib/pq"
)

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
func DefaultTestDBConfig() TestDBConfig {
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
