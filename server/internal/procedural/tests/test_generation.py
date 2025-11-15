"""
Tests for chunk generation functions.
"""

import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(server_dir))

import pytest
from internal.procedural import generation
from internal.procedural import seeds


def test_get_chunk_width():
    """Test chunk width calculation"""
    floor = 0
    chunk_index = 100
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)

    width = generation.get_chunk_width(floor, chunk_index, chunk_seed)

    # Should return base width (400m) for Phase 1
    assert width == 400.0
    assert isinstance(width, float)


def test_generate_empty_chunk():
    """Test empty chunk generation"""
    floor = 0
    chunk_index = 100
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)

    chunk = generation.generate_empty_chunk(floor, chunk_index, chunk_seed)

    assert chunk["chunk_id"] == "0_100"
    assert chunk["floor"] == 0
    assert chunk["chunk_index"] == 100
    assert chunk["seed"] == chunk_seed
    assert chunk["geometry"] is None
    assert chunk["structures"] == []
    assert chunk["zones"] == []
    assert chunk["metadata"]["generated"] is True
