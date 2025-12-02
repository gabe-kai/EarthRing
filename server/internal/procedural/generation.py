"""
Chunk generation functions.
Phase 2: Basic ring floor geometry generation with station flares and building generation.
"""

from . import seeds
from . import stations
import math

# Optional imports for Phase 2 building generation
try:
    from . import grid
    from . import buildings
    import shapely.geometry as sg
    BUILDING_GENERATION_AVAILABLE = True
except ImportError:
    # Building generation not available (e.g., missing shapely)
    BUILDING_GENERATION_AVAILABLE = False

# Constants
CHUNK_LENGTH = 1000.0  # 1 km chunk length along ring
BASE_CHUNK_WIDTH = 400.0  # Base width: 400m
FLOOR_HEIGHT = 20.0  # 20 meters per floor level

# Geometry version - increment this when generation algorithm changes significantly
# Version history:
#   1: Initial rectangular geometry (4 vertices, 2 faces)
#   2: Smooth curved geometry with 50m sample intervals (42 vertices, 40 faces)
#   3: Phase 2 - Added building generation (grid-based city generation with buildings)
#   4: Phase 2 - Added building variability (discrete floor heights, building subtypes, varied footprints)
#   5: Phase 2 - Fixed building heights to be 5, 10, 15, or 20m (within single 20m level)
#   6: Phase 2 - Changed to 4m floor system (1-5 floors) with new window types (full-height, standard, ceiling)
CURRENT_GEOMETRY_VERSION = 6


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


def calculate_restricted_zone_width(x_position: float) -> float:
    """
    Calculate the width of the restricted zone at a given X position.
    
    The zone width varies based on proximity to stations:
    - Base width: 20m (Y: -10 to +10) for normal areas (outside station flares)
    - Within station flare areas, zones scale based on percentage of flare length:
      - 160m wide (80m half-width): 20% of station length (centered)
      - 120m wide (60m half-width): 40% of station length
      - 100m wide (50m half-width): 60% of station length
      - 80m wide (40m half-width): 80% of station length
    
    Args:
        x_position: X position along the ring in meters
    
    Returns:
        Zone half-width in meters (actual Y range is [-half_width, +half_width])
    """
    # Base width: 20m total (10m on each side)
    base_half_width = 10.0
    
    # Find nearest station
    station_result = stations.find_nearest_station(x_position)
    if station_result is None:
        return base_half_width
    
    nearest_station, distance = station_result
    
    # Check if we're within the station flare area
    flare_range = nearest_station.station_type.flare_length / 2.0
    if distance >= flare_range:
        # Outside flare area: use base width
        return base_half_width
    
    # Within station flare area: calculate width based on percentage of flare length
    # Distance from center as percentage of flare range (0.0 = center, 1.0 = edge)
    distance_percentage = distance / flare_range
    
    # Zone widths and their coverage percentages (from center outward):
    # - 160m wide: 20% of station length (0% to 10% from center)
    # - 120m wide: 40% of station length (0% to 20% from center)
    # - 100m wide: 60% of station length (0% to 30% from center)
    # - 80m wide: 80% of station length (0% to 40% from center)
    # - 20m wide: 100% of station length (base, used outside or as fallback)
    
    # Determine which zone width to use based on distance from center
    if distance_percentage <= 0.10:  # Within 10% of flare range (20% of station length)
        # 160m wide (80m half-width)
        return 80.0
    elif distance_percentage <= 0.20:  # Within 20% of flare range (40% of station length)
        # 120m wide (60m half-width)
        return 60.0
    elif distance_percentage <= 0.30:  # Within 30% of flare range (60% of station length)
        # 100m wide (50m half-width)
        return 50.0
    elif distance_percentage <= 0.40:  # Within 40% of flare range (80% of station length)
        # 80m wide (40m half-width)
        return 40.0
    else:
        # Beyond 40% but still within flare: use base width
        # This handles the transition area between station zones and normal areas
        return base_half_width


def generate_chunk_restricted_zone(floor: int, chunk_index: int) -> dict:
    """
    Generate a default restricted zone for a chunk.
    
    Creates a restricted zone that spans the full chunk length (1000m) with variable width
    based on proximity to stations. The zone widens near stations based on flare length percentages.
    
    Zone width specifications:
    - Base width: 20m (Y: -10 to +10) for normal areas (outside station flares)
    - Within station flare areas, zones scale based on percentage of flare length:
      - 160m wide: 20% of station length (centered on station)
      - 120m wide: 40% of station length
      - 100m wide: 60% of station length
      - 80m wide: 80% of station length
    
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
    
    # Sample zone width at multiple points along the chunk to create a smooth polygon
    # Sample every 50m to capture width transitions accurately
    sample_interval = 50.0
    sample_points = []
    x = chunk_start_position
    while x <= chunk_end_position:
        sample_points.append(x)
        x += sample_interval
    # Ensure we include the end point
    if sample_points[-1] < chunk_end_position:
        sample_points.append(chunk_end_position)
    
    # Build polygon coordinates with variable width
    # We'll create vertices along the top and bottom edges
    bottom_edge = []  # Bottom edge (negative Y)
    top_edge = []     # Top edge (positive Y)
    
    for x_pos in sample_points:
        half_width = calculate_restricted_zone_width(x_pos)
        bottom_edge.append([x_pos, -half_width])
        top_edge.append([x_pos, half_width])
    
    # Reverse top edge so we can connect them in order
    top_edge.reverse()
    
    # Combine edges to form closed polygon
    # Start at first bottom point, go along bottom, then along top, then close
    coordinates = [bottom_edge + top_edge + [bottom_edge[0]]]
    
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


def is_within_hub_platform_area(chunk_index: int) -> bool:
    """
    Check if a chunk is within a hub platform area (within 1500m of any hub center).
    
    Args:
        chunk_index: Chunk index (0-263,999)
    
    Returns:
        True if chunk is within hub platform area, False otherwise
    """
    # Calculate chunk center position
    chunk_center_position = chunk_index * CHUNK_LENGTH + (CHUNK_LENGTH / 2.0)
    
    # Check distance to nearest hub station
    hub_positions = stations.PILLAR_HUB_POSITIONS
    min_distance = float('inf')
    for hub_x in hub_positions:
        distance = stations.distance_with_wrapping(chunk_center_position, hub_x)
        min_distance = min(min_distance, distance)
    
    # Within 1500m of hub center
    return min_distance < 1500.0


def is_within_station_flare_area(chunk_index: int) -> bool:
    """
    Check if a chunk is within a station flare area (within flare_length/2 of any hub center).
    
    For pillar/elevator hubs, the flare extends 25km (25,000m) on each side of the hub center.
    
    Args:
        chunk_index: Chunk index (0-263,999)
    
    Returns:
        True if chunk is within station flare area, False otherwise
    """
    # Calculate chunk center position
    chunk_center_position = chunk_index * CHUNK_LENGTH + (CHUNK_LENGTH / 2.0)
    
    # Check distance to nearest hub station
    hub_positions = stations.PILLAR_HUB_POSITIONS
    min_distance = float('inf')
    for hub_x in hub_positions:
        distance = stations.distance_with_wrapping(chunk_center_position, hub_x)
        min_distance = min(min_distance, distance)
    
    # Station flare extends flare_length/2 on each side
    # For PILLAR_ELEVATOR_HUB: flare_length = 50000.0, so flare_range = 25000.0
    flare_range = stations.PILLAR_ELEVATOR_HUB.flare_length / 2.0
    
    # Within flare range of hub center
    return min_distance < flare_range


def generate_chunk_industrial_zones(floor: int, chunk_index: int) -> list:
    """
    Generate industrial zones on either side of the restricted zone within station flare areas.

    Creates two 80m-wide industrial zones that line the restricted zone:
    - North industrial zone: from north edge of restricted zone outward by 80m
    - South industrial zone: from south edge of restricted zone outward by 80m

    These zones are generated within station flare areas (within flare_length/2 of hub centers,
    which is 25km for pillar/elevator hubs).

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)

    Returns:
        List of zone dictionaries in GeoJSON format (empty list if not in station flare area)
    """
    # Only generate industrial zones within station flare areas
    if not is_within_station_flare_area(chunk_index):
        return []
    
    # Calculate chunk boundaries
    chunk_start_position = chunk_index * CHUNK_LENGTH
    chunk_end_position = chunk_start_position + CHUNK_LENGTH
    
    # Sample zone width at multiple points along the chunk
    sample_interval = 50.0
    sample_points = []
    x = chunk_start_position
    while x <= chunk_end_position:
        sample_points.append(x)
        x += sample_interval
    if sample_points[-1] < chunk_end_position:
        sample_points.append(chunk_end_position)
    
    # Build north industrial zone (negative Y side)
    # North zone goes from -half_width - 80 to -half_width
    north_bottom_edge = []  # Outer edge (further from center)
    north_top_edge = []     # Inner edge (touching restricted zone)
    
    for x_pos in sample_points:
        half_width = calculate_restricted_zone_width(x_pos)
        # North zone: from -half_width - 80 to -half_width
        north_bottom_edge.append([x_pos, -half_width - 80.0])
        north_top_edge.append([x_pos, -half_width])
    
    # Reverse top edge to connect in order
    north_top_edge.reverse()
    north_coordinates = [north_bottom_edge + north_top_edge + [north_bottom_edge[0]]]
    
    # Build south industrial zone (positive Y side)
    # South zone goes from +half_width to +half_width + 80
    south_bottom_edge = []  # Inner edge (touching restricted zone)
    south_top_edge = []     # Outer edge (further from center)
    
    for x_pos in sample_points:
        half_width = calculate_restricted_zone_width(x_pos)
        # South zone: from +half_width to +half_width + 80
        south_bottom_edge.append([x_pos, half_width])
        south_top_edge.append([x_pos, half_width + 80.0])
    
    # Reverse top edge to connect in order
    south_top_edge.reverse()
    south_coordinates = [south_bottom_edge + south_top_edge + [south_bottom_edge[0]]]
    
    # Create zone dictionaries
    zones = [
        {
            "type": "Feature",
            "properties": {
                "name": f"Hub Industrial Zone North (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "industrial",
                "floor": floor,
                "is_system_zone": True,
                "properties": {
                    "purpose": "hub_industrial",
                    "description": "Industrial zone lining maglev transit area at hub platform",
                },
                "metadata": {
                    "default_zone": True,
                    "hub_zone": True,
                    "chunk_index": chunk_index,
                    "side": "north",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": north_coordinates,
            },
        },
        {
            "type": "Feature",
            "properties": {
                "name": f"Hub Industrial Zone South (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "industrial",
                "floor": floor,
                "is_system_zone": True,
                "properties": {
                    "purpose": "hub_industrial",
                    "description": "Industrial zone lining maglev transit area at hub platform",
                },
                "metadata": {
                    "default_zone": True,
                    "hub_zone": True,
                    "chunk_index": chunk_index,
                    "side": "south",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": south_coordinates,
            },
        },
    ]
    
    return zones


def generate_chunk_commercial_zones(floor: int, chunk_index: int) -> list:
    """
    Generate commercial zones interspersed within industrial zones at chunk centers.

    Creates two 80m x 80m commercial zones at the center of each chunk:
    - North commercial zone: 80m long (X), 80m wide (Y) on the north side of restricted zone
    - South commercial zone: 80m long (X), 80m wide (Y) on the south side of restricted zone

    These zones are only generated within station flare areas (where industrial zones exist).
    They create 80m x 80m squares of commercial zone breaking up the industrial zone every chunk.

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)

    Returns:
        List of zone dictionaries in GeoJSON format (empty list if not in station flare area)
    """
    # Only generate commercial zones within station flare areas (where industrial zones exist)
    if not is_within_station_flare_area(chunk_index):
        return []
    
    # Calculate chunk boundaries and center
    chunk_start_position = chunk_index * CHUNK_LENGTH
    chunk_center_position = chunk_start_position + (CHUNK_LENGTH / 2.0)
    
    # Commercial zone dimensions: 80m long (X), 80m wide (Y)
    commercial_length = 80.0  # 80m along X axis
    commercial_width = 80.0   # 80m along Y axis
    
    # Calculate restricted zone width at chunk center to position commercial zones correctly
    half_width = calculate_restricted_zone_width(chunk_center_position)
    
    # North commercial zone: from -half_width - 80 to -half_width (80m wide)
    # Positioned at chunk center, 80m long (40m on each side of center)
    north_zone_x_start = chunk_center_position - (commercial_length / 2.0)
    north_zone_x_end = chunk_center_position + (commercial_length / 2.0)
    
    north_coordinates = [[
        [north_zone_x_start, -half_width - commercial_width],  # Bottom-left (outer edge)
        [north_zone_x_end, -half_width - commercial_width],    # Bottom-right (outer edge)
        [north_zone_x_end, -half_width],                       # Top-right (inner edge, touching restricted)
        [north_zone_x_start, -half_width],                    # Top-left (inner edge, touching restricted)
        [north_zone_x_start, -half_width - commercial_width]  # Close polygon
    ]]
    
    # South commercial zone: from +half_width to +half_width + 80 (80m wide)
    # Positioned at chunk center, 80m long (40m on each side of center)
    south_zone_x_start = chunk_center_position - (commercial_length / 2.0)
    south_zone_x_end = chunk_center_position + (commercial_length / 2.0)
    
    south_coordinates = [[
        [south_zone_x_start, half_width],                      # Bottom-left (inner edge, touching restricted)
        [south_zone_x_end, half_width],                        # Bottom-right (inner edge, touching restricted)
        [south_zone_x_end, half_width + commercial_width],     # Top-right (outer edge)
        [south_zone_x_start, half_width + commercial_width],   # Top-left (outer edge)
        [south_zone_x_start, half_width]                       # Close polygon
    ]]
    
    # Create zone dictionaries
    zones = [
        {
            "type": "Feature",
            "properties": {
                "name": f"Hub Commercial Zone North (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "commercial",
                "floor": floor,
                "is_system_zone": True,
                "properties": {
                    "purpose": "hub_commercial",
                    "description": "Commercial zone interspersed within industrial zone at hub platform",
                },
                "metadata": {
                    "default_zone": True,
                    "hub_zone": True,
                    "chunk_index": chunk_index,
                    "side": "north",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": north_coordinates,
            },
        },
        {
            "type": "Feature",
            "properties": {
                "name": f"Hub Commercial Zone South (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "commercial",
                "floor": floor,
                "is_system_zone": True,
                "properties": {
                    "purpose": "hub_commercial",
                    "description": "Commercial zone interspersed within industrial zone at hub platform",
                },
                "metadata": {
                    "default_zone": True,
                    "hub_zone": True,
                    "chunk_index": chunk_index,
                    "side": "south",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": south_coordinates,
            },
        },
    ]
    
    return zones


def generate_chunk_mixed_use_zones(floor: int, chunk_index: int) -> list:
    """
    Generate mixed-use zones outside the industrial/commercial bands within station flare areas.

    Creates two 80m-wide mixed-use strips:
    - North mixed-use zone: from outside edge of industrial/commercial bands outward by 80m
    - South mixed-use zone: from outside edge of industrial/commercial bands outward by 80m

    These zones sit outside the industrial + commercial + restricted stack in hub platforms,
    providing a mixed-use buffer before transitioning to other zones.

    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)

    Returns:
        List of zone dictionaries in GeoJSON format (empty list if not in station flare area)
    """
    # Only generate mixed-use zones within station flare areas
    if not is_within_station_flare_area(chunk_index):
        return []

    # Calculate chunk boundaries
    chunk_start_position = chunk_index * CHUNK_LENGTH
    chunk_end_position = chunk_start_position + CHUNK_LENGTH

    # Sample zone width at multiple points along the chunk
    sample_interval = 50.0
    sample_points = []
    x = chunk_start_position
    while x <= chunk_end_position:
        sample_points.append(x)
        x += sample_interval
    if sample_points and sample_points[-1] < chunk_end_position:
        sample_points.append(chunk_end_position)

    # Build north mixed-use zone (negative Y side)
    # Restricted: [-half_width, +half_width]
    # Industrial: [-half_width - 80, -half_width]
    # Commercial blobs: also within [-half_width - 80, -half_width]
    # Mixed-use: from -half_width - 160 to -half_width - 80 (80m wide band)
    north_inner_edge = []  # Inner edge (adjacent to industrial/commercial)
    north_outer_edge = []  # Outer edge (further from center)

    for x_pos in sample_points:
        half_width = calculate_restricted_zone_width(x_pos)
        inner_y = -half_width - 80.0
        outer_y = -half_width - 160.0
        north_inner_edge.append([x_pos, inner_y])
        north_outer_edge.append([x_pos, outer_y])

    # Reverse outer edge so we can connect them in order
    north_outer_edge.reverse()
    north_coordinates = [north_inner_edge + north_outer_edge + [north_inner_edge[0]]]

    # Build south mixed-use zone (positive Y side)
    # Mixed-use: from +half_width + 80 to +half_width + 160
    south_inner_edge = []  # Inner edge (adjacent to industrial/commercial)
    south_outer_edge = []  # Outer edge (further from center)

    for x_pos in sample_points:
        half_width = calculate_restricted_zone_width(x_pos)
        inner_y = half_width + 80.0
        outer_y = half_width + 160.0
        south_inner_edge.append([x_pos, inner_y])
        south_outer_edge.append([x_pos, outer_y])

    south_outer_edge.reverse()
    south_coordinates = [south_inner_edge + south_outer_edge + [south_inner_edge[0]]]

    zones = [
        {
            "type": "Feature",
            "properties": {
                "name": f"Hub Mixed-Use Zone North (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "mixed_use",
                "floor": floor,
                "is_system_zone": True,
                "properties": {
                    "purpose": "hub_mixed_use",
                    "description": "Mixed-use zone outside hub industrial/commercial bands",
                },
                "metadata": {
                    "default_zone": True,
                    "hub_zone": True,
                    "chunk_index": chunk_index,
                    "side": "north",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": north_coordinates,
            },
        },
        {
            "type": "Feature",
            "properties": {
                "name": f"Hub Mixed-Use Zone South (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "mixed_use",
                "floor": floor,
                "is_system_zone": True,
                "properties": {
                    "purpose": "hub_mixed_use",
                    "description": "Mixed-use zone outside hub industrial/commercial bands",
                },
                "metadata": {
                    "default_zone": True,
                    "hub_zone": True,
                    "chunk_index": chunk_index,
                    "side": "south",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": south_coordinates,
            },
        },
    ]

    return zones

def generate_chunk_agricultural_zones(floor: int, chunk_index: int) -> list:
    """
    Generate agricultural zones in free space between stations.
    
    Creates two agricultural zones on either side of the restricted zone:
    - North agricultural zone: from north edge of restricted zone to north edge of chunk
    - South agricultural zone: from south edge of restricted zone to south edge of chunk
    
    These zones are only generated outside station flare areas (where there's free space
    and no industrial/commercial zones). They are NOT system zones, allowing players to
    dezone or replace them with other zone types.
    
    Args:
        floor: Floor number
        chunk_index: Chunk index (0-263,999)
    
    Returns:
        List of zone dictionaries in GeoJSON format (empty list if in station flare area)
    """
    # Only generate agricultural zones outside station flare areas (free space between stations)
    if is_within_station_flare_area(chunk_index):
        return []
    
    # Calculate chunk boundaries
    chunk_start_position = chunk_index * CHUNK_LENGTH
    chunk_end_position = chunk_start_position + CHUNK_LENGTH
    
    # Sample zone width at multiple points along the chunk
    sample_interval = 50.0
    sample_points = []
    x = chunk_start_position
    while x <= chunk_end_position:
        sample_points.append(x)
        x += sample_interval
    if sample_points[-1] < chunk_end_position:
        sample_points.append(chunk_end_position)
    
    # Build north agricultural zone (negative Y side)
    # North zone goes from -half_width (restricted zone edge) to -chunk_half_width (chunk edge)
    north_inner_edge = []  # Inner edge (touching restricted zone)
    north_outer_edge = []  # Outer edge (chunk edge)
    
    for x_pos in sample_points:
        # Restricted zone half-width at this position
        restricted_half_width = calculate_restricted_zone_width(x_pos)
        
        # Chunk half-width at this position (using stations.calculate_flare_width)
        chunk_width = stations.calculate_flare_width(x_pos)
        chunk_half_width = chunk_width / 2.0
        
        # North zone: from -restricted_half_width to -chunk_half_width
        north_inner_edge.append([x_pos, -restricted_half_width])
        north_outer_edge.append([x_pos, -chunk_half_width])
    
    # Reverse outer edge to connect in order
    north_outer_edge.reverse()
    north_coordinates = [north_inner_edge + north_outer_edge + [north_inner_edge[0]]]
    
    # Build south agricultural zone (positive Y side)
    # South zone goes from +half_width (restricted zone edge) to +chunk_half_width (chunk edge)
    south_inner_edge = []  # Inner edge (touching restricted zone)
    south_outer_edge = []  # Outer edge (chunk edge)
    
    for x_pos in sample_points:
        # Restricted zone half-width at this position
        restricted_half_width = calculate_restricted_zone_width(x_pos)
        
        # Chunk half-width at this position
        chunk_width = stations.calculate_flare_width(x_pos)
        chunk_half_width = chunk_width / 2.0
        
        # South zone: from +restricted_half_width to +chunk_half_width
        south_inner_edge.append([x_pos, restricted_half_width])
        south_outer_edge.append([x_pos, chunk_half_width])
    
    # Reverse outer edge to connect in order
    south_outer_edge.reverse()
    south_coordinates = [south_inner_edge + south_outer_edge + [south_inner_edge[0]]]
    
    # Create zone dictionaries
    # NOTE: is_system_zone = False so players can dezone or replace these zones
    zones = [
        {
            "type": "Feature",
            "properties": {
                "name": f"Agricultural Zone North (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "agricultural",
                "floor": floor,
                "is_system_zone": False,  # NOT a system zone - can be dezoned/replaced
                "properties": {
                    "purpose": "default_agricultural",
                    "description": "Default agricultural zone - can be dezoned or replaced by players",
                },
                "metadata": {
                    "default_zone": True,
                    "chunk_index": chunk_index,
                    "side": "north",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": north_coordinates,
            },
        },
        {
            "type": "Feature",
            "properties": {
                "name": f"Agricultural Zone South (Floor {floor}, Chunk {chunk_index})",
                "zone_type": "agricultural",
                "floor": floor,
                "is_system_zone": False,  # NOT a system zone - can be dezoned/replaced
                "properties": {
                    "purpose": "default_agricultural",
                    "description": "Default agricultural zone - can be dezoned or replaced by players",
                },
                "metadata": {
                    "default_zone": True,
                    "chunk_index": chunk_index,
                    "side": "south",
                },
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": south_coordinates,
            },
        },
    ]
    
    return zones


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
    chunk_center_position = chunk_start_position + (CHUNK_LENGTH / 2.0)
    
    # Get hub name for color palette lookup
    hub_name = stations.get_hub_name_for_position(chunk_center_position)

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
    
    # Generate industrial zones for hub platform areas (within station flare areas)
    industrial_zones = generate_chunk_industrial_zones(floor, chunk_index)
    
    # Generate commercial zones interspersed within industrial zones at chunk centers
    commercial_zones = generate_chunk_commercial_zones(floor, chunk_index)
    
    # Generate mixed-use zones outside the industrial/commercial bands in hub areas
    mixed_use_zones = generate_chunk_mixed_use_zones(floor, chunk_index)
    
    # Generate agricultural zones in free space between stations (outside station flare areas)
    agricultural_zones = generate_chunk_agricultural_zones(floor, chunk_index)
    
    # Combine all zones
    all_zones = [restricted_zone] + industrial_zones + commercial_zones + mixed_use_zones + agricultural_zones

    # Phase 2: Generate buildings and structures for zones (if available)
    if BUILDING_GENERATION_AVAILABLE:
        try:
            all_structures = _generate_structures_for_zones(
                all_zones, floor, chunk_index, chunk_seed, hub_name
            )
        except Exception as e:
            # If building generation fails, return empty structures but still return zones
            print(f"Warning: Building generation failed: {e}")
            all_structures = []
    else:
        all_structures = []

    return {
        "chunk_id": f"{floor}_{chunk_index}",
        "floor": floor,
        "chunk_index": chunk_index,
        "seed": chunk_seed,
        "geometry": geometry,
        "structures": all_structures,  # Phase 2: Now includes generated buildings
        "zones": all_zones,  # Include restricted zone and industrial zones (if in hub area)
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


def _generate_structures_for_zones(
    zones: list, floor: int, chunk_index: int, chunk_seed: int, hub_name: Optional[str] = None
) -> list:
    """
    Generate buildings and structures for zones in a chunk.
    
    Phase 2 MVP: Generates buildings in system zones (industrial, commercial, agricultural).
    Skips restricted zones.
    
    Args:
        zones: List of zone dictionaries (GeoJSON format)
        floor: Floor number
        chunk_index: Chunk index (for structure ID generation)
        chunk_seed: Chunk seed for deterministic generation
    
    Returns:
        List of structure dictionaries (buildings, parks, etc.)
    """
    structures = []
    
    for zone in zones:
        zone_type = zone.get("properties", {}).get("zone_type", "").lower()
        
        # Skip restricted zones (no buildings allowed)
        if zone_type == "restricted":
            continue
        
        # Generate buildings in industrial, commercial, and mixed-use zones (hub areas)
        if zone_type not in ["industrial", "commercial", "mixed_use", "mixed-use"]:
            continue
        
        # Extract zone polygon coordinates
        zone_geometry = zone.get("geometry", {})
        if zone_geometry.get("type") != "Polygon":
            continue
        
        zone_coordinates = zone_geometry.get("coordinates", [])
        if not zone_coordinates or not zone_coordinates[0]:
            continue
        
        # Get zone importance (default to 0.5 for system zones)
        zone_importance = 0.5
        if "properties" in zone and "properties" in zone["properties"]:
            zone_props = zone["properties"].get("properties", {})
            zone_importance = zone_props.get("importance", 0.5)
        
        # Generate grid cells for this zone
        try:
            grid_cells = grid.generate_city_grid(
                zone_coordinates,
                zone_type,
                zone_importance,
                chunk_seed,
            )
            
            # Generate buildings for building-type cells
            # Create Shapely polygon for zone boundary validation
            zone_polygon_shapely = sg.Polygon(zone_coordinates[0])
            
            for cell in grid_cells:
                if cell.get("type") == "building":
                    # Generate building seed
                    cell_x = int(cell["position"][0] / grid.GRID_CELL_SIZE)
                    cell_y = int(cell["position"][1] / grid.GRID_CELL_SIZE)
                    building_seed = buildings.get_building_seed(
                        chunk_seed, cell_x, cell_y
                    )
                    
                    # Generate building with hub name for color palette
                    building = buildings.generate_building(
                        tuple(cell["position"]),
                        zone_type,
                        zone_importance,
                        building_seed,
                        floor,
                        hub_name,
                    )
                    
                    # Validate building footprint is completely within zone
                    # Check all 4 corners of the building to ensure it doesn't extend into adjacent zones
                    building_width = building["dimensions"]["width"]
                    building_depth = building["dimensions"]["depth"]
                    half_width = building_width / 2.0
                    half_depth = building_depth / 2.0
                    
                    building_x = building["position"][0]
                    building_y = building["position"][1]
                    
                    # Check all 4 corners of the building footprint
                    corners = [
                        sg.Point(building_x - half_width, building_y - half_depth),  # Bottom-left
                        sg.Point(building_x + half_width, building_y - half_depth),  # Bottom-right
                        sg.Point(building_x + half_width, building_y + half_depth),  # Top-right
                        sg.Point(building_x - half_width, building_y + half_depth),  # Top-left
                    ]
                    
                    # All corners must be within the zone polygon (using contains, not intersects)
                    all_within = all(zone_polygon_shapely.contains(corner) for corner in corners)
                    
                    if not all_within:
                        # Building would extend outside zone boundary - skip it
                        continue
                    
                    # Convert building to structure format expected by client
                    # Client expects: { id, structure_type, position: {x, y}, floor, ... }
                    # structure_type must be "building" (not zone type) for client to recognize it
                    structure_id = f"proc_{floor}_{chunk_index}_{cell_x}_{cell_y}"
                    structure = {
                        "id": structure_id,
                        "type": "building",
                        "structure_type": "building",  # Always "building" for client recognition
                        "building_subtype": building.get("building_subtype"),  # Include building subtype for variety
                        "position": {
                            "x": building["position"][0],
                            "y": building["position"][1],
                        },
                        "floor": floor,
                        "dimensions": building["dimensions"],
                        "windows": building["windows"],
                        "properties": building.get("properties", {}),  # Include all properties, including colors
                        "is_procedural": True,
                        "procedural_seed": building_seed,
                    }
                    # Verify colors are included (debug)
                    if building.get("properties", {}).get("colors"):
                        if len(structures) < 3:  # Only log first few
                            print(f"Structure with colors: {structure_id}, colors present: {bool(structure['properties'].get('colors'))}")
                    structures.append(structure)
        except Exception as e:
            # Log error but continue with other zones
            # In production, use proper logging
            print(f"Error generating structures for zone {zone_type}: {e}")
            continue
    
    return structures

