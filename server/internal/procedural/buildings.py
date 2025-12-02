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
MAX_BUILDING_WIDTH = 80.0  # Maximum building width in meters (increased for warehouses/factories)
MIN_BUILDING_DEPTH = 10.0  # Minimum building depth in meters
MAX_BUILDING_DEPTH = 80.0  # Maximum building depth in meters (increased for warehouses/factories)
LEVEL_HEIGHT = 20.0  # Height of each level/floor in the map (20m)
# Building heights within a level: 5m, 10m, 15m, or 20m (must fit within the 20m level)
BUILDING_HEIGHT_OPTIONS = [5.0, 10.0, 15.0, 20.0]

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
    width, depth, height, building_subtype = _get_building_dimensions(zone_type, zone_importance, rng)
    
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
    # Warehouses and agri-industrial may have fewer windows
    windows = _generate_window_grid(width, depth, height, building_seed, building_subtype)
    
    # Building properties
    building = {
        "type": "building",
        "building_type": zone_type,  # residential, commercial, industrial, etc.
        "building_subtype": building_subtype,  # warehouse, factory, residence, agri_industrial, etc.
        "position": [x, y, z],
        "dimensions": {
            "width": width,
            "depth": depth,
            "height": height,  # Height in meters (5, 10, 15, or 20m)
        },
        "corners": corners,
        "windows": windows,
        "properties": {
            "seed": building_seed,
            "zone_type": zone_type,
            "zone_importance": zone_importance,
            "floor": floor,
            "building_subtype": building_subtype,
        },
    }
    
    return building


def _get_building_dimensions(
    zone_type: str, zone_importance: float, rng: random.Random
) -> Tuple[float, float, float, str]:
    """
    Get building dimensions based on zone type and importance.
    
    Returns:
        Tuple of (width, depth, height, building_subtype) in meters
        building_subtype: More specific building type (e.g., "warehouse", "factory", "residence", "agri_industrial")
    """
    # Determine building subtype for zones that have variety
    building_subtype = None
    if zone_type == "industrial":
        # Industrial: warehouses (large, single-story) or factories (medium-large, multi-story)
        if rng.random() < 0.6:  # 60% warehouses, 40% factories
            building_subtype = "warehouse"
        else:
            building_subtype = "factory"
    elif zone_type == "agricultural":
        # Agricultural: residences (small-medium) or agri-industrial (medium-large)
        if rng.random() < 0.7:  # 70% residences, 30% agri-industrial
            building_subtype = "residence"
        else:
            building_subtype = "agri_industrial"
    
    # Base dimensions vary by zone type and subtype
    if zone_type == "residential":
        # Residential: medium width/depth, variable height (5-20m)
        # Varied footprints: small apartments to larger townhouses
        base_width = rng.uniform(10.0, 28.0)
        base_depth = rng.uniform(10.0, 28.0)
        # Heights: 10m, 15m, or 20m (typically taller for residences)
        height = rng.choice([10.0, 15.0, 20.0])
        building_subtype = "residence"
    elif zone_type == "commercial":
        # Commercial: wider, typically tall (15-20m)
        # Varied footprints: shops to large department stores
        base_width = rng.uniform(15.0, 45.0)
        base_depth = rng.uniform(15.0, 45.0)
        # Heights: 15m or 20m (commercial buildings are typically tall)
        height = rng.choice([15.0, 20.0])
        building_subtype = "retail"
    elif zone_type == "industrial":
        if building_subtype == "warehouse":
            # Warehouses: very large footprint, typically short (5-10m)
            base_width = rng.uniform(35.0, 70.0)
            base_depth = rng.uniform(35.0, 70.0)
            # Heights: 5m or 10m (warehouses are typically low)
            height = rng.choice([5.0, 10.0])
        else:  # factory
            # Factories: large footprint, medium height (10-15m)
            base_width = rng.uniform(25.0, 55.0)
            base_depth = rng.uniform(25.0, 55.0)
            # Heights: 10m or 15m (factories are medium height)
            height = rng.choice([10.0, 15.0])
    elif zone_type == "mixed_use":
        # Mixed-use: similar to residential but typically taller (10-20m)
        # Varied footprints: small to medium-large
        base_width = rng.uniform(12.0, 35.0)
        base_depth = rng.uniform(12.0, 35.0)
        # Heights: 10m, 15m, or 20m
        height = rng.choice([10.0, 15.0, 20.0])
        building_subtype = "mixed_use"
    elif zone_type == "agricultural":
        if building_subtype == "residence":
            # Agricultural residences: small to medium (farmhouses), typically 5-10m
            base_width = rng.uniform(10.0, 22.0)
            base_depth = rng.uniform(10.0, 22.0)
            # Heights: 5m or 10m (farmhouses are typically low)
            height = rng.choice([5.0, 10.0])
        else:  # agri_industrial
            # Agri-industrial: medium to large (processing plants, storage)
            base_width = rng.uniform(20.0, 50.0)
            base_depth = rng.uniform(20.0, 50.0)
            # Heights: 10m, 15m, or 20m (processing facilities can vary)
            height = rng.choice([10.0, 15.0, 20.0])
        if building_subtype is None:
            building_subtype = "residence"  # Fallback
    else:
        # Default (park, restricted, etc.)
        base_width = rng.uniform(10.0, 30.0)
        base_depth = rng.uniform(10.0, 30.0)
        # Heights: any option
        height = rng.choice(BUILDING_HEIGHT_OPTIONS)
        building_subtype = zone_type
    
    # Scale by zone importance (higher importance = larger buildings)
    scale = 0.7 + (zone_importance * 0.6)  # Scale from 0.7x to 1.3x
    
    width = max(MIN_BUILDING_WIDTH, min(MAX_BUILDING_WIDTH, base_width * scale))
    depth = max(MIN_BUILDING_DEPTH, min(MAX_BUILDING_DEPTH, base_depth * scale))
    # Height is already chosen from discrete options, no scaling needed
    
    return (width, depth, height, building_subtype)


def _generate_window_grid(
    width: float, depth: float, height: float, building_seed: int, building_subtype: str = None
) -> List[Dict[str, Any]]:
    """
    Generate simple grid pattern windows for a building.
    
    Phase 2 MVP: Simple rectangular windows in a grid pattern.
    
    Args:
        width: Building width in meters
        depth: Building depth in meters
        height: Building height in meters
        building_seed: Seed for deterministic generation
        building_subtype: Optional building subtype (warehouse, factory, etc.)
    
    Returns:
        List of window dictionaries with position and size
    """
    rng = seeded_random(building_seed)
    windows = []
    
    # Window density based on building subtype
    if building_subtype == "warehouse":
        density = 0.15  # Warehouses have few windows (15% density)
    elif building_subtype == "factory":
        density = 0.30  # Factories have some windows (30% density)
    elif building_subtype == "agri_industrial":
        density = 0.25  # Agri-industrial has limited windows (25% density)
    elif building_subtype == "residence":
        density = 0.65  # Residences have good window coverage (65% density)
    else:
        density = 0.60  # Default: 60% of facade covered
    
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

