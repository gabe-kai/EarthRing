"""
Color Palettes Module
Loads hub color palettes from JSON file or API endpoint for use in structure generation.
"""

import json
import os
from pathlib import Path
from typing import Dict, Optional, Any

# Cache for loaded palettes
_palettes_cache: Optional[Dict[str, Any]] = None

# Hub name mapping: Python name -> JSON key
HUB_NAME_MAPPING = {
    "Pillar of Kongo": "PillarOfKongo",
    "Pillar of Kilima": "PillarOfKilima",
    "Pillar of Laccadé": "PillarOfLaccade",
    "Pillar of Nusantara": "PillarOfNusantara",
    "Pillar of Makassar": "PillarOfMakassar",
    "Pillar of Arafura": "PillarOfArafura",
    "Pillar of Kirana": "PillarOfKirana",
    "Pillar of Polynesya": "PillarOfPolynesya",
    "Pillar of Andenor": "PillarOfAndenor",
    "Pillar of Quito Prime": "PillarOfQuitoPrime",
    "Pillar of Solamazon": "PillarOfSolamazon",
    "Pillar of Atlantica": "PillarOfAtlantica",
}


def _get_config_path() -> Path:
    """Get the path to the hub-color-palettes.json file."""
    # When running from server/internal/procedural/, go up to server/config/
    # This works when procedural service is run from server/ directory
    current_dir = Path(__file__).parent.parent.parent  # Go up from procedural/ to server/
    return current_dir / "config" / "hub-color-palettes.json"


def load_color_palettes() -> Dict[str, Any]:
    """
    Load hub color palettes from JSON file.
    
    Returns:
        Dictionary mapping hub names to their color palettes
        
    Raises:
        FileNotFoundError: If the JSON file doesn't exist
        json.JSONDecodeError: If the JSON file is invalid
    """
    global _palettes_cache
    
    if _palettes_cache is not None:
        return _palettes_cache
    
    config_path = _get_config_path()
    
    if not config_path.exists():
        raise FileNotFoundError(f"Color palettes file not found: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        _palettes_cache = json.load(f)
    
    return _palettes_cache


def get_hub_colors(hub_name: str, zone_type: str) -> Optional[Dict[str, str]]:
    """
    Get color palette for a specific hub and zone type.
    
    Args:
        hub_name: Name of the hub (e.g., "Pillar of Kongo")
        zone_type: Zone type (e.g., "Industrial", "Commercial", "Residential", "Parks", "Agricultural")
        
    Returns:
        Dictionary with color components (foundation, walls, roofs, windows_doors, trim)
        Each component is a dict with "name" and "hex" keys.
        Returns None if hub or zone type not found.
    """
    try:
        palettes = load_color_palettes()
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Warning: Failed to load color palettes: {e}")
        return None
    
    # Map hub name to JSON key
    hub_key = HUB_NAME_MAPPING.get(hub_name)
    if hub_key is None:
        print(f"Warning: Unknown hub name: {hub_name}")
        return None
    
    # Get hub palette
    hub_palette = palettes.get(hub_key)
    if hub_palette is None:
        print(f"Warning: Hub palette not found: {hub_key}")
        return None
    
    # Get zone type palette
    zone_palette = hub_palette.get(zone_type)
    if zone_palette is None:
        print(f"Warning: Zone type palette not found: {zone_type} for hub {hub_key}")
        return None
    
    return zone_palette


def get_hub_color_hex(hub_name: str, zone_type: str, component: str) -> Optional[str]:
    """
    Get a specific color hex value for a hub, zone type, and component.
    
    Args:
        hub_name: Name of the hub
        zone_type: Zone type (Industrial, Commercial, Residential, Parks, Agricultural)
        component: Color component (foundation, walls, roofs, windows_doors, trim)
        
    Returns:
        Hex color string (e.g., "#1A1A1C") or None if not found
    """
    colors = get_hub_colors(hub_name, zone_type)
    if colors is None:
        return None
    
    component_data = colors.get(component)
    if component_data is None:
        return None
    
    return component_data.get("hex")


def clear_cache() -> None:
    """Clear the color palettes cache (useful for testing or reloading)."""
    global _palettes_cache
    _palettes_cache = None

