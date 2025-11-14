"""
Database integration tests for EarthRing.
"""

import pytest
from conftest import db_connection, db_cursor, clean_db


def test_database_connection(db_connection):
    """Test that we can connect to the database."""
    cursor = db_connection.cursor()
    cursor.execute("SELECT 1")
    result = cursor.fetchone()
    assert result[0] == 1
    cursor.close()


def test_postgis_extension(db_connection):
    """Test that PostGIS extension is available."""
    cursor = db_connection.cursor()
    cursor.execute("SELECT PostGIS_version()")
    result = cursor.fetchone()
    assert result is not None
    assert len(result[0]) > 0  # Version string should not be empty
    cursor.close()


def test_database_cleanup(clean_db, db_connection):
    """Test that database cleanup works."""
    cursor = db_connection.cursor()
    
    # Try to query a table that should not exist after cleanup
    cursor.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'players'
    """)
    result = cursor.fetchone()
    assert result is None  # Table should not exist after cleanup
    cursor.close()

