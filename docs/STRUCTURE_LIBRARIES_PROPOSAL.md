# Structure Libraries System - Design Guide

> **Note**: This document has been reorganized from a proposal into a design guide for implementation. All detailed JSON examples are preserved in the [Configuration Files - Detailed JSON Examples](#configuration-files---detailed-json-examples) section below.

## Table of Contents

1. [Introduction](#introduction)
2. [System Architecture](#system-architecture)
3. [Configuration Files](#configuration-files) - Overview of each file type
4. [Implementation Guide](#implementation-guide) - Step-by-step implementation
5. [Migration Strategy](#migration-strategy) - Phased migration approach
6. [Reference Material](#reference-material) - Quick reference tables and concepts
7. [Configuration Files - Detailed JSON Examples](#configuration-files---detailed-json-examples) - Complete JSON structures

---

## Introduction

### Purpose

This design guide documents a modular, hub-specific structure library system that allows each pillar-hub terminal to have unique cultural theming for buildings, decorations, and visual elements. The system integrates color palettes and motifs into a unified configuration system with admin tools for editing and validation.

### Key Features

- **Hub-Specific Cultural Theming**: Each pillar-hub can override default building characteristics
- **Modular Configuration**: Separate JSON files for different aspects (classes, sizes, shapes, etc.)
- **Inheritance & Overrides**: Base definitions with hub-specific overrides
- **Validation**: JSON Schema validation and runtime validation
- **Admin Tools**: Visual editor and validator in Admin → Structures modal

### Design Principles

1. **Modularity**: Separate concerns into distinct configuration files
2. **Extensibility**: Easy to add new building types, shapes, and decorative elements
3. **Hub Customization**: Support for cultural theming per hub without code changes
4. **Validation**: Comprehensive validation at both schema and runtime levels
5. **Performance**: Efficient loading and caching of configuration data

---

## System Architecture

### Directory Structure

```
server/config/
├── structure-libraries/              # Structure definitions
│   ├── building-classes.json         # Building type definitions (base + hub overrides)
│   ├── building-sizes.json          # Dimension ranges and distributions
│   ├── building-shapes.json         # Base geometry shapes
│   ├── lot-shapes.json              # Lot placement patterns
│   ├── decorative-elements.json    # 3D decorative elements
│   ├── shader-patterns.json        # Shader-based patterns (merged from pillar-motifs.json)
│   ├── color-palettes.json         # Color palettes (merged from hub-color-palettes.json)
│   └── window-door-patterns.json   # Window and door configurations
│
└── structure-libraries-schemas/     # JSON Schema validation files
    ├── building-classes.schema.json
    ├── building-sizes.schema.json
    ├── building-shapes.schema.json
    ├── lot-shapes.schema.json
    ├── decorative-elements.schema.json
    ├── shader-patterns.schema.json
    ├── color-palettes.schema.json
    └── window-door-patterns.schema.json
```

### System Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Procedural Generation                     │
│                  (generation.py / buildings.py)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Structure Libraries Loader                      │
│            (structure_libraries.py)                          │
│  • Loads JSON configuration files                           │
│  • Applies hub overrides                                    │
│  • Caches loaded data                                       │
│  • Provides getter functions                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Building Generation                            │
│  • Selects building class based on zone type                │
│  • Determines size from building-sizes.json                │
│  • Selects shape from building-shapes.json                  │
│  • Applies decorative elements                              │
│  • Applies color palettes                                   │
│  • Applies shader patterns                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Database Storage                               │
│  • Stores structure with model_data JSONB                   │
│  • Includes all configuration references                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Client Rendering                                │
│  • Reads model_data from structure                         │
│  • Generates geometry based on shape                        │
│  • Applies materials from color palette                     │
│  • Renders decorative elements                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Concepts

#### Hub Overrides

Hub overrides allow pillar-hubs to customize building characteristics:

```json
{
  "defaults": {
    "building_classes": {
      "house": { /* base definition */ }
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "building_classes": {
        "house": {
          "decorative_elements": ["porch", "kongo_roof_spirals"],
          "shader_patterns": ["residential_standard", "kongo_soft_dot_grid"]
        }
      }
    }
  }
}
```

#### Exterior vs Interior Structures

- **Interior Structures** (`is_exterior: false`): Constrained to 20m maximum (5 floors × 4m per floor)
- **Exterior Structures** (`is_exterior: true`): Can exceed 20m, subject to type-specific maximums

See [Exterior vs Interior Structures](#exterior-vs-interior-structures) for details.

#### Mixed-Use Zone Runtime Distribution

Mixed-use zones use dynamic runtime distribution - building type proportions are calculated during chunk generation based on contextual factors, not fixed probabilities.

See [Mixed-Use Zone Runtime Distribution](#mixed-use-zone-runtime-distribution) for details.

---

## Configuration Files

### Overview

The system uses 8 JSON configuration files, each handling a specific aspect of structure generation. All files support hub-specific overrides and follow a consistent structure with `defaults` and `hub_overrides` sections.

### 1. Building Classes (`building-classes.json`)

**Purpose**: Defines building types with their characteristics, allowed zones, shapes, sizes, and decorative elements.

**Structure**: Base definitions + hub-specific overrides

**Key Fields**:
- `category`: residential, commercial, industrial, agricultural, park
- `subcategory`: More specific classification
- `allowed_zones`: Which zone types can use this building class
- `base_shape`: Shape from building-shapes.json
- `size_class`: Size class from building-sizes.json
- `is_exterior`: Whether structure can exceed 20m height limit
- `height_range`: [min, max] height in meters
- `decorative_elements`: Array of decorative element names
- `color_palette_zone`: Which color palette to use
- `shader_patterns`: Array of shader pattern names

**Building Class Categories**:

- **Residential** (20 types): Slab & Bar Blocks, Courtyard & Ring Blocks, Tower & Stack Forms, Cluster & Village Forms, Special Residential
- **Commercial** (14 types): Podium & Mall Blocks, Office & Mixed Office Towers, Strip & Bar Commercial, Specialty Commercial
- **Industrial** (12 types): Warehouse & Logistics Bars, Plant & Utility Blocks, Yard & Platform Structures, Light-Industrial / Maker Blocks
- **Agricultural** (12 types): Terraced Grow Blocks, Greenhouse & Biome Halls, Vertical Farm Towers, Processing & Storage
- **Park** (12 types): Plate & Deck Parks, Courtyard & Pocket Parks, Pavilion & Landmark Structures, Sport & Recreation Blocks

**Complete JSON Example**: See [Building Classes JSON Reference](#building-classes-json-reference) section below for the full structure with all 70 building types.

---

## Configuration Files - Detailed JSON Examples

> **Note**: The following sections contain the complete JSON structures for all configuration files. These are reference implementations - use these as templates when creating the actual files.

### Building Classes JSON Reference

**Purpose**: Defines size classes (small, medium, large) with dimension ranges and distributions.

**Structure**:
- Size class definitions with width, depth, height ranges
- Zone-specific size distributions
- Hub-specific size overrides

**Size Classes**:
- `small`: 8-15m width, 8-15m depth
- `medium`: 15-25m width, 15-25m depth
- `large`: 25-40m width, 25-40m depth

**Complete JSON Example**: See [Building Sizes JSON Reference](#building-sizes-json-reference) section below.

### 3. Building Shapes (`building-shapes.json`)

**Purpose**: Defines 20 base geometry shapes for building footprints.

**Shape Catalog**: See [Shape Compatibility Matrix](#shape-compatibility-matrix) for the complete list.

**Complete JSON Example**: See [Building Shapes JSON Reference](#building-shapes-json-reference) section below.

### 4. Color Palettes (`color-palettes.json`)

**Purpose**: Defines color schemes for different zone types, merged from `hub-color-palettes.json`.

**Structure**:
- Zone-specific color palettes (Residential, Commercial, Industrial, Agricultural, Parks)
- Color components: foundation, walls, roofs, windows_doors, trim
- Hub-specific color overrides

**Complete JSON Example**: See [Color Palettes JSON Reference](#color-palettes-json-reference) section below.

### 5. Shader Patterns (`shader-patterns.json`)

**Purpose**: Defines shader-based decorative patterns, merged from `pillar-motifs.json`.

**Structure**:
- Pattern definitions with placement, scale, complexity
- Hub-specific pattern overrides

**Complete JSON Example**: See [Shader Patterns JSON Reference](#shader-patterns-json-reference) section below.

### 6. Decorative Elements (`decorative-elements.json`)

**Purpose**: Defines 3D geometric decorative elements that can be attached to buildings.

**Element Categories**: See [Decorative Elements Merging](#decorative-elements-merging) section for complete list.

**Merging Strategy**: See [Decorative Elements Merging](#decorative-elements-merging) for detailed strategy.

**Complete JSON Example**: See [Decorative Elements JSON Reference](#decorative-elements-json-reference) section below.

### 7. Lot Shapes (`lot-shapes.json`)

**Purpose**: Defines lot placement patterns and sizing rules.

**Lot Patterns**:
- `centered`: Building centered on lot
- `offset_front`: Building offset toward front
- `corner_lot`: Building positioned at corner

**Complete JSON Example**: See [Lot Shapes JSON Reference](#lot-shapes-json-reference) section below.

### 8. Window & Door Patterns (`window-door-patterns.json`)

**Purpose**: Defines window and door configurations, spacing, and patterns.

**Window Patterns**:
- `residential_standard`: Standard residential windows
- `commercial_full_height`: Full-height commercial windows
- `industrial_minimal`: Minimal industrial windows

**Door Patterns**:
- `main_entrance`: Primary entrance doors
- `side_entrance`: Secondary entrance doors
- `truck_bay`: Industrial loading doors

**Complete JSON Example**: See [Window & Door Patterns JSON Reference](#window--door-patterns-json-reference) section below.

---

## Configuration Files - Detailed JSON Examples

> **Implementation Note**: The following sections contain the complete JSON structures for all configuration files. These serve as reference implementations - use these as templates when creating the actual files during Phase 1 of migration.

### Building Classes JSON Reference

```json
{
  "version": "1.0.0",
  "defaults": {
    "building_classes": {
      // ============================================
      // RESIDENTIAL BUILDING CLASSES
      // ============================================
      // 
      // Residential buildings are organized into 5 subcategories with 20 total building types:
      // 1. Slab & Bar Blocks (4 types) - Linear residential blocks
      // 2. Courtyard & Ring Blocks (4 types) - Structures with internal courtyards
      // 3. Tower & Stack Forms (4 types) - Vertical residential structures
      // 4. Cluster & Village Forms (4 types) - Grouped residential structures
      // 5. Special Residential (4 types) - Specialized housing types
      //
      // Each type has specific shape requirements, height ranges, and special features
      // that will be implemented in the building generation system.
      //
      // --- Slab & Bar Blocks ---
      "linear_corridor_block": {
        "name": "Linear Corridor Block",
        "category": "residential",
        "subcategory": "slab_bar",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "is_exterior": false,  // Interior structure - constrained to 20m (5 floors)
        "height_range": [12.0, 20.0],  // Capped at 20m for interior
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 2, "max": 6},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "corridor_windows"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["central_corridor", "double_loaded"]
      },
      "double_loaded_slab": {
        "name": "Double-Loaded Slab",
        "category": "residential",
        "subcategory": "slab_bar",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.75,
        "window_pattern": "residential_standard",
        "door_count": {"min": 3, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "entry_columns"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["central_corridor", "apartments_both_sides"]
      },
      "perimeter_bar": {
        "name": "Perimeter Bar",
        "category": "residential",
        "subcategory": "slab_bar",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 2, "max": 5},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "street_facing_facade"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["edges_street_or_park", "perimeter_orientation"]
      },
      "split_bar_pair": {
        "name": "Split Bar Pair",
        "category": "residential",
        "subcategory": "slab_bar",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "composite_parallel",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 10},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "shared_courtyard"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["two_parallel_slabs", "shared_courtyard"]
      },
      
      // --- Courtyard & Ring Blocks ---
      "closed_courtyard_block": {
        "name": "Closed Courtyard Block",
        "category": "residential",
        "subcategory": "courtyard_ring",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "ring_closed",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.65,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "courtyard_access"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["full_ring", "inner_lightwell", "courtyard"]
      },
      "open_u_block": {
        "name": "Open U-Block",
        "category": "residential",
        "subcategory": "courtyard_ring",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "u_shaped",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 3, "max": 6},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "courtyard_access"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["u_shape", "open_court", "one_side_open"]
      },
      "double_courtyard_block": {
        "name": "Double Courtyard Block",
        "category": "residential",
        "subcategory": "courtyard_ring",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "composite_courtyard",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.65,
        "window_pattern": "residential_standard",
        "door_count": {"min": 6, "max": 12},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "dual_courtyard_access"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["two_internal_courts", "series_layout"]
      },
      "ring_tower_podium": {
        "name": "Ring Tower Podium",
        "category": "residential",
        "subcategory": "courtyard_ring",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "ring_closed",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [20.0, 40.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "podium_base", "tower_section"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["ring_podium", "mid_rise_housing", "tiered_structure"]
      },
      
      // --- Tower & Stack Forms ---
      "point_tower": {
        "name": "Point Tower",
        "category": "residential",
        "subcategory": "tower_stack",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "small",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [40.0, 80.0],
        "window_density": 0.75,
        "window_pattern": "residential_standard",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "tower_crown"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["small_footprint", "tall", "vertical_emphasis"]
      },
      "podium_tower": {
        "name": "Podium Tower",
        "category": "residential",
        "subcategory": "tower_stack",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "composite_podium",
        "size_class": "medium",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [32.0, 60.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "podium_base", "tower_section"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["4_6_floor_base", "tower_above", "setback_transition"]
      },
      "twin_towers_skybridge": {
        "name": "Twin Towers with Skybridge",
        "category": "residential",
        "subcategory": "tower_stack",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "composite_twin",
        "size_class": "medium",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [40.0, 60.0],
        "window_density": 0.75,
        "window_pattern": "residential_standard",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "skybridge", "twin_towers"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["twin_towers", "skybridge_connection", "paired_structure"]
      },
      "terrace_tower": {
        "name": "Terrace Tower",
        "category": "residential",
        "subcategory": "tower_stack",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "stepped_tower",
        "size_class": "medium",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [40.0, 60.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "terrace_levels", "stepped_back"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["stepped_back", "terrace_levels", "setback_every_few_floors"]
      },
      
      // --- Cluster & Village Forms ---
      "clustered_midrises_shared_deck": {
        "name": "Clustered Mid-Rises around Shared Deck",
        "category": "residential",
        "subcategory": "cluster_village",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "cluster",
        "size_class": "large",
        "is_exterior": false,  // Interior structure - constrained to 20m (5 floors)
        "height_range": [16.0, 20.0],  // Capped at 20m for interior
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "shared_deck", "cluster_connection"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["multiple_midrises", "shared_deck", "cluster_layout"]
      },
      "terrace_village": {
        "name": "Terrace Village",
        "category": "residential",
        "subcategory": "cluster_village",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "cluster",
        "size_class": "medium",
        "height_range": [12.0, 20.0],
        "window_density": 0.65,
        "window_pattern": "residential_standard",
        "door_count": {"min": 3, "max": 6},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "shared_plate", "terrace_connection"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["multiple_small_volumes", "shared_plate", "village_layout"]
      },
      "stacked_townhouse_cluster": {
        "name": "Stacked Townhouse Cluster",
        "category": "residential",
        "subcategory": "cluster_village",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "cluster",
        "size_class": "medium",
        "height_range": [12.0, 20.0],
        "window_density": 0.65,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "townhouse_units", "stacked_layout"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["stacked_townhouses", "cluster_layout", "vertical_stacking"]
      },
      "radial_spoke_cluster": {
        "name": "Radial 'Spoke' Cluster",
        "category": "residential",
        "subcategory": "cluster_village",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "radial_spoke",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "central_core", "radial_wings"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["central_core", "short_wings", "radial_layout"]
      },
      
      // --- Special Residential ---
      "coliving_block": {
        "name": "Co-Living Block",
        "category": "residential",
        "subcategory": "special",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "is_exterior": false,  // Interior structure - constrained to 20m (5 floors)
        "height_range": [16.0, 20.0],  // Capped at 20m for interior
        "window_density": 0.75,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["balconies", "cornice", "shared_amenity_floors"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["many_small_units", "shared_amenity_floors", "co_living"]
      },
      "luxury_sky_villas": {
        "name": "Luxury Sky Villas",
        "category": "residential",
        "subcategory": "special",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [24.0, 40.0],
        "window_density": 0.80,
        "window_pattern": "residential_standard",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["large_balconies", "cornice", "luxury_finishes", "wide_shallow_floorplates"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["wide_shallow_floorplates", "big_balconies", "luxury"]
      },
      "student_compact_habitat_stack": {
        "name": "Student / Compact Habitat Stack",
        "category": "residential",
        "subcategory": "special",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [20.0, 32.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 6, "max": 12},
        "door_pattern": "main_entrance",
        "decorative_elements": ["compact_balconies", "cornice", "stacked_units"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["compact_units", "stacked_layout", "student_housing"]
      },
      "senior_assisted_living_terrace": {
        "name": "Senior / Assisted Living Terrace Block",
        "category": "residential",
        "subcategory": "special",
        "allowed_zones": ["residential", "mixed-use"],
        "base_shape": "terrace_block",
        "size_class": "medium",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "residential_standard",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["accessible_balconies", "cornice", "terrace_access", "assisted_features"],
        "material_style": "residential",
        "color_palette_zone": "Residential",
        "shader_patterns": ["residential_standard"],
        "special_features": ["terrace_block", "assisted_living", "accessible_design"]
      },
      // ============================================
      // INDUSTRIAL BUILDING CLASSES
      // ============================================
      // 
      // Industrial buildings are organized into 4 subcategories with 12 total building types:
      // 1. Warehouse & Logistics Bars (3 types) - Storage and distribution facilities
      // 2. Plant & Utility Blocks (3 types) - Production and utility facilities
      // 3. Yard & Platform Structures (3 types) - Open yard and platform structures
      // 4. Light-Industrial / Maker Blocks (3 types) - Smaller scale industrial facilities
      //
      // --- Warehouse & Logistics Bars ---
      "standard_warehouse_bar": {
        "name": "Standard Warehouse Bar",
        "category": "industrial",
        "subcategory": "warehouse_logistics",
        "allowed_zones": ["industrial", "mixed-use", "agricultural"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [5.0, 12.0],
        "window_density": 0.10,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": true,
          "min_per_facade": 1,
          "max_per_facade": 4,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["long_low", "big_span", "standard_warehouse"]
      },
      "cross_dock_facility": {
        "name": "Cross-Dock Facility",
        "category": "industrial",
        "subcategory": "warehouse_logistics",
        "allowed_zones": ["industrial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [5.0, 10.0],
        "window_density": 0.10,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": true,
          "min_per_facade": 2,
          "max_per_facade": 6,
          "pattern": "truck_bay",
          "both_long_sides": true
        },
        "decorative_elements": ["utility_bands", "cross_dock_access"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["truck_access_both_sides", "cross_dock", "service_access"]
      },
      "vertical_logistics_block": {
        "name": "Vertical Logistics Block",
        "category": "industrial",
        "subcategory": "warehouse_logistics",
        "allowed_zones": ["industrial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [16.0, 32.0],
        "window_density": 0.15,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": true,
          "min_per_facade": 1,
          "max_per_facade": 3,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "ramps_or_elevators", "multilevel_access"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["ramped_or_elevator_based", "multilevel_storage", "vertical_logistics"]
      },
      
      // --- Plant & Utility Blocks ---
      "energy_plant_block": {
        "name": "Energy Plant Block",
        "category": "industrial",
        "subcategory": "plant_utility",
        "allowed_zones": ["industrial"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [12.0, 24.0],
        "window_density": 0.20,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "reactor_turbine_hall", "vent_stacks", "cooling_towers"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["reactor_turbine_hall_form", "energy_plant", "utility_facility"]
      },
      "water_recycling_plant": {
        "name": "Water / Recycling Plant",
        "category": "industrial",
        "subcategory": "plant_utility",
        "allowed_zones": ["industrial"],
        "base_shape": "composite_plant",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.15,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "tanks", "process_hall", "piping"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["tanks_plus_process_hall", "water_recycling", "utility_facility"]
      },
      "data_fabrication_block": {
        "name": "Data/Fabrication Block",
        "category": "industrial",
        "subcategory": "plant_utility",
        "allowed_zones": ["industrial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.05,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "heavy_roof_kit", "windowless", "few_openings"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["windowless_or_few_openings", "heavy_roof_kit", "data_fabrication"]
      },
      
      // --- Yard & Platform Structures ---
      "lift_yard_platform": {
        "name": "Lift Yard Platform",
        "category": "industrial",
        "subcategory": "yard_platform",
        "allowed_zones": ["industrial"],
        "base_shape": "platform",
        "size_class": "large",
        "height_range": [2.0, 4.0],
        "window_density": 0.30,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["open_deck", "small_control_building", "lift_equipment"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["open_deck", "small_control_building", "lift_yard"]
      },
      "container_stack_yard": {
        "name": "Container Stack Yard",
        "category": "industrial",
        "subcategory": "yard_platform",
        "allowed_zones": ["industrial"],
        "base_shape": "platform",
        "size_class": "large",
        "height_range": [4.0, 8.0],
        "window_density": 0.25,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["low_control_tower", "flat_yard", "container_stacks"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["low_control_tower", "flat_yard", "container_stacks"]
      },
      "maintenance_deck": {
        "name": "Maintenance Deck",
        "category": "industrial",
        "subcategory": "yard_platform",
        "allowed_zones": ["industrial"],
        "base_shape": "platform",
        "size_class": "large",
        "height_range": [4.0, 8.0],
        "window_density": 0.20,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["open_frame", "sheltered_bays", "maintenance_equipment"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["open_frame", "sheltered_bays_beneath", "maintenance"]
      },
      
      // --- Light-Industrial / Maker Blocks ---
      "small_bay_workshop_row": {
        "name": "Small-Bay Workshop Row",
        "category": "industrial",
        "subcategory": "light_industrial",
        "allowed_zones": ["industrial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [5.0, 10.0],
        "window_density": 0.30,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 3, "max": 6},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "multi_tenant", "workshop_bays"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["multi_tenant", "small_bay_workshops", "row_layout"]
      },
      "maker_lab_block": {
        "name": "Maker / Lab Block",
        "category": "industrial",
        "subcategory": "light_industrial",
        "allowed_zones": ["industrial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [8.0, 16.0],
        "window_density": 0.50,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "more_glass", "finer_grain", "lab_spaces"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["more_glass", "finer_grain", "maker_lab"]
      },
      "hybrid_office_industrial_bar": {
        "name": "Hybrid Office-Industrial Bar",
        "category": "industrial",
        "subcategory": "light_industrial",
        "allowed_zones": ["industrial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [12.0, 20.0],
        "window_density": 0.60,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "front_office", "rear_production", "hybrid_layout"],
        "material_style": "industrial",
        "color_palette_zone": "Industrial",
        "shader_patterns": ["industrial_utility"],
        "special_features": ["front_office", "rear_production", "hybrid"]
      },
      
      // ============================================
      // AGRICULTURAL BUILDING CLASSES
      // ============================================
      // 
      // Agricultural buildings are organized into 4 subcategories with 12 total building types:
      // 1. Terraced Grow Blocks (3 types) - Stepped and terraced growing surfaces
      // 2. Greenhouse & Biome Halls (3 types) - Enclosed growing environments
      // 3. Vertical Farm Towers (3 types) - Vertical farming structures
      // 4. Processing & Storage (3 types) - Food processing and storage facilities
      //
      // --- Terraced Grow Blocks ---
      "stepped_terrace_farm": {
        "name": "Stepped Terrace Farm",
        "category": "agricultural",
        "subcategory": "terraced_grow",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "stepped_terrace",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.40,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["terraced_levels", "grow_surfaces", "irrigation_systems"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["multiple_plate_levels", "stepped_terraces", "grow_surfaces"]
      },
      "cascade_farm_block": {
        "name": "Cascade Farm Block",
        "category": "agricultural",
        "subcategory": "terraced_grow",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "cascade_ramp",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.40,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["continuous_ramp", "grow_surfaces", "irrigation_systems"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["continuous_ramped_grow_surface", "cascade", "ramped_terraces"]
      },
      "rim_terrace_ring": {
        "name": "Rim Terrace Ring",
        "category": "agricultural",
        "subcategory": "terraced_grow",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "ring_closed",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.40,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["ring_shaped_farm", "central_void", "grow_surfaces", "irrigation_systems"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["ring_shaped_farm_layer", "central_void", "rim_terrace"]
      },
      
      // --- Greenhouse & Biome Halls ---
      "linear_greenhouse_bar": {
        "name": "Linear Greenhouse Bar",
        "category": "agricultural",
        "subcategory": "greenhouse_biome",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [6.0, 12.0],
        "window_density": 0.80,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["sawtooth_or_shed_roof", "greenhouse_glazing", "climate_control"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["sawtooth_or_shed_roof", "linear_greenhouse", "climate_controlled"]
      },
      "dome_barrel_biome_hall": {
        "name": "Dome / Barrel Biome Hall",
        "category": "agricultural",
        "subcategory": "greenhouse_biome",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "dome_or_barrel",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["dome_or_barrel_roof", "biome_environment", "climate_control"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["dome_or_barrel_form", "biome_hall", "climate_controlled"]
      },
      "multi_span_greenhouse_block": {
        "name": "Multi-Span Greenhouse Block",
        "category": "agricultural",
        "subcategory": "greenhouse_biome",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "composite_podium",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.75,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["parallel_spans", "podium_base", "greenhouse_glazing", "climate_control"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["several_parallel_spans", "podium_base", "multi_span"]
      },
      
      // --- Vertical Farm Towers ---
      "stack_farm_tower": {
        "name": "Stack Farm Tower",
        "category": "agricultural",
        "subcategory": "vertical_farm",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [24.0, 48.0],
        "window_density": 0.60,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["identical_grow_floors", "vertical_farming", "climate_control"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["identical_grow_floors", "stack_farm", "vertical_farming"]
      },
      "split_core_vertical_farm": {
        "name": "Split-Core Vertical Farm",
        "category": "agricultural",
        "subcategory": "vertical_farm",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "composite_split_core",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [24.0, 40.0],
        "window_density": 0.60,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["central_cores", "two_wings", "vertical_farming", "climate_control"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["central_cores", "two_wings", "split_core"]
      },
      "hybrid_farm_residential_tower": {
        "name": "Hybrid Farm-Residential Tower",
        "category": "agricultural",
        "subcategory": "vertical_farm",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "composite_podium",
        "size_class": "large",
        "height_range": [32.0, 60.0],
        "window_density": 0.70,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["grow_floors", "housing_floors", "hybrid_layout", "climate_control"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["grow_floors_plus_housing", "hybrid", "mixed_use_tower"]
      },
      
      // --- Processing & Storage ---
      "food_processing_block": {
        "name": "Food Processing Block",
        "category": "agricultural",
        "subcategory": "processing_storage",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.30,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": true,
          "min_per_facade": 1,
          "max_per_facade": 3,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["utility_bands", "processing_equipment", "adjacent_to_grow"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["food_processing", "adjacent_to_grow_area", "processing_facility"]
      },
      "cold_storage_silo_block": {
        "name": "Cold Storage / Silo Block",
        "category": "agricultural",
        "subcategory": "processing_storage",
        "allowed_zones": ["agricultural", "mixed-use"],
        "base_shape": "composite_silo",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit (silos are tall)
        "height_range": [12.0, 24.0],
        "window_density": 0.10,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": true,
          "min_per_facade": 1,
          "max_per_facade": 2,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["silos", "cold_storage", "refrigeration_systems"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["cold_storage", "silos", "refrigeration"]
      },
      "seed_gene_bank_vault_block": {
        "name": "Seed / Gene Bank Vault Block",
        "category": "agricultural",
        "subcategory": "processing_storage",
        "allowed_zones": ["agricultural"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [8.0, 16.0],
        "window_density": 0.05,
        "window_pattern": "industrial_minimal",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 1,
          "pattern": "truck_bay"
        },
        "decorative_elements": ["vault_structure", "secure_storage", "gene_bank"],
        "material_style": "agricultural",
        "color_palette_zone": "Agricultural",
        "shader_patterns": ["agricultural_standard"],
        "special_features": ["seed_gene_bank", "vault", "secure_storage"]
      },
      
      // ============================================
      // PARK BUILDING CLASSES
      // ============================================
      // 
      // Park structures are organized into 4 subcategories with 12 total building types:
      // 1. Plate & Deck Parks (3 types) - Large flat park surfaces
      // 2. Courtyard & Pocket Parks (3 types) - Smaller enclosed or freestanding parks
      // 3. Pavilion & Landmark Structures (3 types) - Structures within parks
      // 4. Sport & Recreation Blocks (3 types) - Recreational facilities
      //
      // --- Plate & Deck Parks ---
      "single_plate_park": {
        "name": "Single Plate Park",
        "category": "park",
        "subcategory": "plate_deck",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [0.0, 2.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["landscaping", "paths", "vegetation", "park_features"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["one_large_flat_deck", "landscaping", "open_space"]
      },
      "tiered_plate_park": {
        "name": "Tiered Plate Park",
        "category": "park",
        "subcategory": "plate_deck",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "stepped_terrace",
        "size_class": "large",
        "height_range": [2.0, 8.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["landscaping", "paths", "vegetation", "ramps_stairs", "tiered_levels"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["two_or_more_levels", "ramps_stairs", "tiered"]
      },
      "edge_park_deck": {
        "name": "Edge Park Deck",
        "category": "park",
        "subcategory": "plate_deck",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [0.0, 2.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["landscaping", "paths", "vegetation", "edge_orientation"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["runs_along_ring_edge", "outer_or_inner_edge", "linear_park"]
      },
      
      // --- Courtyard & Pocket Parks ---
      "enclosed_courtyard_park": {
        "name": "Enclosed Courtyard Park",
        "category": "park",
        "subcategory": "courtyard_pocket",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "ring_closed",
        "size_class": "medium",
        "height_range": [0.0, 2.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["landscaping", "paths", "vegetation", "surrounding_blocks"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["within_surrounding_blocks", "enclosed", "courtyard"]
      },
      "pocket_park_plate": {
        "name": "Pocket Park Plate",
        "category": "park",
        "subcategory": "courtyard_pocket",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "small",
        "height_range": [0.0, 2.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["landscaping", "paths", "vegetation", "small_scale"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["small_freestanding", "green_deck", "pocket_park"]
      },
      "atrium_garden": {
        "name": "Atrium Garden",
        "category": "park",
        "subcategory": "courtyard_pocket",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "ring_closed",
        "size_class": "medium",
        "height_range": [4.0, 16.0],
        "window_density": 0.80,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["landscaping", "paths", "vegetation", "interior_void", "building_enclosure"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["interior_void_garden", "inside_larger_building", "atrium"]
      },
      
      // --- Pavilion & Landmark Structures ---
      "civic_pavilion": {
        "name": "Civic Pavilion",
        "category": "park",
        "subcategory": "pavilion_landmark",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [4.0, 12.0],
        "window_density": 0.50,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["pavilion_structure", "event_space", "gathering_space"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["event_gathering_building", "civic", "pavilion"]
      },
      "observation_platform_sky_garden": {
        "name": "Observation Platform / Sky Garden",
        "category": "park",
        "subcategory": "pavilion_landmark",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "platform",
        "size_class": "medium",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [8.0, 24.0],
        "window_density": 0.30,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["observation_platform", "sky_garden", "elevated_park"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["observation_platform", "sky_garden", "elevated"]
      },
      "cultural_garden_complex": {
        "name": "Cultural Garden Complex",
        "category": "park",
        "subcategory": "pavilion_landmark",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "cluster",
        "size_class": "large",
        "height_range": [4.0, 12.0],
        "window_density": 0.40,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 3, "max": 6},
        "door_pattern": "main_entrance",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["temples_shrines_pavilions", "cluster_layout", "cultural_features"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["small_temples_shrines_pavilions", "cluster", "cultural"]
      },
      
      // --- Sport & Recreation Blocks ---
      "sports_deck": {
        "name": "Sports Deck",
        "category": "park",
        "subcategory": "sport_recreation",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [0.0, 2.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["courts_fields_track", "sports_equipment", "single_plate"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["courts_fields_track", "single_plate", "sports"]
      },
      "aquatic_pool_deck": {
        "name": "Aquatic / Pool Deck",
        "category": "park",
        "subcategory": "sport_recreation",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [0.0, 2.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["pool_aquatic_features", "water_features", "recreation"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["aquatic_pool", "water_features", "recreation"]
      },
      "playground_climbing_garden_block": {
        "name": "Playground / Climbing Garden Block",
        "category": "park",
        "subcategory": "sport_recreation",
        "allowed_zones": ["park", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [2.0, 6.0],
        "window_density": 0.0,
        "window_pattern": "none",
        "door_count": {"min": 0, "max": 0},
        "door_pattern": "none",
        "garage_doors": {
          "required": false,
          "min_per_facade": 0,
          "max_per_facade": 0,
          "pattern": "none"
        },
        "decorative_elements": ["playground_equipment", "climbing_features", "recreation_equipment"],
        "material_style": "park",
        "color_palette_zone": "Parks",
        "shader_patterns": ["park_standard"],
        "special_features": ["playground", "climbing_garden", "recreation"]
      }
      
      // ============================================
      // COMMERCIAL BUILDING CLASSES
      // ============================================
      // 
      // Commercial buildings are organized into 4 subcategories with 14 total building types:
      // 1. Podium & Mall Blocks (4 types) - Large commercial structures with podiums
      // 2. Office & Mixed Office Towers (4 types) - Vertical office structures
      // 3. Strip & Bar Commercial (3 types) - Linear commercial structures
      // 4. Specialty Commercial (3 types) - Specialized commercial facilities
      //
      // --- Podium & Mall Blocks ---
      "podium_mall_atrium": {
        "name": "2–4 Floor Podium Mall",
        "category": "commercial",
        "subcategory": "podium_mall",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [8.0, 16.0],
        "window_density": 0.60,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "atrium_skylight", "mall_interior"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["2_4_floors", "inner_atrium", "mall_layout"]
      },
      "streetfront_retail_podium": {
        "name": "Streetfront Retail Podium",
        "category": "commercial",
        "subcategory": "podium_mall",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.75,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 6, "max": 12},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "streetfront_shops", "office_floors_above"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["shops_at_perimeter", "offices_above", "streetfront_orientation"]
      },
      "market_hall_block": {
        "name": "Market Hall Block",
        "category": "commercial",
        "subcategory": "podium_mall",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "ring_closed",
        "size_class": "large",
        "height_range": [12.0, 16.0],
        "window_density": 0.50,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 8, "max": 16},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "big_span_interior", "perimeter_shops"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["big_span_interior", "thin_ring_perimeter_shops", "market_hall"]
      },
      "transit_hub_podium": {
        "name": "Transit Hub Podium",
        "category": "commercial",
        "subcategory": "podium_mall",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "composite_podium",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.70,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 6, "max": 12},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "transit_core", "commercial_wrap"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["commercial_wrapped_around_station", "transit_core", "podium_structure"]
      },
      
      // --- Office & Mixed Office Towers ---
      "pure_office_tower": {
        "name": "Pure Office Tower",
        "category": "commercial",
        "subcategory": "office_tower",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [40.0, 80.0],
        "window_density": 0.80,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "efficient_core", "repeated_plates"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["efficient_core", "repeated_plates", "pure_office"]
      },
      "headquarter_tower_crown": {
        "name": "Headquarter Tower with Crown",
        "category": "commercial",
        "subcategory": "office_tower",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "composite_crown",
        "size_class": "medium",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [60.0, 100.0],
        "window_density": 0.80,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "distinct_crown", "headquarter_floors"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["distinct_top_floors", "crown_architecture", "headquarter"]
      },
      "multi_tower_campus": {
        "name": "Multi-Tower Campus",
        "category": "commercial",
        "subcategory": "office_tower",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "cluster",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [40.0, 60.0],
        "window_density": 0.75,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "shared_base", "multiple_towers"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["several_medium_towers", "shared_base", "campus_layout"]
      },
      "slim_blade_office_bar": {
        "name": "Slim 'Blade' Office Bar",
        "category": "commercial",
        "subcategory": "office_tower",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "small",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [40.0, 60.0],
        "window_density": 0.80,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 1, "max": 2},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "blade_form", "narrow_footprint"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["long_narrow", "blade_form", "slim_profile"]
      },
      
      // --- Strip & Bar Commercial ---
      "retail_strip_bar": {
        "name": "Retail Strip Bar",
        "category": "commercial",
        "subcategory": "strip_bar",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [8.0, 16.0],
        "window_density": 0.75,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "ground_floor_shops", "low_offices_above"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["ground_floor_shops", "low_offices_above", "strip_layout"]
      },
      "double_sided_arcade_bar": {
        "name": "Double-Sided Arcade Bar",
        "category": "commercial",
        "subcategory": "strip_bar",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "medium",
        "height_range": [8.0, 12.0],
        "window_density": 0.70,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 6, "max": 12},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "shops_both_sides", "covered_walk"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["shops_both_sides", "covered_walk", "arcade"]
      },
      "service_strip": {
        "name": "Service Strip",
        "category": "commercial",
        "subcategory": "strip_bar",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "small",
        "height_range": [4.0, 8.0],
        "window_density": 0.60,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 3, "max": 6},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "small_units", "service_orientation"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["small_units", "repair_food_service", "service_strip"]
      },
      
      // --- Specialty Commercial ---
      "convention_exhibition_hall": {
        "name": "Convention / Exhibition Hall Block",
        "category": "commercial",
        "subcategory": "specialty",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "height_range": [12.0, 20.0],
        "window_density": 0.40,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "large_span", "exhibition_space"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["convention_hall", "exhibition_space", "large_span"]
      },
      "cultural_flagship": {
        "name": "Cultural Flagship",
        "category": "commercial",
        "subcategory": "specialty",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "rectangular",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit (cultural buildings can be tall)
        "height_range": [16.0, 24.0],
        "window_density": 0.50,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 2, "max": 4},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "cultural_volume", "museum_gallery_theatre"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["museum_gallery_theatre", "cultural_volume", "flagship"]
      },
      "tech_innovation_hub_podium": {
        "name": "Tech / Innovation Hub Podium",
        "category": "commercial",
        "subcategory": "specialty",
        "allowed_zones": ["commercial", "mixed-use"],
        "base_shape": "composite_podium",
        "size_class": "large",
        "is_exterior": true,  // Exterior structure - can exceed 20m limit
        "height_range": [20.0, 32.0],
        "window_density": 0.75,
        "window_pattern": "commercial_full_height",
        "door_count": {"min": 4, "max": 8},
        "door_pattern": "main_entrance",
        "decorative_elements": ["cornice", "signage_area", "demo_showroom_base", "offices_above"],
        "material_style": "commercial",
        "color_palette_zone": "Commercial",
        "shader_patterns": ["commercial_standard"],
        "special_features": ["offices_above", "demo_showroom_base", "tech_innovation"]
      }
    },
    "zone_distributions": {
      "residential": {
        // Slab & Bar Blocks (40% total)
        "linear_corridor_block": 0.12,
        "double_loaded_slab": 0.15,
        "perimeter_bar": 0.08,
        "split_bar_pair": 0.05,
        
        // Courtyard & Ring Blocks (25% total)
        "closed_courtyard_block": 0.08,
        "open_u_block": 0.07,
        "double_courtyard_block": 0.05,
        "ring_tower_podium": 0.05,
        
        // Tower & Stack Forms (20% total)
        "point_tower": 0.05,
        "podium_tower": 0.07,
        "twin_towers_skybridge": 0.04,
        "terrace_tower": 0.04,
        
        // Cluster & Village Forms (10% total)
        "clustered_midrises_shared_deck": 0.03,
        "terrace_village": 0.03,
        "stacked_townhouse_cluster": 0.02,
        "radial_spoke_cluster": 0.02,
        
        // Special Residential (5% total)
        "coliving_block": 0.02,
        "luxury_sky_villas": 0.01,
        "student_compact_habitat_stack": 0.01,
        "senior_assisted_living_terrace": 0.01
      },
      "commercial": {
        // Podium & Mall Blocks (35% total)
        "podium_mall_atrium": 0.10,
        "streetfront_retail_podium": 0.12,
        "market_hall_block": 0.08,
        "transit_hub_podium": 0.05,
        
        // Office & Mixed Office Towers (40% total)
        "pure_office_tower": 0.15,
        "headquarter_tower_crown": 0.08,
        "multi_tower_campus": 0.10,
        "slim_blade_office_bar": 0.07,
        
        // Strip & Bar Commercial (20% total)
        "retail_strip_bar": 0.10,
        "double_sided_arcade_bar": 0.06,
        "service_strip": 0.04,
        
        // Specialty Commercial (5% total)
        "convention_exhibition_hall": 0.02,
        "cultural_flagship": 0.02,
        "tech_innovation_hub_podium": 0.01
      },
      "industrial": {
        // Warehouse & Logistics Bars (40% total)
        "standard_warehouse_bar": 0.20,
        "cross_dock_facility": 0.12,
        "vertical_logistics_block": 0.08,
        
        // Plant & Utility Blocks (25% total)
        "energy_plant_block": 0.10,
        "water_recycling_plant": 0.08,
        "data_fabrication_block": 0.07,
        
        // Yard & Platform Structures (15% total)
        "lift_yard_platform": 0.06,
        "container_stack_yard": 0.05,
        "maintenance_deck": 0.04,
        
        // Light-Industrial / Maker Blocks (20% total)
        "small_bay_workshop_row": 0.10,
        "maker_lab_block": 0.06,
        "hybrid_office_industrial_bar": 0.04
      },
      "mixed-use": {
        // ============================================================
        // MIXED-USE ZONES: DYNAMIC RUNTIME DISTRIBUTION
        // ============================================================
        //
        // Mixed-use zones are SPECIAL - they can use ANY building type
        // from ANY category (residential, commercial, industrial, 
        // agricultural, park), with proportions determined DYNAMICALLY
        // at runtime by the game engine.
        //
        // This entry is for DOCUMENTATION ONLY. The actual distribution
        // is calculated during chunk generation based on:
        //   - Nearby zone types (contextual blending)
        //   - Hub needs and requirements  
        //   - Game state and player activity
        //   - Spatial relationships and urban planning logic
        //
        // ALL building types that include "mixed-use" in their
        // allowed_zones array are eligible for generation in mixed-use zones.
        //
        // See "Mixed-Use Zone Runtime Distribution" section in this
        // proposal for detailed implementation guidance.
        //
        // Example reference distribution (NOT USED - for documentation only):
        "_documentation_only": {
          "note": "This is NOT used during generation. Actual distribution is runtime-calculated.",
          "example_residential_proportion": 0.50,
          "example_commercial_proportion": 0.30,
          "example_industrial_proportion": 0.15,
          "example_agricultural_proportion": 0.03,
          "example_park_proportion": 0.02,
          "implementation": "See procedural generation code for actual distribution logic"
        }
      },
      "agricultural": {
        // Terraced Grow Blocks (30% total)
        "stepped_terrace_farm": 0.12,
        "cascade_farm_block": 0.10,
        "rim_terrace_ring": 0.08,
        
        // Greenhouse & Biome Halls (35% total)
        "linear_greenhouse_bar": 0.15,
        "dome_barrel_biome_hall": 0.12,
        "multi_span_greenhouse_block": 0.08,
        
        // Vertical Farm Towers (20% total)
        "stack_farm_tower": 0.10,
        "split_core_vertical_farm": 0.06,
        "hybrid_farm_residential_tower": 0.04,
        
        // Processing & Storage (15% total)
        "food_processing_block": 0.08,
        "cold_storage_silo_block": 0.05,
        "seed_gene_bank_vault_block": 0.02
      },
      "park": {
        // Plate & Deck Parks (35% total)
        "single_plate_park": 0.15,
        "tiered_plate_park": 0.12,
        "edge_park_deck": 0.08,
        
        // Courtyard & Pocket Parks (25% total)
        "enclosed_courtyard_park": 0.10,
        "pocket_park_plate": 0.10,
        "atrium_garden": 0.05,
        
        // Pavilion & Landmark Structures (20% total)
        "civic_pavilion": 0.08,
        "observation_platform_sky_garden": 0.07,
        "cultural_garden_complex": 0.05,
        
        // Sport & Recreation Blocks (20% total)
        "sports_deck": 0.10,
        "aquatic_pool_deck": 0.06,
        "playground_climbing_garden_block": 0.04
      }
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "building_classes": {
        "linear_corridor_block": {
          "decorative_elements": ["balconies", "cornice", "corridor_windows", "kongo_roof_spirals"],
          "shader_patterns": ["residential_standard", "kongo_soft_dot_grid", "kongo_roof_spirals"]
        },
        "double_loaded_slab": {
          "decorative_elements": ["balconies", "cornice", "entry_columns", "kongo_roof_spirals"],
          "shader_patterns": ["residential_standard", "kongo_soft_dot_grid"]
        },
        "perimeter_bar": {
          "decorative_elements": ["balconies", "cornice", "street_facing_facade", "kongo_roof_spirals"],
          "shader_patterns": ["residential_standard", "kongo_soft_dot_grid"]
        },
        "closed_courtyard_block": {
          "decorative_elements": ["balconies", "cornice", "courtyard_access", "kongo_roof_spirals"],
          "shader_patterns": ["residential_standard", "kongo_soft_dot_grid"]
        },
        "point_tower": {
          "decorative_elements": ["balconies", "cornice", "tower_crown", "kongo_roof_spirals"],
          "shader_patterns": ["residential_standard", "kongo_soft_dot_grid"]
        },
        "standard_warehouse_bar": {
          "decorative_elements": ["utility_bands", "kongo_cross_panels"],
          "shader_patterns": ["industrial_utility", "kongo_utility_bands", "kongo_cross_panels"]
        },
        "cross_dock_facility": {
          "decorative_elements": ["utility_bands", "kongo_cross_panels", "cross_dock_access"],
          "shader_patterns": ["industrial_utility", "kongo_utility_bands"]
        },
        "small_bay_workshop_row": {
          "decorative_elements": ["utility_bands", "multi_tenant", "workshop_bays", "kongo_cross_panels"],
          "shader_patterns": ["industrial_utility", "kongo_utility_bands"]
        }
      },
      "zone_distributions": {
        "residential": {
          // PillarOfKongo specific distribution adjustments
          "linear_corridor_block": 0.15,
          "double_loaded_slab": 0.18,
          "closed_courtyard_block": 0.10,
          "open_u_block": 0.08,
          "point_tower": 0.06,
          "podium_tower": 0.08,
          "clustered_midrises_shared_deck": 0.05,
          "terrace_village": 0.05,
          "coliving_block": 0.03,
          "luxury_sky_villas": 0.02,
          "student_compact_habitat_stack": 0.02,
          "senior_assisted_living_terrace": 0.02,
          "perimeter_bar": 0.06,
          "split_bar_pair": 0.04,
          "double_courtyard_block": 0.04,
          "ring_tower_podium": 0.04,
          "twin_towers_skybridge": 0.03,
          "terrace_tower": 0.03,
          "stacked_townhouse_cluster": 0.02,
          "radial_spoke_cluster": 0.02
        }
      }
    },
    "PillarOfKilima": {
      "building_classes": {
        "house": {
          "base_shape": "rectangular",
          "decorative_elements": ["porch", "eaves", "mountain_steel_ribs"],
          "shader_patterns": ["residential_standard", "mountain_steel_ribs"]
        },
        "warehouse": {
          "decorative_elements": ["utility_bands", "mountain_steel_ribs"],
          "shader_patterns": ["industrial_utility", "mountain_steel_ribs"]
        }
      }
    }
    // ... other hubs
  }
}
```

### Building Sizes JSON Reference

```json
{
  "version": "1.0.0",
  "size_classes": {
    "small": {
      "width": {"min": 10.0, "max": 18.0, "distribution": "uniform"},
      "depth": {"min": 10.0, "max": 18.0, "distribution": "uniform"},
      "aspect_ratio_range": [0.7, 1.3],
      "height_multiplier": {"min": 0.4, "max": 0.6}
    },
    "medium": {
      "width": {"min": 20.0, "max": 40.0, "distribution": "normal", "mean": 30.0, "std": 5.0},
      "depth": {"min": 20.0, "max": 40.0, "distribution": "normal", "mean": 30.0, "std": 5.0},
      "aspect_ratio_range": [0.6, 1.4],
      "height_multiplier": {"min": 0.5, "max": 0.7}
    },
    "large": {
      "width": {"min": 40.0, "max": 80.0, "distribution": "uniform"},
      "depth": {"min": 40.0, "max": 80.0, "distribution": "uniform"},
      "aspect_ratio_range": [0.5, 1.5],
      "height_multiplier": {"min": 0.1, "max": 0.3}
    }
  },
  "importance_scaling": {
    "min_scale": 0.7,
    "max_scale": 1.3,
    "curve": "linear"
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "size_classes": {
        "small": {
          "width": {"min": 12.0, "max": 20.0},
          "depth": {"min": 12.0, "max": 20.0}
        }
      }
    }
  }
}
```

### Building Shapes JSON Reference

**Structure Shape Catalog**: 20 flexible shapes for procedural building generation.

```json
{
  "version": "1.0.0",
  "defaults": {
    "shapes": {
      // ============================================
      // BASIC SHAPES
      // ============================================
      
      "rectangular": {
        "name": "Rectangle",
        "description": "Basic solid box footprint (current default). Most common shape.",
        "type": "box",
        "variants": ["square", "wide", "deep"],
        "parameters": {
          "corner_trim": {"min": 0.0, "max": 0.5, "units": "meters"},
          "aspect_ratio": {"min": 0.5, "max": 2.0}  // width/depth ratio
        },
        "default_probability": 0.40,
        "use_cases": ["residential", "commercial", "industrial", "agricultural", "park"]
      },
      
      "bar_slab": {
        "name": "Bar / Slab",
        "description": "Long, narrow rectangle; works great for apartments and logistics.",
        "type": "box",
        "variants": ["single_bar", "twin_parallel_bars"],
        "parameters": {
          "length_ratio": {"min": 2.0, "max": 5.0},  // length/width ratio
          "twin_spacing": {"min": 0.1, "max": 0.3, "relative_to": "width"}  // For twin variant
        },
        "default_probability": 0.15,
        "use_cases": ["residential", "commercial", "industrial"]
      },
      
      "l_shaped": {
        "name": "L-Shape",
        "description": "Two bars joined at the corner, making an L-shaped mass.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "main_width",
            "depth": "main_depth"
          },
          {
            "type": "box",
            "width": "wing_width",
            "depth": "wing_depth",
            "offset": {"x": 0, "y": "main_depth/2"},
            "rotation": 90
          }
        ],
        "parameters": {
          "main_width": {"min": 0.5, "max": 0.8, "relative_to": "base_width"},
          "main_depth": {"min": 0.5, "max": 0.8, "relative_to": "base_depth"},
          "wing_width": {"min": 0.3, "max": 0.6, "relative_to": "base_width"},
          "wing_depth": {"min": 0.3, "max": 0.6, "relative_to": "base_depth"}
        },
        "default_probability": 0.08,
        "use_cases": ["residential", "commercial", "industrial"]
      },
      
      "u_shaped": {
        "name": "U-Shape",
        "description": "U-shaped block forming a semi-enclosed courtyard.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "main_width",
            "depth": "main_depth"
          },
          {
            "type": "box",
            "width": "wing_width",
            "depth": "wing_depth",
            "offset": {"x": "-main_width/2", "y": 0}
          },
          {
            "type": "box",
            "width": "wing_width",
            "depth": "wing_depth",
            "offset": {"x": "main_width/2", "y": 0}
          }
        ],
        "parameters": {
          "main_width": {"min": 0.4, "max": 0.7, "relative_to": "base_width"},
          "main_depth": {"min": 0.5, "max": 0.8, "relative_to": "base_depth"},
          "wing_width": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "wing_depth": {"min": 0.3, "max": 0.5, "relative_to": "base_depth"},
          "courtyard_opening": {"min": 0.2, "max": 0.4, "relative_to": "main_width"}
        },
        "default_probability": 0.05,
        "use_cases": ["residential", "commercial"]
      },
      
      "courtyard_ring": {
        "name": "Courtyard / Ring Block",
        "description": "Rectangular ring with an open void in the center.",
        "type": "composite",
        "variants": ["square_ring", "rectangular_ring"],
        "components": [
          {
            "type": "ring",
            "outer_width": "base_width",
            "outer_depth": "base_depth",
            "inner_width": "inner_width",
            "inner_depth": "inner_depth"
          }
        ],
        "parameters": {
          "inner_width": {"min": 0.3, "max": 0.6, "relative_to": "base_width"},
          "inner_depth": {"min": 0.3, "max": 0.6, "relative_to": "base_depth"},
          "wall_thickness": {"min": 0.1, "max": 0.2, "relative_to": "base_width"}
        },
        "default_probability": 0.04,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "donut_full_ring": {
        "name": "Donut / Full Ring",
        "description": "Perfect torus-like footprint if you want a full interior courtyard all the way around.",
        "type": "ring",
        "parameters": {
          "outer_radius": {"min": 0.4, "max": 0.5, "relative_to": "min(base_width, base_depth)"},
          "inner_radius": {"min": 0.2, "max": 0.4, "relative_to": "outer_radius"},
          "segments": 32
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "cluster": {
        "name": "Cluster (3–7 pods)",
        "description": "Multiple smaller chunks arranged around shared decks.",
        "type": "composite",
        "variants": ["triangle_cluster", "cross_cluster", "radial_cluster"],
        "parameters": {
          "pod_count": {"min": 3, "max": 7},
          "pod_size_ratio": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "cluster_spacing": {"min": 0.1, "max": 0.3, "relative_to": "base_width"},
          "shared_deck_size": {"min": 0.3, "max": 0.5, "relative_to": "base_width"}
        },
        "default_probability": 0.03,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "tower_point": {
        "name": "Tower (Point Tower)",
        "description": "Small footprint, tall height.",
        "type": "box",
        "parameters": {
          "footprint_ratio": {"min": 0.3, "max": 0.6, "relative_to": "base_width"},
          "aspect_ratio": {"min": 0.8, "max": 1.2}  // Nearly square
        },
        "default_probability": 0.02,
        "use_cases": ["residential", "commercial"]
      },
      
      "podium_tower": {
        "name": "Podium + Tower",
        "description": "Wide base with one or more towers rising from it.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "podium_width",
            "depth": "podium_depth",
            "height": "podium_height"
          },
          {
            "type": "box",
            "width": "tower_width",
            "depth": "tower_depth",
            "height": "tower_height",
            "offset": {"x": 0, "y": 0, "z": "podium_height"}
          }
        ],
        "parameters": {
          "podium_width": {"min": 0.7, "max": 1.0, "relative_to": "base_width"},
          "podium_depth": {"min": 0.7, "max": 1.0, "relative_to": "base_depth"},
          "podium_height_ratio": {"min": 0.2, "max": 0.4, "relative_to": "total_height"},
          "tower_width": {"min": 0.3, "max": 0.6, "relative_to": "podium_width"},
          "tower_depth": {"min": 0.3, "max": 0.6, "relative_to": "podium_depth"},
          "tower_count": {"min": 1, "max": 3}
        },
        "default_probability": 0.03,
        "use_cases": ["residential", "commercial"]
      },
      
      "stepped_terraced": {
        "name": "Stepped / Terraced Block",
        "description": "Each higher section steps back.",
        "type": "composite",
        "variants": ["1_terrace", "2_terraces", "3_terraces"],
        "parameters": {
          "terrace_count": {"min": 1, "max": 3},
          "step_back_ratio": {"min": 0.1, "max": 0.2, "relative_to": "base_width"},
          "terrace_height_ratio": {"min": 0.25, "max": 0.4, "relative_to": "total_height"}
        },
        "default_probability": 0.02,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "zigzag_bar": {
        "name": "Zigzag Bar",
        "description": "Bar with alternating angles in plan; visually dynamic.",
        "type": "composite",
        "parameters": {
          "segment_count": {"min": 3, "max": 7},
          "segment_length": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "angle_variation": {"min": 15, "max": 45, "units": "degrees"}
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial"]
      },
      
      "y_shaped": {
        "name": "Y-Shape",
        "description": "Three wings radiating from a central core.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "core_width",
            "depth": "core_depth"
          },
          {
            "type": "box",
            "width": "wing_width",
            "depth": "wing_length",
            "offset": {"x": 0, "y": "core_depth/2 + wing_length/2"},
            "rotation": 0
          },
          {
            "type": "box",
            "width": "wing_width",
            "depth": "wing_length",
            "offset": {"x": "wing_length * 0.866", "y": "-wing_length * 0.5"},
            "rotation": 120
          },
          {
            "type": "box",
            "width": "wing_width",
            "depth": "wing_length",
            "offset": {"x": "-wing_length * 0.866", "y": "-wing_length * 0.5"},
            "rotation": 240
          }
        ],
        "parameters": {
          "core_width": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "core_depth": {"min": 0.2, "max": 0.4, "relative_to": "base_depth"},
          "wing_width": {"min": 0.15, "max": 0.3, "relative_to": "base_width"},
          "wing_length": {"min": 0.3, "max": 0.5, "relative_to": "base_width"}
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial"]
      },
      
      "t_shaped": {
        "name": "T-Shape",
        "description": "Bar intersects another bar at the midpoint.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "horizontal_width",
            "depth": "horizontal_depth"
          },
          {
            "type": "box",
            "width": "vertical_width",
            "depth": "vertical_depth",
            "offset": {"x": 0, "y": 0},
            "rotation": 90
          }
        ],
        "parameters": {
          "horizontal_width": {"min": 0.6, "max": 0.9, "relative_to": "base_width"},
          "horizontal_depth": {"min": 0.3, "max": 0.5, "relative_to": "base_depth"},
          "vertical_width": {"min": 0.3, "max": 0.5, "relative_to": "base_width"},
          "vertical_depth": {"min": 0.4, "max": 0.7, "relative_to": "base_depth"}
        },
        "default_probability": 0.02,
        "use_cases": ["residential", "commercial"]
      },
      
      "h_shaped": {
        "name": "H-Shape",
        "description": "Two bars connected by a crossbar.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "left_bar_width",
            "depth": "left_bar_depth",
            "offset": {"x": "-crossbar_width/2 - left_bar_width/2", "y": 0}
          },
          {
            "type": "box",
            "width": "right_bar_width",
            "depth": "right_bar_depth",
            "offset": {"x": "crossbar_width/2 + right_bar_width/2", "y": 0}
          },
          {
            "type": "box",
            "width": "crossbar_width",
            "depth": "crossbar_depth",
            "offset": {"x": 0, "y": 0}
          }
        ],
        "parameters": {
          "left_bar_width": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "left_bar_depth": {"min": 0.4, "max": 0.7, "relative_to": "base_depth"},
          "right_bar_width": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "right_bar_depth": {"min": 0.4, "max": 0.7, "relative_to": "base_depth"},
          "crossbar_width": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "crossbar_depth": {"min": 0.2, "max": 0.3, "relative_to": "base_depth"}
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial"]
      },
      
      "crescent_arc": {
        "name": "Crescent / Arc Block",
        "description": "Gentle curve in plan; good for waterfront- or ring-facing structures.",
        "type": "curved",
        "parameters": {
          "arc_angle": {"min": 30, "max": 180, "units": "degrees"},
          "inner_radius": {"min": 0.3, "max": 0.6, "relative_to": "base_width"},
          "outer_radius": {"min": 0.5, "max": 0.9, "relative_to": "base_width"},
          "segments": 16
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "hexagonal": {
        "name": "Hexagonal Footprint",
        "description": "Flat-sided polygon; rare, visually distinct.",
        "type": "polygon",
        "parameters": {
          "radius": {"min": 0.4, "max": 0.6, "relative_to": "min(base_width, base_depth)"},
          "sides": 6,
          "rotation": {"min": 0, "max": 30, "units": "degrees"}
        },
        "default_probability": 0.005,
        "use_cases": ["commercial", "park"]
      },
      
      "circular_oval": {
        "name": "Circular / Oval Footprint",
        "description": "Soft volume for special civic or park buildings.",
        "type": "ellipse",
        "variants": ["circle", "oval"],
        "parameters": {
          "radius_x": {"min": 0.4, "max": 0.5, "relative_to": "base_width"},
          "radius_y": {"min": 0.4, "max": 0.5, "relative_to": "base_depth"},
          "segments": 32
        },
        "default_probability": 0.01,
        "use_cases": ["commercial", "park"]
      },
      
      "fan_wedge": {
        "name": "Fan / Wedge Footprint",
        "description": "Tapers from narrow to wide; good near curves or edges.",
        "type": "trapezoid",
        "parameters": {
          "narrow_width": {"min": 0.2, "max": 0.4, "relative_to": "base_width"},
          "wide_width": {"min": 0.6, "max": 1.0, "relative_to": "base_width"},
          "depth": {"min": 0.5, "max": 0.8, "relative_to": "base_depth"},
          "taper_angle": {"min": 10, "max": 45, "units": "degrees"}
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "mega_plate": {
        "name": "Mega-Plate (Low Block)",
        "description": "Very short, very broad 'plate' building for parks, agriculture, recreation.",
        "type": "box",
        "parameters": {
          "width_multiplier": {"min": 1.5, "max": 3.0},
          "depth_multiplier": {"min": 1.5, "max": 3.0},
          "height_ratio": {"min": 0.05, "max": 0.15, "relative_to": "base_height"}
        },
        "default_probability": 0.02,
        "use_cases": ["park", "agricultural", "recreation"]
      },
      
      "atrium_spine": {
        "name": "Atrium Spine Block",
        "description": "Rectangular mass with long hollow spine running through center.",
        "type": "composite",
        "components": [
          {
            "type": "box",
            "width": "outer_width",
            "depth": "outer_depth"
          },
          {
            "type": "void",
            "width": "spine_width",
            "depth": "spine_depth",
            "offset": {"x": 0, "y": 0}
          }
        ],
        "parameters": {
          "outer_width": {"min": 0.8, "max": 1.0, "relative_to": "base_width"},
          "outer_depth": {"min": 0.8, "max": 1.0, "relative_to": "base_depth"},
          "spine_width": {"min": 0.1, "max": 0.3, "relative_to": "outer_width"},
          "spine_depth": {"min": 0.6, "max": 0.9, "relative_to": "outer_depth"}
        },
        "default_probability": 0.01,
        "use_cases": ["residential", "commercial"]
      }
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "shapes": {
        "rectangular": {
          "probability": 0.35
        },
        "bar_slab": {
          "probability": 0.20
        },
        "courtyard_ring": {
          "probability": 0.10
        },
        "cluster": {
          "probability": 0.08
        }
      }
    }
  }
}
```

---

## Shape → Building Type Compatibility Matrix

**Curated mapping for procedural generation engine** - Below is a curated mapping your procedural engine can directly use:

| Shape | Compatible Zone Types | Notes |
|-------|----------------------|-------|
| **1. Rectangle** | R, C, I, A, P | → Universally valid. |
| **2. Bar / Slab** | R, C, I, A | → Apartments, offices, warehousing, greenhouses. |
| **3. L-Shape** | R, C, A | → Courtyard housing, corner retail, grow terraces. |
| **4. U-Shape** | R, C | → Residential courts, open shopping courts. |
| **5. Courtyard / Ring Block** | R, C, A | → Housing blocks, malls, ring farms. |
| **6. Donut / Full Ring** | R, C, A | → Circular farms, luxury housing, cultural/commercial hubs. |
| **7. Cluster (Pods)** | R, C, P | → Community housing clusters, innovation parks, pavilion groups. |
| **8. Tower / Point Tower** | R, C | → Residential towers, HQ towers. |
| **9. Podium + Tower** | R, C, Mixed | → Retail at base, offices or apartments above. |
| **10. Stepped / Terraced Block** | R, A | → Terraced farms, stepped apartments, sunlight-maximizing housing. |
| **11. Zigzag Bar** | R, C | → Stylish apartments or commercial strips. |
| **12. Y-Shape** | R, C | → Efficiency for daylight and views; corporate or high-rise living. |
| **13. T-Shape** | R, C, I | → Mixed bars, small campuses, compact light industry. |
| **14. H-Shape** | R, C | → Multi-wing apartments, office campuses. |
| **15. Crescent / Arc Block** | R, C, P | → Waterfront/edge-view apartments, ring-facing malls, arc parks. |
| **16. Hexagonal Block** | C, P | → Civic centers, destination markets, pavilions. |
| **17. Circular / Oval Block** | C, P | → Museums, theaters, garden domes, botanical halls. |
| **18. Fan / Wedge Block** | R, C | → Buildings hugging curvature of ring or parks. |
| **19. Mega-Plate (Low Block)** | A, P, I | → Agriculture plates, sports decks, logistics decks. |
| **20. Atrium Spine Block** | C, R | → Office campuses, malls, gallery spaces with central daylight spine. |

**Legend**: R = Residential, C = Commercial, I = Industrial, A = Agricultural, P = Park, Mixed = Mixed-Use

**Implementation Notes**:
- When generating a building, the engine checks the building class's `category` (residential, commercial, industrial, agricultural, park) against this compatibility matrix
- Only shapes marked as compatible with the building's category are eligible for selection
- For mixed-use zones, all shapes compatible with any of the constituent categories (R, C, I, A, P) are eligible
- The `base_shape` field in building classes should reference shapes that are compatible with the building's category
- Hub overrides can further restrict or expand shape availability per hub
- Shape selection probabilities can be adjusted per hub while maintaining compatibility constraints

---

---

**Shape Name Mapping**: The following mapping connects existing building class shape references to the new shape catalog:

| Building Class Reference | New Shape Name | Notes |
|-------------------------|----------------|-------|
| `rectangular` | `rectangular` | Direct match |
| `composite_parallel` | `bar_slab` (twin_parallel_bars variant) | Twin parallel bars |
| `ring_closed` | `courtyard_ring` | Rectangular ring with inner void |
| `composite_podium` | `podium_tower` | Podium base with tower(s) |
| `composite_twin` | `cluster` (variant) or custom | Twin towers structure |
| `composite_courtyard` | `u_shaped` or `courtyard_ring` | Multiple structures forming courtyards |
| `stepped_tower` | `stepped_terraced` | Tower with stepped-back levels |
| `cluster` | `cluster` | Direct match |
| `radial_spoke` | `y_shaped` or `cluster` (radial_cluster variant) | Central core with radiating wings |
| `terrace_block` | `stepped_terraced` | Terraced/stepped structure |
| `stepped_terrace` | `stepped_terraced` | Direct match |
| `cascade_ramp` | `stepped_terraced` (variant) | Continuous ramped surface |
| `dome_or_barrel` | `circular_oval` or `crescent_arc` | Curved structures |
| `composite_plant` | `rectangular` or `cluster` | Industrial plant structures |
| `composite_silo` | `tower_point` or `circular_oval` | Silo structures |
| `composite_split_core` | `h_shaped` or `cluster` | Split core structures |
| `platform` | `mega_plate` | Low, broad platforms |
| `composite_crown` | `podium_tower` (variant) | Podium with distinctive top |

**Implementation Notes**:
- Shapes are selected based on building class `base_shape` field
- Hub overrides can adjust shape probabilities per hub
- Composite shapes are built from multiple components
- Parameters are relative to base dimensions from `building-sizes.json`
- Shape variants allow for visual variety within the same shape type

### Color Palettes JSON Reference

```json
{
  "version": "1.0.0",
  "defaults": {
    "Residential": {
      "foundation": {"name": "default foundation", "hex": "#8A5D3B"},
      "walls": {"name": "default walls", "hex": "#C46A3F"},
      "roofs": {"name": "default roofs", "hex": "#D9B451"},
      "windows_doors": {"name": "default windows", "hex": "#E7E0CE"},
      "trim": {"name": "default trim", "hex": "#4B2E1A"}
    },
    "Commercial": {
      "foundation": {"name": "default foundation", "hex": "#A38C6D"},
      "walls": {"name": "default walls", "hex": "#F0E4C0"},
      "roofs": {"name": "default roofs", "hex": "#FFF9E7"},
      "windows_doors": {"name": "default windows", "hex": "#D8C06A"},
      "trim": {"name": "default trim", "hex": "#1F4E32"}
    },
    "Industrial": {
      "foundation": {"name": "default foundation", "hex": "#1A1A1C"},
      "walls": {"name": "default walls", "hex": "#5A3E2B"},
      "roofs": {"name": "default roofs", "hex": "#2E2E30"},
      "windows_doors": {"name": "default windows", "hex": "#3A6C9E"},
      "trim": {"name": "default trim", "hex": "#D4A42A"}
    },
    "Agricultural": {
      "foundation": {"name": "default foundation", "hex": "#5C3A22"},
      "walls": {"name": "default walls", "hex": "#7C8B52"},
      "roofs": {"name": "default roofs", "hex": "#6B7A42"},
      "windows_doors": {"name": "default windows", "hex": "#8A9B62"},
      "trim": {"name": "default trim", "hex": "#4A5A32"}
    },
    "Parks": {
      "foundation": {"name": "default foundation", "hex": "#4A3020"},
      "walls": {"name": "default walls", "hex": "#3C6E3B"},
      "roofs": {"name": "default roofs", "hex": "#2E5A28"},
      "windows_doors": {"name": "default windows", "hex": "#D98F3A"},
      "trim": {"name": "default trim", "hex": "#E4C873"}
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "Residential": {
        "foundation": {"name": "soft clay brown", "hex": "#8A5D3B"},
        "walls": {"name": "warm terracotta", "hex": "#C46A3F"},
        "roofs": {"name": "matte gold", "hex": "#D9B451"},
        "windows_doors": {"name": "warm-clear glass", "hex": "#E7E0CE"},
        "trim": {"name": "dark wood", "hex": "#4B2E1A"}
      },
      "Commercial": {
        "foundation": {"name": "warm stone", "hex": "#A38C6D"},
        "walls": {"name": "sun-ivory", "hex": "#F0E4C0"},
        "roofs": {"name": "goldleaf white", "hex": "#FFF9E7"},
        "windows_doors": {"name": "clear-gold glass", "hex": "#D8C06A"},
        "trim": {"name": "deep green", "hex": "#1F4E32"}
      },
      "Industrial": {
        "foundation": {"name": "basalt black", "hex": "#1A1A1C"},
        "walls": {"name": "bronze oxide", "hex": "#5A3E2B"},
        "roofs": {"name": "charcoal metal", "hex": "#2E2E30"},
        "windows_doors": {"name": "blue-tinted glass", "hex": "#3A6C9E"},
        "trim": {"name": "gold linework", "hex": "#D4A42A"}
      },
      "Agricultural": {
        "foundation": {"name": "peat brown", "hex": "#5C3A22"},
        "walls": {"name": "soft olive", "hex": "#7C8B52"},
        "roofs": {"name": "harvest gold", "hex": "#8B7A42"},
        "windows_doors": {"name": "amber glass", "hex": "#D98F3A"},
        "trim": {"name": "pale gold", "hex": "#E4C873"}
      },
      "Parks": {
        "foundation": {"name": "dark soil", "hex": "#4A3020"},
        "walls": {"name": "vine green", "hex": "#3C6E3B"},
        "roofs": {"name": "canopy green", "hex": "#2E5A28"},
        "windows_doors": {"name": "amber-tinted glass", "hex": "#D98F3A"},
        "trim": {"name": "pale gold", "hex": "#E4C873"}
      }
    }
    // ... other hubs (migrated from hub-color-palettes.json)
  }
}
```

### Shader Patterns JSON Reference

```json
{
  "version": "1.0.0",
  "defaults": {
    "patterns": {
      "horizontal_bands": {
        "type": "procedural",
        "shader": "band_pattern",
        "parameters": {
          "band_width": 0.5,
          "band_spacing": 1.0,
          "thickness": 0.04
        },
        "placement": ["foundation", "roofline", "mid_level"],
        "complexity": 0.3
      },
      "circle_cross_grid": {
        "type": "procedural",
        "shader": "grid_pattern",
        "parameters": {
          "scale": 10.0,
          "thickness": 0.02,
          "pattern": "circle_cross"
        },
        "placement": ["panel", "spandrel"],
        "complexity": 0.6
      },
      "dot_grid": {
        "type": "procedural",
        "shader": "grid_pattern",
        "parameters": {
          "scale": 16.0,
          "thickness": 0.01,
          "pattern": "dots"
        },
        "placement": ["wall_field"],
        "complexity": 0.3
      },
      "spiral_band": {
        "type": "procedural",
        "shader": "spiral_pattern",
        "parameters": {
          "scale": 5.0,
          "thickness": 0.015,
          "spirals": 3
        },
        "placement": ["roof_eave"],
        "complexity": 0.5
      }
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "patterns": {
        "kongo_utility_bands": {
          "base_pattern": "horizontal_bands",
          "parameters": {
            "band_width": 0.6,
            "band_spacing": 1.2,
            "thickness": 0.04,
            "default_scale": 6.0
          },
          "preferred_placements": ["foundation", "roofline"],
          "complexity": 0.3
        },
        "kongo_cross_panels": {
          "base_pattern": "circle_cross_grid",
          "parameters": {
            "scale": 10.0,
            "thickness": 0.02,
            "default_scale": 10.0
          },
          "preferred_placements": ["panel", "spandrel"],
          "complexity": 0.6
        },
        "kongo_sunpath_frieze": {
          "base_pattern": "sun_disc_band",
          "parameters": {
            "scale": 8.0,
            "thickness": 0.025,
            "default_scale": 8.0
          },
          "preferred_placements": ["frieze", "cornice"],
          "complexity": 0.7
        },
        "kongo_soft_dot_grid": {
          "base_pattern": "dot_grid",
          "parameters": {
            "scale": 16.0,
            "thickness": 0.01,
            "default_scale": 16.0
          },
          "preferred_placements": ["wall_field"],
          "complexity": 0.3
        },
        "kongo_roof_spirals": {
          "base_pattern": "spiral_band",
          "parameters": {
            "scale": 5.0,
            "thickness": 0.015,
            "default_scale": 5.0
          },
          "preferred_placements": ["roof_eave"],
          "complexity": 0.5
        }
      },
      "zone_patterns": {
        "Industrial": ["kongo_utility_bands", "kongo_cross_panels"],
        "Commercial": ["kongo_sunpath_frieze", "kongo_cosmogram_tiles"],
        "Residential": ["kongo_soft_dot_grid", "kongo_roof_spirals"],
        "Parks": ["kongo_path_rings"],
        "Agricultural": ["kongo_field_bands"]
      }
    }
    // ... other hubs (migrated from pillar-motifs.json)
  }
}
```

### Decorative Elements JSON Reference

```json
{
  "version": "1.0.0",
  "defaults": {
    "elements": {
      "cornice": {
        "type": "geometry",
        "placement": "roofline",
        "geometry": {
          "type": "extrusion",
          "profile": "rectangular",
          "width": "building_width + 0.5",
          "depth": "building_depth + 0.5",
          "height": 0.3,
          "offset": {"z": "building_height / 2"}
        },
        "material": {
          "use_trim_color": true
        },
        "probability": 0.6
      },
      "balconies": {
        "type": "geometry",
        "placement": "facade",
        "per_floor": true,
        "geometry": {
          "type": "box",
          "width": 2.0,
          "depth": 1.0,
          "height": 0.2
        },
        "spacing": {"min": 3.0, "max": 5.0},
        "probability": 0.4
      },
      "entry_columns": {
        "type": "geometry",
        "placement": "entrance",
        "count": 2,
        "geometry": {
          "type": "cylinder",
          "radius": 0.3,
          "height": 3.0
        },
        "spacing": 2.0,
        "probability": 0.3
      },
      "porch": {
        "type": "geometry",
        "placement": "foundation",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": "building_width + 2",
              "depth": 2.0,
              "height": 0.2
            },
            {
              "type": "box",
              "width": "building_width + 2",
              "depth": 0.1,
              "height": 1.0,
              "offset": {"z": 0.1}
            }
          ]
        },
        "probability": 0.5
      },
      "eaves": {
        "type": "geometry",
        "placement": "roofline",
        "geometry": {
          "type": "box",
          "width": "building_width + 1.0",
          "depth": "building_depth + 1.0",
          "height": 0.15,
          "offset": {"z": "building_height / 2 + 0.075"}
        },
        "material": {
          "use_roof_color": true
        },
        "probability": 0.7
      },
      "utility_bands": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "box",
          "width": "building_width",
          "depth": 0.1,
          "height": 0.3
        },
        "spacing": {"min": 2.0, "max": 4.0},
        "probability": 0.8
      },
      
      // ============================================
      // ENTRANCE & ACCESS ELEMENTS
      // ============================================
      
      "steps": {
        "type": "geometry",
        "placement": "entrance",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 2.0,
              "depth": 0.3,
              "height": 0.15,
              "offset": {"x": 0, "y": 0, "z": 0}
            },
            {
              "type": "box",
              "width": 2.0,
              "depth": 0.3,
              "height": 0.15,
              "offset": {"x": 0, "y": 0, "z": 0.3}
            },
            {
              "type": "box",
              "width": 2.0,
              "depth": 0.3,
              "height": 0.15,
              "offset": {"x": 0, "y": 0, "z": 0.6}
            }
          ]
        },
        "count": {"min": 2, "max": 5},
        "probability": 0.7,
        "use_cases": ["residential", "commercial"]
      },
      
      "stair_rail": {
        "type": "geometry",
        "placement": "stairs",
        "geometry": {
          "type": "box",
          "width": 0.05,
          "depth": 0.05,
          "height": 1.0
        },
        "spacing": {"min": 0.3, "max": 0.4},
        "count": {"min": 2, "max": 4},
        "probability": 0.5,
        "use_cases": ["residential", "commercial"]
      },
      
      "balcony_rail": {
        "type": "geometry",
        "placement": "balcony",
        "geometry": {
          "type": "box",
          "width": "balcony_width",
          "depth": 0.05,
          "height": 0.8
        },
        "offset": {"z": 0.1},
        "probability": 0.9,
        "use_cases": ["residential", "commercial"]
      },
      
      "deck_rail": {
        "type": "geometry",
        "placement": "deck",
        "geometry": {
          "type": "box",
          "width": "deck_width",
          "depth": 0.05,
          "height": 0.9
        },
        "probability": 0.8,
        "use_cases": ["residential", "park"]
      },
      
      "awning": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "box",
          "width": 2.5,
          "depth": 1.2,
          "height": 0.1
        },
        "offset": {"y": 2.5, "z": 0.6},
        "spacing": {"min": 3.0, "max": 5.0},
        "probability": 0.4,
        "use_cases": ["commercial", "residential"]
      },
      
      "canopy": {
        "type": "geometry",
        "placement": "entrance",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 3.0,
              "depth": 2.5,
              "height": 0.15,
              "offset": {"y": 2.8, "z": 0}
            },
            {
              "type": "box",
              "width": 0.2,
              "depth": 0.2,
              "height": 2.8,
              "offset": {"x": -1.3, "y": 1.4, "z": 0}
            },
            {
              "type": "box",
              "width": 0.2,
              "depth": 0.2,
              "height": 2.8,
              "offset": {"x": 1.3, "y": 1.4, "z": 0}
            }
          ]
        },
        "probability": 0.3,
        "use_cases": ["commercial", "residential"]
      },
      
      // ============================================
      // WINDOW & DOOR DETAILS
      // ============================================
      
      "window_sill": {
        "type": "geometry",
        "placement": "window",
        "geometry": {
          "type": "box",
          "width": 1.2,
          "depth": 0.15,
          "height": 0.05
        },
        "offset": {"z": 0.6},
        "probability": 0.6,
        "use_cases": ["residential", "commercial"]
      },
      
      "window_frame_3d": {
        "type": "geometry",
        "placement": "window",
        "geometry": {
          "type": "box",
          "width": 1.0,
          "depth": 0.08,
          "height": 1.5
        },
        "probability": 0.3,
        "use_cases": ["residential", "commercial"]
      },
      
      "door_frame_3d": {
        "type": "geometry",
        "placement": "entrance",
        "geometry": {
          "type": "box",
          "width": 1.2,
          "depth": 0.1,
          "height": 2.5
        },
        "probability": 0.5,
        "use_cases": ["residential", "commercial"]
      },
      
      // ============================================
      // ROOF & EXTERIOR DETAILS
      // ============================================
      
      "gutter": {
        "type": "geometry",
        "placement": "roofline",
        "geometry": {
          "type": "box",
          "width": "building_width + 0.5",
          "depth": 0.1,
          "height": 0.08
        },
        "offset": {"z": "building_height / 2 + 0.05"},
        "probability": 0.6,
        "use_cases": ["residential", "commercial"]
      },
      
      "downspout": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "cylinder",
          "radius": 0.05,
          "height": "building_height"
        },
        "count": {"min": 2, "max": 4},
        "spacing": {"min": 5.0, "max": 10.0},
        "probability": 0.5,
        "use_cases": ["residential", "commercial"]
      },
      
      "chimney": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "box",
          "width": 0.4,
          "depth": 0.4,
          "height": 1.5
        },
        "offset": {"y": "building_height / 2 + 0.75"},
        "count": {"min": 1, "max": 2},
        "probability": 0.2,
        "use_cases": ["residential"]
      },
      
      "skylight": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "box",
          "width": 1.5,
          "depth": 1.5,
          "height": 0.1
        },
        "offset": {"y": "building_height / 2 + 0.05"},
        "count": {"min": 1, "max": 4},
        "probability": 0.3,
        "use_cases": ["commercial", "industrial"]
      },
      
      "solar_panels": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "box",
          "width": 2.0,
          "depth": 1.0,
          "height": 0.05
        },
        "offset": {"y": "building_height / 2 + 0.025"},
        "count": {"min": 2, "max": 8},
        "spacing": {"min": 0.5, "max": 1.0},
        "probability": 0.4,
        "use_cases": ["residential", "commercial", "industrial"]
      },
      
      "green_roof": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "box",
          "width": "building_width * 0.8",
          "depth": "building_depth * 0.8",
          "height": 0.2
        },
        "offset": {"y": "building_height / 2 + 0.1"},
        "probability": 0.2,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      // ============================================
      // TRIM & DETAIL BANDS
      // ============================================
      
      "trim_band": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "box",
          "width": "building_width",
          "depth": 0.15,
          "height": 0.2
        },
        "spacing": {"min": 2.5, "max": 4.0},
        "per_floor": true,
        "probability": 0.5,
        "use_cases": ["residential", "commercial"]
      },
      
      "corner_trim": {
        "type": "geometry",
        "placement": "corner",
        "geometry": {
          "type": "box",
          "width": 0.3,
          "depth": 0.3,
          "height": "building_height"
        },
        "count": 4,
        "probability": 0.7,
        "use_cases": ["residential", "commercial"]
      },
      
      "foundation_band": {
        "type": "geometry",
        "placement": "foundation",
        "geometry": {
          "type": "box",
          "width": "building_width + 0.2",
          "depth": "building_depth + 0.2",
          "height": 0.3
        },
        "offset": {"y": -0.15},
        "probability": 0.8,
        "use_cases": ["residential", "commercial", "industrial"]
      },
      
      // ============================================
      // COMMERCIAL ELEMENTS
      // ============================================
      
      "signage_area": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "box",
          "width": 3.0,
          "depth": 0.1,
          "height": 1.5
        },
        "offset": {"y": 3.0, "z": 0.05},
        "count": {"min": 1, "max": 3},
        "probability": 0.6,
        "use_cases": ["commercial"]
      },
      
      "lighting_fixture": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "sphere",
          "radius": 0.15
        },
        "offset": {"y": 2.5, "z": 0.1},
        "spacing": {"min": 4.0, "max": 6.0},
        "count": {"min": 2, "max": 6},
        "probability": 0.5,
        "use_cases": ["commercial", "residential"]
      },
      
      // ============================================
      // INDUSTRIAL ELEMENTS
      // ============================================
      
      "vent_stack": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "cylinder",
          "radius": 0.3,
          "height": 2.0
        },
        "offset": {"y": "building_height / 2 + 1.0"},
        "count": {"min": 1, "max": 4},
        "probability": 0.7,
        "use_cases": ["industrial", "agricultural"]
      },
      
      "cooling_tower": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "cylinder",
          "radius": 1.0,
          "height": 2.5
        },
        "offset": {"y": "building_height / 2 + 1.25"},
        "count": {"min": 1, "max": 2},
        "probability": 0.3,
        "use_cases": ["industrial"]
      },
      // Implementation (current build):
      // - Cooling towers are ground-based, behind the parent building (y negative),
      //   size 8m x 8m x 12m, tapered with a stripe near the top, spaced deterministically
      //   (>=10m) to prevent overlaps.
      // - Reactor turbine hall is attached to the right facade at ground, Quonset-style half-cylinder roof.
      // - Loading docks and roof HVAC are instanced per building to minimize draw calls; utility bands are shader-driven.
      
      "piping": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "cylinder",
          "radius": 0.1,
          "height": "building_height * 0.8"
        },
        "count": {"min": 2, "max": 6},
        "spacing": {"min": 2.0, "max": 4.0},
        "probability": 0.5,
        "use_cases": ["industrial", "agricultural"]
      },
      
      "loading_dock": {
        "type": "geometry",
        "placement": "foundation",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 3.0,
              "depth": 2.0,
              "height": 0.2
            },
            {
              "type": "box",
              "width": 3.0,
              "depth": 0.1,
              "height": 1.2,
              "offset": {"z": 1.0}
            }
          ]
        },
        "count": {"min": 1, "max": 4},
        "spacing": {"min": 5.0, "max": 8.0},
        "probability": 0.6,
        "use_cases": ["industrial", "commercial"]
      },
      
      "dock_leveler": {
        "type": "geometry",
        "placement": "loading_dock",
        "geometry": {
          "type": "box",
          "width": 2.5,
          "depth": 0.05,
          "height": 0.15
        },
        "offset": {"y": 0.1, "z": 1.0},
        "probability": 0.8,
        "use_cases": ["industrial"]
      },
      
      // ============================================
      // RESIDENTIAL SPECIAL FEATURES
      // ============================================
      
      "fire_escape": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 1.2,
              "depth": 0.8,
              "height": 0.1,
              "offset": {"y": 4.0}
            },
            {
              "type": "box",
              "width": 0.05,
              "depth": 0.05,
              "height": 4.0,
              "offset": {"x": 0.575, "y": 2.0}
            },
            {
              "type": "box",
              "width": 0.05,
              "depth": 0.05,
              "height": 4.0,
              "offset": {"x": -0.575, "y": 2.0}
            }
          ]
        },
        "per_floor": true,
        "probability": 0.2,
        "use_cases": ["residential"]
      },
      
      "mailbox": {
        "type": "geometry",
        "placement": "entrance",
        "geometry": {
          "type": "box",
          "width": 0.3,
          "depth": 0.2,
          "height": 0.5
        },
        "offset": {"x": 1.5, "y": 0.25, "z": 0},
        "probability": 0.6,
        "use_cases": ["residential"]
      },
      
      // ============================================
      // AGRICULTURAL ELEMENTS
      // ============================================
      
      "irrigation_system": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "cylinder",
          "radius": 0.05,
          "height": "building_width"
        },
        "count": {"min": 4, "max": 8},
        "spacing": {"min": 2.0, "max": 4.0},
        "probability": 0.7,
        "use_cases": ["agricultural"]
      },
      
      "grow_light": {
        "type": "geometry",
        "placement": "ceiling",
        "geometry": {
          "type": "box",
          "width": 1.0,
          "depth": 1.0,
          "height": 0.1
        },
        "spacing": {"min": 2.0, "max": 3.0},
        "count": {"min": 4, "max": 16},
        "probability": 0.8,
        "use_cases": ["agricultural"]
      },
      
      // ============================================
      // PARK ELEMENTS
      // ============================================
      
      "bench": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 1.5,
              "depth": 0.4,
              "height": 0.05
            },
            {
              "type": "box",
              "width": 0.05,
              "depth": 0.05,
              "height": 0.4,
              "offset": {"x": -0.7, "y": 0.2}
            },
            {
              "type": "box",
              "width": 0.05,
              "depth": 0.05,
              "height": 0.4,
              "offset": {"x": 0.7, "y": 0.2}
            }
          ]
        },
        "count": {"min": 2, "max": 6},
        "spacing": {"min": 3.0, "max": 5.0},
        "probability": 0.7,
        "use_cases": ["park"]
      },
      
      "street_light": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "cylinder",
              "radius": 0.1,
              "height": 4.0
            },
            {
              "type": "sphere",
              "radius": 0.2,
              "offset": {"y": 4.2}
            }
          ]
        },
        "spacing": {"min": 8.0, "max": 12.0},
        "count": {"min": 2, "max": 8},
        "probability": 0.6,
        "use_cases": ["park", "residential", "commercial"]
      },
      
      // ============================================
      // ROOFTOP UTILITIES & EQUIPMENT
      // ============================================
      
      "hvac_unit": {
        "type": "geometry",
        "placement": "roof",
        "geometry": {
          "type": "box",
          "width": 1.2,
          "depth": 1.2,
          "height": 0.8
        },
        "offset": {"y": "building_height / 2 + 0.4"},
        "count": {"min": 1, "max": 4},
        "spacing": {"min": 3.0, "max": 6.0},
        "probability": 0.5,
        "use_cases": ["residential", "commercial", "industrial"]
      },
      
      // ============================================
      // EXTERIOR FURNISHINGS & FIXTURES
      // ============================================
      
      "bike_rack": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 2.0,
              "depth": 0.1,
              "height": 0.8
            },
            {
              "type": "cylinder",
              "radius": 0.05,
              "height": 0.8,
              "offset": {"x": -0.8, "y": 0.4}
            },
            {
              "type": "cylinder",
              "radius": 0.05,
              "height": 0.8,
              "offset": {"x": 0.8, "y": 0.4}
            }
          ]
        },
        "count": {"min": 1, "max": 3},
        "spacing": {"min": 4.0, "max": 6.0},
        "probability": 0.4,
        "use_cases": ["commercial", "residential", "park"]
      },
      
      "trash_bin": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "cylinder",
          "radius": 0.3,
          "height": 0.8
        },
        "count": {"min": 1, "max": 3},
        "spacing": {"min": 5.0, "max": 8.0},
        "probability": 0.6,
        "use_cases": ["commercial", "residential", "park"]
      },
      
      "planter_box": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "box",
          "width": 1.5,
          "depth": 0.5,
          "height": 0.4
        },
        "count": {"min": 2, "max": 6},
        "spacing": {"min": 3.0, "max": 5.0},
        "probability": 0.5,
        "use_cases": ["residential", "commercial", "park"]
      },
      
      "window_box": {
        "type": "geometry",
        "placement": "window",
        "geometry": {
          "type": "box",
          "width": 1.0,
          "depth": 0.2,
          "height": 0.15
        },
        "offset": {"z": 0.1},
        "probability": 0.4,
        "use_cases": ["residential", "commercial"]
      },
      
      "security_camera": {
        "type": "geometry",
        "placement": "facade",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 0.15,
              "depth": 0.15,
              "height": 0.1
            },
            {
              "type": "cylinder",
              "radius": 0.05,
              "height": 0.2,
              "offset": {"y": 0.1}
            }
          ]
        },
        "offset": {"y": 3.0, "z": 0.05},
        "count": {"min": 1, "max": 4},
        "spacing": {"min": 8.0, "max": 12.0},
        "probability": 0.3,
        "use_cases": ["commercial", "industrial"]
      },
      
      // ============================================
      // PARK & RECREATION ELEMENTS
      // ============================================
      
      "playground_equipment": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 2.0,
              "depth": 2.0,
              "height": 0.1
            },
            {
              "type": "cylinder",
              "radius": 0.05,
              "height": 1.5,
              "offset": {"x": 0.8, "y": 0.75}
            },
            {
              "type": "cylinder",
              "radius": 0.05,
              "height": 1.5,
              "offset": {"x": -0.8, "y": 0.75}
            },
            {
              "type": "box",
              "width": 1.6,
              "depth": 0.05,
              "height": 0.05,
              "offset": {"y": 1.5}
            }
          ]
        },
        "count": {"min": 1, "max": 3},
        "spacing": {"min": 6.0, "max": 10.0},
        "probability": 0.4,
        "use_cases": ["park"]
      },
      
      "picnic_table": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 2.0,
              "depth": 0.8,
              "height": 0.05
            },
            {
              "type": "box",
              "width": 0.05,
              "depth": 0.05,
              "height": 0.4,
              "offset": {"x": -0.9, "y": 0.2}
            },
            {
              "type": "box",
              "width": 0.05,
              "depth": 0.05,
              "height": 0.4,
              "offset": {"x": 0.9, "y": 0.2}
            }
          ]
        },
        "count": {"min": 2, "max": 6},
        "spacing": {"min": 4.0, "max": 6.0},
        "probability": 0.5,
        "use_cases": ["park"]
      },
      
      "pergola": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "cylinder",
              "radius": 0.15,
              "height": 2.5,
              "offset": {"x": -1.5, "y": 1.25}
            },
            {
              "type": "cylinder",
              "radius": 0.15,
              "height": 2.5,
              "offset": {"x": 1.5, "y": 1.25}
            },
            {
              "type": "box",
              "width": 3.0,
              "depth": 0.1,
              "height": 0.1,
              "offset": {"y": 2.5}
            }
          ]
        },
        "count": {"min": 1, "max": 2},
        "spacing": {"min": 8.0, "max": 12.0},
        "probability": 0.3,
        "use_cases": ["park"]
      },
      
      // ============================================
      // INFRASTRUCTURE ELEMENTS
      // ============================================
      
      "fence": {
        "type": "geometry",
        "placement": "perimeter",
        "geometry": {
          "type": "box",
          "width": 0.05,
          "depth": 0.05,
          "height": 1.2
        },
        "spacing": {"min": 0.8, "max": 1.2},
        "probability": 0.3,
        "use_cases": ["residential", "commercial", "industrial"]
      },
      
      "retaining_wall": {
        "type": "geometry",
        "placement": "foundation",
        "geometry": {
          "type": "box",
          "width": "building_width + 1.0",
          "depth": 0.3,
          "height": 0.6
        },
        "offset": {"y": 0.3, "z": "-building_depth / 2 - 0.15"},
        "probability": 0.2,
        "use_cases": ["residential", "commercial"]
      },
      
      "drainage_grate": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "box",
          "width": 0.8,
          "depth": 0.8,
          "height": 0.05
        },
        "count": {"min": 1, "max": 4},
        "spacing": {"min": 5.0, "max": 8.0},
        "probability": 0.4,
        "use_cases": ["commercial", "industrial", "park"]
      },
      
      "parking_meter": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "cylinder",
              "radius": 0.1,
              "height": 1.2
            },
            {
              "type": "box",
              "width": 0.2,
              "depth": 0.2,
              "height": 0.3,
              "offset": {"y": 1.35}
            }
          ]
        },
        "count": {"min": 2, "max": 6},
        "spacing": {"min": 4.0, "max": 6.0},
        "probability": 0.3,
        "use_cases": ["commercial"]
      },
      
      "transit_shelter": {
        "type": "geometry",
        "placement": "ground",
        "geometry": {
          "type": "composite",
          "components": [
            {
              "type": "box",
              "width": 3.0,
              "depth": 1.5,
              "height": 0.1
            },
            {
              "type": "box",
              "width": 3.0,
              "depth": 0.1,
              "height": 2.5,
              "offset": {"y": 1.25, "z": 0.7}
            },
            {
              "type": "cylinder",
              "radius": 0.1,
              "height": 2.5,
              "offset": {"x": -1.3, "y": 1.25, "z": -0.7}
            },
            {
              "type": "cylinder",
              "radius": 0.1,
              "height": 2.5,
              "offset": {"x": 1.3, "y": 1.25, "z": -0.7}
            }
          ]
        },
        "count": {"min": 1, "max": 2},
        "spacing": {"min": 20.0, "max": 30.0},
        "probability": 0.2,
        "use_cases": ["commercial", "park"]
      }
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "elements": {
        "kongo_roof_spirals": {
          "type": "geometry",
          "placement": "roofline",
          "geometry": {
            "type": "spiral_extrusion",
            "radius": 0.2,
            "height": 0.3,
            "spirals": 3
          },
          "probability": 0.4
        }
      }
    }
  }
}
```

**Decorative Element Merging Strategy**:

Decorative elements are merged into the main building geometry to minimize draw calls and improve performance. The merging process follows this strategy:

1. **Geometry Collection Phase**:
   - Generate main building walls (4 walls) as separate geometries
   - Generate roof geometry (separate, not merged with walls)
   - For each decorative element specified in the building class:
     - Look up element definition in `decorative-elements.json`
     - Generate geometry based on element type, placement, and building dimensions
     - Apply positioning based on `placement` (entrance, facade, roofline, etc.)
     - Apply spacing and count rules
     - Collect all decorative element geometries

2. **Merging Phase**:
   - **Option A (Recommended)**: Merge walls + decorative elements into single `BufferGeometry`
     - Use `mergeBoxGeometries()` utility to combine all wall and decorative geometries
     - Create geometry groups for material assignment (walls vs. decorative elements)
     - Create single `THREE.Mesh` with material array
     - Result: 2 meshes total (merged walls+decorations, roof)
   - **Option B (Alternative)**: Keep decorative elements as separate meshes
     - Only merge the 4 walls
     - Each decorative element type becomes its own mesh
     - Result: 2 + N meshes (walls, roof, N decorative element types)

3. **Material Assignment**:
   - Walls use shader materials (for windows, doors, trim rendered in shader)
   - Decorative elements use standard materials (from color palette or element definition)
   - Materials are assigned via geometry groups when using Option A

4. **Placement Rules**:
   - **Entrance elements** (steps, columns, canopies): Positioned at main entrance location
   - **Facade elements** (balconies, awnings, utility bands): Distributed along facades based on spacing rules
   - **Roofline elements** (cornice, eaves, gutters): Positioned at building height
   - **Roof elements** (chimneys, HVAC, solar panels): Positioned on roof surface
   - **Per-floor elements** (balconies, fire escapes): Generated for each floor level

5. **Implementation Example** (pseudocode):
```javascript
function createBuildingWithDecorations(structure, dimensions) {
  // 1. Generate main geometries
  const wallGeometries = generateWalls(dimensions);
  const roofGeometry = generateRoof(dimensions);
  
  // 2. Get decorative elements from building class
  const decorativeElementNames = structure.building_class.decorative_elements;
  const decorativeGeometries = [];
  
  for (const elementName of decorativeElementNames) {
    const elementDef = loadDecorativeElement(elementName);
    const geometries = generateElementGeometries(elementDef, dimensions, structure);
    decorativeGeometries.push(...geometries);
  }
  
  // 3. Merge walls + decorative elements
  const allGeometries = [...wallGeometries, ...decorativeGeometries];
  const mergedGeometry = mergeBoxGeometries(allGeometries);
  
  // 4. Create materials
  const wallMaterials = createWallMaterials(structure);
  const decorativeMaterials = createDecorativeMaterials(structure, decorativeElementNames);
  const allMaterials = [...wallMaterials, ...decorativeMaterials];
  
  // 5. Create merged mesh
  const mergedMesh = new THREE.Mesh(mergedGeometry, allMaterials);
  
  // 6. Add roof (separate mesh)
  const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
  
  return { mergedMesh, roofMesh };
}
```

6. **Performance Considerations**:
   - Merging reduces draw calls from 5+ to 2-3 per building
   - Geometry groups allow different materials without separate meshes
   - Decorative elements with high vertex counts (complex shapes) may benefit from separate meshes for LOD
   - Consider instancing for repeated elements (e.g., multiple identical balconies)

7. **Hub-Specific Overrides**:
   - Hub overrides can add/remove decorative elements
   - Hub-specific decorative elements (e.g., `kongo_roof_spirals`) are merged the same way
   - Override probabilities affect which elements are generated, not how they're merged

### Lot Shapes JSON Reference

```json
{
  "version": "1.0.0",
  "defaults": {
    "lot_patterns": {
      "centered": {
        "placement": "center",
        "offset": {"x": 0, "y": 0},
        "rotation_range": [-5, 5],
        "probability": 0.7
      },
      "offset_front": {
        "placement": "offset",
        "offset": {"x": 0, "y": "lot_depth * 0.1"},
        "rotation_range": [0, 0],
        "probability": 0.2
      },
      "corner_lot": {
        "placement": "corner",
        "offset": {"x": "lot_width * 0.15", "y": "lot_depth * 0.15"},
        "rotation_range": [-10, 10],
        "probability": 0.1
      }
    },
    "lot_sizing": {
      "building_to_lot_ratio": {"min": 0.3, "max": 0.7},
      "minimum_setback": 2.0
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "lot_patterns": {
        "centered": {
          "probability": 0.6
        },
        "offset_front": {
          "probability": 0.3
        },
        "corner_lot": {
          "probability": 0.1
        }
      }
    }
  }
}
```

### Window & Door Patterns JSON Reference

```json
{
  "version": "1.0.0",
  "defaults": {
    "window_patterns": {
      "residential_standard": {
        "window_types": ["standard", "ceiling"],
        "density": 0.65,
        "spacing": {"min": 1.5, "max": 3.0},
        "preferred_facades": ["front", "back"],
        "avoid_overlap": true
      },
      "commercial_full_height": {
        "window_types": ["full_height"],
        "density": 0.75,
        "spacing": {"min": 2.0, "max": 4.0},
        "preferred_facades": ["all"],
        "avoid_overlap": true
      },
      "industrial_minimal": {
        "window_types": ["standard"],
        "density": 0.20,
        "spacing": {"min": 5.0, "max": 10.0},
        "preferred_facades": ["front"],
        "avoid_overlap": true
      }
    },
    "door_patterns": {
      "main_entrance": {
        "placement": "facade_facing_center",
        "width": 0.9,
        "height": 2.1,
        "type": "main",
        "required": true
      },
      "secondary_entrance": {
        "placement": "other_facades",
        "width": 0.9,
        "height": 2.1,
        "type": "secondary",
        "probability": 0.3
      }
    },
    "garage_door_patterns": {
      "truck_bay": {
        "width": 2.4,
        "height": 3.0,
        "type": "truck_bay",
        "spacing": 0.6,
        "with_standard_door": true,
        "standard_door_spacing": 0.3
      },
      "residential_garage": {
        "width": 3.0,
        "height": 2.0,
        "type": "garage",
        "spacing": 0.6
      }
    }
  },
  "hub_overrides": {
    "PillarOfKongo": {
      "window_patterns": {
        "residential_standard": {
          "density": 0.70
        }
      }
    }
  }
}
```

---

## Implementation Guide

### Phase 1: Python Loader Module

**File**: `server/internal/procedural/structure_libraries.py`

```python
"""
Structure Libraries Module
Loads building class definitions, sizes, shapes, decorative elements, colors, and shader patterns
from JSON files with hub-specific override support.
"""

import json
from pathlib import Path
from typing import Dict, Optional, Any, List

# Cache for loaded libraries
_libraries_cache: Dict[str, Any] = {}

def _get_config_path(filename: str) -> Path:
    """Get the path to a structure library JSON file."""
    current_dir = Path(__file__).parent.parent.parent
    return current_dir / "config" / "structure-libraries" / filename

def load_library(library_name: str) -> Dict[str, Any]:
    """Load a structure library JSON file."""
    if library_name in _libraries_cache:
        return _libraries_cache[library_name]
    
    config_path = _get_config_path(f"{library_name}.json")
    
    if not config_path.exists():
        raise FileNotFoundError(f"Structure library file not found: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        _libraries_cache[library_name] = json.load(f)
    
    return _libraries_cache[library_name]

def _merge_with_overrides(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge hub overrides into base dictionary."""
    result = base.copy()
    for key, value in overrides.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge_with_overrides(result[key], value)
        else:
            result[key] = value
    return result

def get_building_class(class_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get building class definition with optional hub override."""
    try:
        classes = load_library("building-classes")
        base_classes = classes.get("defaults", {}).get("building_classes", {})
        base_class = base_classes.get(class_name)
        
        if not base_class:
            return None
        
        # Apply hub override if specified
        if hub_name:
            hub_key = _get_hub_key(hub_name)
            hub_overrides = classes.get("hub_overrides", {}).get(hub_key, {})
            class_overrides = hub_overrides.get("building_classes", {}).get(class_name)
            if class_overrides:
                base_class = _merge_with_overrides(base_class, class_overrides)
        
        return base_class
    except Exception as e:
        print(f"Warning: Failed to load building class {class_name}: {e}")
        return None

def get_size_class(size_class: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get size class definition with optional hub override."""
    try:
        sizes = load_library("building-sizes")
        base_sizes = sizes.get("size_classes", {})
        base_size = base_sizes.get(size_class)
        
        if not base_size:
            return None
        
        # Apply hub override if specified
        if hub_name:
            hub_key = _get_hub_key(hub_name)
            hub_overrides = sizes.get("hub_overrides", {}).get(hub_key, {})
            size_overrides = hub_overrides.get("size_classes", {}).get(size_class)
            if size_overrides:
                base_size = _merge_with_overrides(base_size, size_overrides)
        
        return base_size
    except Exception as e:
        print(f"Warning: Failed to load size class {size_class}: {e}")
        return None

def get_hub_colors(hub_name: str, zone_type: str) -> Optional[Dict[str, str]]:
    """Get color palette for a specific hub and zone type."""
    try:
        colors = load_library("color-palettes")
        hub_key = _get_hub_key(hub_name)
        
        # Check hub overrides first
        hub_overrides = colors.get("hub_overrides", {}).get(hub_key, {})
        if zone_type in hub_overrides:
            return hub_overrides[zone_type]
        
        # Fall back to defaults
        defaults = colors.get("defaults", {})
        return defaults.get(zone_type)
    except Exception as e:
        print(f"Warning: Failed to load colors for {hub_name}/{zone_type}: {e}")
        return None

def get_shader_patterns(hub_name: str, zone_type: str) -> List[Dict[str, Any]]:
    """Get shader patterns for a specific hub and zone type."""
    try:
        patterns = load_library("shader-patterns")
        hub_key = _get_hub_key(hub_name)
        
        # Get hub-specific zone patterns
        hub_overrides = patterns.get("hub_overrides", {}).get(hub_key, {})
        zone_patterns = hub_overrides.get("zone_patterns", {}).get(zone_type, [])
        
        # Resolve pattern definitions
        hub_patterns = hub_overrides.get("patterns", {})
        default_patterns = patterns.get("defaults", {}).get("patterns", {})
        
        result = []
        for pattern_name in zone_patterns:
            if pattern_name in hub_patterns:
                result.append(hub_patterns[pattern_name])
            elif pattern_name in default_patterns:
                result.append(default_patterns[pattern_name])
        
        return result
    except Exception as e:
        print(f"Warning: Failed to load shader patterns for {hub_name}/{zone_type}: {e}")
        return []

def _get_hub_key(hub_name: str) -> str:
    """Convert hub display name to JSON key."""
    hub_mapping = {
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
    return hub_mapping.get(hub_name, hub_name.replace(" ", ""))

# ... more getter functions for other libraries
```

---

### Phase 2: Update Building Generation

**File**: `server/internal/procedural/buildings.py`

**Changes Required**:
1. Replace hardcoded building dimensions with `get_building_size()`
2. Replace hardcoded building shapes with `get_building_shape()`
3. Replace hardcoded color palette loading with `get_color_palette()`
4. Add decorative element generation using `get_decorative_elements()`
5. Add shader pattern application using `get_shader_patterns()`

**Building Selection Logic**:
```python
def select_building_class(zone_type: str, zone_importance: float, rng: random.Random, hub_name: str) -> str:
    """Select building class based on zone type and importance."""
    # Get zone distribution from building-classes.json
    # Filter by allowed_zones
    # Weight by zone_importance
    # Return selected class name
```

**Mixed-Use Zone Handling**:
- For mixed-use zones, use dynamic runtime distribution
- Consider nearby zone types for contextual blending
- Calculate proportions algorithmically, not from fixed distributions

### Phase 3: Client-Side Rendering Updates

**File**: `client-web/src/structures/structure-manager.js`

**Changes Required**:
1. Read `model_data` from structure to get building class, shape, decorative elements
2. Generate geometry based on shape definition
3. Apply decorative elements using merging strategy
4. Apply materials from color palette
5. Apply shader patterns

**Decorative Elements Merging**:
- Collect all decorative element geometries
- Merge with wall geometries into single BufferGeometry
- Use geometry groups for material assignment
- Keep roof as separate mesh

See [Decorative Elements Merging](#decorative-elements-merging) for detailed strategy.

### Phase 4: Admin Tools

**Files**:
- `server/internal/api/structure_library_handlers.go` - API endpoints
- `client-web/src/ui/admin-modal.js` - UI components

**Features**:
1. **Validator**:
   - JSON Schema validation
   - Cross-reference validation
   - Display errors/warnings

2. **Editor**:
   - File browser for library files
   - JSON editor (CodeMirror or Monaco)
   - Hub selector for override editing
   - Save/load functionality

3. **Future Enhancements**:
   - Visual preview
   - Import/export
   - Versioning/migration

---


---

## Migration Strategy

### Phase 1: Initial Setup (Subset of Buildings)

1. **Create directory structure**
   ```
   server/config/structure-libraries/
   ```

2. **Create initial library files** (start with 3 building classes):
   - `building-classes.json` - house, apartment, warehouse
   - `building-sizes.json` - small, medium, large
   - `color-palettes.json` - migrate from hub-color-palettes.json
   - `shader-patterns.json` - migrate from pillar-motifs.json

3. **Create Python loader module**
   - `server/internal/procedural/structure_libraries.py`

4. **Update building generation** (gradual migration):
   - Start using libraries for house, apartment, warehouse only
   - Keep existing logic for other building types as fallback

### Phase 2: Expand Building Classes

5. **Add remaining building classes**:
   - factory, retail, barn, campus, park_structure

6. **Add remaining library files**:
   - `building-shapes.json`
   - `lot-shapes.json`
   - `decorative-elements.json`
   - `window-door-patterns.json`

### Phase 3: Admin Tools

7. **Add validation endpoint** (Go):
   - `server/internal/api/structure_library_handlers.go`
   - JSON Schema validation
   - Cross-reference validation

8. **Add editor UI** (JavaScript):
   - Extend `admin-modal.js`
   - Add file browser
   - Add JSON editor
   - Add save/load functionality

### Phase 4: Complete Migration

9. **Remove hardcoded logic**:
   - Replace all hardcoded building generation with library lookups
   - Remove old color_palettes.py (integrated into structure_libraries.py)
   - Remove old hub-color-palettes.json and pillar-motifs.json (migrated)

---

## Reference Material

### Exterior vs Interior Structures

**Overview**:
- **Interior Structures** (`is_exterior: false`): Built within ring's interior levels, constrained to **20m maximum** (5 floors × 4m per floor)
- **Exterior Structures** (`is_exterior: true`): Built on exterior surface, can exceed 20m, subject to type-specific maximums

**Rationale**: The interior of EarthRing has 20m-tall levels. Structures built inside must fit within these levels. Structures built on the exterior surface are not constrained by interior level heights and can be much taller (towers, skyscrapers, etc.).

**Interior Structures** (is_exterior: false, max 20m):
- Most residential buildings (houses, apartments, slabs, courtyards, clusters)
- Most commercial buildings (retail strips, malls, service strips, podiums)
- Most industrial buildings (warehouses, factories, workshops, yards)
- Most agricultural buildings (greenhouses, terraced farms, processing blocks)
- Most park structures (plates, courtyards, pavilions, sports decks)
- **Rule**: If `height_range` maximum ≤ 20m, structure should be interior

**Exterior Structures** (is_exterior: true, can exceed 20m):
- All tower types (point_tower, podium_tower, twin_towers_skybridge, terrace_tower, ring_tower_podium)
- Office towers (pure_office_tower, headquarter_tower_crown, slim_blade_office_bar, multi_tower_campus)
- Vertical farms (stack_farm_tower, split_core_vertical_farm, hybrid_farm_residential_tower)
- Vertical logistics (vertical_logistics_block)
- Tall industrial (energy_plant_block, cold_storage_silo_block)
- Luxury sky villas (luxury_sky_villas)
- Student habitat stacks (student_compact_habitat_stack)
- Observation platforms (observation_platform_sky_garden)
- Tech innovation hubs (tech_innovation_hub_podium)
- Cultural flagships (cultural_flagship)
- **Rule**: If `height_range` maximum > 20m, structure should be exterior

**Height Validation Logic**:
- Interior structures: Check 20m limit first, then type-specific max
- Exterior structures: Skip 20m check, only check type-specific max and floor range
- Both types: Must not extend beyond floor range [-2, 15]

### Mixed-Use Zone Runtime Distribution

**Overview**: Mixed-use zones use dynamic runtime distribution - building type proportions are calculated during chunk generation based on contextual factors, not fixed probabilities.

**Key Principles**:
1. **Universal Access**: All building types with `"mixed-use"` in `allowed_zones` are eligible
2. **Runtime Determination**: Proportions calculated during chunk generation based on:
   - Nearby zone types (contextual blending)
   - Hub needs and requirements
   - Game state and player activity
   - Spatial relationships and urban planning logic
3. **No Fixed Distribution**: The `zone_distributions.mixed-use` entry in JSON is for documentation only

**Implementation**:
- In `generation.py`, when generating mixed-use zones:
  - Get all building classes with `"mixed-use"` in `allowed_zones`
  - Calculate proportions based on context
  - Select building classes using calculated proportions
  - Generate buildings accordingly

### Shape Compatibility Matrix

| Shape | Compatible Zone Types | Notes |
|-------|----------------------|-------|
| **1. Rectangle** | R, C, I, A, P | → Universally valid. |
| **2. Bar / Slab** | R, C, I, A | → Apartments, offices, warehousing, greenhouses. |
| **3. L-Shape** | R, C, A | → Courtyard housing, corner retail, grow terraces. |
| **4. U-Shape** | R, C | → Residential courts, open shopping courts. |
| **5. Courtyard / Ring Block** | R, C, A | → Housing blocks, malls, ring farms. |
| **6. Donut / Full Ring** | R, C, A | → Circular farms, luxury housing, cultural/commercial hubs. |
| **7. Cluster (Pods)** | R, C, P | → Community housing clusters, innovation parks, pavilion groups. |
| **8. Tower / Point Tower** | R, C | → Residential towers, HQ towers. |
| **9. Podium + Tower** | R, C, Mixed | → Retail at base, offices or apartments above. |
| **10. Stepped / Terraced Block** | R, A | → Terraced farms, stepped apartments, sunlight-maximizing housing. |
| **11. Zigzag Bar** | R, C | → Stylish apartments or commercial strips. |
| **12. Y-Shape** | R, C | → Efficiency for daylight and views; corporate or high-rise living. |
| **13. T-Shape** | R, C, I | → Mixed bars, small campuses, compact light industry. |
| **14. H-Shape** | R, C | → Multi-wing apartments, office campuses. |
| **15. Crescent / Arc Block** | R, C, P | → Waterfront/edge-view apartments, ring-facing malls, arc parks. |
| **16. Hexagonal Block** | C, P | → Civic centers, destination markets, pavilions. |
| **17. Circular / Oval Block** | C, P | → Museums, theaters, garden domes, botanical halls. |
| **18. Fan / Wedge Block** | R, C | → Buildings hugging curvature of ring or parks. |
| **19. Mega-Plate (Low Block)** | A, P, I | → Agriculture plates, sports decks, logistics decks. |
| **20. Atrium Spine Block** | C, R | → Office campuses, malls, gallery spaces with central daylight spine. |

**Legend**: R = Residential, C = Commercial, I = Industrial, A = Agricultural, P = Park, Mixed = Mixed-Use

### Decorative Elements Merging

**Strategy**: Merge decorative elements into main building geometry to minimize draw calls.

**Process**:
1. **Geometry Collection**: Generate walls, roof, and all decorative element geometries
2. **Merging**: Merge walls + decorative elements into single BufferGeometry
3. **Material Assignment**: Use geometry groups for different materials
4. **Result**: 2 meshes total (merged walls+decorations, roof)

**Placement Rules**:
- **Entrance elements**: Positioned at main entrance
- **Facade elements**: Distributed along facades based on spacing
- **Roofline elements**: Positioned at building height
- **Roof elements**: Positioned on roof surface
- **Per-floor elements**: Generated for each floor level

**Performance**: Reduces draw calls from 5+ to 2-3 per building.

### API Endpoints

**Admin Endpoints**:
```
GET    /api/admin/structure-libraries              # List all library files
GET    /api/admin/structure-libraries/{filename}   # Get library file content
PUT    /api/admin/structure-libraries/{filename}   # Update library file
POST   /api/admin/structure-libraries/validate     # Validate all libraries
POST   /api/admin/structure-libraries/{filename}/validate  # Validate single file
GET    /api/admin/structure-libraries/schemas/{filename}   # Get JSON schema
```

### Validation Rules

1. **JSON Schema Validation**: Each library file must conform to its schema
2. **Cross-Reference Validation**:
   - Building classes must reference valid size classes
   - Building classes must reference valid shapes
   - Building classes must reference valid window/door patterns
   - Hub overrides must reference valid base definitions
3. **Hub Override Validation**:
   - Hub keys must be valid (match hub name mapping)
   - Overrides must not remove required fields
   - Overrides must maintain type compatibility
4. **Color Palette Validation**:
   - All zone types must have all color components
   - Hex colors must be valid format
5. **Shader Pattern Validation**:
   - Patterns must reference valid base patterns
   - Placement values must be valid

### Building Classes Reference

See [Building Classes JSON Reference](#building-classes-json-reference) section below for the complete list of all 70 building types organized by category.

### Shape Name Mapping

The following mapping connects existing building class shape references to the new shape catalog:

| Building Class Reference | New Shape Name | Notes |
|-------------------------|----------------|-------|
| `rectangular` | `rectangular` | Direct match |
| `composite_parallel` | `bar_slab` (twin_parallel_bars variant) | Twin parallel bars |
| `ring_closed` | `courtyard_ring` | Rectangular ring with inner void |
| `composite_podium` | `podium_tower` | Podium base with tower(s) |
| `composite_twin` | `cluster` (variant) or custom | Twin towers structure |
| `composite_courtyard` | `u_shaped` or `courtyard_ring` | Multiple structures forming courtyards |
| `stepped_tower` | `stepped_terraced` | Tower with stepped-back levels |
| `cluster` | `cluster` | Direct match |
| `radial_spoke` | `y_shaped` or `cluster` (radial_cluster variant) | Central core with radiating wings |
| `terrace_block` | `stepped_terraced` | Terraced/stepped structure |
| `stepped_terrace` | `stepped_terraced` | Direct match |
| `cascade_ramp` | `stepped_terraced` (variant) | Continuous ramped surface |
| `dome_or_barrel` | `circular_oval` or `crescent_arc` | Curved structures |
| `composite_plant` | `rectangular` or `cluster` | Industrial plant structures |
| `composite_silo` | `tower_point` or `circular_oval` | Silo structures |
| `composite_split_core` | `h_shaped` or `cluster` | Split core structures |
| `platform` | `mega_plate` | Low, broad platforms |
| `composite_crown` | `podium_tower` (variant) | Podium with distinctive top |

---

## Building Classes JSON Reference

The following sections contain the complete JSON structure for `building-classes.json` with all 70 building types. This is a reference for implementation - the actual file should be created based on this structure.
