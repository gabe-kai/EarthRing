"""
New procedural structure generation using structure libraries.
Focused on industrial zones for the first rebuild pass.
"""

from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

try:
    import shapely.geometry as sg
except ImportError:  # pragma: no cover - shapely should be present in service env
    sg = None  # type: ignore

from . import structure_libraries as libs

# Bump this to reshuffle deterministic placement when logic changes
STRUCTURE_PLACEMENT_VERSION = 3

# Spacing (meters) by subcategory
SPACING_BY_SUBCATEGORY: Dict[str, float] = {
    "logistics": 8.0,
    "warehouse": 6.0,
    "plant": 10.0,
    "yard_platform": 12.0,
    "light_industrial": 5.0,
}

# Count scale by subcategory (fewer large footprints for heavy types)
COUNT_SCALE_BY_SUBCATEGORY: Dict[str, float] = {
    "logistics": 0.9,
    "warehouse": 1.0,
    "plant": 0.7,
    "yard_platform": 0.6,
    "light_industrial": 1.2,
}


def _weighted_choice(items: List[Dict[str, Any]], weight_key: str, rng: random.Random) -> Optional[str]:
    """Return the `class` or `size_class` field from a weighted list."""
    if not items:
        return None
    total = sum(item.get(weight_key, 0) for item in items)
    if total <= 0:
        return None
    roll = rng.uniform(0, total)
    cumulative = 0.0
    for item in items:
        cumulative += item.get(weight_key, 0)
        if roll <= cumulative:
            return item.get("class") or item.get("size_class")
    return items[-1].get("class") or items[-1].get("size_class")


def _clamp_dimensions(
    width: float, depth: float, bounds: Tuple[float, float, float, float], margin: float = 5.0
) -> Tuple[float, float]:
    min_x, max_x, min_y, max_y = bounds
    max_width = max((max_x - min_x) - 2 * margin, 5.0)
    max_depth = max((max_y - min_y) - 2 * margin, 5.0)
    return min(width, max_width), min(depth, max_depth)


def _bounding_box(coords: List[List[float]]) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return min(xs), max(xs), min(ys), max(ys)


def _choose_footprint(size_def: Dict[str, Any], rng: random.Random) -> Tuple[float, float, float]:
    width = rng.uniform(*size_def["width"])
    depth = rng.uniform(*size_def["depth"])
    height = rng.uniform(*size_def["height"])
    return width, depth, height


def _shape_for_class(class_name: str, class_def: Dict[str, Any]) -> str:
    return class_def.get("base_shape", "rectangle") or "rectangle"


def _is_bar(shape: str) -> bool:
    return shape == "bar"


def _target_building_count(zone_area: float, avg_footprint: float) -> int:
    if avg_footprint <= 0 or zone_area <= 0:
        return 1
    rough = max(1, int(zone_area / (avg_footprint * 2.0)))
    return min(8, rough)


def _make_windows(width: float, depth: float, height: float) -> List[Dict[str, Any]]:
    """
    Generate window positions per facade using 4m floors (1m logistics + 3m living/working).
    Small industrial windows sit near the top of each 4m band.
    """
    # Match client foundation calculation: min(0.5m, 10% of height)
    foundation_height = min(0.5, height * 0.1)
    building_height = height - foundation_height
    if building_height <= 0:
        return []

    floor_height = 4.0
    floor_count = max(1, int(round(building_height / floor_height)))

    win_height = 0.8
    win_width = 1.5
    offsets_front_back = [-0.3, 0.0, 0.3]
    offsets_sides = [-0.3, 0.0, 0.3]

    windows: List[Dict[str, Any]] = []

    for floor_idx in range(floor_count):
        base = foundation_height + floor_idx * floor_height
        top = min(base + floor_height, foundation_height + building_height)
        usable = max(top - base, 0.5)

        # Aim near top of band: center slightly below band top
        desired_center = top - 0.8
        min_center = base + (win_height / 2.0) + 0.1
        max_center = top - (win_height / 2.0) - 0.1
        if max_center < min_center:
            center = (base + top) / 2.0
        else:
            center = max(min_center, min(desired_center, max_center))

        win_z = center - (foundation_height + building_height / 2.0)

        for ox in offsets_front_back:
            windows.append(
                {
                    "facade": "front",
                    "position": [ox * width, 0.0, win_z],
                    "size": [win_width, win_height],
                }
            )
            windows.append(
                {
                    "facade": "back",
                    "position": [ox * width, 0.0, win_z],
                    "size": [win_width, win_height],
                }
            )
        for ox in offsets_sides:
            windows.append(
                {
                    "facade": "left",
                    "position": [ox * depth, 0.0, win_z],
                    "size": [win_width, win_height],
                }
            )
            windows.append(
                {
                    "facade": "right",
                    "position": [ox * depth, 0.0, win_z],
                    "size": [win_width, win_height],
                }
            )

    return windows


def _filter_windows_by_openings(
    windows: List[Dict[str, Any]],
    doors: Dict[str, Any],
    garage_doors: List[Dict[str, Any]],
    width: float,
    depth: float,
) -> List[Dict[str, Any]]:
    """
    Remove windows that overlap doors or garage doors on the same facade.
    Coordinates are center-relative; we compare rectangles in facade space with a generous margin.
    """
    filtered: List[Dict[str, Any]] = []
    openings_by_facade: Dict[str, List[Dict[str, float]]] = {}

    def add_opening(facade: str, opening: Dict[str, Any]) -> None:
        if facade not in openings_by_facade:
            openings_by_facade[facade] = []
        openings_by_facade[facade].append(
            {
                "x": float(opening.get("x", 0.0)),
                "y": float(opening.get("y", 0.0)),
                "w": float(opening.get("width", 0.0)),
                "h": float(opening.get("height", 0.0)),
            }
        )

    for facade, door in doors.items():
        if isinstance(door, dict):
            add_opening(facade, door)
        elif isinstance(door, list):
            for d in door:
                add_opening(facade, d)

    for gd in garage_doors:
        facade = gd.get("facade", "front")
        add_opening(facade, gd)

    for win in windows:
        facade = win.get("facade", "front")
        pos = win.get("position", [0.0, 0.0, 0.0])
        size = win.get("size", [0.0, 0.0])
        wx = float(pos[0])
        wy = float(pos[2])  # vertical offset stored in z component
        ww = float(size[0])
        wh = float(size[1])

        overlap = False
        for op in openings_by_facade.get(facade, []):
            # Horizontal overlap check with generous margin
            margin_x = max(1.0, ww / 2.0)  # at least 1m clearance horizontally
            win_left = wx - ww / 2.0
            win_right = wx + ww / 2.0
            op_left = op["x"] - op["w"] / 2.0
            op_right = op["x"] + op["w"] / 2.0
            horiz_overlap = not (win_right + margin_x < op_left or win_left - margin_x > op_right)

            # Vertical overlap check so windows above/below doors remain
            margin_z = 0.25  # small vertical clearance
            op_bottom = op["y"] - op["h"] / 2.0
            op_top = op["y"] + op["h"] / 2.0
            win_bottom = wy - wh / 2.0
            win_top = wy + wh / 2.0
            vert_overlap = not (win_top + margin_z < op_bottom or win_bottom - margin_z > op_top)

            if horiz_overlap and vert_overlap:
                overlap = True
                break
        if not overlap:
            filtered.append(win)

    return filtered


def generate_structures_for_zones(
    zones: List[Dict[str, Any]],
    floor: int,
    chunk_index: int,
    chunk_seed: int,
    hub_name: Optional[str],
) -> List[Dict[str, Any]]:
    """
    Generate structures for zones using the new structure libraries.
    Currently supports industrial zones only. Places multiple non-overlapping
    buildings per industrial zone when possible.
    """
    structures: List[Dict[str, Any]] = []

    for idx, zone in enumerate(zones):
        zone_type = zone.get("properties", {}).get("zone_type", "").lower()
        if zone_type != "industrial":
            continue

        geometry = zone.get("geometry", {})
        if geometry.get("type") != "Polygon":
            continue
        ring = geometry.get("coordinates", [])
        if not ring or not ring[0]:
            continue

        coords = ring[0]

        if sg is None:
            # Fallback: single building at centroid if shapely missing
            min_x, max_x, min_y, max_y = _bounding_box(coords)
            centroid_x = (min_x + max_x) / 2.0
            centroid_y = (min_y + max_y) / 2.0
            polygon = None
        else:
            polygon = sg.Polygon(coords)
            if not polygon.is_valid or polygon.area <= 0:
                continue
            min_x, min_y, max_x, max_y = polygon.bounds
            centroid = polygon.centroid
            centroid_x, centroid_y = centroid.x, centroid.y

        rng_seed = hash((chunk_seed, floor, chunk_index, idx, STRUCTURE_PLACEMENT_VERSION)) % (2**31)
        rng = random.Random(rng_seed)

        class_name = _weighted_choice(libs.get_zone_distribution("industrial"), "weight", rng)
        if not class_name:
            continue
        class_def = libs.get_building_class(class_name, hub_name)
        if not class_def:
            continue

        size_dist = libs.get_size_distribution("industrial")
        size_class_name = _weighted_choice(size_dist, "weight", rng) or class_def.get("size_class")
        size_def = libs.get_size_class(size_class_name, hub_name) if size_class_name else None
        if not size_def:
            continue

        width, depth, height = _choose_footprint(size_def, rng)
        width, depth = _clamp_dimensions(width, depth, (min_x, max_x, min_y, max_y))
        shape = _shape_for_class(class_name, class_def)
        if _is_bar(shape) and width < depth:
            width, depth = depth, width  # keep bars long along X axis

        # Vertical metrics for doors/windows
        foundation_height = min(0.5, height * 0.1)
        building_height = height - foundation_height
        building_center = foundation_height + building_height / 2.0
        # Doors: bottoms at 1m (top of logistics band)
        main_door_height = 2.2
        truck_door_height = 3.5
        main_door_center = 1.0 + main_door_height / 2.0
        truck_door_center = 1.0 + truck_door_height / 2.0
        main_door_y = main_door_center - building_center
        truck_door_y = truck_door_center - building_center

        color_palette = libs.get_color_palette(class_def.get("color_palette_zone", "Industrial"), hub_name)
        shader_patterns = libs.get_shader_patterns(class_def.get("shader_patterns", []), hub_name)
        decorative_elements = libs.get_decorative_elements(class_def.get("decorative_elements", []), hub_name)

        structure_id = f"proc_lib_{floor}_{chunk_index}_{idx}"

        has_truck_bay = class_name in {"standard_warehouse_bar", "cross_dock_facility"}

        model_doors: Dict[str, Any] = {}
        model_garage_doors: List[Dict[str, Any]] = []

        if has_truck_bay:
            truck_w = 3.0
            util_w = 1.2
            bay_spacing = truck_w + 1.2
            max_bays = max(1, min(3, int(width // bay_spacing)))
            bay_count = max_bays
            total_span = (bay_count - 1) * bay_spacing
            start_x = -total_span / 2.0
            front_doors: List[Dict[str, Any]] = []
            for i in range(bay_count):
                cx = start_x + i * bay_spacing
                model_garage_doors.append(
                    {
                        "facade": "front",
                        "type": "truck_bay",
                        "width": truck_w,
                        "height": truck_door_height,
                        "x": cx,
                        "y": truck_door_y,
                    }
                )
                util_offset = truck_w / 2.0 + util_w / 2.0 + 0.6
                util_x = cx + util_offset
                if util_x + util_w / 2.0 > width / 2.0:
                    util_x = cx - util_offset
                front_doors.append(
                    {
                        "type": "industrial_main",
                        "width": util_w,
                        "height": main_door_height,
                        "x": util_x,
                        "y": main_door_y,
                    }
                )
            model_doors["front"] = front_doors
            print(f"[StructureGen] Created {bay_count} truck bay(s) with {len(front_doors)} utility door(s) for {class_name} (single-building path)")
        else:
            max_offset = max(0.0, (width / 2.0) - 1.0)
            door_x = rng.uniform(-max_offset * 0.4, max_offset * 0.4) if max_offset > 0 else 0.0
            model_doors = {
                "front": {
                    "type": "industrial_main",
                    "width": 1.2,
                    "height": main_door_height,
                    "x": door_x,
                    "y": main_door_y,
                }
            }

        windows = _make_windows(width, depth, height)
        windows_before = len(windows)
        windows = _filter_windows_by_openings(windows, model_doors, model_garage_doors, width, depth)
        windows_after = len(windows)
        if windows_before != windows_after:
            print(f"[StructureGen] Filtered {windows_before} -> {windows_after} windows for {class_name} (removed {windows_before - windows_after} overlapping)")

        # If shapely is unavailable, drop a single building at centroid

        if polygon is None:
            rotation = 0.0 if centroid_y <= 0 else 180.0
            structures.append(
                {
                    "id": structure_id,
                    "type": "building",
                    "structure_type": "building",
                    "building_class": class_name,
                    "category": class_def.get("category"),
                    "subcategory": class_def.get("subcategory"),
                    "position": {"x": centroid_x, "y": centroid_y},
                    "floor": floor,
                    "rotation": rotation,
                    "dimensions": {"width": width, "depth": depth, "height": height},
                    "properties": {
                        "is_exterior": class_def.get("is_exterior", False),
                        "size_class": size_class_name,
                        "color_palette_zone": class_def.get("color_palette_zone"),
                        "windows": windows,
                    },
                    "doors": model_doors,
                    "garage_doors": model_garage_doors,
                    "windows": windows,
                    "model_data": {
                        "class": class_name,
                        "shape": class_def.get("base_shape"),
                        "size_class": size_class_name,
                        "color_palette": color_palette,
                        "shader_patterns": shader_patterns,
                        "decorative_elements": decorative_elements,
                        "height": height,
                        "doors": model_doors,
                        "garage_doors": model_garage_doors,
                        "windows": windows,
                    },
                    "is_procedural": True,
                    "procedural_seed": rng_seed,
                }
            )
            continue

        # Place multiple buildings inside the polygon without overlap
        avg_fp = ((size_def["width"][0] + size_def["width"][1]) / 2.0) * (
            (size_def["depth"][0] + size_def["depth"][1]) / 2.0
        )
        subcat = class_def.get("subcategory", "")
        count_scale = COUNT_SCALE_BY_SUBCATEGORY.get(subcat, 1.0)
        target_count = max(1, int(_target_building_count(polygon.area, avg_fp) * count_scale))

        placed: List[sg.Polygon] = []
        attempts = 0
        max_attempts = target_count * 30
        gap = SPACING_BY_SUBCATEGORY.get(subcat, 5.0)  # meters between buildings

        while len(placed) < target_count and attempts < max_attempts:
            attempts += 1

            # Pick class/size for each attempt to introduce variety
            class_name = _weighted_choice(libs.get_zone_distribution("industrial"), "weight", rng) or class_name
            class_def = libs.get_building_class(class_name, hub_name) or class_def
            class_size_fallback = class_def.get("size_class") or size_class_name
            size_class_name = _weighted_choice(size_dist, "weight", rng) or class_size_fallback or size_class_name
            size_def = libs.get_size_class(size_class_name, hub_name) or size_def
            width, depth, height = _choose_footprint(size_def, rng)
            width, depth = _clamp_dimensions(width, depth, (min_x, max_x, min_y, max_y))
            shape = _shape_for_class(class_name, class_def)
            if _is_bar(shape) and width < depth:
                width, depth = depth, width

            # Sample a candidate point inside the zone bounding box
            cand_x = rng.uniform(min_x, max_x)
            cand_y = rng.uniform(min_y, max_y)
            point = sg.Point(cand_x, cand_y)
            if not polygon.contains(point):
                continue

            half_w = width / 2.0
            half_d = depth / 2.0
            footprint = sg.box(cand_x - half_w, cand_y - half_d, cand_x + half_w, cand_y + half_d)

            # Require full containment with a small margin to avoid edge clipping
            if not polygon.contains(footprint.buffer(0.1)):
                continue

            # Spacing check
            buffered = footprint.buffer(gap / 2.0)
            if any(buffered.intersects(p) for p in placed):
                continue

            placed.append(footprint)

            # Recompute vertical metrics per placed footprint (width/depth/height may vary)
            foundation_height = min(0.5, height * 0.1)
            building_height = height - foundation_height
            building_center = foundation_height + building_height / 2.0
            main_door_height = 2.2
            truck_door_height = 3.5
            main_door_center = 1.0 + main_door_height / 2.0
            truck_door_center = 1.0 + truck_door_height / 2.0
            main_door_y = main_door_center - building_center
            truck_door_y = truck_door_center - building_center

            has_truck_bay = class_name in {"standard_warehouse_bar", "cross_dock_facility", "vertical_logistics_block"}
            rotation = 0.0 if cand_y <= 0 else 180.0
            model_doors: Dict[str, Any] = {}
            model_garage_doors: List[Dict[str, Any]] = []

            if has_truck_bay:
                truck_w = 3.0
                util_w = 1.2
                bay_spacing = truck_w + 1.2
                max_bays = max(1, min(3, int(width // bay_spacing)))
                bay_count = max_bays
                total_span = (bay_count - 1) * bay_spacing
                start_x = -total_span / 2.0
                front_doors: List[Dict[str, Any]] = []
                for i in range(bay_count):
                    cx = start_x + i * bay_spacing
                    model_garage_doors.append(
                        {
                            "facade": "front",
                            "type": "truck_bay",
                            "width": truck_w,
                            "height": truck_door_height,
                            "x": cx,
                            "y": truck_door_y,
                        }
                    )
                    util_offset = truck_w / 2.0 + util_w / 2.0 + 0.6
                    util_x = cx + util_offset
                    if util_x + util_w / 2.0 > width / 2.0:
                        util_x = cx - util_offset
                    front_doors.append(
                        {
                            "type": "industrial_main",
                            "width": util_w,
                            "height": main_door_height,
                            "x": util_x,
                            "y": main_door_y,
                        }
                    )
                model_doors["front"] = front_doors
                print(f"[StructureGen] Created {bay_count} truck bay(s) with {len(front_doors)} utility door(s) for {class_name} (multi-building path)")
            else:
                max_offset = max(0.0, (width / 2.0) - 1.0)
                door_x = rng.uniform(-max_offset * 0.4, max_offset * 0.4) if max_offset > 0 else 0.0
                model_doors = {
                    "front": {
                        "type": "industrial_main",
                        "width": 1.2,
                        "height": main_door_height,
                        "x": door_x,
                        "y": main_door_y,
                    }
                }

            windows = _make_windows(width, depth, height)
            windows_before = len(windows)
            windows = _filter_windows_by_openings(windows, model_doors, model_garage_doors, width, depth)
            windows_after = len(windows)
            if windows_before != windows_after:
                print(f"[StructureGen] Filtered {windows_before} -> {windows_after} windows for {class_name} (removed {windows_before - windows_after} overlapping)")

            structure_id = f"proc_lib_{floor}_{chunk_index}_{idx}_{len(placed)}"

            structures.append(
                {
                    "id": structure_id,
                    "type": "building",
                    "structure_type": "building",
                    "building_class": class_name,
                    "category": class_def.get("category"),
                    "subcategory": class_def.get("subcategory"),
                    "position": {"x": cand_x, "y": cand_y},
                    "floor": floor,
                    "rotation": rotation,
                    "dimensions": {"width": width, "depth": depth, "height": height},
                    "properties": {
                        "is_exterior": class_def.get("is_exterior", False),
                        "size_class": size_class_name,
                        "color_palette_zone": class_def.get("color_palette_zone"),
                        "windows": windows,
                    },
                    "doors": model_doors,
                    "garage_doors": model_garage_doors,
                    "windows": windows,
                    "model_data": {
                        "class": class_name,
                        "shape": class_def.get("base_shape"),
                        "size_class": size_class_name,
                        "color_palette": color_palette,
                        "shader_patterns": shader_patterns,
                        "decorative_elements": decorative_elements,
                        "height": height,
                        "doors": model_doors,
                        "garage_doors": model_garage_doors,
                        "windows": windows,
                    },
                    "is_procedural": True,
                    "procedural_seed": rng_seed,
                }
            )

    return structures
