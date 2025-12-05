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
    building_subtype_override: Optional[str] = None,
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
    # Normalize zone_type to handle any formatting variations (case, whitespace, etc.)
    zone_type = zone_type.lower().strip() if zone_type else ""
    
    rng = seeded_random(building_seed)
    
    # Determine building dimensions based on zone type and importance
    # If subtype override is provided (e.g., for agricultural clustering), use it
    if building_subtype_override:
        # Generate dimensions with the override subtype
        width, depth, height, building_subtype = _get_building_dimensions_with_subtype(
            zone_type, zone_importance, rng, building_subtype_override
        )
    else:
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
    
    # Generate corner trim width (variable between 10cm and 50cm for all buildings)
    corner_trim_width = rng.uniform(0.1, 0.5)  # 10cm to 50cm
    
    # Generate windows for Phase 2 (simple grid pattern)
    # Warehouses and agri-industrial may have fewer windows
    # Pass corner_trim_width to window generation
    windows = _generate_window_grid(width, depth, height, building_seed, building_subtype, corner_trim_width)
    
    # Determine which facade faces r=0 (center of ring)
    # r=0 is at y=0 in EarthRing coordinates
    # Front wall is at y + depth/2, back wall is at y - depth/2
    # The wall closer to y=0 faces the center
    front_distance_to_center = abs(y + depth / 2.0)
    back_distance_to_center = abs(y - depth / 2.0)
    
    # Determine main door facade (side facing r=0)
    if front_distance_to_center < back_distance_to_center:
        main_door_facade = "front"
    elif back_distance_to_center < front_distance_to_center:
        main_door_facade = "back"
    else:
        # Equidistant (y=0), default to front
        main_door_facade = "front"
    
    # Generate doors: main door on side facing r=0, secondary doors on other sides
    # Pass windows to avoid overlaps
    doors = _generate_doors(
        width, depth, height, building_seed, building_subtype, 
        main_door_facade, rng, windows
    )
    
    # Generate garage doors for appropriate building types
    # Also generates utility doors beside each garage door
    garage_doors, utility_doors = _generate_garage_doors(
        width, depth, height, building_seed, building_subtype, rng, corner_trim_width, windows, doors
    )
    
    # Merge utility doors into the main doors dictionary
    # Convert doors dict to support multiple doors per facade by using lists
    for utility_door in utility_doors:
        facade = utility_door["facade"]
        if facade in doors:
            # If facade already has a door, convert to list if needed
            if not isinstance(doors[facade], list):
                doors[facade] = [doors[facade]]
            doors[facade].append(utility_door)
        else:
            # No existing door on this facade, just add the utility door
            doors[facade] = utility_door
    
    # Load color palette if available
    # Determine palette zone type based on building subtype/type, not just zone type
    # This ensures mixed-use zones get the correct colors for each building type
    colors = None
    if color_palettes is not None and hub_name is not None:
        try:
            # Map building_subtype to palette zone_type
            # This ensures that buildings in mixed-use zones get appropriate colors
            # based on their actual building type, not just the zone type
            palette_zone_type = None
            if building_subtype in ["residence", "house", "apartment", "campus"]:
                palette_zone_type = "Residential"
            elif building_subtype == "retail":
                palette_zone_type = "Commercial"
            elif building_subtype in ["warehouse", "factory"]:
                palette_zone_type = "Industrial"
            elif building_subtype in ["agri_industrial", "barn"]:
                palette_zone_type = "Agricultural"
            elif building_subtype == "park_structure":
                palette_zone_type = "Parks"
            else:
                # Fallback: use zone_type to determine palette
                # Handle different zone_type formats: "mixed-use", "mixed_use", "Mixed-use", "Mixed_Use"
                zone_type_normalized = zone_type.lower().replace("_", "-").replace(" ", "-")
                if zone_type_normalized == "mixed-use":
                    # Mixed-use zone but unknown subtype - default to Commercial
                    palette_zone_type = "Commercial"
                else:
                    palette_zone_type = zone_type_normalized.title()  # "industrial" -> "Industrial"
            
            if palette_zone_type:
                colors = color_palettes.get_hub_colors(hub_name, palette_zone_type)
                if colors is None:
                    # Hub or zone type not found in palette - this is OK, use defaults
                    pass
        except Exception as e:
            # If color loading fails, continue without colors (don't spam logs)
            pass
    
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
        "doors": doors,  # Dictionary mapping facade to door info: {"front": {...}, "back": {...}, etc.}
        "garage_doors": garage_doors,  # List of garage door dictionaries
        "properties": {
            "seed": building_seed,
            "zone_type": zone_type,
            "zone_importance": zone_importance,
            "floor": floor,
            "building_subtype": building_subtype,
            "corner_trim_width": corner_trim_width,  # Variable corner trim width (0.1m to 0.5m)
        },
    }
    
    # Add color information if available
    if colors:
        building["properties"]["colors"] = colors
    
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
    # Normalize zone_type to lowercase and strip whitespace to handle any formatting variations
    zone_type = zone_type.lower().strip()
    
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
        # Residential: mix of apartment buildings/campuses and houses
        # 60% apartment/campus buildings, 40% houses
        if rng.random() < 0.6:
            # Apartment buildings and campuses: larger footprints, taller
            building_subtype = rng.choice(["apartment", "campus"])
            base_width = rng.uniform(20.0, 40.0)  # Larger footprint
            base_depth = rng.uniform(20.0, 40.0)
            height = rng.choice([12.0, 16.0, 20.0])  # 3-5 stories
        else:
            # Houses: smaller footprints, shorter
            building_subtype = "house"
            base_width = rng.uniform(10.0, 18.0)  # Smaller footprint
            base_depth = rng.uniform(10.0, 18.0)
            height = rng.choice([8.0, 12.0])  # 2-3 stories
    elif zone_type == "commercial":
        # Commercial: mostly office towers, all 5 stories tall (20m)
        # Commercial zones ONLY get commercial-themed buildings (retail)
        base_width = rng.uniform(15.0, 35.0)  # Office tower footprint
        base_depth = rng.uniform(15.0, 35.0)
        height = 20.0  # All commercial buildings are 5 stories (20m)
        building_subtype = "retail"  # Commercial zones always get retail buildings
    elif zone_type == "industrial":
        if building_subtype == "warehouse":
            # Warehouses: mostly short, wide, and long
            # 80% short (5m or 10m), 20% medium height
            if rng.random() < 0.8:
                height = rng.choice([5.0, 10.0])  # Mostly short
            else:
                height = 12.0  # Some medium height
            # Wide and long footprints
            base_width = rng.uniform(40.0, 80.0)  # Wide
            base_depth = rng.uniform(40.0, 80.0)  # Long
        else:  # factory
            # Factories: large footprint, mostly short to medium height
            base_width = rng.uniform(30.0, 65.0)  # Wide
            base_depth = rng.uniform(30.0, 65.0)  # Long
            # 70% short/medium (5-12m), 30% taller
            if rng.random() < 0.7:
                height = rng.choice([5.0, 8.0, 10.0, 12.0])  # Mostly short/medium
            else:
                height = rng.choice([16.0, 20.0])  # Some taller
    elif zone_type == "mixed_use" or zone_type == "mixed-use":
        # Mixed-use zones can get ANY type of building (residential, commercial, industrial)
        # This creates variety in mixed-use areas
        building_type_choice = rng.random()
        
        if building_type_choice < 0.5:  # 50% residential
            # Residential buildings in mixed-use zones
            if rng.random() < 0.6:
                building_subtype = rng.choice(["apartment", "campus"])
                base_width = rng.uniform(20.0, 40.0)
                base_depth = rng.uniform(20.0, 40.0)
                height = rng.choice([12.0, 16.0, 20.0])
            else:
                building_subtype = "house"
                base_width = rng.uniform(10.0, 18.0)
                base_depth = rng.uniform(10.0, 18.0)
                height = rng.choice([8.0, 12.0])
        elif building_type_choice < 0.8:  # 30% commercial
            # Commercial buildings in mixed-use zones
            base_width = rng.uniform(15.0, 35.0)
            base_depth = rng.uniform(15.0, 35.0)
            height = 20.0  # 5 stories
            building_subtype = "retail"
        else:  # 20% industrial
            # Industrial buildings in mixed-use zones
            if rng.random() < 0.6:  # 60% warehouses, 40% factories
                building_subtype = "warehouse"
                base_width = rng.uniform(40.0, 70.0)
                base_depth = rng.uniform(40.0, 70.0)
                height = rng.choice([5.0, 10.0])
            else:
                building_subtype = "factory"
                base_width = rng.uniform(30.0, 60.0)
                base_depth = rng.uniform(30.0, 60.0)
                height = rng.choice([8.0, 10.0, 12.0])
    elif zone_type == "agricultural":
        # Agricultural buildings: house, barn/warehouse, small industrial
        # This will be clustered in generation.py, but here we define the building types
        if building_subtype == "residence":
            # Agricultural residences: small to medium (farmhouses)
            building_subtype = "house"  # Use "house" subtype for farmhouses
            base_width = rng.uniform(10.0, 18.0)
            base_depth = rng.uniform(10.0, 18.0)
            height = rng.choice([8.0, 12.0])  # 2-3 stories
        elif building_subtype == "agri_industrial":
            # Determine if it's a barn/warehouse or small industrial
            if rng.random() < 0.6:  # 60% barn/warehouse
                building_subtype = "barn"
                base_width = rng.uniform(12.0, 25.0)  # Small warehouse/barn
                base_depth = rng.uniform(12.0, 25.0)
                height = rng.choice([5.0, 8.0, 10.0])  # Short structures
            else:  # 40% small industrial
                building_subtype = "warehouse"  # Use warehouse subtype
                base_width = rng.uniform(15.0, 30.0)  # Small industrial
                base_depth = rng.uniform(15.0, 30.0)
                height = rng.choice([5.0, 8.0, 10.0])  # Short
        else:
            # Default agricultural: farmhouse
            building_subtype = "house"
            base_width = rng.uniform(10.0, 18.0)
            base_depth = rng.uniform(10.0, 18.0)
            height = rng.choice([8.0, 12.0])
    elif zone_type == "park":
        # Park buildings: small structures scattered throughout
        base_width = rng.uniform(5.0, 15.0)  # Small
        base_depth = rng.uniform(5.0, 15.0)  # Small
        height = rng.choice([4.0, 8.0])  # 1-2 stories, mostly 1 story
        building_subtype = "park_structure"
    else:
        # Default (restricted, etc.)
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


def _get_building_dimensions_with_subtype(
    zone_type: str, zone_importance: float, rng: random.Random, building_subtype_override: str
) -> Tuple[float, float, float, str]:
    """
    Get building dimensions based on zone type and a specific building subtype override.
    Used for agricultural clustering where we want specific building types (house, barn, warehouse).
    
    Args:
        zone_type: Type of zone (agricultural, etc.)
        zone_importance: Zone importance value (0.0 to 1.0)
        rng: Random number generator
        building_subtype_override: Specific building subtype to generate (house, barn, warehouse, etc.)
    
    Returns:
        Tuple of (width, depth, height, building_subtype) in meters
    """
    # Normalize zone_type and subtype override
    zone_type = zone_type.lower().strip()
    building_subtype_override = building_subtype_override.lower().strip() if building_subtype_override else ""
    
    building_subtype = building_subtype_override
    base_width = 15.0
    base_depth = 15.0
    height = 8.0
    
    # Handle agricultural zone with specific subtype overrides
    if zone_type == "agricultural":
        if building_subtype_override == "house":
            # Agricultural house (farmhouse)
            base_width = rng.uniform(10.0, 18.0)
            base_depth = rng.uniform(10.0, 18.0)
            height = rng.choice([8.0, 12.0])  # 2-3 stories
            building_subtype = "house"
        elif building_subtype_override == "barn":
            # Agricultural barn/warehouse
            base_width = rng.uniform(12.0, 25.0)  # Small warehouse/barn
            base_depth = rng.uniform(12.0, 25.0)
            height = rng.choice([5.0, 8.0, 10.0])  # Short structures
            building_subtype = "barn"
        elif building_subtype_override == "small_industrial" or building_subtype_override == "warehouse":
            # Small industrial (warehouse subtype)
            base_width = rng.uniform(15.0, 30.0)  # Small industrial
            base_depth = rng.uniform(15.0, 30.0)
            height = rng.choice([5.0, 8.0, 10.0])  # Short
            building_subtype = "warehouse"  # Use warehouse subtype for small industrial
        else:
            # Unknown override, default to house
            base_width = rng.uniform(10.0, 18.0)
            base_depth = rng.uniform(10.0, 18.0)
            height = rng.choice([8.0, 12.0])
            building_subtype = "house"
    else:
        # For non-agricultural zones, use the standard dimension function logic
        # but with the override subtype
        if zone_type == "residential":
            if building_subtype_override in ["apartment", "campus"]:
                base_width = rng.uniform(20.0, 40.0)
                base_depth = rng.uniform(20.0, 40.0)
                height = rng.choice([12.0, 16.0, 20.0])
            elif building_subtype_override == "house":
                base_width = rng.uniform(10.0, 18.0)
                base_depth = rng.uniform(10.0, 18.0)
                height = rng.choice([8.0, 12.0])
        elif zone_type == "commercial":
            base_width = rng.uniform(15.0, 35.0)
            base_depth = rng.uniform(15.0, 35.0)
            height = 20.0
            building_subtype = "retail"
        elif zone_type == "industrial":
            if building_subtype_override == "warehouse":
                if rng.random() < 0.8:
                    height = rng.choice([5.0, 10.0])
                else:
                    height = 12.0
                base_width = rng.uniform(40.0, 80.0)
                base_depth = rng.uniform(40.0, 80.0)
            elif building_subtype_override == "factory":
                if rng.random() < 0.7:
                    height = rng.choice([5.0, 8.0, 10.0, 12.0])
                else:
                    height = rng.choice([16.0, 20.0])
                base_width = rng.uniform(30.0, 65.0)
                base_depth = rng.uniform(30.0, 65.0)
            else:
                # Default industrial
                base_width = rng.uniform(30.0, 60.0)
                base_depth = rng.uniform(30.0, 60.0)
                height = rng.choice([5.0, 10.0, 12.0])
        else:
            # Default fallback
            base_width = rng.uniform(10.0, 30.0)
            base_depth = rng.uniform(10.0, 30.0)
            height = rng.choice([8.0, 12.0, 16.0])
    
    # Scale by zone importance (higher importance = larger buildings)
    scale = 0.7 + (zone_importance * 0.6)  # Scale from 0.7x to 1.3x
    
    width = max(MIN_BUILDING_WIDTH, min(MAX_BUILDING_WIDTH, base_width * scale))
    depth = max(MIN_BUILDING_DEPTH, min(MAX_BUILDING_DEPTH, base_depth * scale))
    # Height is already in 4m floor increments, no scaling needed
    
    return (width, depth, height, building_subtype)


def _generate_window_grid(
    width: float, depth: float, height: float, building_seed: int, building_subtype: str = None, corner_trim_width: float = 0.02
) -> List[Dict[str, Any]]:
    """
    Generate windows for a building using floor-based window patterns.
    Windows are generated on all four facades (front, back, left, right).
    
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
    
    # Window density and type preferences based on building subtype
    if building_subtype == "warehouse":
        density = 0.10  # Warehouses have very few windows (10% density)
        prefer_full_height = False
        prefer_standard = False
        prefer_ceiling = False
    elif building_subtype == "factory":
        density = 0.20  # Factories have few windows (20% density)
        prefer_full_height = False
        prefer_standard = True
        prefer_ceiling = False
    elif building_subtype in ["barn", "agri_industrial"]:
        density = 0.20  # Agricultural buildings have limited windows (20% density)
        prefer_full_height = False
        prefer_standard = True
        prefer_ceiling = False
    elif building_subtype == "retail":
        # Commercial office towers: mostly floor-to-ceiling windows
        density = 0.75  # High window density
        prefer_full_height = True  # Prefer full-height windows
        prefer_standard = False
        prefer_ceiling = False
    elif building_subtype in ["apartment", "campus", "house", "residence"]:
        # Residential: mostly standard windows
        if building_subtype == "house":
            density = 0.60  # Houses have moderate window coverage
        else:
            density = 0.70  # Apartments/campuses have good window coverage
        prefer_full_height = False
        prefer_standard = True  # Prefer standard windows
        prefer_ceiling = False
    elif building_subtype == "park_structure":
        density = 0.40  # Park structures have moderate windows
        prefer_full_height = False
        prefer_standard = True
        prefer_ceiling = False
    else:
        density = 0.65  # Default: 65% of facade covered
        prefer_full_height = False
        prefer_standard = True
        prefer_ceiling = False
    
    # Use variable corner trim width (10cm to 50cm) - absolute width in meters
    
    # Helper function to generate windows for a facade
    def generate_windows_for_facade(facade: str, facade_width: float, facade_offset: Tuple[float, float, float]):
        """Generate windows for a specific facade.
        
        Args:
            facade: 'front', 'back', 'left', or 'right'
            facade_width: Width of the facade (for spacing calculation)
            facade_offset: (x, y, z) offset from building center to facade center
        """
        # Calculate horizontal window spacing for this facade
        # Use absolute corner trim width (in meters)
        trim_margin = corner_trim_width  # Absolute width in meters
        # Usable area: exclude trim margins on both sides
        usable_width = facade_width - (trim_margin * 2)
        # Further reduce by window spacing margins
        available_width = usable_width - (WINDOW_SPACING * 2)
        windows_per_facade = max(1, int(available_width / (WINDOW_WIDTH + WINDOW_SPACING)))
        windows_per_facade = max(1, int(windows_per_facade * math.sqrt(density)))
        window_spacing_x = available_width / max(1, windows_per_facade - 1) if windows_per_facade > 1 else 0
        
        # Calculate offset range for windows (relative to facade center)
        # Windows should be within: [-facade_width/2 + trim_margin, +facade_width/2 - trim_margin]
        # Account for window width: window center must be at least WINDOW_WIDTH/2 from trim edge
        min_offset = -facade_width / 2.0 + trim_margin + WINDOW_WIDTH / 2.0
        max_offset = facade_width / 2.0 - trim_margin - WINDOW_WIDTH / 2.0
        
        # Generate windows for each floor
        for floor_num in range(num_floors):
            floor_base = -height / 2.0 + floor_num * FLOOR_HEIGHT
            
            # Determine which window types to use on this floor based on preferences
            if prefer_full_height:
                # Commercial: mostly full-height windows
                use_full_height = rng.random() < 0.85  # 85% chance for full-height windows
                use_standard = rng.random() < 0.15     # 15% chance for standard windows
                use_ceiling = rng.random() < 0.10      # 10% chance for ceiling windows
            elif prefer_standard:
                # Residential and others: mostly standard windows
                use_full_height = rng.random() < 0.20  # 20% chance for full-height windows
                use_standard = rng.random() < 0.85     # 85% chance for standard windows
                use_ceiling = rng.random() < 0.25      # 25% chance for ceiling windows
            else:
                # Industrial/warehouse: minimal windows
                use_full_height = rng.random() < 0.10  # 10% chance for full-height windows
                use_standard = rng.random() < 0.30     # 30% chance for standard windows
                use_ceiling = rng.random() < 0.10      # 10% chance for ceiling windows
            
            # Generate windows horizontally across the facade
            for i in range(windows_per_facade):
                # Skip some windows randomly for variation (10% chance)
                if rng.random() < 0.1:
                    continue
                
                # Horizontal position (relative to facade center)
                # Distribute windows evenly across available width, starting from min_offset
                # Ensure we don't exceed max_offset
                if windows_per_facade > 1:
                    offset_local = min_offset + (i * window_spacing_x)
                    # Clamp to ensure we don't exceed max_offset (accounting for window width)
                    max_allowed = max_offset - WINDOW_WIDTH / 2.0
                    offset_local = min(offset_local, max_allowed)
                else:
                    # Single window: center it in available area
                    offset_local = (min_offset + max_offset) / 2.0
                
                # Convert to building-relative coordinates based on facade orientation
                if facade == "front":
                    offset_x = offset_local
                    offset_y = facade_offset[1]  # depth / 2.0
                    offset_z = facade_offset[2]  # 0
                elif facade == "back":
                    offset_x = offset_local
                    offset_y = facade_offset[1]  # -depth / 2.0
                    offset_z = facade_offset[2]  # 0
                elif facade == "left":
                    offset_x = facade_offset[0]  # -width / 2.0
                    offset_y = offset_local
                    offset_z = facade_offset[2]  # 0
                else:  # right
                    offset_x = facade_offset[0]  # width / 2.0
                    offset_y = offset_local
                    offset_z = facade_offset[2]  # 0
                
                # Generate window types for this position
                if use_full_height:
                    win_type = WINDOW_TYPES["full_height"]
                    window = {
                        "position": [
                            offset_x,
                            offset_y,
                            floor_base + (win_type["bottom"] + win_type["top"]) / 2.0
                        ],
                        "size": [WINDOW_WIDTH, win_type["height"]],
                        "facade": facade,
                        "type": "full_height",
                    }
                    windows.append(window)
                
                if use_standard:
                    win_type = WINDOW_TYPES["standard"]
                    window = {
                        "position": [
                            offset_x,
                            offset_y,
                            floor_base + (win_type["bottom"] + win_type["top"]) / 2.0
                        ],
                        "size": [WINDOW_WIDTH, win_type["height"]],
                        "facade": facade,
                        "type": "standard",
                    }
                    windows.append(window)
                
                if use_ceiling:
                    win_type = WINDOW_TYPES["ceiling"]
                    window = {
                        "position": [
                            offset_x,
                            offset_y,
                            floor_base + (win_type["bottom"] + win_type["top"]) / 2.0
                        ],
                        "size": [WINDOW_WIDTH, win_type["height"]],
                        "facade": facade,
                        "type": "ceiling",
                    }
                    windows.append(window)
    
    # Generate windows for all four facades
    generate_windows_for_facade("front", width, (0, depth / 2.0, 0))
    generate_windows_for_facade("back", width, (0, -depth / 2.0, 0))
    generate_windows_for_facade("left", depth, (-width / 2.0, 0, 0))
    generate_windows_for_facade("right", depth, (width / 2.0, 0, 0))
    
    return windows


def _generate_doors(
    width: float, 
    depth: float, 
    height: float, 
    building_seed: int, 
    building_subtype: str,
    main_door_facade: str,
    rng: random.Random,
    windows: List[Dict[str, Any]] = None,
    corner_trim_width: float = 0.1
) -> Dict[str, Dict[str, Any]]:
    """
    Generate doors for a building.
    Main door is always on the facade facing r=0 (center of ring).
    Secondary doors may be added to other facades based on building type.
    Doors are placed to avoid overlapping windows and corner trim.
    
    Args:
        width: Building width in meters
        depth: Building depth in meters
        height: Building height in meters
        building_seed: Seed for deterministic generation
        building_subtype: Building subtype (warehouse, factory, etc.)
        main_door_facade: Facade that faces r=0 ("front" or "back")
        rng: Random number generator
        windows: List of window dictionaries to avoid overlaps
    
    Returns:
        Dictionary mapping facade name to door info, or empty dict if no door on that facade
        Example: {"front": {"x": 0, "y": 0, "width": 1.2, "height": 2.5}, ...}
    """
    doors = {}
    windows = windows or []
    
    # Standard door dimensions
    door_width = 0.9  # 90cm wide
    door_height = 2.1  # 210cm tall
    
    # Foundation height calculation (matches client-side: min(0.5, height * 0.1))
    foundation_height = min(0.5, height * 0.1)
    # Door bottom should start at foundation top
    # Building base is at -height/2, foundation top is at -height/2 + foundation_height
    # Door center at foundation top + door_height/2
    door_bottom_y = -height / 2.0 + foundation_height  # At foundation top
    door_y_position = door_bottom_y + door_height / 2.0  # Door center relative to building center
    
    # Use variable corner trim width (absolute value in meters)
    
    def door_overlaps_window(door_x: float, door_y: float, door_w: float, door_h: float, 
                              facade: str, facade_width: float) -> bool:
        """Check if door overlaps any window on the given facade."""
        door_left = door_x - door_w / 2.0
        door_right = door_x + door_w / 2.0
        door_bottom = door_y - door_h / 2.0
        door_top = door_y + door_h / 2.0
        
        for window in windows:
            if window.get("facade") != facade:
                continue
            
            win_pos = window["position"]
            win_size = window["size"]
            
            # Convert window position to facade-local coordinates
            # Window position is in building-relative coordinates (x, y, z)
            # For front/back facades: window X is already in facade-local coordinates
            # For left/right facades: window Y becomes X for the facade
            if facade == "front" or facade == "back":
                # Window X is already in facade-local coordinates
                win_x = win_pos[0]
            elif facade == "left":
                # For left facade, window Y coordinate (relative to building center) becomes X
                # But we need to account for the fact that left facade is at -width/2
                # Window Y is relative to building center, so win_pos[1] is the Y offset
                # For left facade, we need the distance from the facade center
                # Actually, looking at the window generation code, for left facade:
                # offset_x = -width/2 (facade position), offset_y = offset_local (window position along facade)
                # So win_pos[1] is the window position along the facade
                win_x = win_pos[1]  # Y coordinate becomes X for side facades
            else:  # right
                win_x = win_pos[1]  # Y coordinate becomes X for side facades
            
            win_left = win_x - win_size[0] / 2.0
            win_right = win_x + win_size[0] / 2.0
            
            # Window Z is vertical position (relative to building center)
            win_center_y = win_pos[2]
            win_bottom = win_center_y - win_size[1] / 2.0
            win_top = win_center_y + win_size[1] / 2.0
            
            # Check for overlap (with margin to avoid touching)
            margin = 0.15  # 15cm margin for safety
            if not (door_right < win_left - margin or door_left > win_right + margin or
                    door_top < win_bottom - margin or door_bottom > win_top + margin):
                return True
        
        return False
    
    def find_door_position(facade: str, facade_width: float, max_attempts: int = 50) -> Optional[float]:
        """Find a valid door position that doesn't overlap windows or corner trim."""
        # Available width: exclude corner trim (absolute width in meters)
        # Door center must be at least door_width/2 from trim edge
        min_x = -facade_width / 2.0 + corner_trim_width + door_width / 2.0
        max_x = facade_width / 2.0 - corner_trim_width - door_width / 2.0
        available_width = max_x - min_x
        
        # Try multiple positions to find one that doesn't overlap windows
        for attempt in range(max_attempts):
            # Try random position within available area
            door_x = min_x + rng.random() * available_width
            
            # Check if this position overlaps any window
            if not door_overlaps_window(door_x, door_y_position, door_width, door_height, facade, facade_width):
                return door_x
        
        # If we can't find a non-overlapping position after many attempts,
        # try positions away from center where windows are more likely
        # Try edges first (less likely to have windows)
        edge_positions = [
            min_x + available_width * 0.1,  # 10% from left edge
            min_x + available_width * 0.9,  # 10% from right edge
            min_x + available_width * 0.25,  # 25% from left
            min_x + available_width * 0.75,  # 25% from right
        ]
        
        for pos in edge_positions:
            if not door_overlaps_window(pos, door_y_position, door_width, door_height, facade, facade_width):
                return pos
        
        # Last resort: try very edge positions to minimize overlap
        # Check if very edge positions avoid windows
        for edge_pos in [min_x + available_width * 0.05, min_x + available_width * 0.95]:
            if not door_overlaps_window(edge_pos, door_y_position, door_width, door_height, facade, facade_width):
                return edge_pos
        
        # If still can't find a position, place at edge anyway (this should be rare)
        # The door will overlap a window, but it's better than having no door
        return min_x + available_width * 0.05  # 5% from left edge
    
    # Main door: always on the facade facing r=0
    facade_width = width if main_door_facade in ["front", "back"] else depth
    door_offset = find_door_position(main_door_facade, facade_width)
    
    if door_offset is not None:
        doors[main_door_facade] = {
            "x": door_offset,  # Offset from facade center (in facade's local X coordinate)
            "y": door_y_position,  # Vertical position relative to building center
            "width": door_width,
            "height": door_height,
            "type": "main",
        }
    
    # Secondary doors: some buildings get them on other facades
    # Commercial office towers: doors on all sides
    # Apartment/campus buildings: multiple doors
    # Houses: fewer doors (just main door, maybe one secondary)
    if building_subtype == "retail":
        # Commercial office towers: doors on all sides (front, back, left, right)
        all_facades = ["front", "back", "left", "right"]
        for facade in all_facades:
            if facade != main_door_facade:  # Already have main door on one facade
                facade_width = width if facade in ["front", "back"] else depth
                door_offset = find_door_position(facade, facade_width)
                if door_offset is not None:
                    doors[facade] = {
                        "x": door_offset,
                        "y": door_y_position,
                        "width": door_width,
                        "height": door_height,
                        "type": "secondary",
                    }
    elif building_subtype in ["apartment", "campus"]:
        # Apartment buildings and campuses: multiple doors (2-3 additional)
        num_secondary_doors = rng.randint(2, 3)
        other_facades = [f for f in ["front", "back", "left", "right"] if f != main_door_facade]
        rng.shuffle(other_facades)  # Randomize order
        
        for i in range(min(num_secondary_doors, len(other_facades))):
            facade = other_facades[i]
            facade_width = width if facade in ["front", "back"] else depth
            door_offset = find_door_position(facade, facade_width)
            if door_offset is not None:
                doors[facade] = {
                    "x": door_offset,
                    "y": door_y_position,
                    "width": door_width,
                    "height": door_height,
                    "type": "secondary",
                }
    elif building_subtype == "house":
        # Houses: fewer doors, 20% chance for one secondary door
        has_secondary_door = rng.random() < 0.2
        if has_secondary_door:
            other_facades = [f for f in ["front", "back", "left", "right"] if f != main_door_facade]
            secondary_facade = rng.choice(other_facades)
            
            facade_width = width if secondary_facade in ["front", "back"] else depth
            door_offset = find_door_position(secondary_facade, facade_width)
            
            if door_offset is not None:
                doors[secondary_facade] = {
                    "x": door_offset,
                    "y": door_y_position,
                    "width": door_width,
                    "height": door_height,
                    "type": "secondary",
                }
    elif building_subtype == "residence":
        # Legacy "residence" subtype: 40% chance for secondary door
        has_secondary_doors = rng.random() < 0.4
        if has_secondary_doors:
            other_facades = [f for f in ["front", "back", "left", "right"] if f != main_door_facade]
            secondary_facade = rng.choice(other_facades)
            
            facade_width = width if secondary_facade in ["front", "back"] else depth
            door_offset = find_door_position(secondary_facade, facade_width)
            
            if door_offset is not None:
                doors[secondary_facade] = {
                    "x": door_offset,
                    "y": door_y_position,
                    "width": door_width,
                    "height": door_height,
                    "type": "secondary",
                }
    elif building_subtype in ["warehouse", "factory"]:
        # Industrial buildings: REQUIRE at least 1 door on BOTH front and back facades
        # Main door is already on one facade (front or back), ensure the other also has a door
        north_south_facades = ["front", "back"]
        for facade in north_south_facades:
            if facade not in doors:  # If this facade doesn't have a door yet, add one
                facade_width = width if facade in ["front", "back"] else depth
                door_offset = find_door_position(facade, facade_width)
                
                if door_offset is not None:
                    door_type = "main" if facade == main_door_facade else "secondary"
                    doors[facade] = {
                        "x": door_offset,
                        "y": door_y_position,
                        "width": door_width,
                        "height": door_height,
                        "type": door_type,
                    }
    
    return doors


def _generate_garage_doors(
    width: float,
    depth: float,
    height: float,
    building_seed: int,
    building_subtype: str,
    rng: random.Random,
    corner_trim_width: float = 0.1,
    windows: List[Dict[str, Any]] = None,
    doors: Dict[str, Any] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """
    Generate garage doors for appropriate building types.
    Garage doors are typically for industrial buildings (warehouses, factories, agri-industrial).
    Also generates utility doors right beside each garage door.
    
    Args:
        width: Building width in meters
        depth: Building depth in meters
        height: Building height in meters
        building_seed: Seed for deterministic generation
        building_subtype: Building subtype (warehouse, factory, etc.)
        rng: Random number generator
        corner_trim_width: Corner trim width in meters
        windows: List of window dictionaries to avoid overlaps
    
    Returns:
        Tuple of (garage_doors_list, utility_doors_list)
        - garage_doors_list: List of garage door dictionaries
        - utility_doors_list: List of utility door dictionaries (one per garage door)
    """
    garage_doors = []
    utility_doors = []  # List of utility door dictionaries (one per garage door)
    windows = windows or []
    doors = doors or {}
    
    # Foundation height calculation (matches client-side: min(0.5, height * 0.1))
    foundation_height = min(0.5, height * 0.1)
    
    # Standard utility door dimensions (same as regular doors)
    utility_door_width = 0.9  # 90cm wide
    utility_door_height = 2.1  # 210cm tall
    utility_door_y_position = -height / 2.0 + foundation_height + utility_door_height / 2.0  # At foundation top
    
    def utility_door_overlaps_window(door_x: float, door_y: float, facade: str, facade_width: float) -> bool:
        """Check if utility door overlaps any window on the given facade."""
        door_left = door_x - utility_door_width / 2.0
        door_right = door_x + utility_door_width / 2.0
        door_bottom = door_y - utility_door_height / 2.0
        door_top = door_y + utility_door_height / 2.0
        
        for window in windows:
            if window.get("facade") != facade:
                continue
            
            win_pos = window["position"]
            win_size = window["size"]
            
            if facade == "front" or facade == "back":
                win_x = win_pos[0]
            elif facade == "left" or facade == "right":
                win_x = win_pos[1]
            
            win_left = win_x - win_size[0] / 2.0
            win_right = win_x + win_size[0] / 2.0
            win_center_y = win_pos[2]
            win_bottom = win_center_y - win_size[1] / 2.0
            win_top = win_center_y + win_size[1] / 2.0
            
            margin = 0.15  # 15cm margin for safety
            if not (door_right < win_left - margin or door_left > win_right + margin or
                    door_top < win_bottom - margin or door_bottom > win_top + margin):
                return True
        
        return False
    
    # Garage doors are for industrial/agricultural building types
    has_garage_doors = False
    garage_count = 0
    garage_count_per_facade = 0  # Used for industrial buildings that require doors on both facades
    
    if building_subtype == "warehouse":
        # Warehouses: REQUIRE at least 1 truck bay door on BOTH front and back facades
        # Each facade gets 1-4 truck bay doors (1 is minimum, 2-4 are optional extras)
        # 50% chance for 2 doors per facade, 35% for 3 doors, 15% for 4 doors
        rand = rng.random()
        if rand < 0.5:
            garage_count_per_facade = 2
        elif rand < 0.85:
            garage_count_per_facade = 3
        else:
            garage_count_per_facade = 4
        # Always have at least 1 truck bay door per facade
        garage_count_per_facade = max(1, garage_count_per_facade)
    elif building_subtype == "factory":
        # Factories: REQUIRE at least 1 garage door on BOTH front and back facades
        # Each facade gets 1-3 garage doors (1 is minimum, 2-3 are optional extras)
        garage_count_per_facade = rng.randint(1, 3)  # Always at least 1
    elif building_subtype == "house":
        # Residential houses: may have 1-2 standard garage doors
        has_garage_doors = rng.random() < 0.60  # 60% chance
        garage_count = rng.randint(1, 2) if has_garage_doors else 0
    elif building_subtype == "barn":
        # Barns/warehouses: 1-2 garage doors
        has_garage_doors = rng.random() < 0.70  # 70% chance
        garage_count = rng.randint(1, 2) if has_garage_doors else 0
    elif building_subtype == "agri_industrial":
        # Agri-industrial buildings often have 1-2 garage doors
        has_garage_doors = rng.random() < 0.70  # 70% chance
        garage_count = rng.randint(1, 2) if has_garage_doors else 0
    
    # Foundation height calculation (matches client-side: min(0.5, height * 0.1))
    foundation_height = min(0.5, height * 0.1)
    
    # For warehouses: use truck bay doors (240cm x 300cm) with standard door beside each
    # For factories: use standard garage doors (300cm x 200cm)
    # For residential houses: use standard garage doors (300cm x 200cm)
    if building_subtype == "warehouse":
        # Truck bay door dimensions
        garage_width = 2.4  # 240cm wide
        garage_height = 3.0  # 300cm tall
        # Truck bay door center Y position: door bottom at foundation top, door center at foundation top + door_height/2
        # Building base is at -height/2, foundation top is at -height/2 + foundation_height
        garage_y_position = -height / 2.0 + foundation_height + garage_height / 2.0  # Door center relative to building center
        door_type = "truck_bay"  # Special type for warehouses
    elif building_subtype == "factory":
        # Standard garage door dimensions
        garage_width = 3.0  # 300cm wide
        garage_height = 2.0  # 200cm tall
        # Garage door center Y position: door bottom at foundation top, door center at foundation top + door_height/2
        garage_y_position = -height / 2.0 + foundation_height + garage_height / 2.0  # Door center relative to building center
        door_type = "garage"
    elif building_subtype == "house" and garage_count > 0:
        # Standard garage door dimensions for residential
        garage_width = 3.0  # 300cm wide
        garage_height = 2.0  # 200cm tall
        # Garage door center Y position: door bottom at foundation top, door center at foundation top + door_height/2
        garage_y_position = -height / 2.0 + foundation_height + garage_height / 2.0  # Door center relative to building center
        door_type = "garage"
    else:
        # Default case (shouldn't happen, but handle gracefully)
        garage_width = 3.0
        garage_height = 2.0
        garage_y_position = -height / 2.0 + foundation_height + garage_height / 2.0
        door_type = "garage"
    
    # Only proceed with garage/truck bay door generation if we have a valid building type
    if building_subtype in ["warehouse", "factory"] or (building_subtype == "house" and garage_count > 0):
        
        # Function to check if garage door overlaps windows or doors with margin
        def garage_door_overlaps(garage_x: float, facade: str, facade_width: float) -> bool:
            """Check if garage door overlaps windows or doors with 30cm margin on both sides."""
            garage_margin = 0.3  # 30cm margin on each side
            garage_left = garage_x - garage_width / 2.0 - garage_margin
            garage_right = garage_x + garage_width / 2.0 + garage_margin
            garage_bottom = garage_y_position - garage_height / 2.0
            garage_top = garage_y_position + garage_height / 2.0
            
            # Check windows
            for window in windows:
                if window.get("facade") != facade:
                    continue
                
                win_pos = window["position"]
                win_size = window["size"]
                
                if facade == "front" or facade == "back":
                    win_x = win_pos[0]
                elif facade == "left" or facade == "right":
                    win_x = win_pos[1]
                
                win_left = win_x - win_size[0] / 2.0
                win_right = win_x + win_size[0] / 2.0
                win_center_y = win_pos[2]
                win_bottom = win_center_y - win_size[1] / 2.0
                win_top = win_center_y + win_size[1] / 2.0
                
                # Check if garage door (with margins) overlaps window
                if not (garage_right < win_left or garage_left > win_right or
                        garage_top < win_bottom or garage_bottom > win_top):
                    return True
            
            # Check doors (regular doors already placed on this facade)
            if facade in doors:
                facade_door = doors[facade]
                # Handle both single door dict and list of doors
                door_list = facade_door if isinstance(facade_door, list) else [facade_door]
                
                for door in door_list:
                    door_x = door.get("x", 0)
                    door_width = door.get("width", 0.9)
                    door_left = door_x - door_width / 2.0
                    door_right = door_x + door_width / 2.0
                    
                    # Check horizontal overlap (with margin)
                    if not (garage_right < door_left - garage_margin or garage_left > door_right + garage_margin):
                        return True
            
            # Check already-placed garage doors on this facade (with margin between them)
            for existing_garage in garage_doors:
                if existing_garage.get("facade") != facade:
                    continue
                
                existing_x = existing_garage.get("x", 0)
                existing_left = existing_x - garage_width / 2.0
                existing_right = existing_x + garage_width / 2.0
                
                # Check horizontal overlap (with margin)
                if not (garage_right < existing_left - garage_margin or garage_left > existing_right + garage_margin):
                    return True
            
            return False
        
        # Determine which facade(s) to place doors on
        if building_subtype in ["warehouse", "factory"]:
            # For warehouses and factories: prefer front/back facades (north/south sides)
            facade_width = width  # Front and back have width as their dimension
            
            # Decide: place on both sides, or just one?
            # 60% chance for both sides, 40% chance for one side (front or back randomly)
            place_on_both = rng.random() < 0.60
            if place_on_both:
                facades_to_use = ["front", "back"]
                # When on both, use garage_count_per_facade for each
                garage_count_for_side = garage_count_per_facade
            else:
                # Choose one facade (front or back)
                facades_to_use = [rng.choice(["front", "back"])]
                # When on one side, we can have more doors (1-4 for warehouses, 1-3 for factories)
                if building_subtype == "warehouse":
                    garage_count_for_side = rng.randint(1, 4)
                else:  # factory
                    garage_count_for_side = rng.randint(1, 3)
        elif building_subtype == "house":
            # For houses: typically on front facade, sometimes back
            facade_width = width  # Front and back have width as their dimension
            if rng.random() < 0.80:
                facades_to_use = ["front"]
            else:
                facades_to_use = [rng.choice(["front", "back"])]
            garage_count_for_side = garage_count
        
        # Place garage doors on selected facade(s)
        garage_spacing = 0.6  # 60cm spacing between garage doors (30cm margin on each side)
        available_width = facade_width - (corner_trim_width * 2)  # Usable width
        
        for facade in facades_to_use:
            garage_count = garage_count_for_side
            total_garage_width = (garage_width * garage_count) + (garage_spacing * (garage_count - 1))
            
            # Check if we have enough space
            if total_garage_width <= available_width:
                # Center the garage door group on the facade
                start_offset = -total_garage_width / 2.0 + garage_width / 2.0
                
                for i in range(garage_count):
                    # Position along facade, side-by-side
                    garage_offset = start_offset + i * (garage_width + garage_spacing)
                    
                    # Check if this position overlaps windows or doors (with margin)
                    if garage_door_overlaps(garage_offset, facade, facade_width):
                        # Try to find a nearby position that doesn't overlap
                        # Try positions slightly left and right
                        found_position = False
                        for offset_adjust in [0.1, 0.2, 0.3, -0.1, -0.2, -0.3]:
                            test_offset = garage_offset + offset_adjust
                            # Make sure it's still within bounds
                            if abs(test_offset) + garage_width / 2.0 <= facade_width / 2.0 - corner_trim_width:
                                if not garage_door_overlaps(test_offset, facade, facade_width):
                                    garage_offset = test_offset
                                    found_position = True
                                    break
                        
                        # If still overlapping, skip this garage door
                        if not found_position:
                            continue
                    
                    garage_door = {
                        "facade": facade,
                        "x": garage_offset,
                        "y": garage_y_position,
                        "width": garage_width,
                        "height": garage_height,
                        "type": door_type,  # "truck_bay" for warehouses, "garage" for others
                    }
                    garage_doors.append(garage_door)
                    
                    # For warehouses: add standard door 30cm to one side of truck bay (always together as unit)
                    # For factories: add utility door beside garage door
                    # For houses: no additional door beside garage door
                    if building_subtype == "warehouse":
                        # Truck bay + standard door unit: standard door 30cm to one side
                        standard_door_width = 0.9  # 90cm standard door
                        standard_door_height = 2.1  # 210cm standard door
                        standard_door_y_position = -height / 2.0 + foundation_height + standard_door_height / 2.0  # At foundation top
                        standard_door_spacing = 0.3  # 30cm spacing
                        
                        # Place standard door to the right of truck bay (or left if at edge)
                        standard_door_x = garage_offset + garage_width / 2.0 + standard_door_spacing + standard_door_width / 2.0
                        
                        # Check if standard door fits on the right side, otherwise place on left
                        facade_width_for_check = width  # Front and back use width
                        max_x = facade_width_for_check / 2.0 - corner_trim_width - standard_door_width / 2.0
                        
                        if standard_door_x + standard_door_width / 2.0 > max_x:
                            # Place on left side instead
                            standard_door_x = garage_offset - garage_width / 2.0 - standard_door_spacing - standard_door_width / 2.0
                            min_x = -facade_width_for_check / 2.0 + corner_trim_width + standard_door_width / 2.0
                            # If it still doesn't fit on left, place it as close as possible
                            if standard_door_x - standard_door_width / 2.0 < min_x:
                                standard_door_x = min_x
                        
                        # Always add standard door beside truck bay (they're a unit)
                        utility_doors.append({
                            "facade": facade,
                            "x": standard_door_x,
                            "y": standard_door_y_position,
                            "width": standard_door_width,
                            "height": standard_door_height,
                            "type": "standard",  # Standard door for truck bay units
                        })
                    elif building_subtype == "factory":
                        # Factories: add utility door beside garage door (existing logic)
                        utility_spacing = 0.3  # 30cm spacing between garage door and utility door
                        utility_door_x = garage_offset + garage_width / 2.0 + utility_spacing + utility_door_width / 2.0
                        
                        # Check if utility door fits on the right side, otherwise place on left
                        facade_width_for_check = width  # Front and back use width
                        max_x = facade_width_for_check / 2.0 - corner_trim_width - utility_door_width / 2.0
                        
                        if utility_door_x + utility_door_width / 2.0 > max_x:
                            # Place on left side instead
                            utility_door_x = garage_offset - garage_width / 2.0 - utility_spacing - utility_door_width / 2.0
                            min_x = -facade_width_for_check / 2.0 + corner_trim_width + utility_door_width / 2.0
                            # If it still doesn't fit on left, place it as close as possible
                            if utility_door_x - utility_door_width / 2.0 < min_x:
                                utility_door_x = min_x
                        
                        # Add utility door beside each garage door (one per garage door)
                        # Only add if it doesn't overlap windows
                        if not utility_door_overlaps_window(utility_door_x, utility_door_y_position, facade, facade_width_for_check):
                            utility_doors.append({
                                "facade": facade,
                                "x": utility_door_x,
                                "y": utility_door_y_position,
                                "width": utility_door_width,
                                "height": utility_door_height,
                                "type": "utility",
                            })
                    # For houses: no utility door beside garage door
            else:
                # Not enough space for side-by-side, place them with minimal spacing
                spacing = (available_width - (garage_width * garage_count)) / max(1, garage_count + 1) if garage_count > 1 else available_width / 2
                start_offset = -available_width / 2.0 + spacing + garage_width / 2.0
                
                for i in range(garage_count):
                    garage_offset = start_offset + i * (garage_width + spacing)
                    
                    # Check if this position overlaps windows or doors (with margin)
                    # Note: In minimal spacing case, we still try to respect margins
                    if garage_door_overlaps(garage_offset, facade, facade_width):
                        # Try to find a nearby position that doesn't overlap
                        found_position = False
                        for offset_adjust in [0.1, 0.2, 0.3, -0.1, -0.2, -0.3]:
                            test_offset = garage_offset + offset_adjust
                            # Make sure it's still within bounds
                            if abs(test_offset) + garage_width / 2.0 <= facade_width / 2.0 - corner_trim_width:
                                if not garage_door_overlaps(test_offset, facade, facade_width):
                                    garage_offset = test_offset
                                    found_position = True
                                    break
                        
                        # If still overlapping, skip this garage door
                        if not found_position:
                            continue
                    
                    garage_door = {
                        "facade": facade,
                        "x": garage_offset,
                        "y": garage_y_position,
                        "width": garage_width,
                        "height": garage_height,
                        "type": door_type,  # "truck_bay" for warehouses, "garage" for others
                    }
                    garage_doors.append(garage_door)
                    
                    # For warehouses: add standard door 30cm to one side of truck bay (always together as unit)
                    # For factories: add utility door beside garage door
                    # For houses: no additional door beside garage door
                    if building_subtype == "warehouse":
                        # Truck bay + standard door unit: standard door 30cm to one side
                        standard_door_width = 0.9  # 90cm standard door
                        standard_door_height = 2.1  # 210cm standard door
                        standard_door_y_position = -height / 2.0 + foundation_height + standard_door_height / 2.0  # At foundation top
                        standard_door_spacing = 0.3  # 30cm spacing
                        
                        # Place standard door to the right of truck bay (or left if at edge)
                        standard_door_x = garage_offset + garage_width / 2.0 + standard_door_spacing + standard_door_width / 2.0
                        
                        # Check if standard door fits on the right side, otherwise place on left
                        facade_width_for_check = width  # Front and back use width
                        max_x = facade_width_for_check / 2.0 - corner_trim_width - standard_door_width / 2.0
                        
                        if standard_door_x + standard_door_width / 2.0 > max_x:
                            # Place on left side instead
                            standard_door_x = garage_offset - garage_width / 2.0 - standard_door_spacing - standard_door_width / 2.0
                            min_x = -facade_width_for_check / 2.0 + corner_trim_width + standard_door_width / 2.0
                            # If it still doesn't fit on left, place it as close as possible
                            if standard_door_x - standard_door_width / 2.0 < min_x:
                                standard_door_x = min_x
                        
                        # Always add standard door beside truck bay (they're a unit)
                        utility_doors.append({
                            "facade": facade,
                            "x": standard_door_x,
                            "y": standard_door_y_position,
                            "width": standard_door_width,
                            "height": standard_door_height,
                            "type": "standard",  # Standard door for truck bay units
                        })
                    elif building_subtype == "factory":
                        # Factories: add utility door beside garage door
                        utility_spacing = 0.3  # 30cm spacing between garage door and utility door
                        utility_door_x = garage_offset + garage_width / 2.0 + utility_spacing + utility_door_width / 2.0
                        
                        # Check if utility door fits on the right side, otherwise place on left
                        facade_width_for_check = width  # Front and back use width
                        max_x = facade_width_for_check / 2.0 - corner_trim_width - utility_door_width / 2.0
                        
                        if utility_door_x + utility_door_width / 2.0 > max_x:
                            # Place on left side instead
                            utility_door_x = garage_offset - garage_width / 2.0 - utility_spacing - utility_door_width / 2.0
                            min_x = -facade_width_for_check / 2.0 + corner_trim_width + utility_door_width / 2.0
                            # If it still doesn't fit on left, place it as close as possible
                            if utility_door_x - utility_door_width / 2.0 < min_x:
                                utility_door_x = min_x
                        
                        # Add utility door beside each garage door (one per garage door)
                        # Only add if it doesn't overlap windows
                        if not utility_door_overlaps_window(utility_door_x, utility_door_y_position, facade, facade_width_for_check):
                            utility_doors.append({
                                "facade": facade,
                                "x": utility_door_x,
                                "y": utility_door_y_position,
                                "width": utility_door_width,
                                "height": utility_door_height,
                                "type": "utility",
                            })
                    # For houses: no utility door beside garage door
    elif garage_count > 0:
        # For other building types (barn, agri_industrial), use standardized dimensions
        # Garage door dimensions (standardized)
        garage_width = 3.0  # 300cm wide
        garage_height = 2.0  # 200cm tall
        # Garage door center Y position: building base is at -height/2, door bottom at base, door center at base + door_height/2
        garage_y_position = -height / 2.0 + garage_height / 2.0  # Door center relative to building base
        
        # Function to check if garage door overlaps windows or doors with margin
        def garage_door_overlaps_simple(garage_x: float, facade: str, facade_width: float) -> bool:
            """Check if garage door overlaps windows or doors with 30cm margin on both sides."""
            garage_margin = 0.3  # 30cm margin on each side
            garage_left = garage_x - garage_width / 2.0 - garage_margin
            garage_right = garage_x + garage_width / 2.0 + garage_margin
            garage_bottom = garage_y_position - garage_height / 2.0
            garage_top = garage_y_position + garage_height / 2.0
            
            # Check windows
            for window in windows:
                if window.get("facade") != facade:
                    continue
                
                win_pos = window["position"]
                win_size = window["size"]
                
                if facade == "front" or facade == "back":
                    win_x = win_pos[0]
                elif facade == "left" or facade == "right":
                    win_x = win_pos[1]
                
                win_left = win_x - win_size[0] / 2.0
                win_right = win_x + win_size[0] / 2.0
                win_center_y = win_pos[2]
                win_bottom = win_center_y - win_size[1] / 2.0
                win_top = win_center_y + win_size[1] / 2.0
                
                # Check if garage door (with margins) overlaps window
                if not (garage_right < win_left or garage_left > win_right or
                        garage_top < win_bottom or garage_bottom > win_top):
                    return True
            
            # Check doors (regular doors already placed on this facade)
            if facade in doors:
                facade_door = doors[facade]
                door_list = facade_door if isinstance(facade_door, list) else [facade_door]
                
                for door in door_list:
                    door_x = door.get("x", 0)
                    door_width = door.get("width", 0.9)
                    door_left = door_x - door_width / 2.0
                    door_right = door_x + door_width / 2.0
                    
                    # Check horizontal overlap (with margin)
                    if not (garage_right < door_left - garage_margin or garage_left > door_right + garage_margin):
                        return True
            
            # Check already-placed garage doors on this facade
            for existing_garage in garage_doors:
                if existing_garage.get("facade") != facade:
                    continue
                
                existing_x = existing_garage.get("x", 0)
                existing_left = existing_x - garage_width / 2.0
                existing_right = existing_x + garage_width / 2.0
                
                # Check horizontal overlap (with margin)
                if not (garage_right < existing_left - garage_margin or garage_left > existing_right + garage_margin):
                    return True
            
            return False
        
        # Determine which facade(s) to place garage doors on
        # For barns and agri-industrial, typically on the front or back (larger facades)
        facade_candidates = ["front", "back"]
        # Choose one facade for all garage doors (they should be side-by-side)
        facade = rng.choice(facade_candidates)
        facade_width = width if facade in ["front", "back"] else depth
        
        # Place garage doors side-by-side with spacing between them
        # Account for corner trim (absolute width in meters)
        available_width = facade_width - (corner_trim_width * 2)  # Usable width
        
        # Total width needed for all garage doors with spacing
        garage_spacing = 0.6  # 60cm spacing between garage doors (30cm margin on each side)
        total_garage_width = (garage_width * garage_count) + (garage_spacing * (garage_count - 1))
        
        # Check if we have enough space
        if total_garage_width <= available_width:
            # Center the garage door group on the facade
            start_offset = -total_garage_width / 2.0 + garage_width / 2.0
            
            for i in range(garage_count):
                # Position along facade, side-by-side
                garage_offset = start_offset + i * (garage_width + garage_spacing)
                
                # Check if this position overlaps windows or doors (with margin)
                if garage_door_overlaps_simple(garage_offset, facade, facade_width):
                    # Try to find a nearby position that doesn't overlap
                    found_position = False
                    for offset_adjust in [0.1, 0.2, 0.3, -0.1, -0.2, -0.3]:
                        test_offset = garage_offset + offset_adjust
                        # Make sure it's still within bounds
                        if abs(test_offset) + garage_width / 2.0 <= facade_width / 2.0 - corner_trim_width:
                            if not garage_door_overlaps_simple(test_offset, facade, facade_width):
                                garage_offset = test_offset
                                found_position = True
                                break
                    
                    # If still overlapping, skip this garage door
                    if not found_position:
                        continue
                
                garage_door = {
                    "facade": facade,
                    "x": garage_offset,
                    "y": garage_y_position,
                    "width": garage_width,
                    "height": garage_height,
                    "type": "garage",
                }
                garage_doors.append(garage_door)
                
                # Add utility door right beside each garage door (one per garage door)
                utility_spacing = 0.3  # 30cm spacing between garage door and utility door
                utility_door_x = garage_offset + garage_width / 2.0 + utility_spacing + utility_door_width / 2.0
                
                # Check if utility door fits on the right side, otherwise place on left
                max_x = facade_width / 2.0 - corner_trim_width - utility_door_width / 2.0
                
                if utility_door_x + utility_door_width / 2.0 > max_x:
                    # Place on left side instead
                    utility_door_x = garage_offset - garage_width / 2.0 - utility_spacing - utility_door_width / 2.0
                    min_x = -facade_width / 2.0 + corner_trim_width + utility_door_width / 2.0
                    if utility_door_x - utility_door_width / 2.0 < min_x:
                        utility_door_x = min_x
                
                # Only add utility door if it doesn't overlap windows
                if not utility_door_overlaps_window(utility_door_x, utility_door_y_position, facade, facade_width):
                    utility_doors.append({
                        "facade": facade,
                        "x": utility_door_x,
                        "y": utility_door_y_position,
                        "width": utility_door_width,
                        "height": utility_door_height,
                        "type": "utility",
                    })
        else:
            # Not enough space for side-by-side, place them with minimal spacing
            spacing = (available_width - total_garage_width) / max(1, garage_count + 1) if garage_count > 1 else available_width / 2
            start_offset = -available_width / 2.0 + spacing + garage_width / 2.0
            
            for i in range(garage_count):
                garage_offset = start_offset + i * (garage_width + spacing)
                
                # Check if this position overlaps windows or doors (with margin)
                if garage_door_overlaps_simple(garage_offset, facade, facade_width):
                    # Try to find a nearby position that doesn't overlap
                    found_position = False
                    for offset_adjust in [0.1, 0.2, 0.3, -0.1, -0.2, -0.3]:
                        test_offset = garage_offset + offset_adjust
                        # Make sure it's still within bounds
                        if abs(test_offset) + garage_width / 2.0 <= facade_width / 2.0 - corner_trim_width:
                            if not garage_door_overlaps_simple(test_offset, facade, facade_width):
                                garage_offset = test_offset
                                found_position = True
                                break
                    
                    # If still overlapping, skip this garage door
                    if not found_position:
                        continue
                
                garage_door = {
                    "facade": facade,
                    "x": garage_offset,
                    "y": garage_y_position,
                    "width": garage_width,
                    "height": garage_height,
                    "type": "garage",
                }
                garage_doors.append(garage_door)
                
                # Add utility door right beside each garage door (one per garage door)
                utility_spacing = 0.3  # 30cm spacing between garage door and utility door
                utility_door_x = garage_offset + garage_width / 2.0 + utility_spacing + utility_door_width / 2.0
                
                # Check if utility door fits on the right side, otherwise place on left
                max_x = facade_width / 2.0 - corner_trim_width - utility_door_width / 2.0
                
                if utility_door_x + utility_door_width / 2.0 > max_x:
                    # Place on left side instead
                    utility_door_x = garage_offset - garage_width / 2.0 - utility_spacing - utility_door_width / 2.0
                    min_x = -facade_width / 2.0 + corner_trim_width + utility_door_width / 2.0
                    if utility_door_x - utility_door_width / 2.0 < min_x:
                        utility_door_x = min_x
                
                # Only add utility door if it doesn't overlap windows
                if not utility_door_overlaps_window(utility_door_x, utility_door_y_position, facade, facade_width):
                    utility_doors.append({
                        "facade": facade,
                        "x": utility_door_x,
                        "y": utility_door_y_position,
                        "width": utility_door_width,
                        "height": utility_door_height,
                        "type": "utility",
                    })
    
    return (garage_doors, utility_doors)

