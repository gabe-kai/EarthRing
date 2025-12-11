# Structure Libraries System - Design Guide

## Table of Contents

1. [Introduction](#introduction)
2. [System Architecture](#system-architecture)
3. [Configuration Files](#configuration-files)
4. [Implementation Guide](#implementation-guide)
5. [Migration Strategy](#migration-strategy)
6. [Reference Material](#reference-material)

---

## Introduction

### Purpose

The Structure Libraries System provides a modular, hub-specific configuration system for procedural building generation in EarthRing. It allows each pillar-hub terminal to have unique cultural theming for buildings, decorations, and visual elements while maintaining a unified, extensible architecture.

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

### 1. Building Classes (`building-classes.json`)

**Purpose**: Defines building types with their characteristics, allowed zones, shapes, sizes, and decorative elements.

**Structure**:
- Base definitions in `defaults.building_classes`
- Hub-specific overrides in `hub_overrides.{hub_name}.building_classes`

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

See [Building Classes Reference](#building-classes-reference) for complete list.

### 2. Building Sizes (`building-sizes.json`)

**Purpose**: Defines size classes (small, medium, large) with dimension ranges and distributions.

**Structure**:
- Size class definitions with width, depth, height ranges
- Zone-specific size distributions
- Hub-specific size overrides

**Size Classes**:
- `small`: 8-15m width, 8-15m depth
- `medium`: 15-25m width, 15-25m depth
- `large`: 25-40m width, 25-40m depth

### 3. Building Shapes (`building-shapes.json`)

**Purpose**: Defines 20 base geometry shapes for building footprints.

**Shape Catalog**:
1. Rectangle - Universally valid
2. Bar / Slab - Long, narrow rectangles
3. L-Shape - Two bars joined at corner
4. U-Shape - Semi-enclosed courtyard
5. Courtyard / Ring Block - Rectangular ring with inner void
6. Donut / Full Ring - Perfect torus-like footprint
7. Cluster (Pods) - Multiple smaller chunks
8. Tower / Point Tower - Small footprint, tall
9. Podium + Tower - Wide base with tower(s)
10. Stepped / Terraced Block - Stepped-back sections
11. Zigzag Bar - Alternating angles
12. Y-Shape - Three wings from central core
13. T-Shape - Bar intersects another bar
14. H-Shape - Two bars connected by crossbar
15. Crescent / Arc Block - Curved in plan
16. Hexagonal Block - Flat-sided polygon
17. Circular / Oval Block - Soft volume
18. Fan / Wedge Block - Tapers from narrow to wide
19. Mega-Plate (Low Block) - Very short, very broad
20. Atrium Spine Block - Rectangular with hollow spine

**Shape Compatibility Matrix**: See [Shape Compatibility Matrix](#shape-compatibility-matrix)

### 4. Color Palettes (`color-palettes.json`)

**Purpose**: Defines color schemes for different zone types, merged from `hub-color-palettes.json`.

**Structure**:
- Zone-specific color palettes (Residential, Commercial, Industrial, Agricultural, Parks)
- Color components: foundation, walls, roofs, windows_doors, trim
- Hub-specific color overrides

### 5. Shader Patterns (`shader-patterns.json`)

**Purpose**: Defines shader-based decorative patterns, merged from `pillar-motifs.json`.

**Structure**:
- Pattern definitions with placement, scale, complexity
- Hub-specific pattern overrides

### 6. Decorative Elements (`decorative-elements.json`)

**Purpose**: Defines 3D geometric decorative elements that can be attached to buildings.

**Element Categories**:
- **Entrance & Access**: steps, stair_rail, balcony_rail, deck_rail, awning, canopy
- **Window & Door Details**: window_sill, window_frame_3d, door_frame_3d
- **Roof & Exterior**: gutter, downspout, chimney, skylight, solar_panels, green_roof
- **Trim & Detail Bands**: trim_band, corner_trim, foundation_band
- **Commercial Elements**: signage_area, lighting_fixture
- **Industrial Elements**: vent_stack, cooling_tower, piping, loading_dock, dock_leveler
- **Residential Special Features**: fire_escape, mailbox
- **Agricultural Elements**: irrigation_system, grow_light
- **Park Elements**: bench, street_light
- **Rooftop Utilities**: hvac_unit
- **Exterior Furnishings**: bike_rack, trash_bin, planter_box, window_box, security_camera
- **Park & Recreation**: playground_equipment, picnic_table, pergola
- **Infrastructure**: fence, retaining_wall, drainage_grate, parking_meter, transit_shelter

**Current implementation notes (industrial)**
- `vent_stack`: roof cylinders; individual meshes per stack.
- `loading_dock`: instanced boxes, top at ~1m, aligned to truck bays.
- `roof_hvac`: instanced boxes placed on roof.
- `cooling_tower`: ground-based tapered cylinders (8m dia, 12m tall) behind building with deterministic spacing to prevent overlap.
- `reactor_turbine_hall`: attached to right facade at ground; Quonset half-cylinder roof.

**Merging Strategy**: See [Decorative Elements Merging](#decorative-elements-merging)

### 7. Lot Shapes (`lot-shapes.json`)

**Purpose**: Defines lot placement patterns and sizing rules.

**Lot Patterns**:
- `centered`: Building centered on lot
- `offset_front`: Building offset toward front
- `corner_lot`: Building positioned at corner

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

---

## Implementation Guide

### Phase 1: Python Loader Module

**File**: `server/internal/procedural/structure_libraries.py`

**Responsibilities**:
- Load JSON configuration files
- Apply hub overrides
- Cache loaded data
- Provide getter functions for each library type

**Key Functions**:
```python
def load_library(library_name: str, hub_name: Optional[str] = None) -> Dict[str, Any]:
    """Load a library file with optional hub overrides."""
    
def get_building_class(class_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get building class definition with hub overrides applied."""
    
def get_building_size(size_class: str, zone_type: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get size class definition for a zone type."""
    
def get_building_shape(shape_name: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get shape definition with hub overrides."""
    
def get_decorative_elements(element_names: List[str], hub_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get decorative element definitions."""
    
def get_color_palette(zone_type: str, hub_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get color palette for a zone type."""
    
def get_shader_patterns(pattern_names: List[str], hub_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get shader pattern definitions."""
```

**Implementation Notes**:
- Use file system caching to avoid reloading on every request
- Apply hub overrides recursively (deep merge)
- Handle missing files gracefully (return None, log warning)
- Validate hub name mapping

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

## Migration Strategy

### Phase 1: Initial Setup (Subset of Buildings)

1. **Create directory structure**:
   - `server/config/structure-libraries/`
   - `server/config/structure-libraries-schemas/`

2. **Create initial library files** (subset):
   - `building-classes.json` - Start with 5-10 building types
   - `building-sizes.json` - Basic size classes
   - `building-shapes.json` - Basic shapes (rectangular, bar_slab, l_shaped)
   - `color-palettes.json` - Migrate from hub-color-palettes.json
   - `shader-patterns.json` - Migrate from pillar-motifs.json

3. **Create Python loader module**:
   - `server/internal/procedural/structure_libraries.py`
   - Implement basic loading and caching
   - Implement hub override merging

4. **Update building generation** (subset):
   - Update `buildings.py` to use loader for subset of buildings
   - Keep old logic as fallback for unmigrated buildings
   - Test with single hub first

### Phase 2: Expand Building Classes

5. **Add remaining building classes**:
   - Complete residential (20 types)
   - Complete commercial (14 types)
   - Complete industrial (12 types)
   - Complete agricultural (12 types)
   - Complete park (12 types)

6. **Add remaining shapes**:
   - Complete 20-shape catalog
   - Add shape compatibility matrix

7. **Add decorative elements**:
   - Complete decorative-elements.json
   - Test merging strategy

### Phase 3: Admin Tools

8. **Add validation endpoint** (Go):
   - `server/internal/api/structure_library_handlers.go`
   - JSON Schema validation
   - Cross-reference validation

9. **Add editor UI** (JavaScript):
   - Extend `admin-modal.js`
   - Add file browser
   - Add JSON editor
   - Add save/load functionality

### Phase 4: Complete Migration

10. **Remove hardcoded logic**:
    - Replace all hardcoded building generation with library lookups
    - Remove old `color_palettes.py` (integrated into structure_libraries.py)
    - Remove old `hub-color-palettes.json` and `pillar-motifs.json` (migrated)

11. **Testing & Validation**:
    - Test all building types generate correctly
    - Test hub overrides work
    - Test validation endpoints
    - Test admin editor

---

## Reference Material

### Exterior vs Interior Structures

**Overview**:
- **Interior Structures** (`is_exterior: false`): Built within ring's interior levels, constrained to **20m maximum** (5 floors × 4m per floor)
- **Exterior Structures** (`is_exterior: true`): Built on exterior surface, can exceed 20m, subject to type-specific maximums

**Interior Structures** (is_exterior: false, max 20m):
- Most residential buildings (houses, apartments, slabs, courtyards, clusters)
- Most commercial buildings (retail strips, malls, service strips, podiums)
- Most industrial buildings (warehouses, factories, workshops, yards)
- Most agricultural buildings (greenhouses, terraced farms, processing blocks)
- Most park structures (plates, courtyards, pavilions, sports decks)

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

---

## Building Classes Reference

### Residential Building Classes (20 types)

#### Slab & Bar Blocks (4 types)
- `linear_corridor_block` - Linear Corridor Block
- `double_loaded_slab` - Double-Loaded Slab
- `perimeter_bar` - Perimeter Bar
- `split_bar_pair` - Split Bar Pair

#### Courtyard & Ring Blocks (4 types)
- `closed_courtyard_block` - Closed Courtyard Block
- `open_u_block` - Open U-Block
- `double_courtyard_block` - Double Courtyard Block
- `ring_tower_podium` - Ring Tower Podium

#### Tower & Stack Forms (4 types)
- `point_tower` - Point Tower
- `podium_tower` - Podium Tower
- `twin_towers_skybridge` - Twin Towers with Skybridge
- `terrace_tower` - Terrace Tower

#### Cluster & Village Forms (4 types)
- `clustered_midrises_shared_deck` - Clustered Mid-Rises around Shared Deck
- `terrace_village` - Terrace Village
- `stacked_townhouse_cluster` - Stacked Townhouse Cluster
- `radial_spoke_cluster` - Radial "Spoke" Cluster

#### Special Residential (4 types)
- `coliving_block` - Co-Living Block
- `luxury_sky_villas` - Luxury Sky Villas
- `student_compact_habitat_stack` - Student / Compact Habitat Stack
- `senior_assisted_living_terrace` - Senior / Assisted Living Terrace Block

### Commercial Building Classes (14 types)

#### Podium & Mall Blocks (4 types)
- `podium_mall_atrium` - 2–4 Floor Podium Mall (inner atrium)
- `streetfront_retail_podium` - Streetfront Retail Podium
- `market_hall_block` - Market Hall Block
- `transit_hub_podium` - Transit Hub Podium

#### Office & Mixed Office Towers (4 types)
- `pure_office_tower` - Pure Office Tower
- `headquarter_tower_crown` - Headquarter Tower with Crown
- `multi_tower_campus` - Multi-Tower Campus
- `slim_blade_office_bar` - Slim "Blade" Office Bar

#### Strip & Bar Commercial (3 types)
- `retail_strip_bar` - Retail Strip Bar
- `double_sided_arcade_bar` - Double-Sided Arcade Bar
- `service_strip` - Service Strip

#### Specialty Commercial (3 types)
- `convention_exhibition_hall` - Convention / Exhibition Hall Block
- `cultural_flagship` - Cultural Flagship
- `tech_innovation_hub_podium` - Tech / Innovation Hub Podium

### Industrial Building Classes (12 types)

#### Warehouse & Logistics Bars (3 types)
- `standard_warehouse_bar` - Standard Warehouse Bar
- `cross_dock_facility` - Cross-Dock Facility
- `vertical_logistics_block` - Vertical Logistics Block

#### Plant & Utility Blocks (3 types)
- `energy_plant_block` - Energy Plant Block
- `water_recycling_plant` - Water / Recycling Plant
- `data_fabrication_block` - Data/Fabrication Block

#### Yard & Platform Structures (3 types)
- `lift_yard_platform` - Lift Yard Platform
- `container_stack_yard` - Container Stack Yard
- `maintenance_deck` - Maintenance Deck

#### Light-Industrial / Maker Blocks (3 types)
- `small_bay_workshop_row` - Small-Bay Workshop Row
- `maker_lab_block` - Maker / Lab Block
- `hybrid_office_industrial_bar` - Hybrid Office-Industrial Bar

### Agricultural Building Classes (12 types)

#### Terraced Grow Blocks (3 types)
- `stepped_terrace_farm` - Stepped Terrace Farm
- `cascade_farm_block` - Cascade Farm Block
- `rim_terrace_ring` - Rim Terrace Ring

#### Greenhouse & Biome Halls (3 types)
- `linear_greenhouse_bar` - Linear Greenhouse Bar
- `dome_barrel_biome_hall` - Dome / Barrel Biome Hall
- `multi_span_greenhouse_block` - Multi-Span Greenhouse Block

#### Vertical Farm Towers (3 types)
- `stack_farm_tower` - Stack Farm Tower
- `split_core_vertical_farm` - Split-Core Vertical Farm
- `hybrid_farm_residential_tower` - Hybrid Farm-Residential Tower

#### Processing & Storage (3 types)
- `food_processing_block` - Food Processing Block
- `cold_storage_silo_block` - Cold Storage / Silo Block
- `seed_gene_bank_vault_block` - Seed / Gene Bank Vault Block

### Park Building Classes (12 types)

#### Plate & Deck Parks (3 types)
- `single_plate_park` - Single Plate Park
- `tiered_plate_park` - Tiered Plate Park
- `edge_park_deck` - Edge Park Deck

#### Courtyard & Pocket Parks (3 types)
- `enclosed_courtyard_park` - Enclosed Courtyard Park
- `pocket_park_plate` - Pocket Park Plate
- `atrium_garden` - Atrium Garden

#### Pavilion & Landmark Structures (3 types)
- `civic_pavilion` - Civic Pavilion
- `observation_platform_sky_garden` - Observation Platform / Sky Garden
- `cultural_garden_complex` - Cultural Garden Complex

#### Sport & Recreation Blocks (3 types)
- `sports_deck` - Sports Deck
- `aquatic_pool_deck` - Aquatic / Pool Deck
- `playground_climbing_garden` - Playground / Climbing Garden Block

---

*End of Design Guide*
