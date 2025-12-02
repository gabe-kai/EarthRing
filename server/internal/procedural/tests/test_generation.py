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


def test_generate_chunk():
    """Test chunk generation (generates smooth curved geometry in Phase 2)"""
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
    # Chunks now include default zones (restricted maglev zones)
    assert isinstance(chunk["zones"], list)
    assert len(chunk["zones"]) > 0  # Should have at least one default zone
    # Check that zones have required fields
    for zone in chunk["zones"]:
        assert "geometry" in zone
        assert "properties" in zone
    # Chunk 100 is outside hub areas, so no structures expected
    assert isinstance(chunk["structures"], list)
    assert chunk["metadata"]["generated"] is True
    assert chunk["metadata"]["version"] == 6  # Phase 2 with 4m floor system and new window types version


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


def test_structure_format_includes_building_subtype():
    """Test that structures generated include building_subtype"""
    floor = 0
    chunk_index = 0  # Hub chunk that should have buildings
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    # Should have structures at hub
    assert len(chunk["structures"]) > 0
    
    for structure in chunk["structures"]:
        assert "id" in structure
        assert "structure_type" in structure
        assert "dimensions" in structure
        assert "building_subtype" in structure
        # Heights should be valid (5, 10, 15, or 20m)
        assert structure["dimensions"]["height"] in [5.0, 10.0, 15.0, 20.0]
        # Verify building_subtype matches expected values
        if structure["structure_type"] == "industrial":
            assert structure["building_subtype"] in ["warehouse", "factory"]
        elif structure["structure_type"] == "agricultural":
            assert structure["building_subtype"] in ["residence", "agri_industrial"]


def test_generate_chunk_with_buildings():
    """Test chunk generation at hub center includes buildings"""
    floor = 0
    chunk_index = 0  # Hub center chunk
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    assert chunk["chunk_id"] == "0_0"
    # Hub chunks should have zones (restricted, industrial, commercial, mixed-use)
    assert len(chunk["zones"]) > 1
    
    # Hub chunks should have structures (buildings)
    assert isinstance(chunk["structures"], list)
    assert len(chunk["structures"]) > 0
    
    # Check structure format
    if chunk["structures"]:
        structure = chunk["structures"][0]
        assert "id" in structure
        assert "structure_type" in structure
        assert "position" in structure
        assert "floor" in structure
        assert structure["position"]["x"] is not None
        assert structure["position"]["y"] is not None
        assert structure["floor"] == floor
        assert structure.get("is_procedural", False) is True


def test_building_boundary_validation():
    """Test that buildings are validated to stay within zone boundaries"""
    floor = 0
    chunk_index = 0  # Hub center chunk
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    # Get zones and structures
    zones = chunk["zones"]
    structures = chunk["structures"]
    
    if not structures:
        pytest.skip("No structures generated for this chunk")
    
    # For each structure, verify it's within a zone
    import shapely.geometry as sg
    
    for structure in structures:
        pos_x = structure["position"]["x"]
        pos_y = structure["position"]["y"]
        
        # Find the zone this structure belongs to
        structure_in_zone = False
        for zone in zones:
            zone_type = zone.get("properties", {}).get("zone_type", "").lower()
            if zone_type not in ["industrial", "commercial", "mixed_use"]:
                continue
            
            # Check if structure center is in zone
            zone_coords = zone["geometry"]["coordinates"][0]
            zone_poly = sg.Polygon(zone_coords)
            structure_point = sg.Point(pos_x, pos_y)
            
            if zone_poly.contains(structure_point):
                # Check that building corners are also within zone
                width = structure["dimensions"]["width"]
                depth = structure["dimensions"]["depth"]
                half_width = width / 2.0
                half_depth = depth / 2.0
                
                corners = [
                    sg.Point(pos_x - half_width, pos_y - half_depth),
                    sg.Point(pos_x + half_width, pos_y - half_depth),
                    sg.Point(pos_x + half_width, pos_y + half_depth),
                    sg.Point(pos_x - half_width, pos_y + half_depth),
                ]
                
                # All corners should be within zone
                all_within = all(zone_poly.contains(corner) for corner in corners)
                assert all_within, f"Building at ({pos_x}, {pos_y}) extends outside zone"
                structure_in_zone = True
                break
        
        # Structure should belong to at least one zone
        assert structure_in_zone, f"Structure at ({pos_x}, {pos_y}) not in any zone"
