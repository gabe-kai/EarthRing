"""
Chunk generation functions.
Phase 2: Basic ring floor geometry generation with station flares.
"""

from . import seeds
from . import stations
import math

# Constants
CHUNK_LENGTH = 1000.0  # 1 km chunk length along ring
BASE_CHUNK_WIDTH = 400.0  # Base width: 400m
FLOOR_HEIGHT = 20.0  # 20 meters per floor level


def get_chunk_width(floor: int, chunk_index: int, chunk_seed: int) -> float:
    """
    Get the width of a chunk, accounting for station flares.

    Base width is 400m, but chunks at stations can be wider (up to 25km).
    Width varies smoothly based on distance from station centers using cosine transitions.

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)
        chunk_seed: Chunk seed (not used for width calculation, kept for API compatibility)

    Returns:
        Chunk width in meters (400m base, up to 25km at station centers)
    """
    # Calculate chunk center position along ring (in meters)
    chunk_center_position = chunk_index * CHUNK_LENGTH + (CHUNK_LENGTH / 2.0)

    # Calculate width based on station flares
    width = stations.calculate_flare_width(chunk_center_position)

    return width


def get_chunk_levels(floor: int, chunk_index: int, chunk_seed: int) -> int:
    """
    Get the number of levels for a chunk, accounting for station flares.

    Base levels is 5, but chunks at stations can have more levels (up to 15).
    Levels vary smoothly based on distance from station centers using cosine transitions.

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)
        chunk_seed: Chunk seed (not used for level calculation, kept for API compatibility)

    Returns:
        Number of levels (5 base, up to 15 at station centers)
    """
    # Calculate chunk center position along ring (in meters)
    chunk_center_position = chunk_index * CHUNK_LENGTH + (CHUNK_LENGTH / 2.0)

    # Calculate levels based on station flares
    levels = stations.calculate_flare_levels(chunk_center_position)

    return levels


def generate_ring_floor_geometry(chunk_width: float) -> dict:
    """
    Generate basic ring floor geometry (flat plane).

    Creates a simple rectangular plane representing the ring floor.
    Geometry is in EarthRing coordinate system (X=ring, Y=width, Z=floor).

    Args:
        chunk_width: Width of the chunk in meters

    Returns:
        Dictionary with geometry data (vertices, faces, normals)
    """
    # Create a simple rectangular plane
    # Vertices in EarthRing coordinates (X=ring position, Y=width position, Z=floor)
    # For a chunk at position (chunk_index * 1000, 0, floor):
    # - X ranges from (chunk_index * 1000) to (chunk_index * 1000 + 1000)
    # - Y ranges from -chunk_width/2 to +chunk_width/2
    # - Z is the floor level (will be set by caller)

    half_width = chunk_width / 2.0

    # Define vertices (4 corners of the rectangle)
    # Format: [x, y, z] in EarthRing coordinates
    vertices = [
        [0.0, -half_width, 0.0],  # Bottom-left (relative to chunk start)
        [CHUNK_LENGTH, -half_width, 0.0],  # Bottom-right
        [CHUNK_LENGTH, half_width, 0.0],  # Top-right
        [0.0, half_width, 0.0],  # Top-left
    ]

    # Define faces (two triangles forming the rectangle)
    # Format: [v1, v2, v3] where v1, v2, v3 are vertex indices
    faces = [
        [0, 1, 2],  # First triangle
        [0, 2, 3],  # Second triangle
    ]

    # Calculate normals (all pointing up in EarthRing Z direction)
    # For a flat plane, normal is [0, 0, 1]
    normals = [
        [0.0, 0.0, 1.0],  # Normal for first triangle
        [0.0, 0.0, 1.0],  # Normal for second triangle
    ]

    return {
        "type": "ring_floor",
        "vertices": vertices,
        "faces": faces,
        "normals": normals,
        "width": chunk_width,
        "length": CHUNK_LENGTH,
    }


def generate_chunk(floor: int, chunk_index: int, chunk_seed: int):
    """
    Generate a chunk with basic ring floor geometry (Phase 2 MVP).

    Generates a chunk with basic ring floor geometry. Buildings, zones, etc.
    will be added in later phases.

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)
        chunk_seed: Chunk seed for deterministic generation

    Returns:
        Dictionary with chunk data including geometry
    """
    # Get chunk width
    chunk_width = get_chunk_width(floor, chunk_index, chunk_seed)

    # Generate ring floor geometry
    geometry = generate_ring_floor_geometry(chunk_width)

    # Calculate chunk position along ring (in meters)
    # Chunk index 0 starts at position 0, each chunk is 1000m long
    chunk_start_position = chunk_index * CHUNK_LENGTH

    # Adjust geometry vertices to absolute positions
    # Add chunk start position to X coordinates
    adjusted_vertices = []
    for vertex in geometry["vertices"]:
        adjusted_vertex = [
            vertex[0] + chunk_start_position,  # X: ring position
            vertex[1],  # Y: width position (centered at 0)
            floor,  # Z: floor level
        ]
        adjusted_vertices.append(adjusted_vertex)

    geometry["vertices"] = adjusted_vertices

    return {
        "chunk_id": f"{floor}_{chunk_index}",
        "floor": floor,
        "chunk_index": chunk_index,
        "seed": chunk_seed,
        "geometry": geometry,
        "structures": [],
        "zones": [],
        "metadata": {
            "generated": True,
            "version": 2,  # Version 2 for Phase 2 geometry
            "chunk_width": chunk_width,
            "chunk_length": CHUNK_LENGTH,
            "chunk_levels": get_chunk_levels(floor, chunk_index, chunk_seed),
        },
    }


# Backward compatibility: keep generate_empty_chunk for tests
def generate_empty_chunk(floor: int, chunk_index: int, chunk_seed: int):
    """
    Generate an empty chunk (deprecated, use generate_chunk instead).

    This function is kept for backward compatibility with tests.
    New code should use generate_chunk().
    """
    return generate_chunk(floor, chunk_index, chunk_seed)
