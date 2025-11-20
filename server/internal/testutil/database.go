package testutil

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

var (
	envLoaded  bool
	envLoadMux sync.Mutex
	dbSetupMux sync.Mutex // Serialize database setup to prevent race conditions
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
// Uses a mutex to serialize database setup and prevent race conditions when tests run in parallel
func SetupTestDB(t *testing.T) *sql.DB {
	cfg := DefaultTestDBConfig()

	// Serialize database setup to prevent race conditions
	dbSetupMux.Lock()
	defer dbSetupMux.Unlock()

	// Connect to postgres database first to create test database
	adminURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/postgres?sslmode=%s",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.SSLMode,
	)

	adminDB, err := sql.Open("postgres", adminURL)
	if err != nil {
		t.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer func() {
		if err := adminDB.Close(); err != nil {
			t.Logf("Warning: error closing admin database connection: %v", err)
		}
	}()

	// Check if test database exists and terminate any existing connections
	// This is necessary before we can drop it
	checkDBQuery := fmt.Sprintf(`
		SELECT 1 FROM pg_database WHERE datname = '%s'
	`, cfg.Database)
	var dbExists bool
	err = adminDB.QueryRow(checkDBQuery).Scan(&dbExists)
	if err != nil && err != sql.ErrNoRows {
		t.Logf("Note: Could not check if database exists: %v", err)
	}

	if dbExists {
		// Terminate any existing connections to the test database
		// Use pg_terminate_backend to force disconnect all sessions
		terminateQuery := fmt.Sprintf(`
			SELECT pg_terminate_backend(pg_stat_activity.pid)
			FROM pg_stat_activity
			WHERE pg_stat_activity.datname = '%s'
			AND pid <> pg_backend_pid()
		`, cfg.Database)
		if _, err := adminDB.Exec(terminateQuery); err != nil {
			t.Logf("Note: Terminating connections (may fail if no connections exist): %v", err)
		}

		// Also try to revoke connect privileges to prevent new connections
		revokeQuery := fmt.Sprintf(`
			REVOKE CONNECT ON DATABASE %s FROM public
		`, cfg.Database)
		if _, err := adminDB.Exec(revokeQuery); err != nil {
			t.Logf("Note: Revoking connect privileges (may fail): %v", err)
		}

		// Drop test database if it exists (to ensure clean state)
		// Retry logic to handle race conditions with parallel tests
		maxRetries := 3
		var dropErr error
		for attempt := 0; attempt < maxRetries; attempt++ {
			_, dropErr = adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s", cfg.Database))
			if dropErr == nil {
				break // Successfully dropped
			}

			// If drop fails, try terminating connections again and wait a bit
			if attempt < maxRetries-1 {
				t.Logf("Warning: Drop attempt %d failed: %v, retrying after re-terminating connections...", attempt+1, dropErr)
				// Terminate connections again
				if _, termErr := adminDB.Exec(terminateQuery); termErr != nil {
					t.Logf("Note: Re-terminating connections: %v", termErr)
				}
				// Wait a bit for connections to close
				time.Sleep(100 * time.Millisecond)
			}
		}

		if dropErr != nil {
			// Last resort: try with FORCE if supported (PostgreSQL 13+)
			_, dropErr = adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", cfg.Database))
			if dropErr != nil {
				t.Fatalf("Failed to drop test database after %d attempts: %v", maxRetries, dropErr)
			}
		}

		// Wait a moment to ensure database is fully dropped before creating
		time.Sleep(50 * time.Millisecond)
	}

	// Create test database fresh
	// Retry creation in case of race conditions with parallel tests
	maxCreateRetries := 3
	var createErr error
	for attempt := 0; attempt < maxCreateRetries; attempt++ {
		_, createErr = adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s", cfg.Database))
		if createErr == nil {
			break // Successfully created
		}

		// Check if database already exists (another test might have created it)
		var exists bool
		checkErr := adminDB.QueryRow(checkDBQuery).Scan(&exists)
		if checkErr == nil && exists {
			// Database exists, which is fine - another test created it
			// We'll use the existing database
			break
		}

		// If creation failed and database doesn't exist, wait and retry
		if attempt < maxCreateRetries-1 {
			time.Sleep(50 * time.Millisecond)
		}
	}

	if createErr != nil {
		// Check one more time if database exists
		var exists bool
		checkErr := adminDB.QueryRow(checkDBQuery).Scan(&exists)
		if checkErr == nil && exists {
			// Database exists now, use it - no error to report
		} else {
			t.Fatalf("Failed to create test database after %d attempts: %v", maxCreateRetries, createErr)
		}
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

// CloseDB registers a cleanup function that closes the provided database connection.
// It fails the test if closing the database returns an error.
func CloseDB(t *testing.T, db *sql.DB) {
	t.Helper()
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Failed to close test database: %v", err)
		}
	})
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
