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


def _make_decorations(
    width: float,
    depth: float,
    height: float,
    class_def: Dict[str, Any],
    garage_doors: List[Dict[str, Any]],
    rng: random.Random,
    windows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Create simple decoration hints based on class decorative elements.
    These are lightweight data-only markers (placement/rendering can be handled by client later).
    """
    decorations: List[Dict[str, Any]] = []
    elements = class_def.get("decorative_elements", []) or []

    # Vertical reference: client builds walls from ground (y=0) up to total height
    foundation_height = min(0.5, height * 0.1)
    roof_z = height  # top of the roof; caller can add half-size if needed
    base_z = foundation_height * 0.5               # slightly above ground/foundation
    building_half_width = width / 2.0
    building_half_depth = depth / 2.0
    has_green_roof = False
    vent_rects: List[Dict[str, float]] = []
    # Floor metrics (match window logic)
    floor_height = 4.0
    floor_count = max(1, int(round((height - foundation_height) / floor_height)))

    if "vent_stack" in elements:
        stack_count = rng.randint(1, 3)
        vent_w = 1.0
        vent_d = 1.0
        for _ in range(stack_count):
            placed = False
            for _ in range(8):
                vx = rng.uniform(-width * 0.3, width * 0.3)
                vz = rng.uniform(-depth * 0.3, depth * 0.3)
                # keep vents from overlapping each other (simple AABB)
                if all(
                    abs(vx - vr["x"]) > (vent_w * 0.5 + vr["w"] * 0.5 + 0.2)
                    or abs(vz - vr["z"]) > (vent_d * 0.5 + vr["d"] * 0.5 + 0.2)
                    for vr in vent_rects
                ):
                    vent_rects.append({"x": vx, "z": vz, "w": vent_w, "d": vent_d})
                    decorations.append(
                        {
                            "type": "vent_stack",
                            "position": [vx, vz, roof_z],
                            "size": [vent_w, vent_d, 1.2],  # w, d, h
                        }
                    )
                    placed = True
                    break
            if not placed:
                # fallback: place anyway
                vx = rng.uniform(-width * 0.3, width * 0.3)
                vz = rng.uniform(-depth * 0.3, depth * 0.3)
                vent_rects.append({"x": vx, "z": vz, "w": vent_w, "d": vent_d})
                decorations.append(
                    {"type": "vent_stack", "position": [vx, vz, roof_z], "size": [vent_w, vent_d, 1.2]}
                )

    if "green_roof" in elements:
        has_green_roof = True
        gr_w = width * 0.8
        gr_d = depth * 0.8
        gr_h = 0.3
        decorations.append(
            {
                "type": "green_roof",
                "position": [0.0, 0.0, roof_z + gr_h * 0.5],
                "size": [gr_w, gr_d, gr_h],
            }
        )
        # Rooftop access hut
        hut_w = 3.0
        hut_d = 2.5
        hut_h = 2.4
        decorations.append(
            {
                "type": "roof_access",
                "position": [-width * 0.25, 0.0, roof_z + hut_h * 0.5],
                "size": [hut_w, hut_d, hut_h],
            }
        )
        # Rooftop railing inset slightly from roof edge
        rail_h = 1.1
        decorations.append(
            {
                "type": "roof_railing",
                "position": [0.0, 0.0, roof_z + rail_h * 0.5],
                "size": [width - 0.4, depth - 0.4, rail_h],
            }
        )

    skylight_rects: List[Dict[str, float]] = []
    if "skylight" in elements and not has_green_roof:
        sky_count = rng.randint(2, 5)
        rows = max(1, int(round(sky_count ** 0.5)))
        cols = max(rows, int((sky_count + rows - 1) // rows))
        usable_w = width * 0.7
        usable_d = depth * 0.7
        margin_x = usable_w / max(1, cols + 1)
        margin_z = usable_d / max(1, rows + 1)
        size_x = min(1.8, usable_w / max(3, cols * 2))
        size_z = min(1.8, usable_d / max(3, rows * 2))
        placed = 0
        for r in range(rows):
            for c in range(cols):
                if placed >= sky_count:
                    break
                cx = (c + 1) * margin_x - usable_w * 0.5
                cz = (r + 1) * margin_z - usable_d * 0.5
                skylight_rects.append({"x": cx, "z": cz, "w": size_x, "d": size_z})
                decorations.append(
                    {
                        "type": "skylight",
                        "position": [cx, cz, roof_z + 0.1],
                        "size": [size_x, size_z, 0.25],
                    }
                )
                placed += 1

    def _overlaps_skylight(x: float, z: float, w: float, d: float, pad: float = 0.5) -> bool:
        for rect in skylight_rects:
            rw = rect["w"] * 0.5 + pad
            rd = rect["d"] * 0.5 + pad
            if abs(x - rect["x"]) <= (rw + w * 0.5) and abs(z - rect["z"]) <= (rd + d * 0.5):
                return True
        return False

    solar_rects: List[Dict[str, float]] = []
    hvac_rects: List[Dict[str, float]] = []

    def _overlaps_roof(
        x: float,
        z: float,
        w: float,
        d: float,
        pad: float = 0.5,
        include_solar: bool = False,
        include_vents: bool = False,
        include_hvac: bool = False,
    ) -> bool:
        if _overlaps_skylight(x, z, w, d, pad):
            return True
        if include_solar:
            for rect in solar_rects:
                rw = rect["w"] * 0.5 + pad
                rd = rect["d"] * 0.5 + pad
                if abs(x - rect["x"]) <= (rw + w * 0.5) and abs(z - rect["z"]) <= (rd + d * 0.5):
                    return True
        if include_vents:
            for rect in vent_rects:
                rw = rect["w"] * 0.5 + pad
                rd = rect["d"] * 0.5 + pad
                if abs(x - rect["x"]) <= (rw + w * 0.5) and abs(z - rect["z"]) <= (rd + d * 0.5):
                    return True
        if include_hvac:
            for rect in hvac_rects:
                rw = rect["w"] * 0.5 + pad
                rd = rect["d"] * 0.5 + pad
                if abs(x - rect["x"]) <= (rw + w * 0.5) and abs(z - rect["z"]) <= (rd + d * 0.5):
                    return True
        return False

    if "solar_panel" in elements and not has_green_roof:
        panel_count = rng.randint(4, 12)
        rows = max(1, int(round(panel_count ** 0.5)))
        cols = max(rows, int((panel_count + rows - 1) // rows))
        solar_w = 3.0
        solar_d = 1.6
        solar_h = 0.15
        usable_w = width * 0.7
        usable_d = depth * 0.7
        spacing_x = max(solar_w * 1.2, usable_w / max(1, cols + 1))
        spacing_z = max(solar_d * 1.2, usable_d / max(1, rows + 1))
        start_x = -spacing_x * (cols - 1) * 0.5
        start_z = -spacing_z * (rows - 1) * 0.5

        placed = 0
        for r in range(rows):
            for c in range(cols):
                if placed >= panel_count:
                    break
                px = start_x + c * spacing_x
                pz = start_z + r * spacing_z
                if not _overlaps_roof(px, pz, solar_w, solar_d, pad=0.4, include_solar=True, include_vents=True, include_hvac=True):
                    solar_rects.append({"x": px, "z": pz, "w": solar_w, "d": solar_d})
                    decorations.append(
                        {
                            "type": "solar_panel",
                            "position": [px, pz, roof_z + 0.05],
                            "size": [solar_w, solar_d, solar_h],
                        }
                    )
                    placed += 1

    if "piping" in elements:
        pipe_count = rng.randint(2, 5)
        facades = ["front", "back", "left", "right"]
        pipe_height = max(3.0, (height - foundation_height) * 0.8)
        z_center = base_z + pipe_height * 0.5
        # build window spans per facade for overlap avoidance
        win_by_facade: Dict[str, List[Tuple[float, float]]] = {}
        for w in windows:
            fac = w.get("facade", "front")
            pos = w.get("position", [0.0, 0.0, 0.0])
            size = w.get("size", [0.0, 0.0])
            win_by_facade.setdefault(fac, []).append((float(pos[0]), float(size[0])))

        for _ in range(pipe_count):
            facade = rng.choice(facades)
            if facade in {"front", "back"}:
                span = width * 0.4
                px = None
                for _ in range(12):
                    cand_x = rng.uniform(-span, span)
                    # avoid windows horizontally
                    overlap = False
                    for wx, ww in win_by_facade.get(facade, []):
                        if abs(cand_x - wx) <= (0.125 + ww * 0.5 + 0.3):  # pipe radius ~0.125 plus margin
                            overlap = True
                            break
                    if not overlap:
                        px = cand_x
                        break
                if px is None:
                    px = rng.uniform(-span, span)
                pz = 0.0  # depth offset applied client-side based on facade
            else:
                span = depth * 0.4
                pz = None
                for _ in range(12):
                    cand_z = rng.uniform(-span, span)
                    overlap = False
                    for wx, ww in win_by_facade.get(facade, []):
                        if abs(cand_z - wx) <= (0.125 + ww * 0.5 + 0.3):
                            overlap = True
                            break
                    if not overlap:
                        pz = cand_z
                        break
                if pz is None:
                    pz = rng.uniform(-span, span)
                px = 0.0
            decorations.append(
                {
                    "type": "piping",
                    "facade": facade,
                    "position": [px, pz, z_center],
                    "size": [0.25, 0.25, pipe_height],
                }
            )

    if "loading_dock" in elements and garage_doors:
        for gd in garage_doors:
            if gd.get("facade") != "front":
                continue
            # Determine utility door X (paired with this bay) if present in front doors
            util_x: Optional[float] = None
            # We will find a matching utility door later when model_doors are built; for now, use truck bay center
            # Caller will pass paired utility X via a supplied field on the garage door if available
            util_x = gd.get("paired_utility_x")
            if util_x is None:
                # Fallback: place dock centered on truck bay
                util_x = gd.get("x", 0.0)

            truck_x = gd.get("x", 0.0)
            truck_w = gd.get("width", 3.0)
            util_w = 1.2
            gap = 0.6
            # Compute span covering truck bay and utility door with a small margin
            left = min(truck_x - truck_w / 2.0, util_x - util_w / 2.0) - 0.2
            right = max(truck_x + truck_w / 2.0, util_x + util_w / 2.0) + 0.2
            platform_w = max(2.5, right - left)
            platform_x = (left + right) / 2.0
            platform_d = 2.5
            platform_h = 1.0  # 1m tall, top aligns with door bottom at ~1m

            decorations.append(
                {
                    "type": "loading_dock",
                    "facade": "front",
                    "position": [platform_x, 0.0, platform_h * 0.5],  # center at half height
                    "size": [platform_w, platform_d, platform_h],
                }
            )

    if "roof_hvac" in elements and not has_green_roof:
        hvac_count = rng.randint(1, 3)
        for _ in range(hvac_count):
            for _ in range(8):
                px = rng.uniform(-building_half_width * 0.5, building_half_width * 0.5)
                pz = rng.uniform(-building_half_depth * 0.5, building_half_depth * 0.5)
                if not _overlaps_roof(px, pz, 2.0, 2.0, pad=0.5, include_solar=True, include_vents=True, include_hvac=True):
                    hvac_rects.append({"x": px, "z": pz, "w": 2.0, "d": 2.0})
                    decorations.append(
                        {
                            "type": "roof_hvac",
                            "position": [
                                px,
                                pz,
                                roof_z + 0.6,  # center above roof so it protrudes upward
                            ],
                            "size": [2.0, 2.0, 1.0],
                        }
                    )
                    break

    if "utility_band" in elements:
        # Place bands per floor (near top of each 4m band), all facades
        # Skip ground floor to avoid overlapping truck/utility doors
        band_heights: List[float] = []
        for k in range(1, floor_count):  # start at 2nd band
            bh = foundation_height + k * floor_height + 0.9
            if bh < height - 0.5:
                band_heights.append(bh)
        facades = ["front", "back", "left", "right"]
        for bh in band_heights:
            for facade in facades:
                # Width/depth per facade
                if facade in {"front", "back"}:
                    size = [width * 0.9, 0.2, 0.25]
                    pos = [0.0, 0.0, bh]
                else:
                    size = [depth * 0.9, 0.2, 0.25]
                    pos = [0.0, 0.0, bh]
                decorations.append(
                    {
                        "type": "utility_band",
                        "facade": facade,
                        "position": pos,  # x relative, y depth axis, z height from ground
                        "size": size,
                    }
                )

    if "cooling_tower" in elements:
        tower_count = rng.randint(1, 3)
        # Deterministic spacing to avoid overlap
        towerspan = width * 0.6
        tower_diameter = 8.0
        min_spacing = 10.0  # add buffer beyond diameter
        max_range = max(0.1, towerspan * 0.5 - (tower_diameter * 0.5) - 0.2)

        if tower_count == 1:
            positions_x = [0.0]
        else:
            # Base spacing attempt
            spacing = min_spacing
            total_half = spacing * (tower_count - 1) * 0.5
            if total_half > max_range:
                # Fit inside available span
                spacing = (max_range * 2.0) / (tower_count - 1)
            positions_x = [
                -spacing * (tower_count - 1) * 0.5 + i * spacing for i in range(tower_count)
            ]

        for px in positions_x:
            decorations.append(
                {
                    "type": "cooling_tower",
                    "position": [
                        px,
                        -(building_half_depth + 6.0),  # back close to parent
                        0.0,
                    ],
                    "size": [tower_diameter, tower_diameter, 12.0],
                }
            )

    if "reactor_turbine_hall" in elements:
        hall_height = height * 0.6
        hall_width = 12.0
        hall_depth = depth * 0.6
        # Place flush against right facade (x is east-west), sitting on ground
        hall_pos_x = building_half_width + (hall_width * 0.5) + 0.1  # small gap to avoid z-fighting
        hall_pos_y = 0.0  # depth axis (front/back) centered
        hall_pos_z = 0.0  # vertical: base on ground
        decorations.append(
            {
                "type": "reactor_turbine_hall",
                "position": [hall_pos_x, hall_pos_y, hall_pos_z],
                "size": [hall_width, hall_depth, hall_height],
            }
        )

    return decorations


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
    Supports all zone types (industrial, residential, commercial, etc.).
    Places multiple non-overlapping buildings per zone when possible.
    """
    structures: List[Dict[str, Any]] = []

    for idx, zone in enumerate(zones):
        zone_type = zone.get("properties", {}).get("zone_type", "").lower()
        
        # Skip zones that don't have structure generation support
        # Restricted zones typically don't have buildings
        if zone_type in ("restricted", ""):
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

        # Get zone distribution for this zone type
        zone_dist = libs.get_zone_distribution(zone_type)
        if not zone_dist:
            # If no specific distribution for this zone type, skip it
            continue
        
        class_name = _weighted_choice(zone_dist, "weight", rng)
        if not class_name:
            continue
        class_def = libs.get_building_class(class_name, hub_name)
        if not class_def:
            continue

        size_dist = libs.get_size_distribution(zone_type)
        if not size_dist:
            # If no size distribution for this zone type, try a default
            size_dist = libs.get_size_distribution("industrial")
        if not size_dist:
            # Still no distribution - use class default size_class if available
            size_class_name = class_def.get("size_class")
        else:
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

        # Use zone-specific color palette, fallback to class default or "Industrial"
        color_palette_zone = class_def.get("color_palette_zone") or zone_type.capitalize() or "Industrial"
        color_palette = libs.get_color_palette(color_palette_zone, hub_name)
        shader_patterns = libs.get_shader_patterns(class_def.get("shader_patterns", []), hub_name)
        decorative_elements = libs.get_decorative_elements(class_def.get("decorative_elements", []), hub_name)

        structure_id = f"proc_lib_{floor}_{chunk_index}_{idx}"

        has_truck_bay = class_name in {"standard_warehouse_bar", "cross_dock_facility"}

        model_doors: Dict[str, Any] = {}
        model_garage_doors: List[Dict[str, Any]] = []

        if has_truck_bay:
            truck_w = 3.0
            util_w = 1.2
            bay_clearance = 2.5  # more spacing between bays
            bay_spacing = truck_w + bay_clearance
            max_bays = max(1, min(3, int((width - 2.0) // bay_spacing)))
            bay_count = max_bays
            total_span = (bay_count - 1) * bay_spacing
            start_x = -total_span / 2.0
            front_doors: List[Dict[str, Any]] = []
            for i in range(bay_count):
                cx = start_x + i * bay_spacing
                # Truck bay door
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
                # Utility door beside bay
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
                # Store pairing for dock placement
                model_garage_doors[-1]["paired_utility_x"] = util_x
            model_doors["front"] = front_doors
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

        # If shapely is unavailable, drop a single building at centroid

        if polygon is None:
            rotation = 0.0 if centroid_y <= 0 else 180.0
            decorations = _make_decorations(width, depth, height, class_def, model_garage_doors, rng)
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
                    "decorations": decorations,
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
                        "decorations": decorations,
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

            # Expand footprint to reserve space for large exterior decorations
            back_margin = 0.0
            right_margin = 0.0
            if "cooling_tower" in class_def.get("decorative_elements", []):
                back_margin = 12.0  # keep towers close but reserve space behind
            if "reactor_turbine_hall" in class_def.get("decorative_elements", []):
                right_margin = 14.0  # reserve space on the right side for hall

            footprint = sg.box(
                cand_x - half_w - 0.0,
                cand_y - half_d - back_margin,
                cand_x + half_w + right_margin,
                cand_y + half_d + 0.0,
            )

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
                bay_clearance = 2.5
                bay_spacing = truck_w + bay_clearance
                max_bays = max(1, min(3, int((width - 2.0) // bay_spacing)))
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
                    model_garage_doors[-1]["paired_utility_x"] = util_x
                model_doors["front"] = front_doors
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
            decorations = _make_decorations(width, depth, height, class_def, model_garage_doors, rng, windows)

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
                    "decorations": decorations,
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
                        "decorations": decorations,
                    },
                    "is_procedural": True,
                    "procedural_seed": rng_seed,
                }
            )

    return structures
