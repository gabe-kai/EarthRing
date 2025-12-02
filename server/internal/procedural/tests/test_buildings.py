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
    assert building["dimensions"]["width"] <= 40.0
    assert building["dimensions"]["depth"] >= 20.0
    assert building["dimensions"]["depth"] <= 40.0
    assert building["dimensions"]["height"] >= 20.0
    assert building["dimensions"]["height"] <= 60.0
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
    assert building["dimensions"]["width"] >= 15.0
    assert building["dimensions"]["width"] <= 35.0
    assert building["dimensions"]["height"] >= 40.0
    assert building["dimensions"]["height"] <= 100.0


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
    assert building["dimensions"]["width"] >= 12.0
    # Account for importance scaling: max base (30.0) * max scale (1.3) = 39.0, clamped to MAX_BUILDING_WIDTH (40.0)
    assert building["dimensions"]["width"] <= 40.0
    assert building["dimensions"]["height"] >= 40.0
    assert building["dimensions"]["height"] <= 100.0


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

