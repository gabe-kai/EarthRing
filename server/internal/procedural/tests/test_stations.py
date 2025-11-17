"""
Tests for station flare calculations.
"""

import pytest
import math
from .. import stations


def test_calculate_flare_width_at_hub_center():
    """Test width calculation at hub center (should be max width)."""
    # Hub 0 is at position 0
    width = stations.calculate_flare_width(0.0)
    # Should be close to max width (25km = 25000m)
    assert width > 20000.0, f"Expected width > 20000m at hub center, got {width}m"
    assert width <= 25000.0, f"Expected width <= 25000m, got {width}m"


def test_calculate_flare_width_at_hub_edge():
    """Test width calculation at hub flare edge (should be base width)."""
    # Hub 0 flare extends 25km each side, so edge is at 25km
    width = stations.calculate_flare_width(25000.0)
    # Should be close to base width (400m)
    assert abs(width - 400.0) < 10.0, f"Expected width ~400m at edge, got {width}m"


def test_calculate_flare_width_outside_flare():
    """Test width calculation outside flare zone (should be base width)."""
    # Position 30km from hub 0 (outside 25km flare range)
    width = stations.calculate_flare_width(30000.0)
    assert width == 400.0, f"Expected base width 400m, got {width}m"


def test_calculate_flare_width_mid_flare():
    """Test width calculation mid-flare (should be between base and max)."""
    # Position 12.5km from hub 0 (halfway to edge)
    width = stations.calculate_flare_width(12500.0)
    # Should be between base (400m) and max (25000m)
    assert (
        400.0 < width < 25000.0
    ), f"Expected width between 400m and 25000m, got {width}m"
    # Should be roughly halfway (but cosine curve, so not exactly)
    assert (
        5000.0 < width < 20000.0
    ), f"Expected reasonable mid-flare width, got {width}m"


def test_calculate_flare_levels_at_hub_center():
    """Test levels calculation at hub center (should be max levels)."""
    levels = stations.calculate_flare_levels(0.0)
    # Should be max levels (15 for pillar/elevator hub)
    assert levels == 15, f"Expected 15 levels at hub center, got {levels}"


def test_calculate_flare_levels_at_hub_edge():
    """Test levels calculation at hub flare edge (should be base levels)."""
    levels = stations.calculate_flare_levels(25000.0)
    # Should be base levels (5)
    assert levels == 5, f"Expected 5 levels at edge, got {levels}"


def test_calculate_flare_levels_outside_flare():
    """Test levels calculation outside flare zone (should be base levels)."""
    levels = stations.calculate_flare_levels(30000.0)
    assert levels == 5, f"Expected base 5 levels, got {levels}"


def test_find_nearest_station_at_hub():
    """Test finding station at hub position."""
    station_info = stations.find_nearest_station(0.0)
    assert station_info is not None, "Should find station at hub position"
    station, distance = station_info
    assert distance == 0.0, f"Distance should be 0 at hub center, got {distance}"
    assert (
        station.position == 0.0
    ), f"Station position should be 0, got {station.position}"


def test_find_nearest_station_near_hub():
    """Test finding station near hub."""
    station_info = stations.find_nearest_station(10000.0)
    assert station_info is not None, "Should find station within flare range"
    station, distance = station_info
    assert distance == 10000.0, f"Distance should be 10000m, got {distance}"


def test_find_nearest_station_outside_flare():
    """Test finding station outside flare range."""
    # Position 30km from hub 0 (outside 25km flare range)
    station_info = stations.find_nearest_station(30000.0)
    assert station_info is None, "Should not find station outside flare range"


def test_find_nearest_station_with_wrapping():
    """Test finding station with ring wrapping."""
    # Position near end of ring, should wrap to hub 0
    position_near_end = 263999000.0  # Near end of ring
    station_info = stations.find_nearest_station(position_near_end)
    # Should find hub 0 (wraps around)
    assert station_info is not None, "Should find station with wrapping"
    station, distance = station_info
    # Distance should account for wrapping
    assert distance <= 25000.0, f"Distance should be within flare range, got {distance}"


def test_flare_smooth_transition():
    """Test that flare transitions smoothly."""
    # Test multiple positions and ensure smooth transition
    positions = [0, 5000, 10000, 15000, 20000, 25000]
    widths = [stations.calculate_flare_width(pos) for pos in positions]

    # Widths should decrease monotonically (or stay same) as distance increases
    for i in range(len(widths) - 1):
        assert (
            widths[i] >= widths[i + 1]
        ), f"Width should decrease with distance: {widths[i]}m at {positions[i]}m vs {widths[i+1]}m at {positions[i+1]}m"


def test_all_pillar_hubs_exist():
    """Test that all 12 pillar hubs are defined."""
    assert (
        len(stations.PILLAR_STATIONS) == 12
    ), f"Expected 12 pillar stations, got {len(stations.PILLAR_STATIONS)}"

    # Check positions are correct
    expected_positions = [
        0,
        22000000,
        44000000,
        66000000,
        88000000,
        110000000,
        132000000,
        154000000,
        176000000,
        198000000,
        220000000,
        242000000,
    ]
    actual_positions = [station.position for station in stations.PILLAR_STATIONS]
    assert (
        actual_positions == expected_positions
    ), f"Station positions don't match expected: {actual_positions} vs {expected_positions}"
