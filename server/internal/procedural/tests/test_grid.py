"""
Tests for grid-based city layout generation.
"""

import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(server_dir))

import pytest
from internal.procedural import grid


def test_generate_city_grid_basic():
    """Test basic city grid generation"""
    # Simple square zone
    zone_polygon = [[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0], [0.0, 0.0]]]
    zone_type = "industrial"
    zone_importance = 0.5
    chunk_seed = 12345
    
    cells = grid.generate_city_grid(zone_polygon, zone_type, zone_importance, chunk_seed)
    
    assert len(cells) > 0
    
    # Check cell structure
    for cell in cells:
        assert "type" in cell
        assert "position" in cell
        assert "bounds" in cell
        assert "seed" in cell
        assert cell["type"] in ["building", "park", "road", "plaza"]
        assert len(cell["position"]) == 2
        assert "min_x" in cell["bounds"]
        assert "min_y" in cell["bounds"]
        assert "max_x" in cell["bounds"]
        assert "max_y" in cell["bounds"]


def test_grid_cell_size():
    """Test grid cells are 50m × 50m"""
    zone_polygon = [[[0.0, 0.0], [200.0, 0.0], [200.0, 200.0], [0.0, 200.0], [0.0, 0.0]]]
    zone_type = "commercial"
    zone_importance = 0.5
    chunk_seed = 12345
    
    cells = grid.generate_city_grid(zone_polygon, zone_type, zone_importance, chunk_seed)
    
    # Check cell bounds are 50m apart
    if len(cells) > 1:
        cell1 = cells[0]
        cell_width = cell1["bounds"]["max_x"] - cell1["bounds"]["min_x"]
        cell_height = cell1["bounds"]["max_y"] - cell1["bounds"]["min_y"]
        
        assert abs(cell_width - grid.GRID_CELL_SIZE) < 0.01
        assert abs(cell_height - grid.GRID_CELL_SIZE) < 0.01


def test_grid_deterministic():
    """Test grid generation is deterministic"""
    zone_polygon = [[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0], [0.0, 0.0]]]
    zone_type = "industrial"
    zone_importance = 0.5
    chunk_seed = 99999
    
    cells1 = grid.generate_city_grid(zone_polygon, zone_type, zone_importance, chunk_seed)
    cells2 = grid.generate_city_grid(zone_polygon, zone_type, zone_importance, chunk_seed)
    
    # Same inputs should produce same grid
    assert len(cells1) == len(cells2)
    
    # Check positions match
    positions1 = [tuple(c["position"]) for c in cells1]
    positions2 = [tuple(c["position"]) for c in cells2]
    assert set(positions1) == set(positions2)


def test_grid_zone_type_distribution():
    """Test grid respects zone type distribution"""
    # Use a larger zone (500x500m) to minimize edge effects
    # With 50m grid cells, this gives 10x10 = 100 cells
    # Most cells will be interior, giving a better distribution test
    zone_polygon = [[[0.0, 0.0], [500.0, 0.0], [500.0, 500.0], [0.0, 500.0], [0.0, 0.0]]]
    
    # Industrial zones should have high building density
    industrial_cells = grid.generate_city_grid(
        zone_polygon, "industrial", 0.5, 12345
    )
    building_cells = [c for c in industrial_cells if c["type"] == "building"]
    building_ratio = len(building_cells) / len(industrial_cells) if industrial_cells else 0
    
    # Industrial zones should have ~85% buildings, but edge cells reduce this significantly
    # With edge detection at 75m, a 500x500 zone still has many edge cells
    # The actual ratio depends on the specific seed and randomness
    # For deterministic testing, we just verify buildings are being generated
    assert building_ratio > 0.5  # At least half should be buildings (accounts for edge cells)
    
    # Commercial zones should also have high building density
    commercial_cells = grid.generate_city_grid(
        zone_polygon, "commercial", 0.5, 67890  # Different seed
    )
    commercial_buildings = [c for c in commercial_cells if c["type"] == "building"]
    commercial_ratio = len(commercial_buildings) / len(commercial_cells) if commercial_cells else 0
    
    # Commercial zones should have ~80% buildings, but edge cells reduce this significantly
    assert commercial_ratio > 0.5  # At least half should be buildings (accounts for edge cells)


def test_grid_narrow_zone():
    """Test grid generation for narrow zones (less than 3 cells wide)"""
    # Narrow zone (80m wide, less than 3×50m = 150m)
    zone_polygon = [[[0.0, -40.0], [100.0, -40.0], [100.0, 40.0], [0.0, 40.0], [0.0, -40.0]]]
    zone_type = "industrial"
    zone_importance = 0.5
    chunk_seed = 12345
    
    cells = grid.generate_city_grid(zone_polygon, zone_type, zone_importance, chunk_seed)
    
    # Narrow zones should still generate buildings (not all edge cells)
    building_cells = [c for c in cells if c["type"] == "building"]
    
    # Should have at least some building cells
    assert len(building_cells) > 0


def test_grid_empty_zone():
    """Test grid generation handles empty/invalid zones"""
    # Empty polygon
    zone_polygon = []
    cells = grid.generate_city_grid(zone_polygon, "industrial", 0.5, 12345)
    assert cells == []
    
    # Invalid polygon (less than 3 points)
    zone_polygon = [[[0.0, 0.0], [100.0, 0.0]]]
    cells = grid.generate_city_grid(zone_polygon, "industrial", 0.5, 12345)
    assert cells == []

