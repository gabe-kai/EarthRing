"""
Building generation functions for Phase 2 MVP.
Generates basic rectangular buildings with simple window patterns.
"""

import random
import math
from typing import Dict, List, Any, Tuple, Optional

# Import color palettes module
try:
    from . import color_palettes
except ImportError:
    # If import fails, color_palettes will be None and we'll skip color application
    color_palettes = None

# Constants
GRID_CELL_SIZE = 50.0  # 50m × 50m cells
MIN_BUILDING_WIDTH = 10.0  # Minimum building width in meters
MAX_BUILDING_WIDTH = 80.0  # Maximum building width in meters (increased for warehouses/factories)
MIN_BUILDING_DEPTH = 10.0  # Minimum building depth in meters
MAX_BUILDING_DEPTH = 80.0  # Maximum building depth in meters (increased for warehouses/factories)
FLOOR_HEIGHT = 4.0  # Height of each building floor: 4m (1m logistics + 3m living space)
MAX_FLOORS = 5  # Maximum number of floors (5 floors × 4m = 20m max height)

# Window constants
WINDOW_WIDTH = 2.5  # Window width in meters
WINDOW_SPACING = 0.5  # Spacing between windows in meters

# Window type definitions (relative to floor base, 0-4m per floor)
# Each floor has 1m logistics (0-1m) and 3m living space (1-4m)
WINDOW_TYPES = {
    "full_height": {"height": 3.0, "bottom": 1.0, "top": 4.0},  # Spans living space (1-4m)
    "standard": {"height": 1.0, "bottom": 2.0, "top": 3.0},     # Middle of living space (2-3m)
    "ceiling": {"height": 0.5, "bottom": 3.25, "top": 3.75},    # Upper part (3.25-3.75m)
}


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
    hub_name: Optional[str] = None,
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
    
    # Load color palette if available
    colors = None
    if color_palettes is not None and hub_name is not None:
        try:
            # Map zone_type to palette zone_type
            # Handle different zone_type formats: "mixed-use", "mixed_use", "Mixed-use", "Mixed_Use"
            zone_type_normalized = zone_type.lower().replace("_", "-").replace(" ", "-")
            if zone_type_normalized == "mixed-use":
                palette_zone_type = "Commercial"  # Use commercial palette for mixed-use
            else:
                palette_zone_type = zone_type_normalized.title()  # "industrial" -> "Industrial"
            colors = color_palettes.get_hub_colors(hub_name, palette_zone_type)
            if colors is None:
                # Hub or zone type not found in palette - this is OK, use defaults
                pass
        except Exception as e:
            # If color loading fails, log but continue without colors
            print(f"Warning: Failed to load colors for hub={hub_name}, zone={zone_type}: {e}")
            import traceback
            traceback.print_exc()
    
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
    
    # Add color information if available
    if colors:
        building["properties"]["colors"] = colors
        # Debug: print first building with colors to verify they're being loaded
        if building_seed % 1000 == 0:  # Only print occasionally
            print(f"Building with colors: hub={hub_name}, zone={zone_type}, colors={colors}")
    
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
        # Heights: 1-3 floors
        num_floors = rng.choice([1, 2, 3])
        height = num_floors * FLOOR_HEIGHT
        building_subtype = zone_type
    
    # Scale by zone importance (higher importance = larger buildings)
    scale = 0.7 + (zone_importance * 0.6)  # Scale from 0.7x to 1.3x
    
    width = max(MIN_BUILDING_WIDTH, min(MAX_BUILDING_WIDTH, base_width * scale))
    depth = max(MIN_BUILDING_DEPTH, min(MAX_BUILDING_DEPTH, base_depth * scale))
    # Height is already in 4m floor increments, no scaling needed
    
    return (width, depth, height, building_subtype)


def _generate_window_grid(
    width: float, depth: float, height: float, building_seed: int, building_subtype: str = None
) -> List[Dict[str, Any]]:
    """
    Generate windows for a building using floor-based window patterns.
    
    Each floor is 4m tall: 1m logistics (bottom) + 3m living space (top).
    Window types per floor:
    - Full height: 1.0-4.0m (spans living space)
    - Standard: 2.0-3.0m (middle of living space)
    - Ceiling: 3.25-3.75m (upper part of living space)
    
    Args:
        width: Building width in meters
        depth: Building depth in meters
        height: Building height in meters (must be multiple of 4m)
        building_seed: Seed for deterministic generation
        building_subtype: Optional building subtype (warehouse, factory, etc.)
    
    Returns:
        List of window dictionaries with position and size
    """
    rng = seeded_random(building_seed)
    windows = []
    
    # Calculate number of floors (each floor is 4m)
    num_floors = int(height / FLOOR_HEIGHT)
    if num_floors < 1:
        return windows  # No floors, no windows
    
    # Window density based on building subtype
    if building_subtype == "warehouse":
        density = 0.15  # Warehouses have few windows (15% density)
    elif building_subtype == "factory":
        density = 0.30  # Factories have some windows (30% density)
    elif building_subtype == "agri_industrial":
        density = 0.25  # Agri-industrial has limited windows (25% density)
    elif building_subtype == "residence":
        density = 0.70  # Residences have good window coverage (70% density)
    else:
        density = 0.65  # Default: 65% of facade covered
    
    # Calculate horizontal window spacing
    available_width = width - (WINDOW_SPACING * 2)  # Margin from edges
    windows_per_facade = max(1, int(available_width / (WINDOW_WIDTH + WINDOW_SPACING)))
    windows_per_facade = max(1, int(windows_per_facade * math.sqrt(density)))
    window_spacing_x = available_width / max(1, windows_per_facade - 1) if windows_per_facade > 1 else 0
    
    # Generate windows for each floor
    for floor_num in range(num_floors):
        # Floor base position (relative to building center)
        # Building center is at Y=0, building extends from -height/2 to +height/2
        # Each floor extends from floor_base to floor_base + 4m
        # Floor 0 starts at -height/2, each subsequent floor is +4m higher
        floor_base = -height / 2.0 + floor_num * FLOOR_HEIGHT
        
        # Determine which window types to use on this floor
        # Each floor can have: full-height, standard, and/or ceiling windows
        # Distribution: full-height are common, standard are most common, ceiling are less common
        use_full_height = rng.random() < 0.4  # 40% chance for full-height windows
        use_standard = rng.random() < 0.8     # 80% chance for standard windows
        use_ceiling = rng.random() < 0.3      # 30% chance for ceiling windows
        
        # Generate windows horizontally across the facade
        for i in range(windows_per_facade):
            # Skip some windows randomly for variation (10% chance)
            if rng.random() < 0.1:
                continue
            
            # Horizontal position
            offset_x = (i * window_spacing_x) - (available_width / 2.0)
            
            # Generate window types for this position
            if use_full_height:
                win_type = WINDOW_TYPES["full_height"]
                window = {
                    "position": [
                        offset_x,
                        depth / 2.0,  # Front facade
                        floor_base + (win_type["bottom"] + win_type["top"]) / 2.0  # Center of window vertically
                    ],
                    "size": [WINDOW_WIDTH, win_type["height"]],
                    "facade": "front",
                    "type": "full_height",
                }
                windows.append(window)
            
            if use_standard:
                win_type = WINDOW_TYPES["standard"]
                window = {
                    "position": [
                        offset_x,
                        depth / 2.0,  # Front facade
                        floor_base + (win_type["bottom"] + win_type["top"]) / 2.0
                    ],
                    "size": [WINDOW_WIDTH, win_type["height"]],
                    "facade": "front",
                    "type": "standard",
                }
                windows.append(window)
            
            if use_ceiling:
                win_type = WINDOW_TYPES["ceiling"]
                window = {
                    "position": [
                        offset_x,
                        depth / 2.0,  # Front facade
                        floor_base + (win_type["bottom"] + win_type["top"]) / 2.0
                    ],
                    "size": [WINDOW_WIDTH, win_type["height"]],
                    "facade": "front",
                    "type": "ceiling",
                }
                windows.append(window)
    
    return windows

