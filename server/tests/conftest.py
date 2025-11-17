"""
Pytest configuration and fixtures for EarthRing tests.
"""

import os
import sys
from pathlib import Path

import pytest

# Try to load .env file from multiple locations (similar to Go testutil)
# Try multiple paths for .env file
env_paths = [
    ".env",  # Current directory
    Path(__file__).parent.parent / ".env",  # server/.env
    Path(__file__).parent.parent.parent / ".env",  # project root .env
    Path(__file__).parent.parent
    / "server"
    / ".env",  # server/server/.env (if running from subdirectory)
]

# Try to load python-dotenv if available
try:
    from dotenv import load_dotenv

    DOTENV_AVAILABLE = True
    # Try to load .env from any of the paths
    loaded = False
    for env_path in env_paths:
        if isinstance(env_path, Path):
            env_path_str = str(env_path)
        else:
            env_path_str = env_path
        if os.path.exists(env_path_str):
            load_dotenv(env_path_str, override=False)
            loaded = True
            break
    if not loaded:
        # Try to load from any path even if it doesn't exist (dotenv will handle it)
        for env_path in env_paths:
            if isinstance(env_path, Path):
                env_path_str = str(env_path)
            else:
                env_path_str = env_path
            try:
                load_dotenv(env_path_str, override=False)
                loaded = True
                break
            except Exception:
                pass
except ImportError:
    DOTENV_AVAILABLE = False
    # Continue without dotenv - will use environment variables directly

# Import psycopg2 with graceful handling if not available
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    pytest.skip("psycopg2 not available", allow_module_level=True)


@pytest.fixture(scope="session")
def db_config():
    """Database configuration for tests."""
    # Load .env if available (already done at module level, but ensure it's loaded)
    if DOTENV_AVAILABLE:
        for env_path in env_paths:
            if isinstance(env_path, Path):
                env_path_str = str(env_path)
            else:
                env_path_str = env_path
            if os.path.exists(env_path_str):
                from dotenv import load_dotenv

                load_dotenv(env_path_str, override=False)
                break

    return {
        "host": os.getenv("TEST_DB_HOST", "localhost"),
        "port": int(os.getenv("TEST_DB_PORT", "5432")),
        "user": os.getenv("TEST_DB_USER", "postgres"),
        "password": os.getenv("TEST_DB_PASSWORD", "postgres"),
        "database": os.getenv("TEST_DB_NAME", "earthring_test"),
    }


@pytest.fixture(scope="function")
def db_connection(db_config):
    """Create a database connection for tests."""
    conn = psycopg2.connect(**db_config)
    yield conn
    conn.close()


@pytest.fixture(scope="function")
def db_cursor(db_connection):
    """Create a database cursor for tests."""
    cursor = db_connection.cursor(cursor_factory=RealDictCursor)
    yield cursor
    cursor.close()


@pytest.fixture(scope="function")
def clean_db(db_connection):
    """Clean the database before each test."""
    cursor = db_connection.cursor()

    # Drop all tables in reverse order of dependencies
    tables = [
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
    ]

    for table in tables:
        cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    db_connection.commit()
    cursor.close()

    yield

    # Cleanup after test
    cursor = db_connection.cursor()
    for table in tables:
        cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    db_connection.commit()
    cursor.close()


@pytest.fixture
def test_data():
    """Generate test data."""
    import random
    import string

    def random_string(length=10):
        return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))

    def random_username():
        return f"testuser_{random_string(8)}"

    def random_email():
        return f"test_{random_string(8)}@example.com"

    return {
        "random_string": random_string,
        "random_username": random_username,
        "random_email": random_email,
    }
