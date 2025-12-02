"""
Building generation functions for Phase 2 MVP.
Generates basic rectangular buildings with simple window patterns.
"""

import random
import math
from typing import Dict, List, Any, Tuple, Optional

# Constants
GRID_CELL_SIZE = 50.0  # 50m × 50m cells
MIN_BUILDING_WIDTH = 10.0  # Minimum building width in meters
MAX_BUILDING_WIDTH = 40.0  # Maximum building width in meters
MIN_BUILDING_DEPTH = 10.0  # Minimum building depth in meters
MAX_BUILDING_DEPTH = 40.0  # Maximum building depth in meters
MIN_BUILDING_HEIGHT = 20.0  # Minimum building height (1 floor = 20m)
MAX_BUILDING_HEIGHT = 100.0  # Maximum building height (5 floors = 100m)

# Window constants
WINDOW_WIDTH = 2.5  # Window width in meters
WINDOW_HEIGHT = 2.5  # Window height in meters
WINDOW_SPACING = 0.5  # Spacing between windows in meters


def seeded_random(seed: int) -> random.Random:
    """Create deterministic random number generator."""
    rng = random.Random(seed)
    return rng


def get_building_seed(chunk_seed: int, cell_x: int, cell_y: int) -> int:
    """Generate deterministic seed for a building cell."""
    return hash((chunk_seed, cell_x, cell_y)) % (2**31)


def generate_building(
    position: Tuple[float, float],
    zone_type: str,
    zone_importance: float,
    building_seed: int,
    floor: int,
) -> Dict[str, Any]:
    """
    Generate a basic rectangular building.
    
    Args:
        position: (x, y) position in EarthRing coordinates
        zone_type: Type of zone (residential, commercial, industrial, etc.)
        zone_importance: Zone importance value (0.0 to 1.0)
        building_seed: Deterministic seed for this building
        floor: Floor number for Z coordinate
    
    Returns:
        Dictionary with building data including geometry and properties
    """
    rng = seeded_random(building_seed)
    
    # Determine building dimensions based on zone type and importance
    width, depth, height = _get_building_dimensions(zone_type, zone_importance, rng)
    
    # Calculate building corners (centered on position)
    half_width = width / 2.0
    half_depth = depth / 2.0
    
    x, y = position
    z = floor  # Floor level (will be converted to meters later)
    
    # Create base rectangle (4 corners)
    corners = [
        [x - half_width, y - half_depth, z],
        [x + half_width, y - half_depth, z],
        [x + half_width, y + half_depth, z],
        [x - half_width, y + half_depth, z],
    ]
    
    # Generate windows for Phase 2 (simple grid pattern)
    windows = _generate_window_grid(width, depth, height, building_seed)
    
    # Building properties
    building = {
        "type": "building",
        "building_type": zone_type,  # residential, commercial, industrial, etc.
        "position": [x, y, z],
        "dimensions": {
            "width": width,
            "depth": depth,
            "height": height,
        },
        "corners": corners,
        "windows": windows,
        "properties": {
            "seed": building_seed,
            "zone_type": zone_type,
            "zone_importance": zone_importance,
            "floor": floor,
        },
    }
    
    return building


def _get_building_dimensions(
    zone_type: str, zone_importance: float, rng: random.Random
) -> Tuple[float, float, float]:
    """
    Get building dimensions based on zone type and importance.
    
    Returns:
        Tuple of (width, depth, height) in meters
    """
    # Base dimensions vary by zone type
    if zone_type == "residential":
        # Residential: medium width/depth, variable height
        base_width = rng.uniform(12.0, 25.0)
        base_depth = rng.uniform(12.0, 25.0)
        base_height = rng.uniform(20.0, 80.0)  # 1-4 floors
    elif zone_type == "commercial":
        # Commercial: wider, taller
        base_width = rng.uniform(15.0, 35.0)
        base_depth = rng.uniform(15.0, 35.0)
        base_height = rng.uniform(40.0, 100.0)  # 2-5 floors
    elif zone_type == "industrial":
        # Industrial: very wide, lower height
        base_width = rng.uniform(20.0, 40.0)
        base_depth = rng.uniform(20.0, 40.0)
        base_height = rng.uniform(20.0, 60.0)  # 1-3 floors
    elif zone_type == "mixed_use":
        # Mixed-use: similar to residential but taller
        base_width = rng.uniform(12.0, 30.0)
        base_depth = rng.uniform(12.0, 30.0)
        base_height = rng.uniform(40.0, 100.0)  # 2-5 floors
    else:
        # Default (agricultural, park, etc.)
        base_width = rng.uniform(10.0, 30.0)
        base_depth = rng.uniform(10.0, 30.0)
        base_height = rng.uniform(20.0, 60.0)
    
    # Scale by zone importance (higher importance = larger buildings)
    scale = 0.7 + (zone_importance * 0.6)  # Scale from 0.7x to 1.3x
    
    width = max(MIN_BUILDING_WIDTH, min(MAX_BUILDING_WIDTH, base_width * scale))
    depth = max(MIN_BUILDING_DEPTH, min(MAX_BUILDING_DEPTH, base_depth * scale))
    height = max(MIN_BUILDING_HEIGHT, min(MAX_BUILDING_HEIGHT, base_height * scale))
    
    return (width, depth, height)


def _generate_window_grid(
    width: float, depth: float, height: float, building_seed: int
) -> List[Dict[str, Any]]:
    """
    Generate simple grid pattern windows for a building.
    
    Phase 2 MVP: Simple rectangular windows in a grid pattern.
    
    Args:
        width: Building width in meters
        depth: Building depth in meters
        height: Building height in meters
        building_seed: Seed for deterministic generation
    
    Returns:
        List of window dictionaries with position and size
    """
    rng = seeded_random(building_seed)
    windows = []
    
    # Window density based on building type (will be passed via building later)
    # For now, use medium density
    density = 0.6  # 60% of facade covered
    
    # Calculate number of windows that fit
    # Account for spacing
    available_width = width - (WINDOW_SPACING * 2)  # Margin from edges
    available_height = height - (WINDOW_SPACING * 2)
    
    windows_per_row = max(1, int(available_width / (WINDOW_WIDTH + WINDOW_SPACING)))
    windows_per_col = max(1, int(available_height / (WINDOW_HEIGHT + WINDOW_SPACING)))
    
    # Adjust for density
    windows_per_row = max(1, int(windows_per_row * math.sqrt(density)))
    windows_per_col = max(1, int(windows_per_col * math.sqrt(density)))
    
    # Generate windows for each facade
    # We'll generate windows for the front and back facades (along width)
    # For Phase 2, we'll keep it simple and just do one facade
    
    window_spacing_x = available_width / max(1, windows_per_row - 1) if windows_per_row > 1 else 0
    window_spacing_y = available_height / max(1, windows_per_col - 1) if windows_per_col > 1 else 0
    
    # Front facade (positive Y direction)
    for i in range(windows_per_row):
        for j in range(windows_per_col):
            # Skip some windows randomly for variation (10% chance)
            if rng.random() < 0.1:
                continue
            
            # Calculate window position relative to building center
            # Building center is at (0, 0, 0) for relative positioning
            offset_x = (i * window_spacing_x) - (available_width / 2.0)
            offset_y = depth / 2.0  # On the front facade
            offset_z = (j * window_spacing_y) - (available_height / 2.0)
            
            window = {
                "position": [offset_x, offset_y, offset_z],
                "size": [WINDOW_WIDTH, WINDOW_HEIGHT],
                "facade": "front",  # front, back, left, right
            }
            windows.append(window)
    
    # Back facade (negative Y direction) - same pattern
    for i in range(windows_per_row):
        for j in range(windows_per_col):
            if rng.random() < 0.1:
                continue
            
            offset_x = (i * window_spacing_x) - (available_width / 2.0)
            offset_y = -depth / 2.0  # On the back facade
            offset_z = (j * window_spacing_y) - (available_height / 2.0)
            
            window = {
                "position": [offset_x, offset_y, offset_z],
                "size": [WINDOW_WIDTH, WINDOW_HEIGHT],
                "facade": "back",
            }
            windows.append(window)
    
    return windows

