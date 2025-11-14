# Testing Framework

This directory contains the testing framework and utilities for EarthRing.

## Structure

- `conftest.py` - Pytest configuration and fixtures
- `test_basic.py` - Basic test to verify setup
- `test_database.py` - Database integration tests

## Usage

### Running Tests

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_database.py

# Run with coverage
pytest --cov=. --cov-report=html
```

### Test Fixtures

The `conftest.py` file provides several fixtures:

- `db_config` - Database configuration for tests
- `db_connection` - Database connection (function-scoped)
- `db_cursor` - Database cursor (function-scoped)
- `clean_db` - Cleans database before/after each test
- `test_data` - Test data generators

### Example Test

```python
def test_example(db_connection, clean_db):
    """Example test using fixtures."""
    cursor = db_connection.cursor()
    cursor.execute("SELECT 1")
    result = cursor.fetchone()
    assert result[0] == 1
    cursor.close()
```

## Environment Variables

Tests use the following environment variables (with defaults):

- `TEST_DB_HOST` (default: `localhost`)
- `TEST_DB_PORT` (default: `5432`)
- `TEST_DB_USER` (default: `postgres`)
- `TEST_DB_PASSWORD` (default: `postgres`)
- `TEST_DB_NAME` (default: `earthring_test`)

## Database Setup

Tests require a PostgreSQL database with PostGIS extension. The `clean_db` fixture will automatically clean tables before and after each test.

## Best Practices

1. Use fixtures for database connections and cleanup
2. Keep tests isolated - each test should be independent
3. Use descriptive test names
4. Clean up resources in fixtures
5. Use `clean_db` fixture for tests that modify database state

