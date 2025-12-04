"""
Grid-based city layout generation.
Creates 50m × 50m grid cells within zones and assigns building/park/road types.
"""

import random
import math
from typing import Dict, List, Any, Tuple, Optional
import shapely.geometry as sg
import shapely.ops as so

# Import building generation
from . import buildings

# Constants
GRID_CELL_SIZE = 50.0  # 50m × 50m cells


def seeded_random(seed: int) -> random.Random:
    """Create deterministic random number generator."""
    rng = random.Random(seed)
    return rng


def generate_city_grid(
    zone_polygon: List[List[float]],  # GeoJSON coordinates
    zone_type: str,
    zone_importance: float,
    chunk_seed: int,
) -> List[Dict[str, Any]]:
    """
    Generate city grid within a zone polygon.
    
    Creates 50m × 50m grid cells and assigns cell types (building, park, road, plaza).
    
    Args:
        zone_polygon: Zone polygon coordinates (GeoJSON format: [[[x1,y1], [x2,y2], ...]])
        zone_type: Type of zone (residential, commercial, industrial, etc.)
        zone_importance: Zone importance value (0.0 to 1.0)
        chunk_seed: Deterministic seed for this chunk
    
    Returns:
        List of grid cell dictionaries with position and cell type
    """
    rng = seeded_random(chunk_seed)
    
    # Extract coordinates from GeoJSON format
    # GeoJSON polygons are: [[[x1,y1], [x2,y2], ...], ...] (outer ring + holes)
    if not zone_polygon or not zone_polygon[0]:
        return []
    
    outer_ring = zone_polygon[0]
    if len(outer_ring) < 3:  # Need at least 3 points for a polygon
        return []
    
    # Create Shapely polygon for geometry operations
    polygon = sg.Polygon(outer_ring)
    
    # Get bounding box
    bounds = polygon.bounds  # (minx, miny, maxx, maxy)
    
    # Calculate grid cell positions
    cells = []
    
    # Start at grid-aligned positions
    min_x = math.floor(bounds[0] / GRID_CELL_SIZE) * GRID_CELL_SIZE
    min_y = math.floor(bounds[1] / GRID_CELL_SIZE) * GRID_CELL_SIZE
    max_x = math.ceil(bounds[2] / GRID_CELL_SIZE) * GRID_CELL_SIZE
    max_y = math.ceil(bounds[3] / GRID_CELL_SIZE) * GRID_CELL_SIZE
    
    # Generate cells
    x = min_x
    while x < max_x:
        y = min_y
        while y < max_y:
            # Create cell polygon
            cell_polygon = sg.box(
                x, y, x + GRID_CELL_SIZE, y + GRID_CELL_SIZE
            )
            
            # Check if cell intersects with zone polygon
            if polygon.intersects(cell_polygon):
                # Calculate cell center
                cell_center = cell_polygon.centroid
                
                # Determine cell type based on zone type and position
                cell_type = _determine_cell_type(
                    cell_center, polygon, zone_type, zone_importance, rng, chunk_seed
                )
                
                cell = {
                    "type": cell_type,
                    "position": [cell_center.x, cell_center.y],
                    "bounds": {
                        "min_x": x,
                        "min_y": y,
                        "max_x": x + GRID_CELL_SIZE,
                        "max_y": y + GRID_CELL_SIZE,
                    },
                    "seed": hash((chunk_seed, int(x / GRID_CELL_SIZE), int(y / GRID_CELL_SIZE))) % (2**31),
                }
                cells.append(cell)
            
            y += GRID_CELL_SIZE
        x += GRID_CELL_SIZE
    
    return cells


def _determine_cell_type(
    cell_center: Any,  # Shapely Point
    zone_polygon: sg.Polygon,
    zone_type: str,
    zone_importance: float,
    rng: random.Random,
    chunk_seed: int,
) -> str:
    """
    Determine the type of cell (building, park, road, plaza).
    
    Returns:
        Cell type string: "building", "park", "road", "plaza"
    """
    # Get distribution based on zone type
    distribution = _get_zone_distribution(zone_type)
    
    # Check if zone is too small for edge detection (less than 3 grid cells wide)
    bounds = zone_polygon.bounds
    zone_width = bounds[2] - bounds[0]  # max_x - min_x
    zone_depth = bounds[3] - bounds[1]  # max_y - min_y
    min_dimension = min(zone_width, zone_depth)
    
    # For very small zones (< 3 cells = 150m), treat all cells as interior
    # This handles narrow zones like the 20m-wide industrial zones
    if min_dimension < GRID_CELL_SIZE * 3:
        # Small zone - all cells can be buildings
        is_edge = False
    else:
        # Normal zone - check distance to edge
        distance_to_edge = zone_polygon.exterior.distance(cell_center)
        is_edge = distance_to_edge < GRID_CELL_SIZE * 1.5  # Within 1.5 cells of edge
    
    if is_edge:
        # Edge cells: roads or plazas
        road_prob = distribution.get("road", 0.05)
        plaza_prob = distribution.get("plaza", 0.05)
        total_edge_prob = road_prob + plaza_prob
        if total_edge_prob > 0:
            if rng.random() < road_prob / total_edge_prob:
                return "road"
            else:
                return "plaza"
        else:
            # If no edge distribution, use building distribution
            is_edge = False
    
    if not is_edge:
        # Interior cells: buildings or parks based on distribution
        # Use noise for variation
        noise_seed = hash((chunk_seed, int(cell_center.x), int(cell_center.y))) % (2**31)
        noise_rng = seeded_random(noise_seed)
        noise_value = noise_rng.random()
        
        # Select cell type based on distribution
        building_prob = distribution.get("building", 0.7)
        park_prob = distribution.get("park", 0.2)
        
        if noise_value < building_prob:
            return "building"
        elif noise_value < building_prob + park_prob:
            return "park"
        else:
            return "plaza"  # Fallback


def _get_zone_distribution(zone_type: str) -> Dict[str, float]:
    """
    Get cell type distribution percentages for a zone type.
    
    Returns:
        Dictionary with cell type percentages (sum should be ~1.0)
    """
    distributions = {
        "residential": {
            "building": 0.70,
            "park": 0.20,
            "plaza": 0.05,
            "road": 0.05,
        },
        "commercial": {
            "building": 0.80,
            "plaza": 0.15,
            "park": 0.03,
            "road": 0.02,
        },
        "industrial": {
            "building": 0.85,
            "road": 0.10,
            "plaza": 0.03,
            "park": 0.02,
        },
        "mixed_use": {
            "building": 0.75,
            "park": 0.15,
            "plaza": 0.07,
            "road": 0.03,
        },
        "agricultural": {
            "building": 0.15,  # Storage buildings
            "park": 0.70,  # Agricultural plots (treated as "park" for now)
            "road": 0.10,
            "plaza": 0.05,
        },
        "park": {
            "building": 0.05,
            "park": 0.90,
            "plaza": 0.03,
            "road": 0.02,
        },
        "restricted": {
            "building": 0.0,
            "park": 0.0,
            "plaza": 0.0,
            "road": 1.0,  # Only roads in restricted zones
        },
    }
    
    return distributions.get(zone_type, {
        "building": 0.70,
        "park": 0.20,
        "plaza": 0.05,
        "road": 0.05,
    })

