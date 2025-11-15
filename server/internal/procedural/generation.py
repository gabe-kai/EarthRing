"""
Chunk generation functions.
For Phase 1, this provides basic utilities. Full generation will be implemented in Phase 2.
"""

from . import seeds


def get_chunk_width(floor: int, chunk_index: int, chunk_seed: int) -> float:
    """
    Get the width of a chunk.

    Base width is 400m, but chunks at stations can be wider (up to 25km).
    For Phase 1, returns base width. Full station flare logic will be in Phase 2.

    Args:
        floor: Floor number
        chunk_index: Chunk index
        chunk_seed: Chunk seed

    Returns:
        Chunk width in meters
    """
    # Base width: 400m
    base_width = 400.0

    # TODO: Phase 2 - Calculate station flare width
    # For now, return base width
    return base_width


def generate_empty_chunk(floor: int, chunk_index: int, chunk_seed: int):
    """
    Generate an empty chunk (Phase 1 placeholder).

    Full chunk generation with buildings, zones, etc. will be implemented in Phase 2.

    Args:
        floor: Floor number
        chunk_index: Chunk index
        chunk_seed: Chunk seed

    Returns:
        Dictionary with chunk data (empty for Phase 1)
    """
    return {
        "chunk_id": f"{floor}_{chunk_index}",
        "floor": floor,
        "chunk_index": chunk_index,
        "seed": chunk_seed,
        "geometry": None,
        "structures": [],
        "zones": [],
        "metadata": {
            "generated": True,
            "version": 1,
        },
    }
