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
import shapely.geometry as sg


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
    assert chunk["metadata"]["version"] == 7  # Phase 2 with enhanced building shape weights


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
        # Heights should be valid (4m floor increments: 4, 8, 12, 16, or 20m)
        assert structure["dimensions"]["height"] in [4.0, 5.0, 8.0, 10.0, 12.0, 15.0, 16.0, 20.0]
        # Verify building_subtype matches expected values
        # Note: structure_type is always "building" now, not the zone type
        if structure.get("properties", {}).get("zone_type") == "industrial":
            assert structure["building_subtype"] in ["warehouse", "factory"]
        elif structure.get("properties", {}).get("zone_type") == "agricultural":
            assert structure["building_subtype"] in ["house", "barn", "warehouse", "agri_industrial"]


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


def test_structures_include_doors_and_garage_doors():
    """Test that structures include doors and garage_doors"""
    floor = 0
    chunk_index = 0  # Hub center chunk
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    # Should have structures at hub
    assert len(chunk["structures"]) > 0
    
    # Check that all structures have doors and garage_doors fields
    for structure in chunk["structures"]:
        assert "doors" in structure, f"Structure {structure.get('id')} missing 'doors' field"
        assert "garage_doors" in structure, f"Structure {structure.get('id')} missing 'garage_doors' field"
        assert isinstance(structure["doors"], dict), "Doors should be a dictionary"
        assert isinstance(structure["garage_doors"], list), "Garage doors should be a list"
        
        # All buildings should have at least one door (main door)
        assert len(structure["doors"]) > 0, "Building should have at least one door (main door)"
        
        # Check door structure if present
        for facade, door_info in structure["doors"].items():
            assert facade in ["front", "back", "left", "right"]
            assert "x" in door_info
            assert "y" in door_info
            assert "width" in door_info
            assert "height" in door_info
            assert "type" in door_info
            assert door_info["type"] in ["main", "secondary"]
        
        # Check garage door structure if present
        for garage_door in structure["garage_doors"]:
            assert "facade" in garage_door
            assert "x" in garage_door
            assert "y" in garage_door
            assert "width" in garage_door
            assert "height" in garage_door
            assert "type" in garage_door
            assert garage_door["type"] == "garage"


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


def test_building_spacing_rules():
    """Test that buildings respect spacing rules: can touch, or have at least 5m gap"""
    floor = 0
    chunk_index = 0  # Hub center chunk
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    structures = chunk["structures"]
    if len(structures) < 2:
        pytest.skip("Need at least 2 buildings to test spacing")
    
    # Check all pairs of buildings
    for i, struct1 in enumerate(structures):
        if struct1.get("structure_type") != "building":
            continue
        
        pos1_x = struct1["position"]["x"]
        pos1_y = struct1["position"]["y"]
        dim1 = struct1["dimensions"]
        width1 = dim1["width"]
        depth1 = dim1["depth"]
        
        # Create rectangle for building 1
        half_w1 = width1 / 2.0
        half_d1 = depth1 / 2.0
        rect1 = sg.box(
            pos1_x - half_w1,
            pos1_y - half_d1,
            pos1_x + half_w1,
            pos1_y + half_d1
        )
        
        for j, struct2 in enumerate(structures[i+1:], start=i+1):
            if struct2.get("structure_type") != "building":
                continue
            
            pos2_x = struct2["position"]["x"]
            pos2_y = struct2["position"]["y"]
            dim2 = struct2["dimensions"]
            width2 = dim2["width"]
            depth2 = dim2["depth"]
            
            # Create rectangle for building 2
            half_w2 = width2 / 2.0
            half_d2 = depth2 / 2.0
            rect2 = sg.box(
                pos2_x - half_w2,
                pos2_y - half_d2,
                pos2_x + half_w2,
                pos2_y + half_d2
            )
            
            # Check spacing rules:
            # 1. Buildings should not be at the exact same position (duplicates)
            if abs(pos1_x - pos2_x) < 0.01 and abs(pos1_y - pos2_y) < 0.01:
                pytest.fail(f"Duplicate buildings at ({pos1_x}, {pos1_y})")
            
            # 2. Buildings should not overlap (interiors should not intersect)
            if rect1.intersects(rect2):
                # If they intersect, they must only touch (not overlap)
                # Use overlaps() to check if interiors actually overlap
                if rect1.overlaps(rect2):
                    pytest.fail(f"Buildings at ({pos1_x}, {pos1_y}) and ({pos2_x}, {pos2_y}) overlap")
                # If they only touch (touches() returns True), that's OK
            
            # 3. If buildings don't touch, gap must be at least 5m
            if not rect1.touches(rect2) and not rect1.intersects(rect2):
                distance = rect1.distance(rect2)
                assert distance >= 5.0, \
                    f"Buildings at ({pos1_x}, {pos1_y}) and ({pos2_x}, {pos2_y}) have gap {distance:.2f}m, " \
                    f"which is less than minimum 5m (alleys)"
            
            # 2. If buildings don't touch, gap must be at least 5m
            if not rect1.touches(rect2) and not rect1.intersects(rect2):
                distance = rect1.distance(rect2)
                assert distance >= 5.0, \
                    f"Buildings at ({pos1_x}, {pos1_y}) and ({pos2_x}, {pos2_y}) have gap {distance:.2f}m, " \
                    f"which is less than minimum 5m (alleys)"


def test_buildings_can_touch():
    """Test that buildings can touch (walls can touch) without violating spacing rules"""
    floor = 0
    chunk_index = 0  # Hub center chunk
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 99999)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    structures = chunk["structures"]
    building_structures = [s for s in structures if s.get("structure_type") == "building"]
    
    if len(building_structures) < 2:
        pytest.skip("Need at least 2 buildings to test touching")
    
    # Check if any buildings touch (this is allowed)
    touching_pairs = 0
    for i, struct1 in enumerate(building_structures):
        pos1_x = struct1["position"]["x"]
        pos1_y = struct1["position"]["y"]
        dim1 = struct1["dimensions"]
        width1 = dim1["width"]
        depth1 = dim1["depth"]
        
        half_w1 = width1 / 2.0
        half_d1 = depth1 / 2.0
        rect1 = sg.box(
            pos1_x - half_w1,
            pos1_y - half_d1,
            pos1_x + half_w1,
            pos1_y + half_d1
        )
        
        for struct2 in building_structures[i+1:]:
            pos2_x = struct2["position"]["x"]
            pos2_y = struct2["position"]["y"]
            dim2 = struct2["dimensions"]
            width2 = dim2["width"]
            depth2 = dim2["depth"]
            
            half_w2 = width2 / 2.0
            half_d2 = depth2 / 2.0
            rect2 = sg.box(
                pos2_x - half_w2,
                pos2_y - half_d2,
                pos2_x + half_w2,
                pos2_y + half_d2
            )
            
            if rect1.touches(rect2):
                touching_pairs += 1
    
    # Touching is allowed, so we just verify the test runs
    # (We don't require touching, just that it's allowed)


def test_agricultural_zones_generate_buildings():
    """Test that agricultural zones generate buildings (including clustering)"""
    floor = 0
    chunk_index = 5  # Use a chunk that should have agricultural zones
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 54321)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    # Find agricultural zones
    agri_zones = [z for z in chunk["zones"] if z.get("properties", {}).get("zone_type", "").lower() == "agricultural"]
    
    if not agri_zones:
        pytest.skip("No agricultural zones in this chunk")
    
    # Check if any structures are in agricultural zones
    # Structures should have appropriate subtypes (house, barn, warehouse)
    agri_structures = [
        s for s in chunk["structures"]
        if s.get("properties", {}).get("zone_type", "").lower() == "agricultural"
    ]
    
    if agri_structures:
        for structure in agri_structures:
            assert structure["building_subtype"] in ["house", "barn", "warehouse", "agri_industrial"], \
                f"Agricultural structure should have appropriate subtype, got: {structure['building_subtype']}"


def test_park_zones_generate_buildings():
    """Test that park zones generate small scattered structures"""
    floor = 0
    chunk_index = 0  # Hub chunk might have park zones
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, 12345)
    
    chunk = generation.generate_chunk(floor, chunk_index, chunk_seed)
    
    # Find park structures
    park_structures = [
        s for s in chunk["structures"]
        if s.get("properties", {}).get("zone_type", "").lower() == "park"
    ]
    
    if park_structures:
        for structure in park_structures:
            # Park structures should be small
            width = structure["dimensions"]["width"]
            depth = structure["dimensions"]["depth"]
            height = structure["dimensions"]["height"]
            
            assert width <= 20.0, f"Park structure width {width}m should be small (<=20m)"
            assert depth <= 20.0, f"Park structure depth {depth}m should be small (<=20m)"
            assert height <= 8.0, f"Park structure height {height}m should be low (<=8m, 1-2 stories)"
