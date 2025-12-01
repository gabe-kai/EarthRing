"""
Station location and flare calculation utilities.

Handles station locations and calculates flare width/height based on distance from stations.
"""

import math
from typing import Optional, Tuple

# Ring constants
RING_CIRCUMFERENCE = 264000000  # 264,000 km in meters
CHUNK_LENGTH = 1000.0  # 1 km chunk length

# Base ring dimensions
BASE_WIDTH = 400.0  # Base width: 400m
BASE_LEVELS = 5  # Base levels: 5 (Levels -2, -1, 0, +1, +2)


# Station type definitions
class StationType:
    """Represents a station type with its flare parameters."""

    def __init__(
        self, name: str, max_flare_radius: float, flare_length: float, max_levels: int
    ):
        """
        Initialize station type.

        Args:
            name: Station type name
            max_flare_radius: Maximum flare radius from center (meters)
            flare_length: Total flare length (meters, extends flare_length/2 each side)
            max_levels: Maximum number of levels at station center
        """
        self.name = name
        self.max_flare_radius = max_flare_radius
        self.flare_length = flare_length
        self.max_levels = max_levels


# Station type constants
PILLAR_ELEVATOR_HUB = StationType(
    name="pillar_elevator",
    max_flare_radius=12500.0,  # 12.5 km radius
    flare_length=50000.0,  # 50 km total (25 km each side)
    max_levels=15,  # 15 levels total
)

REGIONAL_HUB = StationType(
    name="regional",
    max_flare_radius=8000.0,  # 8 km radius
    flare_length=32000.0,  # 32 km total (16 km each side)
    max_levels=11,  # 11 levels total
)

LOCAL_STATION = StationType(
    name="local",
    max_flare_radius=2500.0,  # 2.5 km radius
    flare_length=10000.0,  # 10 km total (5 km each side)
    max_levels=7,  # 7 levels total
)


class Station:
    """Represents a station location on the ring."""

    def __init__(self, position: float, station_type: StationType):
        """
        Initialize station.

        Args:
            position: Ring position in meters (0 to RING_CIRCUMFERENCE)
            station_type: Type of station
        """
        self.position = position
        self.station_type = station_type


# Pillar/Elevator Hub locations (12 stations at regular intervals, 30° apart)
# Positions in meters: 0, 22,000 km, 44,000 km, etc.
# Hub 0 is Pillar of Kongo (s = 0, theta = 0°)
PILLAR_HUB_POSITIONS = [
    0,  # Hub 0: Pillar of Kongo (theta = 0°)
    22000000,  # Hub 1: Pillar of Kilima (theta = 30°)
    44000000,  # Hub 2: Pillar of Laccadé (theta = 60°)
    66000000,  # Hub 3: Pillar of Nusantara (theta = 90°)
    88000000,  # Hub 4: Pillar of Makassar (theta = 120°)
    110000000,  # Hub 5: Pillar of Arafura (theta = 150°)
    132000000,  # Hub 6: Pillar of Kirana (theta = 180°)
    154000000,  # Hub 7: Pillar of Polynesya (theta = 210°)
    176000000,  # Hub 8: Pillar of Andenor (theta = 240°)
    198000000,  # Hub 9: Pillar of Quito Prime (theta = 270°)
    220000000,  # Hub 10: Pillar of Solamazon (theta = 300°)
    242000000,  # Hub 11: Pillar of Atlantica (theta = 330°)
]

# Pillar/Elevator Hub names (12 stations at regular intervals)
# Names correspond to PILLAR_HUB_POSITIONS by index
PILLAR_HUB_NAMES = [
    "Pillar of Kongo",      # Hub 0 (theta = 0°)
    "Pillar of Kilima",     # Hub 1 (theta = 30°)
    "Pillar of Laccadé",    # Hub 2 (theta = 60°)
    "Pillar of Nusantara",  # Hub 3 (theta = 90°)
    "Pillar of Makassar",   # Hub 4 (theta = 120°)
    "Pillar of Arafura",    # Hub 5 (theta = 150°)
    "Pillar of Kirana",     # Hub 6 (theta = 180°)
    "Pillar of Polynesya",  # Hub 7 (theta = 210°)
    "Pillar of Andenor",    # Hub 8 (theta = 240°)
    "Pillar of Quito Prime", # Hub 9 (theta = 270°)
    "Pillar of Solamazon",  # Hub 10 (theta = 300°)
    "Pillar of Atlantica",  # Hub 11 (theta = 330°)
]

# Create station objects for pillar/elevator hubs
PILLAR_STATIONS = [Station(pos, PILLAR_ELEVATOR_HUB) for pos in PILLAR_HUB_POSITIONS]

# TODO: Regional hubs and local stations will be added based on gameplay needs
# For now, we only have pillar/elevator hubs


def wrap_position(position: float) -> float:
    """
    Wrap ring position to valid range [0, RING_CIRCUMFERENCE).

    Args:
        position: Ring position in meters

    Returns:
        Wrapped position in range [0, RING_CIRCUMFERENCE)
    """
    return ((position % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE


def distance_with_wrapping(pos1: float, pos2: float) -> float:
    """
    Calculate distance between two ring positions, accounting for wrapping.

    Args:
        pos1: First position in meters
        pos2: Second position in meters

    Returns:
        Shortest distance in meters (accounts for ring wrapping)
    """
    wrapped1 = wrap_position(pos1)
    wrapped2 = wrap_position(pos2)

    # Calculate direct distance
    direct = abs(wrapped2 - wrapped1)

    # Calculate wrapped distance (going the other way around the ring)
    wrapped = RING_CIRCUMFERENCE - direct

    # Return the shorter distance
    return min(direct, wrapped)


def find_nearest_station(ring_position: float) -> Optional[Tuple[Station, float]]:
    """
    Find the nearest station to a given ring position.

    Args:
        ring_position: Ring position in meters

    Returns:
        Tuple of (Station, distance) if a station is within flare range, None otherwise
    """
    wrapped_pos = wrap_position(ring_position)
    nearest_station = None
    nearest_distance = float("inf")

    # Check all stations
    for station in PILLAR_STATIONS:
        distance = distance_with_wrapping(wrapped_pos, station.position)

        # Check if within flare range (flare_length / 2 each side)
        flare_range = station.station_type.flare_length / 2.0
        if distance <= flare_range and distance < nearest_distance:
            nearest_station = station
            nearest_distance = distance

    if nearest_station is None:
        return None

    return (nearest_station, nearest_distance)


def calculate_flare_width(ring_position: float) -> float:
    """
    Calculate chunk width at a given ring position, accounting for station flares.

    Uses cosine-based smooth transition for flare width.

    Args:
        ring_position: Ring position in meters

    Returns:
        Chunk width in meters (400m base, up to 25km at station centers)
    """
    # Start with base width
    width = BASE_WIDTH

    # Find nearest station
    station_info = find_nearest_station(ring_position)
    if station_info is None:
        return width

    station, distance = station_info
    station_type = station.station_type

    # Check if within flare zone
    flare_range = station_type.flare_length / 2.0
    if distance <= flare_range:
        # Pillar hubs should have a flat plateau across the four chunks that straddle the seam.
        # Chunk centers occur every 1 km; we want the two chunks on each side of the station center
        # (±0.5 km and ±1.5 km) to all receive the full width.
        # Keep the five center chunks (two on each side of the seam plus the seam chunk)
        # at full width. Chunk centers are spaced 1 km apart, so covering ±2.5 km
        # ensures chunk indices (..., -2, -1, 0, +1, +2, ...) all receive the max width.
        plateau_radius = 2500.0 if station_type is PILLAR_ELEVATOR_HUB else 0.0

        if plateau_radius > 0.0 and distance <= plateau_radius:
            return station_type.max_flare_radius * 2.0

        # After the plateau, fall back to the smooth cosine curve over the remaining range.
        effective_range = flare_range - plateau_radius
        adjusted_distance = max(distance - plateau_radius, 0.0)

        if effective_range <= 0.0:
            normalized_distance = 1.0
        else:
            # Calculate normalized distance (0 = start of taper, 1 = edge of flare zone)
            normalized_distance = adjusted_distance / effective_range

        # Cosine-based smooth transition
        # At start of taper: contribution = 1, at edge: 0.
        flare_contribution = (1.0 + math.cos(math.pi * normalized_distance)) / 2.0
        max_width = station_type.max_flare_radius * 2.0  # Total width = 2 * radius
        width = BASE_WIDTH + (max_width - BASE_WIDTH) * flare_contribution

    return width


def calculate_flare_levels(ring_position: float) -> int:
    """
    Calculate number of levels at a given ring position, accounting for station flares.

    Uses cosine-based smooth transition for flare height.

    Args:
        ring_position: Ring position in meters

    Returns:
        Number of levels (5 base, up to 15 at station centers)
    """
    # Start with base levels
    levels = BASE_LEVELS

    # Find nearest station
    station_info = find_nearest_station(ring_position)
    if station_info is None:
        return levels

    station, distance = station_info
    station_type = station.station_type

    # Check if within flare zone
    flare_range = station_type.flare_length / 2.0
    if distance <= flare_range:
        # Calculate normalized distance (0 = at center, 1 = at edge)
        normalized_distance = distance / flare_range

        # Cosine-based smooth transition
        # At center (normalized_distance = 0): flare_contribution = 1 (max levels)
        # At edge (normalized_distance = 1): flare_contribution = 0 (base levels)
        # Formula: (1 + cos(π * normalized_distance)) / 2
        # This gives: 0 -> 1, 1 -> 0
        flare_contribution = (1.0 + math.cos(math.pi * normalized_distance)) / 2.0
        additional_levels = station_type.max_levels - BASE_LEVELS
        levels = BASE_LEVELS + int(additional_levels * flare_contribution)

    return levels
