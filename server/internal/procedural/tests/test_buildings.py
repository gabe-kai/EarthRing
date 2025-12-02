"""
Tests for building generation functions.
"""

import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(server_dir))

import pytest
from internal.procedural import buildings


def test_get_building_seed():
    """Test building seed generation"""
    chunk_seed = 12345
    cell_x = 10
    cell_y = 20
    
    seed1 = buildings.get_building_seed(chunk_seed, cell_x, cell_y)
    seed2 = buildings.get_building_seed(chunk_seed, cell_x, cell_y)
    
    # Same inputs should produce same seed
    assert seed1 == seed2
    assert isinstance(seed1, int)
    
    # Different cell positions should produce different seeds
    seed3 = buildings.get_building_seed(chunk_seed, cell_x + 1, cell_y)
    assert seed1 != seed3


def test_generate_building_agricultural():
    """Test building generation for agricultural zone"""
    position = (150.0, 100.0)
    zone_type = "agricultural"
    zone_importance = 0.4
    building_seed = 99999
    floor = 0
    
    building = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    assert building["building_type"] == "agricultural"
    assert "building_subtype" in building
    assert building["building_subtype"] in ["residence", "agri_industrial"]
    # Heights should be 5, 10, 15, or 20m (within a single 20m level)
    assert building["dimensions"]["height"] in [5.0, 10.0, 15.0, 20.0]
    # Residences are typically low (5-10m), agri-industrial varies (10-20m)
    if building["building_subtype"] == "residence":
        assert building["dimensions"]["height"] in [5.0, 10.0]
    elif building["building_subtype"] == "agri_industrial":
        assert building["dimensions"]["height"] in [10.0, 15.0, 20.0]


def test_generate_building_industrial():
    """Test building generation for industrial zone"""
    position = (100.0, -150.0)
    zone_type = "industrial"
    zone_importance = 0.5
    building_seed = 12345
    floor = 0
    
    building = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    assert building["type"] == "building"
    assert building["building_type"] == "industrial"
    assert building["position"] == [100.0, -150.0, 0]
    assert "dimensions" in building
    assert building["dimensions"]["width"] >= 20.0
    assert building["dimensions"]["width"] <= 80.0  # Increased for warehouses/factories
    assert building["dimensions"]["depth"] >= 20.0
    assert building["dimensions"]["depth"] <= 80.0  # Increased for warehouses/factories
    assert "building_subtype" in building
    assert building["building_subtype"] in ["warehouse", "factory"]
    # Heights should be 5, 10, 15, or 20m (within a single 20m level)
    assert building["dimensions"]["height"] in [5.0, 10.0, 15.0, 20.0]
    # Warehouses are typically low (5-10m), factories are medium (10-15m)
    if building["building_subtype"] == "warehouse":
        assert building["dimensions"]["height"] in [5.0, 10.0]
    elif building["building_subtype"] == "factory":
        assert building["dimensions"]["height"] in [10.0, 15.0]
    assert "windows" in building
    assert isinstance(building["windows"], list)
    assert "properties" in building
    assert building["properties"]["seed"] == building_seed
    assert building["properties"]["zone_type"] == zone_type
    assert building["properties"]["floor"] == floor


def test_generate_building_commercial():
    """Test building generation for commercial zone"""
    position = (200.0, 150.0)
    zone_type = "commercial"
    zone_importance = 0.7
    building_seed = 67890
    floor = 0
    
    building = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    assert building["building_type"] == "commercial"
    assert "building_subtype" in building
    assert building["dimensions"]["width"] >= 15.0
    # Commercial can be larger now (up to 45m base, scaled up)
    assert building["dimensions"]["width"] <= 80.0
    # Heights should be 15m or 20m (commercial buildings are typically tall)
    assert building["dimensions"]["height"] in [15.0, 20.0]


def test_generate_building_mixed_use():
    """Test building generation for mixed-use zone"""
    position = (300.0, 0.0)
    zone_type = "mixed_use"
    zone_importance = 0.6
    building_seed = 11111
    floor = 0
    
    building = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    assert building["building_type"] == "mixed_use"
    assert "building_subtype" in building
    assert building["dimensions"]["width"] >= 12.0
    # Account for importance scaling: max base (35.0) * max scale (1.3) = 45.5, clamped to MAX_BUILDING_WIDTH (80.0)
    assert building["dimensions"]["width"] <= 80.0
    # Heights should be 15m or 20m (commercial buildings are typically tall)
    assert building["dimensions"]["height"] in [15.0, 20.0]


def test_building_deterministic():
    """Test that same seed produces same building"""
    position = (100.0, 100.0)
    zone_type = "industrial"
    zone_importance = 0.5
    building_seed = 99999
    floor = 0
    
    building1 = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    building2 = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    # Same inputs should produce identical buildings
    assert building1["dimensions"] == building2["dimensions"]
    assert building1["building_subtype"] == building2["building_subtype"]
    assert len(building1["windows"]) == len(building2["windows"])


def test_building_windows():
    """Test window generation"""
    position = (100.0, 100.0)
    zone_type = "commercial"
    zone_importance = 0.5
    building_seed = 12345
    floor = 0
    
    building = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    windows = building["windows"]
    assert len(windows) > 0
    
    # Check window structure
    for window in windows:
        assert "position" in window
        assert "size" in window
        assert "facade" in window
        assert len(window["position"]) == 3
        assert len(window["size"]) == 2
        assert window["facade"] in ["front", "back"]


def test_building_corners():
    """Test building corner calculation"""
    position = (100.0, 100.0)
    zone_type = "industrial"
    zone_importance = 0.5
    building_seed = 12345
    floor = 0
    
    building = buildings.generate_building(
        position, zone_type, zone_importance, building_seed, floor
    )
    
    assert "corners" in building
    assert len(building["corners"]) == 4
    
    # Check corners are correctly positioned around center
    width = building["dimensions"]["width"]
    depth = building["dimensions"]["depth"]
    half_width = width / 2.0
    half_depth = depth / 2.0
    
    corners = building["corners"]
    assert corners[0] == [100.0 - half_width, 100.0 - half_depth, 0]  # Bottom-left
    assert corners[1] == [100.0 + half_width, 100.0 - half_depth, 0]  # Bottom-right
    assert corners[2] == [100.0 + half_width, 100.0 + half_depth, 0]  # Top-right
    assert corners[3] == [100.0 - half_width, 100.0 + half_depth, 0]  # Top-left


def test_building_height_constraints():
    """Test that all buildings have valid heights (5, 10, 15, or 20m)"""
    zone_types = ["residential", "commercial", "industrial", "mixed_use", "agricultural"]
    valid_heights = [5.0, 10.0, 15.0, 20.0]
    
    for zone_type in zone_types:
        for i in range(20):  # Test multiple buildings per zone type
            building = buildings.generate_building(
                (100.0 + i, 200.0 + i), zone_type, 0.5, 10000 + i, 0
            )
            height = building["dimensions"]["height"]
            assert height in valid_heights, f"Invalid height {height} for {zone_type} building"
            assert height <= 20.0, f"Height {height} exceeds 20m level limit"


def test_building_footprint_variability():
    """Test that buildings have varied footprints based on type and subtype"""
    # Test industrial buildings - warehouses should be larger than factories on average
    warehouse_widths = []
    factory_widths = []
    
    for i in range(20):
        building = buildings.generate_building(
            (100.0 + i, 200.0 + i), "industrial", 0.5, 20000 + i, 0
        )
        width = building["dimensions"]["width"]
        depth = building["dimensions"]["depth"]
        footprint = width * depth
        
        if building["building_subtype"] == "warehouse":
            warehouse_widths.append(width)
            # Warehouses should be large (35-70m base range)
            assert width >= 20.0
            assert depth >= 20.0
        elif building["building_subtype"] == "factory":
            factory_widths.append(width)
            # Factories should be medium-large (25-55m base range)
            assert width >= 20.0
            assert depth >= 20.0
    
    # Should have both types
    assert len(warehouse_widths) > 0
    assert len(factory_widths) > 0
    
    # Warehouses should generally be larger on average
    avg_warehouse = sum(warehouse_widths) / len(warehouse_widths)
    avg_factory = sum(factory_widths) / len(factory_widths)
    assert avg_warehouse > avg_factory, "Warehouses should be larger than factories on average"


def test_window_density_by_subtype():
    """Test that window density varies by building subtype"""
    # Test that warehouses have fewer windows relative to their size
    warehouse_samples = []
    residence_samples = []
    
    for i in range(20):
        # Generate warehouses
        industrial_building = buildings.generate_building(
            (100.0, 200.0), "industrial", 0.5, 30000 + i, 0
        )
        if industrial_building["building_subtype"] == "warehouse":
            width = industrial_building["dimensions"]["width"]
            depth = industrial_building["dimensions"]["depth"]
            height = industrial_building["dimensions"]["height"]
            surface_area = 2 * (width + depth) * height  # Approximate facade area
            window_count = len(industrial_building["windows"])
            if surface_area > 0:
                warehouse_samples.append(window_count / surface_area)
        
        # Generate agricultural residences
        agri_building = buildings.generate_building(
            (100.0, 200.0), "agricultural", 0.5, 40000 + i, 0
        )
        if agri_building["building_subtype"] == "residence":
            width = agri_building["dimensions"]["width"]
            depth = agri_building["dimensions"]["depth"]
            height = agri_building["dimensions"]["height"]
            surface_area = 2 * (width + depth) * height  # Approximate facade area
            window_count = len(agri_building["windows"])
            if surface_area > 0:
                residence_samples.append(window_count / surface_area)
    
    # Should have samples of both
    if len(warehouse_samples) > 0 and len(residence_samples) > 0:
        avg_warehouse_density = sum(warehouse_samples) / len(warehouse_samples)
        avg_residence_density = sum(residence_samples) / len(residence_samples)
        # Residences should have higher window density (more windows per unit area)
        assert avg_residence_density > avg_warehouse_density, \
            f"Residences should have higher window density than warehouses ({avg_residence_density:.4f} vs {avg_warehouse_density:.4f})"


def test_building_subtype_distribution():
    """Test that building subtypes are distributed correctly"""
    # Industrial: should have both warehouses and factories
    subtypes_seen = set()
    for i in range(30):
        building = buildings.generate_building(
            (100.0 + i, 200.0 + i), "industrial", 0.5, 50000 + i, 0
        )
        subtypes_seen.add(building["building_subtype"])
    
    assert "warehouse" in subtypes_seen
    assert "factory" in subtypes_seen
    
    # Agricultural: should have both residences and agri_industrial
    subtypes_seen = set()
    for i in range(30):
        building = buildings.generate_building(
            (100.0 + i, 200.0 + i), "agricultural", 0.4, 60000 + i, 0
        )
        subtypes_seen.add(building["building_subtype"])
    
    assert "residence" in subtypes_seen
    assert "agri_industrial" in subtypes_seen


def test_residential_building_height_range():
    """Test that residential buildings have appropriate height range"""
    heights_seen = set()
    for i in range(20):
        building = buildings.generate_building(
            (100.0 + i, 200.0 + i), "residential", 0.5, 70000 + i, 0
        )
        height = building["dimensions"]["height"]
        heights_seen.add(height)
        # Residential should be 10, 15, or 20m (taller than agricultural residences)
        assert height in [10.0, 15.0, 20.0]
    
    # Should see some variety
    assert len(heights_seen) > 1, "Residential buildings should have height variety"


def test_building_subtype_in_properties():
    """Test that building_subtype is included in building properties"""
    building = buildings.generate_building(
        (100.0, 200.0), "industrial", 0.5, 80000, 0
    )
    
    assert "building_subtype" in building
    assert "building_subtype" in building["properties"]
    assert building["building_subtype"] == building["properties"]["building_subtype"]

