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
	"github.com/lib/pq"
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
// Uses PostgreSQL advisory locks and improved concurrency handling for parallel test execution
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
	defer func() {
		if err := adminDB.Close(); err != nil {
			t.Logf("Warning: error closing admin database connection: %v", err)
		}
	}()

	// Use PostgreSQL advisory lock to coordinate database operations across parallel tests
	// Hash the database name to create a unique lock ID
	lockID := int64(hashString(cfg.Database))

	// Acquire advisory lock (blocks until available)
	acquireLockQuery := fmt.Sprintf("SELECT pg_advisory_lock(%d)", lockID)
	if _, err := adminDB.Exec(acquireLockQuery); err != nil {
		t.Fatalf("Failed to acquire advisory lock: %v", err)
	}

	// Ensure lock is released even if test fails
	defer func() {
		releaseLockQuery := fmt.Sprintf("SELECT pg_advisory_unlock(%d)", lockID)
		if _, err := adminDB.Exec(releaseLockQuery); err != nil {
			t.Logf("Warning: Failed to release advisory lock: %v", err)
		}
	}()

	// Check if test database exists and is usable
	checkDBQuery := fmt.Sprintf(`
		SELECT 1 FROM pg_database WHERE datname = '%s'
	`, cfg.Database)
	var dbExists bool
	err = adminDB.QueryRow(checkDBQuery).Scan(&dbExists)
	if err != nil && err != sql.ErrNoRows {
		t.Logf("Note: Could not check if database exists: %v", err)
		dbExists = false
	}

	// Try to connect to existing database to verify it's usable
	if dbExists {
		testDB, testErr := sql.Open("postgres", cfg.DatabaseURL())
		if testErr == nil {
			// Try to ping the database
			if pingErr := testDB.Ping(); pingErr == nil {
				// Database exists and is accessible, check if PostGIS is available
				var extExists bool
				extCheckQuery := `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')`
				if extCheckErr := testDB.QueryRow(extCheckQuery).Scan(&extExists); extCheckErr == nil && extExists {
					// Database is usable, close test connection and return a new one
					if closeErr := testDB.Close(); closeErr != nil {
						t.Logf("Warning: error closing test database connection: %v", closeErr)
					}

					// Return a fresh connection to the existing database
					db, err := sql.Open("postgres", cfg.DatabaseURL())
					if err != nil {
						t.Fatalf("Failed to connect to test database: %v", err)
					}
					if err := db.Ping(); err != nil {
						t.Fatalf("Failed to ping test database: %v", err)
					}
					return db
				}
			}
			if closeErr := testDB.Close(); closeErr != nil {
				t.Logf("Warning: error closing test database connection: %v", closeErr)
			}
		}
	}

	// Database doesn't exist or isn't usable, create/recreate it
	if dbExists {
		// Terminate any existing connections to the test database
		terminateQuery := fmt.Sprintf(`
			SELECT pg_terminate_backend(pg_stat_activity.pid)
			FROM pg_stat_activity
			WHERE pg_stat_activity.datname = '%s'
			AND pid <> pg_backend_pid()
		`, cfg.Database)
		if _, err := adminDB.Exec(terminateQuery); err != nil {
			t.Logf("Note: Terminating connections (may fail if no connections exist): %v", err)
		}

		// Wait for connections to close
		time.Sleep(100 * time.Millisecond)

		// Drop test database with exponential backoff retry
		maxRetries := 5
		var dropErr error
		for attempt := 0; attempt < maxRetries; attempt++ {
			// Try DROP DATABASE WITH (FORCE) first (PostgreSQL 13+)
			_, dropErr = adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", cfg.Database))
			if dropErr == nil {
				break
			}

			// If FORCE fails, try regular DROP
			if attempt == 0 {
				_, dropErr = adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s", cfg.Database))
				if dropErr == nil {
					break
				}
			}

			// Check if error is because database doesn't exist (which is fine)
			if pqErr, ok := dropErr.(*pq.Error); ok {
				if pqErr.Code == "3D000" { // invalid_catalog_name - database doesn't exist
					dropErr = nil
					break
				}
			}

			// Retry with exponential backoff
			if attempt < maxRetries-1 {
				backoff := time.Duration(50*(1<<uint(attempt))) * time.Millisecond
				t.Logf("Warning: Drop attempt %d failed: %v, retrying in %v...", attempt+1, dropErr, backoff)
				time.Sleep(backoff)

				// Terminate connections again before retry
				if _, termErr := adminDB.Exec(terminateQuery); termErr != nil {
					t.Logf("Note: Re-terminating connections: %v", termErr)
				}
			}
		}

		if dropErr != nil {
			t.Fatalf("Failed to drop test database after %d attempts: %v", maxRetries, dropErr)
		}

		// Wait a moment to ensure database is fully dropped
		time.Sleep(100 * time.Millisecond)
	}

	// Create test database with exponential backoff retry
	maxCreateRetries := 5
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
			break
		}

		// Check if error is because database already exists
		if pqErr, ok := createErr.(*pq.Error); ok {
			if pqErr.Code == "42P04" { // duplicate_database
				// Database exists, verify it's usable
				var exists bool
				if checkErr := adminDB.QueryRow(checkDBQuery).Scan(&exists); checkErr == nil && exists {
					break
				}
			}
		}

		// Retry with exponential backoff
		if attempt < maxCreateRetries-1 {
			backoff := time.Duration(50*(1<<uint(attempt))) * time.Millisecond
			t.Logf("Warning: Create attempt %d failed: %v, retrying in %v...", attempt+1, createErr, backoff)
			time.Sleep(backoff)
		}
	}

	if createErr != nil {
		// Final check if database exists
		var exists bool
		checkErr := adminDB.QueryRow(checkDBQuery).Scan(&exists)
		if checkErr == nil && exists {
			// Database exists now, use it
		} else {
			t.Fatalf("Failed to create test database after %d attempts: %v", maxCreateRetries, createErr)
		}
	}

	// Wait a moment for database to be ready
	time.Sleep(50 * time.Millisecond)

	// Connect to test database
	db, err := sql.Open("postgres", cfg.DatabaseURL())
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}

	// Verify connection with retry
	maxPingRetries := 5
	for attempt := 0; attempt < maxPingRetries; attempt++ {
		if err := db.Ping(); err == nil {
			break
		}
		if attempt < maxPingRetries-1 {
			backoff := time.Duration(50*(1<<uint(attempt))) * time.Millisecond
			time.Sleep(backoff)
		} else {
			t.Fatalf("Failed to ping test database after %d attempts: %v", maxPingRetries, err)
		}
	}

	// Set up PostGIS extension with retry
	maxExtRetries := 3
	for attempt := 0; attempt < maxExtRetries; attempt++ {
		_, err = db.Exec("CREATE EXTENSION IF NOT EXISTS postgis")
		if err == nil {
			break
		}

		// Check if error is due to extension already existing (race condition)
		if pqErr, ok := err.(*pq.Error); ok {
			if pqErr.Code == "23505" { // unique_violation
				// Extension already exists, which is fine
				break
			}
		}

		if attempt < maxExtRetries-1 {
			backoff := time.Duration(50*(1<<uint(attempt))) * time.Millisecond
			time.Sleep(backoff)
		} else {
			t.Fatalf("Failed to create PostGIS extension after %d attempts: %v", maxExtRetries, err)
		}
	}

	return db
}

// hashString creates a simple hash of a string for use as an advisory lock ID
func hashString(s string) int64 {
	var hash int64
	for _, c := range s {
		hash = hash*31 + int64(c)
	}
	// Ensure positive value (PostgreSQL advisory locks use signed integers)
	if hash < 0 {
		hash = -hash
	}
	return hash
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
