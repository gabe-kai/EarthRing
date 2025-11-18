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
    """Test chunk generation (now generates smooth curved geometry in Phase 2)"""
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
    # With 50m sample interval, we get 21 samples (0, 50, 100, ..., 1000)
    # Each sample has 2 vertices (left and right edge), so 42 vertices total
    # 20 quads * 2 triangles = 40 faces
    assert len(chunk["geometry"]["vertices"]) == 42  # 21 samples * 2 vertices
    assert len(chunk["geometry"]["faces"]) == 40  # 20 quads * 2 triangles
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
    """Test smooth curved ring floor geometry generation"""
    from internal.procedural import generation

    chunk_index = 100  # Chunk 100 (outside flare range, should be 400m width)
    floor = 0
    geometry = generation.generate_ring_floor_geometry(chunk_index, floor)

    assert geometry["type"] == "ring_floor"
    assert geometry["width"] == 400.0  # Base width for chunk 100
    assert geometry["length"] == 1000.0
    # With 50m sample interval: 21 samples * 2 vertices = 42 vertices
    # 20 quads * 2 triangles = 40 faces
    assert len(geometry["vertices"]) == 42
    assert len(geometry["faces"]) == 40
    assert len(geometry["normals"]) == 40

    # Check first vertex (left edge at start of chunk)
    assert geometry["vertices"][0] == [0.0, -200.0, 0.0]  # Left edge, -half_width
    # Check second vertex (right edge at start of chunk)
    assert geometry["vertices"][1] == [0.0, 200.0, 0.0]  # Right edge, +half_width
    
    # Check last vertex (right edge at end of chunk)
    assert geometry["vertices"][-1] == [1000.0, 200.0, 0.0]  # Right edge at end

    # Check faces are triangles (first quad)
    assert geometry["faces"][0] == [0, 2, 1]  # First triangle of first quad
    assert geometry["faces"][1] == [1, 2, 3]  # Second triangle of first quad

    # Check normals point up (Z direction in EarthRing)
    assert geometry["normals"][0] == [0.0, 0.0, 1.0]
    assert geometry["normals"][1] == [0.0, 0.0, 1.0]
