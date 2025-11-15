"""
Tests for seed generation utilities.
"""

import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(server_dir))

import pytest
from internal.procedural import seeds


def test_get_chunk_seed():
    """Test chunk seed generation"""
    world_seed = 12345

    # Same inputs should produce same seed
    seed1 = seeds.get_chunk_seed(0, 100, world_seed)
    seed2 = seeds.get_chunk_seed(0, 100, world_seed)
    assert seed1 == seed2

    # Different inputs should produce different seeds
    seed3 = seeds.get_chunk_seed(0, 101, world_seed)
    assert seed1 != seed3

    # Different floors should produce different seeds
    seed4 = seeds.get_chunk_seed(1, 100, world_seed)
    assert seed1 != seed4


def test_get_building_seed():
    """Test building seed generation"""
    chunk_seed = 12345

    # Same inputs should produce same seed
    seed1 = seeds.get_building_seed(chunk_seed, 10, 20)
    seed2 = seeds.get_building_seed(chunk_seed, 10, 20)
    assert seed1 == seed2

    # Different cells should produce different seeds
    seed3 = seeds.get_building_seed(chunk_seed, 11, 20)
    assert seed1 != seed3


def test_get_window_seed():
    """Test window seed generation"""
    building_seed = 12345

    # Same inputs should produce same seed
    seed1 = seeds.get_window_seed(building_seed, 5, 10)
    seed2 = seeds.get_window_seed(building_seed, 5, 10)
    assert seed1 == seed2

    # Different windows should produce different seeds
    seed3 = seeds.get_window_seed(building_seed, 6, 10)
    assert seed1 != seed3


def test_seeded_random():
    """Test seeded random number generator"""
    seed = 12345
    rng1 = seeds.seeded_random(seed)
    rng2 = seeds.seeded_random(seed)

    # Same seed should produce same sequence
    assert rng1.random() == rng2.random()
    assert rng1.random() == rng2.random()

    # Different seeds should produce different sequences
    rng3 = seeds.seeded_random(seed + 1)
    assert rng1.random() != rng3.random()
