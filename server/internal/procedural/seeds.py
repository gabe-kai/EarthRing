"""
Seed generation utilities for deterministic procedural generation.
"""


def get_chunk_seed(floor: int, chunk_index: int, world_seed: int) -> int:
    """
    Generate deterministic seed for a chunk.

    Args:
        floor: Floor number
        chunk_index: Chunk index
        world_seed: Global world seed

    Returns:
        Deterministic chunk seed
    """
    # Use Python's built-in hash function for deterministic seeding
    # Modulo to keep within 32-bit signed integer range
    seed = hash((floor, chunk_index, world_seed)) % (2**31)
    return seed


def get_building_seed(chunk_seed: int, cell_x: int, cell_y: int) -> int:
    """
    Generate deterministic seed for a building cell.

    Args:
        chunk_seed: Seed of the parent chunk
        cell_x: X coordinate of the cell within the chunk
        cell_y: Y coordinate of the cell within the chunk

    Returns:
        Deterministic building seed
    """
    seed = hash((chunk_seed, cell_x, cell_y)) % (2**31)
    return seed


def get_window_seed(building_seed: int, window_x: int, window_y: int) -> int:
    """
    Generate deterministic seed for a window.

    Args:
        building_seed: Seed of the parent building
        window_x: X coordinate of the window
        window_y: Y coordinate of the window

    Returns:
        Deterministic window seed
    """
    seed = hash((building_seed, window_x, window_y)) % (2**31)
    return seed


def seeded_random(seed: int):
    """
    Create deterministic random number generator.

    Args:
        seed: Seed value

    Returns:
        Seeded Random instance
    """
    import random

    return random.Random(seed)
