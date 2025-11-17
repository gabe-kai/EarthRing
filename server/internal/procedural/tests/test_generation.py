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
    """Test chunk width calculation with station flares"""
    floor = 0
    chunk_index = 100  # 100km from position 0 (outside flare range)
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)

    width = generation.get_chunk_width(floor, chunk_index, chunk_seed)

    # Should return base width (400m) since chunk 100 is outside station flare range
    assert width == 400.0
    assert isinstance(width, float)

    # Test at hub center (chunk 0) - should have max width
    width_at_hub = generation.get_chunk_width(0, 0, chunk_seed)
    assert width_at_hub > 20000.0  # Should be close to max width (25km)
    assert width_at_hub <= 25000.0


def test_generate_empty_chunk():
    """Test chunk generation (now generates geometry in Phase 2)"""
    floor = 0
    chunk_index = 100
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)

    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)

    assert chunk["chunk_id"] == "0_100"
    assert chunk["floor"] == 0
    assert chunk["chunk_index"] == 100
    assert chunk["seed"] == chunk_seed
    # Geometry should be present (Phase 2)
    assert chunk["geometry"] is not None
    assert chunk["geometry"]["type"] == "ring_floor"
    assert len(chunk["geometry"]["vertices"]) == 4
    assert len(chunk["geometry"]["faces"]) == 2
    # Width should be base width (400m) since chunk 100 is outside station flare range
    assert chunk["geometry"]["width"] == 400.0
    assert chunk["geometry"]["length"] == 1000.0
    # Check vertices are in absolute positions
    assert chunk["geometry"]["vertices"][0][0] == chunk_index * 1000.0  # X position
    assert chunk["geometry"]["vertices"][0][2] == floor  # Z position (floor)
    assert chunk["structures"] == []
    assert chunk["zones"] == []
    assert chunk["metadata"]["generated"] is True
    assert chunk["metadata"]["version"] == 2  # Phase 2 version


def test_generate_ring_floor_geometry():
    """Test ring floor geometry generation"""
    from internal.procedural import generation

    chunk_width = 400.0
    geometry = generation.generate_ring_floor_geometry(chunk_width)

    assert geometry["type"] == "ring_floor"
    assert geometry["width"] == 400.0
    assert geometry["length"] == 1000.0
    assert len(geometry["vertices"]) == 4
    assert len(geometry["faces"]) == 2
    assert len(geometry["normals"]) == 2

    # Check vertices are relative positions (will be adjusted in generate_chunk)
    assert geometry["vertices"][0] == [0.0, -200.0, 0.0]  # Bottom-left
    assert geometry["vertices"][1] == [1000.0, -200.0, 0.0]  # Bottom-right
    assert geometry["vertices"][2] == [1000.0, 200.0, 0.0]  # Top-right
    assert geometry["vertices"][3] == [0.0, 200.0, 0.0]  # Top-left

    # Check faces are triangles
    assert geometry["faces"][0] == [0, 1, 2]
    assert geometry["faces"][1] == [0, 2, 3]

    # Check normals point up (Z direction in EarthRing)
    assert geometry["normals"][0] == [0.0, 0.0, 1.0]
    assert geometry["normals"][1] == [0.0, 0.0, 1.0]
