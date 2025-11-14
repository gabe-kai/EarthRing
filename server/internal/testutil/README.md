# Test Utilities

This package provides testing utilities and helpers for EarthRing server tests.

## Packages

### `database.go` - Database Testing Utilities

Provides helpers for setting up test databases:

- `SetupTestDB(t *testing.T) *sql.DB` - Creates a test database connection with PostGIS
- `CleanupTestDB(t *testing.T, db *sql.DB)` - Cleans up test database tables
- `TestDBConfig` - Configuration for test databases

**Example:**
```go
func TestDatabase(t *testing.T) {
    db := testutil.SetupTestDB(t)
    defer db.Close()
    defer testutil.CleanupTestDB(t, db)
    
    // Your test code here
}
```

### `http.go` - HTTP Testing Utilities

Provides helpers for HTTP handler testing:

- `HTTPTestHelper` - Helper for making HTTP requests in tests
- `ParseJSONResponse` - Parse JSON response bodies
- `AssertJSONResponse` - Assert JSON response structure

**Example:**
```go
func TestHandler(t *testing.T) {
    handler := http.HandlerFunc(myHandler)
    helper := testutil.NewHTTPTestHelper(handler)
    
    rr := helper.MakeRequest("GET", "/api/endpoint", nil)
    
    if rr.Code != http.StatusOK {
        t.Errorf("Expected 200, got %d", rr.Code)
    }
}
```

### `fixtures.go` - Test Data Generators

Provides test data generators:

- `RandomString(length int)` - Generate random strings
- `RandomUsername()` - Generate random usernames
- `RandomEmail()` - Generate random email addresses
- `NewTestPlayer()` - Create test player data
- `NewTestZone()` - Create test zone data

**Example:**
```go
func TestPlayer(t *testing.T) {
    fixtures := testutil.NewTestFixtures()
    player := fixtures.NewTestPlayer()
    
    // Use player.Username, player.Email, player.Password
}
```

## Environment Variables

Test utilities use the following environment variables (with defaults):

- `TEST_DB_HOST` (default: `localhost`)
- `TEST_DB_PORT` (default: `5432`)
- `TEST_DB_USER` (default: `postgres`)
- `TEST_DB_PASSWORD` (default: `postgres`)
- `TEST_DB_NAME` (default: `earthring_test`)

## Best Practices

1. Always close database connections in tests
2. Use `defer` for cleanup operations
3. Use fixtures for test data generation
4. Keep tests isolated and independent
5. Use descriptive test names

## Dependencies

- `github.com/lib/pq` - PostgreSQL driver
- Standard library: `database/sql`, `net/http`, `testing`

