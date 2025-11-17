# Procedural Generation System

## Table of Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Seed-Based Deterministic Generation](#seed-based-deterministic-generation)
- [City Grid Generation](#city-grid-generation)
- [Building Generation](#building-generation)
  - [Building Complexity Levels](#building-complexity-levels)
  - [Building Types](#building-types)
  - [Architectural Styles](#architectural-styles)
  - [Window Generation](#window-generation)
  - [Building Details](#building-details)
- [Window Lighting System](#window-lighting-system)
- [Window Silhouettes](#window-silhouettes)
- [Park and Agricultural Areas](#park-and-agricultural-areas)
- [Decorative Elements](#decorative-elements)
- [Performance Optimization](#performance-optimization)
- [Integration with Player Actions](#integration-with-player-actions)
- [Regeneration Strategy](#regeneration-strategy)
- [Implementation Phases](#implementation-phases)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The procedural generation system creates the cityscape, buildings, parks, and decorative elements of EarthRing. It uses deterministic, seed-based algorithms to ensure consistent generation across all clients while allowing for variety and realistic city layouts.

**Implementation Status**: ✅ **SERVICE IMPLEMENTED** (Phase 1)
- Python service implemented with FastAPI (`server/internal/procedural/main.py`)
- Go client implemented for service communication (`server/internal/procedural/client.go`)
- Seed generation utilities implemented (`server/internal/procedural/seeds.py`)
- **Current**: Returns chunks with basic ring floor geometry (Phase 1)
- **Future**: Full generation with buildings, zones, structures (Phase 2)

**Key Characteristics:**
- **Deterministic**: Same seed always produces same result
- **Seed-based**: Uses hierarchical seed system for consistency
- **Zone-aware**: Adapts to player-defined zones (Phase 2)
- **Performance-optimized**: Uses LOD and caching strategies (Phase 2)
- **Player-aware**: Integrates with player-placed structures (Phase 2)
- **Cultural variation**: Buildings match Earth cultures below ring position (Phase 2)

## Core Principles

1. **Determinism**: Same inputs (seed, parameters) always produce same outputs
2. **Hierarchical Seeds**: Seeds derived from chunk → building → window levels
3. **Zone Integration**: Generation respects and enhances player-defined zones
4. **Performance Scaling**: Detail level adapts based on traffic and player attention
5. **Cultural Variation**: Building styles vary based on Earth position below ring
6. **Futuristic Aesthetic**: Modern, sustainable, space-age architecture
7. **Realistic Lighting**: Windows light/dim based on time of day and occupancy

## Seed-Based Deterministic Generation

### Seed Hierarchy

Seeds are derived hierarchically to ensure consistency:

```
World Seed (global constant)
  └─ Chunk Seed = hash(floor_number, chunk_index, world_seed)
      └─ Building Seed = hash(chunk_seed, building_cell_x, building_cell_y)
          └─ Window Seed = hash(building_seed, window_x, window_y)
              └─ Decoration Seed = hash(window_seed, decoration_index)
```

### Seed Generation Functions

**Chunk Seed:**
```python
def get_chunk_seed(floor: int, chunk_index: int, world_seed: int) -> int:
    """Generate deterministic seed for a chunk."""
    return hash((floor, chunk_index, world_seed)) % (2**31)
```

**Building Seed:**
```python
def get_building_seed(chunk_seed: int, cell_x: int, cell_y: int) -> int:
    """Generate deterministic seed for a building cell."""
    return hash((chunk_seed, cell_x, cell_y)) % (2**31)
```

**Window Seed:**
```python
def get_window_seed(building_seed: int, window_x: int, window_y: int) -> int:
    """Generate deterministic seed for a window."""
    return hash((building_seed, window_x, window_y)) % (2**31)
```

### Deterministic Random Number Generation

All random operations use seeded random number generators:

```python
import random

def seeded_random(seed: int):
    """Create deterministic random number generator."""
    rng = random.Random(seed)
    return rng
```

**Critical Rule**: Never use true randomness (`random.random()` without seed). Always use seeded RNGs.

## City Grid Generation

### Grid-Based Layout

**Cell Size**: 50m × 50m (configurable)

**Algorithm:**

```
1. Input: Zone polygon, zone type, zone importance
2. Create grid overlay (50m cells) within zone bounds
3. For each cell:
   a. Determine cell type based on:
      - Distance from zone edge
      - Zone type (residential/commercial/industrial)
      - Zone importance
      - Noise function for variation
   b. Assign cell type:
      - Road/Plaza (near edges, high traffic areas)
      - Building (center areas, based on density)
      - Park (residential zones, based on noise)
      - Agricultural (designated agricultural zones)
4. Connect cells with transportation network
5. Add decorative elements based on cell type
```

### Cell Type Distribution

**Residential Zones:**
- Buildings: 70%
- Parks: 20%
- Plazas: 5%
- Roads: 5%

**Commercial Zones:**
- Buildings: 80%
- Plazas: 15%
- Parks: 3%
- Roads: 2%

**Industrial Zones:**
- Buildings: 85%
- Roads: 10%
- Plazas: 3%
- Parks: 2%

**Agricultural Zones:**
- Agricultural plots: 70%
- Storage buildings: 15%
- Roads: 10%
- Support structures: 5%

### Grid Generation Implementation

```python
def generate_city_grid(zone_polygon, zone_type, zone_importance, chunk_seed):
    """Generate city grid within zone."""
    rng = seeded_random(chunk_seed)
    
    # Create 50m grid cells
    cells = create_grid_cells(zone_polygon, cell_size=50)
    
    # Determine distribution based on zone type
    distribution = get_zone_distribution(zone_type)
    
    # Assign cell types
    for cell in cells:
        # Use noise for organic variation
        noise_value = perlin_noise(cell.x, cell.y, chunk_seed)
        
        # Determine if edge cell
        is_edge = is_near_zone_edge(cell, zone_polygon)
        
        if is_edge:
            cell.type = "road" if rng.random() < 0.7 else "plaza"
        else:
            # Use distribution + noise for variation
            cell.type = select_cell_type(distribution, noise_value, rng)
    
    return cells
```

## Building Generation

### Building Complexity Levels

**Decision**: Buildings use adaptive complexity based on traffic and player attention, similar to NPC system.

**Complexity Levels:**

1. **Abstract Mass** (Low Detail)
   - Simple box shape
   - Basic window grid (no individual windows)
   - No lighting
   - No silhouettes
   - Used for: Low-traffic areas, distant buildings, unvisited areas

2. **Standard Detail** (Medium Detail)
   - Defined building shape
   - Individual windows (grid pattern)
   - Basic lighting (on/off per window)
   - No silhouettes
   - Used for: Normal traffic areas, standard buildings

3. **High Detail** (Full Detail)
   - Complex building shape
   - Individual windows with variation
   - Dynamic lighting (dimming, color variation)
   - Silhouettes in lit windows
   - Architectural details (balconies, external structures)
   - Used for: High-traffic areas, frequently visited buildings, player attention

**Complexity Assignment:**

```python
def get_building_complexity(building_id, traffic_data, player_attention_data):
    """Determine building complexity level."""
    # Base complexity from traffic
    traffic_score = get_traffic_score(building_id, traffic_data)
    
    # Boost from player attention
    attention_score = get_attention_score(building_id, player_attention_data)
    
    # Combined score
    total_score = traffic_score + (attention_score * 2)  # Attention weighted higher
    
    if total_score > 0.7:
        return "high_detail"
    elif total_score > 0.3:
        return "standard_detail"
    else:
        return "abstract_mass"
```

**Player Attention Tracking:**
- Track how often players look at/interact with buildings
- Buildings gain "attention points" when viewed/interacted
- Attention decays over time (similar to NPC favoritism)
- High-attention buildings get upgraded to high detail

### Building Types

**Residential Buildings:**
- Apartment towers (tall, narrow)
- Residential blocks (medium height, wider)
- Mixed-use (residential + commercial ground floor)

**Commercial Buildings:**
- Office towers (very tall, glass-heavy)
- Shopping centers (wide, low-medium height)
- Entertainment venues (unique shapes)

**Industrial Buildings:**
- Warehouses (wide, low)
- Manufacturing facilities (medium height, large footprint)
- Processing plants (tall, with external structures)

**Special Buildings:**
- Transportation hubs (unique shape, large)
- Public facilities (hospitals, schools, etc.)
- Agricultural storage (large, functional)

### Architectural Styles

**Decision**: Building styles match Earth cultures below ring position.

**Cultural Regions:**

1. **East Asian** (China, Japan, Korea, etc.)
   - Clean lines, minimalist
   - Vertical emphasis
   - Integrated green spaces
   - Futuristic but traditional elements

2. **European** (Western Europe)
   - Mixed old and new
   - Public spaces emphasis
   - Sustainable design
   - Historical references

3. **North American** (USA, Canada)
   - Bold, modern
   - Large scale
   - Technology integration
   - Commercial emphasis

4. **South American** (Brazil, Argentina, etc.)
   - Colorful, vibrant
   - Community spaces
   - Tropical adaptations
   - Cultural fusion

5. **Middle Eastern** (Gulf states, etc.)
   - Grand scale
   - Geometric patterns
   - Luxury materials
   - Modern Islamic architecture

6. **African** (Various regions)
   - Community-focused
   - Sustainable materials
   - Cultural patterns
   - Modern adaptations

7. **South Asian** (India, Pakistan, etc.)
   - Dense, vertical
   - Color and pattern
   - Mixed-use emphasis
   - Traditional + modern

8. **Oceanic** (Australia, Pacific Islands)
   - Open, airy
   - Natural integration
   - Sustainable focus
   - Island adaptations

**Style Selection:**

```python
def get_cultural_style(ring_position_x):
    """Determine cultural style based on Earth position below ring."""
    # Ring position X corresponds to longitude on Earth
    # X=0 is Prime Meridian (Gulf of Guinea)
    
    # Map ring position to Earth longitude
    earth_longitude = (ring_position_x / 264000) * 360 - 180
    
    # Determine cultural region
    if -10 <= earth_longitude <= 50:  # Europe, Middle East
        if 30 <= earth_longitude <= 50:
            return "middle_eastern"
        else:
            return "european"
    elif 50 <= earth_longitude <= 150:  # Asia
        if 100 <= earth_longitude <= 150:
            return "east_asian"
        else:
            return "south_asian"
    elif 150 <= earth_longitude <= 180 or -180 <= earth_longitude <= -120:  # Pacific
        return "oceanic"
    elif -120 <= earth_longitude <= -50:  # Americas
        if -100 <= earth_longitude <= -50:
            return "south_american"
        else:
            return "north_american"
    elif -50 <= earth_longitude <= 50:  # Africa
        return "african"
    else:
        return "default"  # Fallback
```

**Style Application:**

```python
def apply_cultural_style(building, style):
    """Apply cultural architectural style to building."""
    style_params = CULTURAL_STYLES[style]
    
    # Adjust building parameters
    building.window_pattern = style_params.window_pattern
    building.color_scheme = style_params.color_scheme
    building.roof_style = style_params.roof_style
    building.decorative_elements = style_params.decorative_elements
    building.materials = style_params.materials
```

### Window Generation

**Decision**: Lots of windows, futuristic glass buildings. Fake transparency and fake lighting acceptable. Not every window needs dynamic light casting shadows.

**Window Density:**
- **High**: 60-80% of facade covered in windows (glass buildings)
- **Medium**: 40-60% coverage (mixed)
- **Low**: 20-40% coverage (industrial, some residential)

**Window Patterns:**

1. **Grid Pattern** (Most common)
   - Regular rows and columns
   - Window size: 2-3m wide × 2-3m tall
   - Spacing: 0.5-1m between windows
   - Variation: Occasional missing windows, different sizes

2. **Strip Windows** (Horizontal bands)
   - Continuous horizontal strips
   - 1-2m tall strips
   - Spacing between strips: 1-2m

3. **Vertical Strips** (Less common)
   - Vertical window columns
   - 1-2m wide columns
   - Spacing: 1-2m

4. **Curved/Organic** (Futuristic)
   - Curved window patterns
   - Organic shapes
   - Used for special buildings

**Window Generation Algorithm:**

```python
def generate_windows(building, building_seed, complexity_level):
    """Generate windows for building facade."""
    rng = seeded_random(building_seed)
    
    # Determine window density based on building type
    if building.type == "commercial":
        density = rng.uniform(0.6, 0.8)  # High density
    elif building.type == "residential":
        density = rng.uniform(0.4, 0.6)  # Medium density
    else:
        density = rng.uniform(0.2, 0.4)  # Low density
    
    # Select pattern
    pattern = select_window_pattern(building.type, rng)
    
    # Generate window grid
    windows = []
    facade_width = building.width
    facade_height = building.height
    
    if pattern == "grid":
        windows = generate_grid_windows(
            facade_width, facade_height, density, rng
        )
    elif pattern == "strip_horizontal":
        windows = generate_strip_windows_horizontal(
            facade_width, facade_height, density, rng
        )
    # ... other patterns
    
    # Add variation
    for window in windows:
        # Size variation
        window.width *= rng.uniform(0.9, 1.1)
        window.height *= rng.uniform(0.9, 1.1)
        
        # Occasional missing windows (5% chance)
        if rng.random() < 0.05:
            window.exists = False
    
    return windows
```

**Fake Transparency:**
- Use texture mapping for glass appearance
- Reflect environment (sky, nearby buildings)
- No actual transparency calculations needed
- Performance-friendly

**Fake Lighting:**
- Pre-calculated light maps
- Window brightness based on time of day
- No dynamic shadow casting per window
- Simple brightness values (0.0 to 1.0)

### Building Details

**Futuristic Elements:**

1. **Solar Panels**
   - On roofs (flat roofs)
   - Some facades (south-facing)
   - Density based on building type

2. **Vertical Gardens**
   - On some facades (residential, commercial)
   - Integrated into building design
   - 10-20% of buildings have vertical gardens

3. **Holographic Signage**
   - Commercial buildings
   - Futuristic displays
   - Animated (simple animations)

4. **Landing Pads**
   - Top of tall buildings (20% of buildings >10 floors)
   - For drones, small vehicles
   - Safety railings, lighting

5. **External Structures**
   - Pipes, vents, conduits
   - Industrial buildings
   - Some residential (utilities)

6. **Balconies**
   - Residential buildings
   - 30-50% of residential buildings
   - Vary in size and style

**Detail Generation:**

```python
def generate_building_details(building, building_seed, complexity_level):
    """Generate architectural details for building."""
    rng = seeded_random(building_seed)
    details = []
    
    # Solar panels (roof)
    if building.has_flat_roof and rng.random() < 0.6:
        details.append({
            "type": "solar_panel",
            "location": "roof",
            "coverage": rng.uniform(0.3, 0.7)
        })
    
    # Vertical gardens
    if building.type in ["residential", "commercial"]:
        if rng.random() < 0.15:
            details.append({
                "type": "vertical_garden",
                "facade": rng.choice(["north", "south", "east", "west"]),
                "coverage": rng.uniform(0.2, 0.5)
            })
    
    # Landing pad (tall buildings)
    if building.height > 40:  # >10 floors
        if rng.random() < 0.2:
            details.append({
                "type": "landing_pad",
                "location": "roof",
                "size": rng.uniform(10, 20)
            })
    
    # Balconies (residential)
    if building.type == "residential" and rng.random() < 0.4:
        balcony_count = int(building.width / 5)  # ~5m per balcony
        for i in range(balcony_count):
            details.append({
                "type": "balcony",
                "floor": rng.randint(2, building.floor_count),
                "position": i * 5,
                "size": rng.uniform(3, 5)
            })
    
    return details
```

## Window Lighting System

### Lighting Algorithm

**Decision**: Windows light and dim at appropriate times. Fake lighting acceptable (no dynamic shadows).

**Lighting States:**

1. **Daytime (Sun-facing)**
   - Bright (0.8-1.0 brightness)
   - Slight reflection
   - Interior visible (if high detail)

2. **Daytime (Shadow)**
   - Dimmer (0.4-0.6 brightness)
   - More interior visible
   - Some lights on

3. **Evening/Dawn**
   - Transition period
   - Mix of natural and artificial light
   - Gradual brightness change

4. **Nighttime**
   - Interior lights on (if occupied)
   - Brightness: 0.6-0.9 (artificial light)
   - Exterior dark
   - Silhouettes visible

**Lighting Calculation:**

```python
def calculate_window_lighting(window, building, time_of_day, sun_position):
    """Calculate window brightness and lighting state."""
    # Determine if window faces sun
    window_direction = get_window_direction(window, building)
    sun_direction = get_sun_direction(sun_position, building.position)
    
    faces_sun = dot_product(window_direction, sun_direction) > 0.5
    
    # Base brightness from time of day
    if 6 <= time_of_day < 18:  # Daytime
        if faces_sun:
            brightness = 0.9
            light_state = "day_bright"
        else:
            brightness = 0.5
            light_state = "day_shadow"
    elif 18 <= time_of_day < 20 or 5 <= time_of_day < 6:  # Dawn/Dusk
        brightness = 0.6
        light_state = "transition"
    else:  # Nighttime
        # Check if window is occupied
        if window.is_occupied:
            brightness = rng.uniform(0.6, 0.9)
            light_state = "night_lit"
        else:
            brightness = 0.1
            light_state = "night_dark"
    
    return {
        "brightness": brightness,
        "light_state": light_state,
        "color": get_light_color(light_state, time_of_day)
    }
```

**Occupancy Determination:**

```python
def determine_window_occupancy(window, window_seed, time_of_day):
    """Determine if window shows occupied (lights on)."""
    rng = seeded_random(window_seed)
    
    # Base occupancy probability
    if building.type == "residential":
        base_probability = 0.4  # 40% of residential windows occupied
    elif building.type == "commercial":
        # Commercial: high during day, low at night
        if 9 <= time_of_day < 17:
            base_probability = 0.7
        else:
            base_probability = 0.2
    else:
        base_probability = 0.3
    
    # Add variation
    window_occupancy = rng.random() < base_probability
    
    return window_occupancy
```

**Gradual Dimming:**

- Don't instantly switch lighting
- Interpolate brightness over 5-10 minutes (game time)
- Smooth transitions between states
- Store target brightness, interpolate current brightness

## Window Silhouettes

**Decision**: Very simple silhouettes, sprites better than 3D models.

**Silhouette Types:**

1. **Simple 2D Sprites**
   - Basic human shapes
   - 3-5 different poses
   - Side-view silhouettes
   - No animation needed (static sprites)

2. **Occasional Movement**
   - Silhouettes change position every 30-60 seconds
   - Simple position updates (left, center, right)
   - No complex animations

**Implementation:**

```python
def generate_window_silhouette(window, window_seed, light_state):
    """Generate silhouette for lit window."""
    if light_state not in ["night_lit", "day_shadow"]:
        return None  # No silhouette if window not lit
    
    if not window.is_occupied:
        return None  # No silhouette if not occupied
    
    rng = seeded_random(window_seed)
    
    # Select silhouette type
    silhouette_type = rng.choice([
        "person_standing",
        "person_sitting",
        "person_walking"
    ])
    
    # Position within window
    position_x = rng.uniform(0.2, 0.8)  # 20-80% across window
    position_y = rng.uniform(0.3, 0.9)  # 30-90% up window
    
    return {
        "type": silhouette_type,
        "sprite_id": f"silhouette_{silhouette_type}",
        "position": (position_x, position_y),
        "scale": rng.uniform(0.8, 1.2),
        "update_interval": rng.randint(30, 60)  # Seconds
    }
```

**Performance Considerations:**

- Only generate silhouettes for lit, occupied windows
- Limit visible silhouettes (LOD: only close buildings)
- Use sprite atlas (all silhouettes in one texture)
- Batch render silhouettes
- Update positions infrequently (every 30-60 seconds)

**Sprite Assets:**

- 3-5 different silhouette sprites
- Simple black shapes on transparent background
- Side-view only (no front/back needed)
- Size: 64×64 or 128×128 pixels

## Park and Agricultural Areas

### Parks

**Terrain Generation:**

```python
def generate_park_terrain(cell, cell_seed):
    """Generate park terrain with gentle undulation."""
    rng = seeded_random(cell_seed)
    
    # Use Perlin noise for terrain height
    heightmap = generate_heightmap(
        width=50, height=50,
        scale=10,  # Smooth variation
        seed=cell_seed
    )
    
    # Normalize height (keep variation small, 0-2m)
    heightmap = normalize_heightmap(heightmap, min_height=0, max_height=2)
    
    return heightmap
```

**Park Elements:**

1. **Paths**
   - Winding paths through park
   - 2-3m wide
   - Connect entrances
   - Use A* or similar for pathfinding

2. **Trees**
   - Spaced using Poisson disk sampling
   - 5-10m spacing
   - Vary tree types
   - 10-20 trees per park cell

3. **Structures**
   - Benches (along paths)
   - Playground equipment (if residential area)
   - Decorative sculptures
   - Small pavilions

4. **Dirt/Grass**
   - Dirt visible in paths
   - Grass texture for open areas
   - Procedural texture based on noise

### Agricultural Spin-Grav Segments

**Layout:**

```python
def generate_agricultural_segment(cell, cell_seed, segment_type):
    """Generate agricultural area."""
    rng = seeded_random(cell_seed)
    
    # Determine layout
    if segment_type == "terraced":
        # Terraced farming (sloped areas)
        terraces = generate_terraces(cell, rng)
    else:
        # Flat farming
        plots = generate_farming_plots(cell, rng)
    
    # Add infrastructure
    infrastructure = {
        "irrigation": generate_irrigation_system(cell, rng),
        "storage": generate_storage_buildings(cell, rng),
        "paths": generate_access_paths(cell, rng)
    }
    
    return {
        "plots": plots or terraces,
        "infrastructure": infrastructure,
        "crop_types": assign_crop_types(plots, rng)
    }
```

**Agricultural Elements:**

1. **Growing Plots**
   - Grid of growing areas
   - 5m × 5m plots
   - Dirt visible
   - Crop types vary

2. **Infrastructure**
   - Irrigation systems
   - Storage buildings
   - Processing facilities
   - Access roads

3. **Dirt/Soil**
   - Visible soil in plots
   - Paths between plots
   - Terraced areas show soil layers

## Decorative Elements

**Types:**

1. **Street Furniture**
   - Benches (along paths, in parks)
   - Street lights (along roads)
   - Trash bins (near buildings)
   - Signage (directional, informational)

2. **Plants**
   - Potted plants (near buildings)
   - Small trees (along streets)
   - Decorative shrubs
   - Vertical garden elements

3. **Art and Decorations**
   - Sculptures (parks, plazas)
   - Murals (building walls)
   - Holographic displays
   - Decorative lighting

**Placement Algorithm:**

```python
def place_decorative_elements(cells, chunk_seed):
    """Place decorative elements throughout chunk."""
    rng = seeded_random(chunk_seed)
    decorations = []
    
    for cell in cells:
        # Determine decoration density based on cell type
        if cell.type == "park":
            density = 0.3  # High density in parks
        elif cell.type == "plaza":
            density = 0.2
        elif cell.type == "road":
            density = 0.1
        else:
            density = 0.05
        
        # Place decorations
        decoration_count = int(cell.area * density / 100)  # Per 100m²
        
        for i in range(decoration_count):
            decoration = {
                "type": select_decoration_type(cell.type, rng),
                "position": random_position_in_cell(cell, rng),
                "rotation": rng.uniform(0, 360),
                "scale": rng.uniform(0.8, 1.2)
            }
            decorations.append(decoration)
    
    return decorations
```

## Performance Optimization

### LOD (Level of Detail) System

**Three LOD Levels:**

1. **Low LOD** (Far away, >500m)
   - Simple box shapes
   - No windows
   - No lighting
   - No silhouettes
   - Minimal polygons

2. **Medium LOD** (Mid distance, 100-500m)
   - Building shapes
   - Basic window grid (texture, not individual)
   - Simple lighting (per-building, not per-window)
   - No silhouettes

3. **High LOD** (Close, <100m)
   - Full building detail
   - Individual windows
   - Per-window lighting
   - Silhouettes (if high detail)

**LOD Selection:**

```python
def get_lod_level(distance, building_complexity):
    """Determine LOD level based on distance and complexity."""
    if distance > 500:
        return "low"
    elif distance > 100:
        return "medium"
    else:
        # Use building complexity for close buildings
        if building_complexity == "high_detail":
            return "high"
        elif building_complexity == "standard_detail":
            return "medium"
        else:
            return "low"
```

### Caching Strategy

**Generation Cache:**

```python
# Generate once, store in database
def generate_chunk(chunk_id, chunk_seed):
    """Generate chunk and store in database."""
    # Check if already generated
    if chunk_exists_in_db(chunk_id):
        return load_chunk_from_db(chunk_id)
    
    # Generate new chunk
    chunk_data = {
        "grid": generate_city_grid(...),
        "buildings": generate_buildings(...),
        "parks": generate_parks(...),
        "decorations": generate_decorations(...)
    }
    
    # Store in database
    save_chunk_to_db(chunk_id, chunk_data)
    
    return chunk_data
```

**Memory Cache:**

- Cache frequently accessed chunks in memory
- LRU eviction policy
- Cache size: 100-200 chunks
- Invalidate on modification

### Incremental Generation

**Priority System:**

1. **High Priority**: Visible chunks, player's current chunk
2. **Medium Priority**: Adjacent chunks, predicted movement path
3. **Low Priority**: Background chunks, far-away chunks

**Generation Queue:**

```python
class GenerationQueue:
    def __init__(self):
        self.high_priority = []
        self.medium_priority = []
        self.low_priority = []
    
    def add_chunk(self, chunk_id, priority):
        if priority == "high":
            self.high_priority.append(chunk_id)
        elif priority == "medium":
            self.medium_priority.append(chunk_id)
        else:
            self.low_priority.append(chunk_id)
    
    def get_next_chunk(self):
        if self.high_priority:
            return self.high_priority.pop(0)
        elif self.medium_priority:
            return self.medium_priority.pop(0)
        else:
            return self.low_priority.pop(0)
```

### Parallel Generation

**Python Service:**

- Use multiprocessing for CPU-bound generation
- Process multiple chunks simultaneously
- Queue system for generation requests
- Scale based on server capacity

```python
from multiprocessing import Pool

def generate_chunks_parallel(chunk_ids, chunk_seeds):
    """Generate multiple chunks in parallel."""
    with Pool(processes=4) as pool:
        results = pool.starmap(generate_chunk, zip(chunk_ids, chunk_seeds))
    return results
```

## Integration with Player Actions

### Player Structure Override

**Rule**: Player-placed structures override procedural generation.

```python
def generate_building_cell(cell, player_structures):
    """Generate building, respecting player structures."""
    # Check if player has placed structure here
    player_structure = find_player_structure_at(cell.position, player_structures)
    
    if player_structure:
        # Use player structure, don't generate
        return {
            "type": "player_structure",
            "structure_id": player_structure.id,
            "geometry": player_structure.geometry
        }
    else:
        # Generate procedurally
        return generate_procedural_building(cell)
```

### Zone Adaptation

**Procedural generation adapts to player zones:**

```python
def generate_for_zone(zone, chunk_seed):
    """Generate content for player-defined zone."""
    # Use zone type to determine generation parameters
    if zone.type == "residential":
        building_types = ["apartment", "residential_block"]
        density = zone.importance * 0.7
    elif zone.type == "commercial":
        building_types = ["office", "shopping"]
        density = zone.importance * 0.8
    # ... etc
    
    # Generate with zone-specific parameters
    return generate_buildings(zone, building_types, density, chunk_seed)
```

### Regeneration on Zone Change

**When zones change:**

1. Mark affected chunks as "needs_regeneration"
2. Regenerate only if no player structures present
3. Preserve player structures
4. Regenerate surrounding areas for continuity

## Regeneration Strategy

**Decision**: Follow recommendations - regenerate on demand, cache results, only regenerate when necessary.

### When to Regenerate

1. **Initial Generation**: When chunk first requested
2. **Zone Changes**: When zone boundaries/types change
3. **Seed Changes**: If world seed changes (rare)
4. **Player Request**: If player requests regeneration (admin feature)

### When NOT to Regenerate

1. **Player Structures Present**: Don't regenerate areas with player structures
2. **Recently Generated**: If generated within last hour (unless forced)
3. **Unchanged Zones**: If zone hasn't changed, use cached version

### Regeneration Process

```python
def regenerate_chunk(chunk_id, reason, force=False):
    """Regenerate chunk if needed."""
    # Check if regeneration needed
    if not force:
        if not should_regenerate(chunk_id, reason):
            return load_chunk_from_db(chunk_id)
    
    # Check for player structures
    player_structures = get_player_structures_in_chunk(chunk_id)
    if player_structures and not force:
        # Don't regenerate, preserve player structures
        return load_chunk_from_db(chunk_id)
    
    # Regenerate
    chunk_seed = get_chunk_seed(chunk_id)
    new_chunk = generate_chunk(chunk_id, chunk_seed)
    
    # Preserve player structures
    new_chunk = integrate_player_structures(new_chunk, player_structures)
    
    # Update database
    update_chunk_in_db(chunk_id, new_chunk)
    
    return new_chunk
```

### Caching Strategy

**Database Cache:**
- Store generated chunks in database
- Only regenerate if needed
- Version chunks (track changes)

**Memory Cache:**
- Cache frequently accessed chunks
- LRU eviction
- Invalidate on modification

**Client Cache:**
- Clients cache received chunks
- Check version on load
- Request updates if version changed

## Implementation Phases

### Phase 1: Service Foundation ✅ COMPLETE

**Goals:**
- Python service structure (FastAPI)
- Seed generation utilities
- Basic chunk generation endpoint (empty chunks)
- Go client for service communication
- Health check and debugging endpoints

**Deliverables:**
- ✅ Python service runs and responds to requests
- ✅ Seed generation utilities working (deterministic)
- ✅ Chunk generation endpoint returns chunks with basic ring floor geometry
- ✅ Ring floor geometry visible in client (gray rectangular planes)
- ✅ Go server can communicate with Python service
- ✅ Health check endpoint working
- ✅ Service configuration and environment variables
- ✅ Windows compatibility (default uses 127.0.0.1 instead of localhost)

**Status**: ✅ **COMPLETE** - Service foundation implemented with basic geometry generation, ready for Phase 2 full generation.

### Phase 2: MVP (Basic Generation)

**Goals:**
- Simple grid-based city generation
- Basic building shapes (rectangles)
- Simple window patterns
- Basic lighting (on/off based on time)
- Park generation (basic)
- Seed-based deterministic generation

**Deliverables:**
- City grid generation working
- Buildings generate in zones
- Windows generate on buildings
- Basic lighting system
- Parks generate with terrain
- All generation is deterministic

### Phase 3: Enhancement

**Goals:**
- More building variety (L-shapes, combinations)
- Window lighting with dimming
- Silhouettes in windows
- More decorative elements
- Cultural style variation
- Building complexity levels

**Deliverables:**
- Complex building shapes
- Dynamic window lighting
- Silhouette system working
- Cultural styles applied
- Adaptive complexity based on traffic/attention

### Phase 4: Polish

**Goals:**
- Advanced architectural details
- Complex building shapes
- Sophisticated city layouts
- Performance optimization
- Advanced lighting effects

**Deliverables:**
- Full detail buildings
- Optimized generation performance
- Advanced lighting and effects
- Production-ready system

## Open Questions

1. How detailed should building interiors be? (Currently exterior only)
2. Should we support custom building templates from players?
3. How to handle building destruction/decay over time?
4. Should agricultural areas have visible crops growing?
5. How to balance generation time vs. detail level?

## Future Considerations

- **Building Interiors**: Generate interior layouts for enterable buildings
- **Dynamic Building Growth**: Buildings evolve over time based on zone development
- **Weather Effects**: Buildings adapt to weather (snow, rain, etc.)
- **Advanced Lighting**: Ray-traced lighting for high-end clients
- **Procedural Textures**: Generate building materials procedurally
- **AI-Generated Architecture**: Use ML for more varied building designs
- **Player Customization**: Allow players to customize building styles in their zones
- **Historical Buildings**: Generate buildings that reflect historical Earth architecture
- **Adaptive Density**: Building density adapts to player activity over time

