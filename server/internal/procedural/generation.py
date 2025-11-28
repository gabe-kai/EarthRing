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

# Geometry version - increment this when generation algorithm changes significantly
# Version history:
#   1: Initial rectangular geometry (4 vertices, 2 faces)
#   2: Smooth curved geometry with 50m sample intervals (42 vertices, 40 faces)
CURRENT_GEOMETRY_VERSION = 2


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


def generate_ring_floor_geometry(chunk_index: int, floor: int) -> dict:
    """
    Generate smooth curved ring floor geometry with tapered edges.

    Creates a curved mesh that smoothly tapers based on station flares.
    Samples width at regular intervals along the chunk to create smooth curves.
    Geometry is in EarthRing coordinate system (X=ring, Y=width, Z=floor).

    Args:
        chunk_index: Chunk index (0-263,999)
        floor: Floor number

    Returns:
        Dictionary with geometry data (vertices, faces, normals)
    """
    # Sample interval: 50m for smooth curves (20 samples per 1km chunk)
    SAMPLE_INTERVAL = 50.0
    num_samples = int(CHUNK_LENGTH / SAMPLE_INTERVAL) + 1

    # Calculate chunk start position
    chunk_start_position = chunk_index * CHUNK_LENGTH

    vertices = []
    faces = []
    normals = []

    # Generate vertices along both edges (left and right) at each sample point
    for i in range(num_samples):
        # Position along chunk (0 to CHUNK_LENGTH)
        x_offset = min(i * SAMPLE_INTERVAL, CHUNK_LENGTH)

        # Calculate absolute ring position at this sample point
        ring_position = chunk_start_position + x_offset

        # Calculate width at this position (smooth curve)
        width = stations.calculate_flare_width(ring_position)
        half_width = width / 2.0

        # Create vertices for left and right edges at this X position
        # Left edge (negative Y)
        vertices.append([x_offset, -half_width, 0.0])
        # Right edge (positive Y)
        vertices.append([x_offset, half_width, 0.0])

    # Generate faces connecting adjacent sample points
    # Each quad is made of two triangles
    for i in range(num_samples - 1):
        # Indices for current sample point
        left_current = i * 2
        right_current = i * 2 + 1

        # Indices for next sample point
        left_next = (i + 1) * 2
        right_next = (i + 1) * 2 + 1

        # Create two triangles forming a quad
        # Triangle 1: left_current -> left_next -> right_current
        faces.append([left_current, left_next, right_current])
        # Triangle 2: right_current -> left_next -> right_next
        faces.append([right_current, left_next, right_next])

    # Calculate normals for each face (all pointing up: [0, 0, 1])
    for _ in faces:
        normals.append([0.0, 0.0, 1.0])

    # Calculate average width for metadata (width at chunk center)
    chunk_center_position = chunk_start_position + (CHUNK_LENGTH / 2.0)
    avg_width = stations.calculate_flare_width(chunk_center_position)

    return {
        "type": "ring_floor",
        "vertices": vertices,
        "faces": faces,
        "normals": normals,
        "width": avg_width,
        "length": CHUNK_LENGTH,
    }


def generate_chunk_restricted_zone(floor: int, chunk_index: int) -> dict:
    """
    Generate a default restricted zone for a chunk.
    
    Creates a restricted zone that spans the full chunk length (1000m) and is 20m wide
    (Y: -10 to +10), centered on the ring. This zone reserves space for maglev transit
    and prevents building in that area.
    
    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)
    
    Returns:
        Dictionary with zone data in GeoJSON format
    """
    # Calculate chunk boundaries
    # Note: These are absolute coordinates - wrapping happens during rendering, not storage
    chunk_start_position = chunk_index * CHUNK_LENGTH
    chunk_end_position = chunk_start_position + CHUNK_LENGTH
    
    # For the last chunk (index 263999), chunk_end_position = 264000000
    # This is valid - coordinates can be stored up to the ring circumference
    # The client will wrap coordinates relative to camera during rendering
    
    # Zone specifications:
    # - Width: 20m (Y: -10 to +10)
    # - Length: Full chunk (X: chunk_start to chunk_end)
    # - Type: Restricted (prevents building)
    # - System zone: Yes (protected from player modifications)
    
    # Create polygon coordinates in GeoJSON format
    # GeoJSON coordinates are [longitude, latitude] but we use [X, Y] for EarthRing
    # Polygon is a closed ring, so first and last coordinates are the same
    coordinates = [
        [
            [chunk_start_position, -10.0],  # Bottom-left
            [chunk_end_position, -10.0],     # Bottom-right
            [chunk_end_position, 10.0],       # Top-right
            [chunk_start_position, 10.0],    # Top-left
            [chunk_start_position, -10.0],    # Close polygon
        ]
    ]
    
    return {
        "type": "Feature",
        "properties": {
            "name": f"Maglev Transit Zone (Floor {floor}, Chunk {chunk_index})",
            "zone_type": "restricted",
            "floor": floor,
            "is_system_zone": True,
            "properties": {
                "purpose": "maglev_transit",
                "description": "Reserved space for maglev train and loading/unloading equipment",
            },
            "metadata": {
                "default_zone": True,
                "maglev_zone": True,
                "chunk_index": chunk_index,
            },
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": coordinates,
        },
    }


def generate_chunk(floor: int, chunk_index: int, chunk_seed: int):
    """
    Generate a chunk with smooth curved ring floor geometry.

    Generates a chunk with smooth curved geometry that tapers based on station flares.
    Includes a default restricted zone for maglev transit.

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)
        chunk_seed: Chunk seed for deterministic generation

    Returns:
        Dictionary with chunk data including geometry and zones
    """
    # Generate smooth curved ring floor geometry
    geometry = generate_ring_floor_geometry(chunk_index, floor)

    # Calculate chunk position along ring (in meters)
    # Chunk index 0 starts at position 0, each chunk is 1000m long
    chunk_start_position = chunk_index * CHUNK_LENGTH

    # Adjust geometry vertices to absolute positions
    # Add chunk start position to X coordinates and set floor level
    adjusted_vertices = []
    for vertex in geometry["vertices"]:
        adjusted_vertex = [
            vertex[0] + chunk_start_position,  # X: ring position
            vertex[1],  # Y: width position (centered at 0)
            floor,  # Z: floor level
        ]
        adjusted_vertices.append(adjusted_vertex)

    geometry["vertices"] = adjusted_vertices

    # Get chunk width for metadata (width at chunk center)
    chunk_width = get_chunk_width(floor, chunk_index, chunk_seed)
    
    # Generate default restricted zone for this chunk
    restricted_zone = generate_chunk_restricted_zone(floor, chunk_index)

    return {
        "chunk_id": f"{floor}_{chunk_index}",
        "floor": floor,
        "chunk_index": chunk_index,
        "seed": chunk_seed,
        "geometry": geometry,
        "structures": [],
        "zones": [restricted_zone],  # Include default restricted zone
        "metadata": {
            "generated": True,
            "version": CURRENT_GEOMETRY_VERSION,
            "chunk_width": chunk_width,
            "chunk_length": CHUNK_LENGTH,
            "chunk_levels": get_chunk_levels(floor, chunk_index, chunk_seed),
            # Version metadata for granular version checking
            "version_metadata": {
                "geometry_version": CURRENT_GEOMETRY_VERSION,
                "sample_interval": 50.0,  # Sample interval in meters
                "algorithm": "smooth_curved_taper",
                "vertex_count": len(geometry["vertices"]),
                "face_count": len(geometry["faces"]),
            },
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
