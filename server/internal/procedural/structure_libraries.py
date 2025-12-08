"""
Structure Libraries loader and helpers.
Minimal implementation focused on industrial buildings to support
the rebuilt procedural pipeline.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

_LIB_CACHE: Dict[str, Any] = {}
# __file__ = server/internal/procedural/structure_libraries.py
# config lives at server/config/structure-libraries
_BASE_DIR = Path(__file__).resolve().parents[2] / "config" / "structure-libraries"


def _load(name: str) -> Dict[str, Any]:
    """Load and cache a library JSON file."""
    if name in _LIB_CACHE:
        return _LIB_CACHE[name]

    path = _BASE_DIR / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Structure library not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    _LIB_CACHE[name] = data
    return data


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge override into base."""
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _get_hub_key(hub_name: Optional[str]) -> Optional[str]:
    if not hub_name:
        return None
    return hub_name.replace(" ", "")


def get_building_class(class_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("building-classes")
    base = data.get("defaults", {}).get("building_classes", {}).get(class_name)
    if base is None:
        return None

    hub_key = _get_hub_key(hub_name)
    if hub_key:
        hub_override = (
            data.get("hub_overrides", {}).get(hub_key, {}).get("building_classes", {}).get(class_name)
        )
        if hub_override:
            return _deep_merge(base, hub_override)

    return base


def get_zone_distribution(zone_type: str) -> List[Dict[str, Any]]:
    data = _load("building-classes")
    return data.get("defaults", {}).get("zone_distributions", {}).get(zone_type, [])


def get_size_distribution(zone_type: str) -> List[Dict[str, Any]]:
    data = _load("building-sizes")
    return data.get("zone_distributions", {}).get(zone_type, [])


def get_size_class(size_class: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("building-sizes")
    base = data.get("size_classes", {}).get(size_class)
    if base is None:
        return None

    hub_key = _get_hub_key(hub_name)
    if hub_key:
        hub_override = data.get("hub_overrides", {}).get(hub_key, {}).get("size_classes", {}).get(size_class)
        if hub_override:
            return _deep_merge(base, hub_override)
    return base


def get_shape(shape_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("building-shapes")
    base = data.get("defaults", {}).get("shapes", {}).get(shape_name)
    if base is None:
        return None

    hub_key = _get_hub_key(hub_name)
    if hub_key:
        hub_override = data.get("hub_overrides", {}).get(hub_key, {}).get("shapes", {}).get(shape_name)
        if hub_override:
            return _deep_merge(base, hub_override)
    return base


def get_color_palette(zone_type: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("color-palettes")
    hub_key = _get_hub_key(hub_name)

    if hub_key:
        hub_palette = data.get("hub_overrides", {}).get(hub_key, {}).get(zone_type)
        if hub_palette is not None:
            return hub_palette

    return data.get("defaults", {}).get(zone_type)


def get_shader_patterns(pattern_names: List[str], hub_name: Optional[str] = None) -> List[Dict[str, Any]]:
    data = _load("shader-patterns")
    results: List[Dict[str, Any]] = []
    hub_key = _get_hub_key(hub_name)

    for name in pattern_names:
        pattern = None
        if hub_key:
            pattern = data.get("hub_overrides", {}).get(hub_key, {}).get("patterns", {}).get(name)
        if pattern is None:
            pattern = data.get("defaults", {}).get("patterns", {}).get(name)
        if pattern is not None:
            results.append(pattern)
    return results


def get_decorative_elements(element_names: List[str], hub_name: Optional[str] = None) -> List[Dict[str, Any]]:
    data = _load("decorative-elements")
    results: List[Dict[str, Any]] = []
    hub_key = _get_hub_key(hub_name)

    for name in element_names:
        element = None
        if hub_key:
            element = data.get("hub_overrides", {}).get(hub_key, {}).get("elements", {}).get(name)
        if element is None:
            element = data.get("defaults", {}).get("elements", {}).get(name)
        if element is not None:
            results.append(element)
    return results


def get_lot_shape(shape_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("lot-shapes")
    base = data.get("defaults", {}).get("lot_shapes", {}).get(shape_name)
    if base is None:
        return None

    hub_key = _get_hub_key(hub_name)
    if hub_key:
        hub_override = data.get("hub_overrides", {}).get(hub_key, {}).get("lot_shapes", {}).get(shape_name)
        if hub_override:
            return _deep_merge(base, hub_override)
    return base


def get_window_pattern(pattern_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("window-door-patterns")
    base = data.get("defaults", {}).get("window_patterns", {}).get(pattern_name)
    if base is None:
        return None

    hub_key = _get_hub_key(hub_name)
    if hub_key:
        hub_override = (
            data.get("hub_overrides", {}).get(hub_key, {}).get("window_patterns", {}).get(pattern_name)
        )
        if hub_override:
            return _deep_merge(base, hub_override)
    return base


def get_door_pattern(pattern_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    data = _load("window-door-patterns")
    base = data.get("defaults", {}).get("door_patterns", {}).get(pattern_name)
    if base is None:
        return None

    hub_key = _get_hub_key(hub_name)
    if hub_key:
        hub_override = (
            data.get("hub_overrides", {}).get(hub_key, {}).get("door_patterns", {}).get(pattern_name)
        )
        if hub_override:
            return _deep_merge(base, hub_override)
    return base
