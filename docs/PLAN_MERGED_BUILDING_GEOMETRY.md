# Plan: Merge Building Geometries into Single BufferGeometry

## Current Implementation

Currently, each building consists of **5 separate meshes**:
1. Front wall (`THREE.Mesh` with `THREE.BoxGeometry`)
2. Back wall (`THREE.Mesh` with `THREE.BoxGeometry`)
3. Left wall (`THREE.Mesh` with `THREE.BoxGeometry`)
4. Right wall (`THREE.Mesh` with `THREE.BoxGeometry`)
5. Roof (`THREE.Mesh` with `THREE.BoxGeometry`)

Each wall uses a custom shader material that procedurally renders:
- Windows (up to 50 per wall)
- Doors (1-2 per wall)
- Foundations
- Corner trim
- Window/door frames

**Performance Impact:**
- 5 draw calls per building
- 5 separate geometry objects
- Each wall has separate shader uniforms (window data, door data, etc.)

**Current Building Complexity:**
- All buildings are simple rectangular boxes
- Single width, depth, and height
- No multi-wing structures
- No variable floor heights
- No attached structures (garages are part of main building footprint)

## Goal

Merge all 5 geometries into **1-2 merged BufferGeometry objects**:
- Option A: 1 merged geometry (all walls + roof) with multiple materials using `THREE.Mesh`
- Option B: 2 merged geometries (walls merged, roof separate) - simpler implementation
- Option C: 1 merged geometry for walls only, keep roof separate - balanced approach

**Recommended: Option C** - Merge 4 walls into 1 geometry, keep roof separate (2 meshes total)
- Simplest implementation (roof has different material)
- Reduces draw calls from 5 to 2
- Maintains material separation for easier management

**Future Goal: Support Complex Building Shapes**
- Multi-wing buildings (L-shaped, U-shaped, T-shaped, etc.)
- Buildings with variable floor heights (setbacks, towers on bases)
- Attached structures (garages attached to houses, wings attached to main building)
- This plan must accommodate these future enhancements

## Technical Approach

### Step 1: Create Geometry Merging Utility

Create a utility function to merge multiple `THREE.BoxGeometry` objects with transformations:

```javascript
/**
 * Merge multiple BoxGeometry objects into a single BufferGeometry
 * @param {Array<{geometry: THREE.BoxGeometry, position: [x, y, z], rotation: [x, y, z]}>} geometries - Array of geometry definitions
 * @returns {THREE.BufferGeometry} Merged geometry
 */
mergeBoxGeometries(geometries) {
  const mergedGeometry = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let indexOffset = 0;
  
  for (const {geometry, position, rotation} of geometries) {
    // Clone geometry to avoid modifying original
    const geom = geometry.clone();
    
    // Apply rotation to geometry
    const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(...rotation, 'XYZ')
    );
    geom.applyMatrix4(rotationMatrix);
    
    // Apply translation to geometry
    const translationMatrix = new THREE.Matrix4().makeTranslation(...position);
    geom.applyMatrix4(translationMatrix);
    
    // Extract attributes
    const posAttr = geom.attributes.position;
    const normalAttr = geom.attributes.normal;
    const uvAttr = geom.attributes.uv;
    const indexAttr = geom.index;
    
    // Add vertices with offset indices
    for (let i = 0; i < posAttr.count; i++) {
      positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      normals.push(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
      uvs.push(uvAttr.getX(i), uvAttr.getY(i));
    }
    
    // Add indices with offset
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i) + indexOffset);
      }
    }
    
    indexOffset += posAttr.count;
  }
  
  // Set merged attributes
  mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mergedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  mergedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  mergedGeometry.setIndex(indices);
  
  return mergedGeometry;
}
```

### Step 2: Modify `createDetailedBuilding()` Method

**Current flow:**
1. Create 4 separate wall meshes via `createWallWithWindows()`
2. Create 1 roof mesh
3. Add all 5 meshes to `structureGroup`

**New flow:**
1. Collect wall geometry definitions (without creating meshes)
2. Merge 4 walls into 1 `BufferGeometry`
3. Create 1 merged wall mesh with shader material
4. Create 1 roof mesh (unchanged)
5. Add 2 meshes to `structureGroup`

### Step 3: Handle Shader Materials for Merged Geometry

**Challenge:** Each wall currently has its own shader material with unique uniforms:
- Window data (different windows per wall)
- Door data (different doors per wall)
- Facade identification (front/back/left/right)

**Solution Options:**

**Option A: Single Shader with Facade Identification**
- Add a UV-based or position-based attribute to identify which face belongs to which facade
- Use conditional logic in shader to apply correct windows/doors based on facade
- Pros: Single material, single draw call
- Cons: Complex shader logic, uniform array limits

**Option B: Multiple Materials with Groups** (Recommended)
- Use `THREE.Mesh` with `material` array and `groups` in geometry
- Each group corresponds to one wall (front/back/left/right)
- Each group uses its own material instance with appropriate uniforms
- Pros: Cleaner separation, easier to maintain
- Cons: Still 4 materials (but 1 draw call with `THREE.Mesh`)

**Option C: Separate Merged Geometries per Facade Type**
- Merge front+back walls, merge left+right walls (2 geometries)
- Or merge all walls but separate by shader needs
- Pros: Simpler material management
- Cons: More geometries (but still better than 4 separate meshes)

**Recommended: Option B** - Use geometry groups with material array

### Step 4: Geometry Groups Implementation

```javascript
// Create merged geometry with groups
const mergedGeometry = new THREE.BufferGeometry();

// Group 0: Front wall (faces 0-1)
// Group 1: Back wall (faces 2-3)
// Group 2: Left wall (faces 4-5)
// Group 3: Right wall (faces 6-7)

mergedGeometry.groups = [
  { start: 0, count: 6, materialIndex: 0 },   // Front
  { start: 6, count: 6, materialIndex: 1 },   // Back
  { start: 12, count: 6, materialIndex: 2 },  // Left
  { start: 18, count: 6, materialIndex: 3 },  // Right
];

const materials = [
  frontWallShaderMaterial,
  backWallShaderMaterial,
  leftWallShaderMaterial,
  rightWallShaderMaterial,
];

const mergedWallMesh = new THREE.Mesh(mergedGeometry, materials);
```

**Note:** `BoxGeometry` has 6 faces per box. We need to ensure we're only rendering the outer faces (not inner faces of hollow box).

### Step 5: Handle Hollow Box (Walls Only)

**Current:** Walls are created as thin boxes (`BoxGeometry`), which creates 6 faces:
- 2 outer faces (front/back)
- 4 edge faces

**For merged geometry:** We need to ensure we're only including the outer faces that should be visible.

**Approach:** When merging, only include specific faces from each box:
- Front wall: front face + 4 edge faces
- Back wall: back face + 4 edge faces (but exclude shared edges)
- Left wall: left face + 2 edge faces (front/back edges)
- Right wall: right face + 2 edge faces (front/back edges)

Actually, since walls are thin boxes, each wall has:
- 2 large faces (outer and inner)
- 4 thin edge faces

We only want to render the **outer faces**, not inner faces. So each wall contributes:
- 1 large outer face (2 triangles = 6 indices)
- 4 edge faces (8 triangles = 24 indices)

Total per wall: 30 indices (5 faces × 6 indices)
4 walls: 120 indices

### Step 6: Implementation Steps

1. **Create geometry merging utility function**
   - Function to extract specific faces from `BoxGeometry`
   - Function to merge geometries with transformations
   - Function to create geometry groups

2. **Refactor `createWallWithWindows()`**
   - Extract geometry creation logic (without creating mesh)
   - Return geometry definition object instead of adding mesh to group
   - Keep shader material creation logic separate

3. **Modify `createDetailedBuilding()`**
   - Collect 4 wall geometry definitions
   - Merge geometries using utility
   - Create geometry groups for material assignment
   - Create single merged mesh with material array
   - Keep roof as separate mesh

4. **Test and verify**
   - Visual verification (walls render correctly)
   - Shader functionality (windows/doors still work)
   - Performance measurement (draw calls reduced)

5. **Optimize further** (optional)
   - Consider merging roof too (if materials can be unified)
   - Add geometry caching for identical buildings

## Performance Benefits

**Before:**
- 5 meshes per building = 5 draw calls
- 5 separate geometry objects
- 5 separate material instances

**After (Option C - recommended):**
- 2 meshes per building = 2 draw calls (60% reduction)
- 1 merged geometry (walls) + 1 geometry (roof)
- 4 materials (walls) + 1 material (roof), but managed via groups

**After (Option A - if roof merged too):**
- 1 mesh per building = 1 draw call (80% reduction)
- 1 merged geometry
- 5 materials managed via groups

## Potential Issues & Solutions

### Issue 1: Shader Uniform Limitations
- Each material instance still needs its own uniforms
- Solution: Groups allow per-material uniforms, which is fine

### Issue 2: Face Culling
- Inner faces of hollow box walls shouldn't render
- Solution: Only include outer faces when merging geometries

### Issue 3: UV Mapping
- UV coordinates need to be preserved for shader-based rendering
- Solution: Preserve UV coordinates from original geometries

### Issue 4: Floating Origin Pattern
- Current walls use individual positions/rotations
- Solution: Merge geometries in local space, then position the merged mesh once

## Testing Plan

1. **Visual Testing**
   - Verify all 4 walls render correctly
   - Verify roof renders correctly
   - Verify windows/doors appear on correct facades
   - Verify foundations render correctly
   - Verify corner trim renders correctly

2. **Performance Testing**
   - Measure draw calls (should reduce from 5 to 2)
   - Measure frame rate improvement
   - Compare memory usage

3. **Edge Cases**
   - Buildings with no windows
   - Buildings with many windows
   - Buildings with different door configurations
   - Buildings with different corner trim widths

## Files to Modify

1. `client-web/src/structures/structure-manager.js`
   - Add geometry merging utility functions
   - Refactor `createWallWithWindows()` to return geometry definition
   - Modify `createDetailedBuilding()` to use merged geometry
   - Update material handling for geometry groups

2. `docs/08-procedural-generation.md` (optional)
   - Update documentation to reflect merged geometry approach

## Estimated Complexity

### Phase 1: Simple Merging (Initial Implementation)
- **Time:** 4-6 hours
- **Risk:** Medium (geometry merging can have edge cases)
- **Testing:** 2-3 hours
- **Total:** 6-9 hours

### Phase 2: Complex Building Shapes Support
- **Time:** 12-16 hours
  - Component data structure: 2-3 hours
  - Component geometry generation: 4-5 hours
  - Connection detection: 2-3 hours
  - Shared wall removal: 2-3 hours
  - Multi-component merging: 2-3 hours
- **Risk:** High (complex geometry operations, edge cases with connections)
- **Testing:** 4-6 hours
- **Total:** 16-22 hours

### Phase 3: Variable Floor Heights
- **Time:** 6-8 hours
  - Floor data structure: 1-2 hours
  - Per-floor geometry generation: 2-3 hours
  - Window/door positioning per floor: 2-3 hours
- **Risk:** Medium (coordinate system complexity)
- **Testing:** 2-3 hours
- **Total:** 8-11 hours

### Total Estimated Complexity (All Phases)
- **Time:** 22-30 hours
- **Risk:** High (complex geometry operations)
- **Testing:** 8-12 hours
- **Total:** 30-42 hours

**Recommendation:** Implement Phase 1 first, then evaluate performance and visual results before proceeding to Phase 2 and 3.

## Complex Building Shapes Support

### Overview

The merged geometry approach must support future enhancements for complex building shapes:
- **Multi-wing buildings**: L-shaped, U-shaped, T-shaped, H-shaped, etc.
- **Variable floor heights**: Setbacks, towers on bases, different floor heights per section
- **Attached structures**: Garages attached to houses, wings attached to main building, etc.

### Building Structure Representation

**Current Structure (Simple Rectangle):**
```javascript
{
  width: 20.0,
  depth: 15.0,
  height: 12.0,
  position: [x, y, z],
  // Single rectangular footprint
}
```

**Future Structure (Complex Shapes):**
```javascript
{
  // Main building footprint
  main: {
    width: 20.0,
    depth: 15.0,
    height: 12.0,
    position: [x, y, z],
    floors: [
      { height: 4.0, y_offset: 0.0 },    // Ground floor
      { height: 4.0, y_offset: 4.0 },    // Second floor
      { height: 4.0, y_offset: 8.0 },   // Third floor
    ]
  },
  // Optional wings
  wings: [
    {
      width: 10.0,
      depth: 8.0,
      height: 8.0,
      position: [x + 15.0, y, z],  // Relative to main building
      rotation: 0.0,  // Optional rotation
      floors: [
        { height: 4.0, y_offset: 0.0 },
        { height: 4.0, y_offset: 4.0 },
      ]
    }
  ],
  // Optional attached structures (garages, etc.)
  attached: [
    {
      type: "garage",
      width: 6.0,
      depth: 4.0,
      height: 3.0,
      position: [x - 8.0, y, z],  // Attached to left side
      connection_wall: "left",  // Which wall it connects to
    }
  ]
}
```

### Geometry Merging Strategy for Complex Shapes

**Approach: Component-Based Merging**

1. **Identify Building Components**
   - Main building (always present)
   - Wings (0 or more)
   - Attached structures (0 or more)

2. **Generate Geometry for Each Component**
   - Each component generates its own wall geometries (4 walls per component)
   - Each component has its own roof geometry
   - Components may share walls (where wings connect)

3. **Handle Shared Walls**
   - When wings connect to main building, shared walls should not be duplicated
   - Identify connection points and exclude inner faces
   - Only render outer faces of shared walls

4. **Merge All Components**
   - Merge all wall geometries into single `BufferGeometry`
   - Merge all roof geometries into single `BufferGeometry` (or keep separate)
   - Use geometry groups to assign materials per component/facade

### Implementation for Complex Shapes

#### Step 1: Component Geometry Generation

```javascript
/**
 * Generate geometry for a building component (main, wing, or attached structure)
 * @param {Object} component - Component definition (width, depth, height, position, floors)
 * @param {Object} structure - Full structure definition (for windows, doors, etc.)
 * @param {string} componentType - 'main', 'wing', or 'attached'
 * @returns {Array<GeometryDefinition>} Array of geometry definitions for walls
 */
generateComponentGeometry(component, structure, componentType) {
  const geometries = [];
  
  // Generate 4 walls for this component
  const walls = [
    { facade: 'front', width: component.width, depth: component.depth, ... },
    { facade: 'back', width: component.width, depth: component.depth, ... },
    { facade: 'left', width: component.depth, depth: component.width, ... },
    { facade: 'right', width: component.depth, depth: component.width, ... },
  ];
  
  // Handle variable floor heights
  if (component.floors && component.floors.length > 0) {
    // Generate walls for each floor level
    for (const floor of component.floors) {
      // Create wall segments for this floor
      // Position adjusted by floor.y_offset
    }
  } else {
    // Single height (current implementation)
    // Generate standard walls
  }
  
  return geometries;
}
```

#### Step 2: Connection Detection

```javascript
/**
 * Detect where components connect and identify shared walls
 * @param {Object} main - Main building component
 * @param {Array<Object>} wings - Wing components
 * @param {Array<Object>} attached - Attached structure components
 * @returns {Array<ConnectionInfo>} Array of connection information
 */
detectConnections(main, wings, attached) {
  const connections = [];
  
  // Check each wing against main building
  for (const wing of wings) {
    const connection = findConnectionPoint(main, wing);
    if (connection) {
      connections.push({
        component1: main,
        component2: wing,
        sharedWall: connection.wall,
        connectionPoint: connection.point,
      });
    }
  }
  
  // Check attached structures
  for (const att of attached) {
    const connection = findAttachedConnection(main, att);
    if (connection) {
      connections.push({
        component1: main,
        component2: att,
        sharedWall: att.connection_wall,
        connectionPoint: connection.point,
      });
    }
  }
  
  return connections;
}
```

#### Step 3: Shared Wall Handling

```javascript
/**
 * Exclude inner faces of shared walls from geometry
 * @param {THREE.BufferGeometry} geometry - Wall geometry
 * @param {ConnectionInfo} connection - Connection information
 * @returns {THREE.BufferGeometry} Geometry with shared faces removed
 */
removeSharedWallFaces(geometry, connection) {
  // Identify faces that are internal (shared between components)
  // Remove those faces from the geometry
  // Keep only outer faces
  
  // This may require:
  // 1. Identifying which faces are shared (based on position/normal)
  // 2. Removing those faces from the index buffer
  // 3. Cleaning up unused vertices
}
```

#### Step 4: Multi-Component Merging

```javascript
/**
 * Merge geometries from multiple building components
 * @param {Array<ComponentGeometry>} componentGeometries - Geometries from all components
 * @param {Array<ConnectionInfo>} connections - Connection information
 * @returns {THREE.BufferGeometry} Merged geometry
 */
mergeComplexBuilding(componentGeometries, connections) {
  // 1. Remove shared wall faces based on connections
  const cleanedGeometries = componentGeometries.map((geom, idx) => {
    const relevantConnections = connections.filter(c => 
      c.component1 === geom.component || c.component2 === geom.component
    );
    return removeSharedWallFaces(geom, relevantConnections);
  });
  
  // 2. Merge all cleaned geometries
  const mergedGeometry = mergeBoxGeometries(cleanedGeometries);
  
  // 3. Create geometry groups for material assignment
  // Each component's walls get their own material group
  mergedGeometry.groups = createComponentGroups(componentGeometries);
  
  return mergedGeometry;
}
```

### Shader Material Considerations for Complex Shapes

**Challenge:** Each component may have different:
- Window patterns
- Door configurations
- Material properties (colors, textures)
- Floor heights (affects window/door positioning)

**Solution Options:**

**Option A: Per-Component Material Groups**
- Each component gets its own material group
- Each group has its own shader material with component-specific uniforms
- Pros: Clean separation, easy to maintain
- Cons: More materials (but still fewer than separate meshes)

**Option B: Facade-Based Material Groups**
- Group by facade type (front/back/left/right) across all components
- Use position-based logic in shader to determine which component
- Pros: Fewer materials
- Cons: More complex shader logic

**Option C: Hybrid Approach** (Recommended)
- Use component-based groups for main building
- Use facade-based groups for wings/attached structures
- Pros: Balance between simplicity and flexibility
- Cons: Moderate complexity

### Variable Floor Heights

**Challenge:** Buildings with different floor heights (setbacks, towers) need:
- Walls that step at different heights
- Windows/doors positioned correctly for each floor level
- Roofs at different heights

**Solution:**
- Generate wall segments per floor level
- Each floor level has its own geometry segment
- Windows/doors positioned relative to their floor level
- Roof geometry generated per component (may have multiple roof levels)

### Example: House with Attached Garage

```javascript
// Structure definition
{
  main: {
    width: 12.0,
    depth: 10.0,
    height: 8.0,  // 2 stories
    position: [x, y, z],
    floors: [
      { height: 4.0, y_offset: 0.0 },
      { height: 4.0, y_offset: 4.0 },
    ]
  },
  attached: [
    {
      type: "garage",
      width: 6.0,
      depth: 4.0,
      height: 3.0,
      position: [x - 7.0, y, z],  // Left side of house
      connection_wall: "left",
    }
  ]
}

// Geometry generation:
// 1. Generate 4 walls for main house (2 floors each = 8 wall segments)
// 2. Generate 3 walls for garage (front, back, right - left is shared)
// 3. Remove shared wall face (house left wall inner face, garage left wall)
// 4. Merge all wall geometries
// 5. Generate roofs (house roof + garage roof, may merge or keep separate)
```

### Example: L-Shaped Building

```javascript
// Structure definition
{
  main: {
    width: 20.0,
    depth: 15.0,
    height: 12.0,
    position: [x, y, z],
  },
  wings: [
    {
      width: 10.0,
      depth: 8.0,
      height: 12.0,
      position: [x + 10.0, y + 7.5, z],  // Extends from right side
      rotation: 0.0,
    }
  ]
}

// Geometry generation:
// 1. Generate 4 walls for main building
// 2. Generate 4 walls for wing
// 3. Detect connection: wing connects to main building's right wall
// 4. Remove shared faces (main right wall inner face, wing left wall)
// 5. Merge all wall geometries
// 6. Generate single L-shaped roof (or merge two rectangular roofs)
```

### Data Structure Changes Required

#### Server-Side (buildings.py)

**Current Building Data Structure:**
```python
{
    "id": "proc_0_5_110_1",
    "type": "building",
    "position": [x, y, z],
    "width": 20.0,
    "depth": 15.0,
    "height": 12.0,
    "building_type": "residential",
    "building_subtype": "apartment",
    "windows": [...],
    "doors": {...},
    "garage_doors": [...],
    "properties": {
        "colors": {...},
        "corner_trim_width": 0.2,
    }
}
```

**Future Building Data Structure (Backwards Compatible):**
```python
{
    "id": "proc_0_5_110_1",
    "type": "building",
    "position": [x, y, z],  # Main building position
    
    # Simple building (backwards compatible)
    "width": 20.0,  # Optional if components present
    "depth": 15.0,  # Optional if components present
    "height": 12.0,  # Optional if components present
    
    # Complex building (new)
    "components": {
        "main": {
            "width": 20.0,
            "depth": 15.0,
            "height": 12.0,
            "position": [0, 0, 0],  # Relative to building position
            "floors": [
                {"height": 4.0, "y_offset": 0.0},
                {"height": 4.0, "y_offset": 4.0},
                {"height": 4.0, "y_offset": 8.0},
            ],
            "windows": [...],  # Windows for main component
            "doors": {...},    # Doors for main component
        },
        "wings": [
            {
                "width": 10.0,
                "depth": 8.0,
                "height": 8.0,
                "position": [15.0, 0, 0],  # Relative to main
                "rotation": 0.0,
                "connection": {
                    "to": "main",
                    "wall": "right",  # Which wall of main it connects to
                    "offset": 0.0,   # Position along that wall
                },
                "windows": [...],
                "doors": {...},
            }
        ],
        "attached": [
            {
                "type": "garage",
                "width": 6.0,
                "depth": 4.0,
                "height": 3.0,
                "position": [-8.0, 0, 0],  # Relative to main
                "connection": {
                    "to": "main",
                    "wall": "left",
                    "offset": 0.0,
                },
                "doors": {...},  # Garage doors
            }
        ]
    },
    
    # Global properties (applied to all components if not overridden)
    "building_type": "residential",
    "building_subtype": "apartment",
    "properties": {
        "colors": {...},
        "corner_trim_width": 0.2,
    }
}
```

**Server-Side Functions to Add:**
```python
def generate_complex_building(
    position: Tuple[float, float],
    zone_type: str,
    zone_importance: float,
    building_seed: int,
    floor: int,
    hub_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate a building that may have multiple wings or attached structures.
    
    Returns building with either simple (width/depth/height) or complex (components) structure.
    """
    rng = seeded_random(building_seed)
    
    # Determine if building should be complex based on zone type and importance
    is_complex = should_generate_complex_building(zone_type, zone_importance, rng)
    
    if is_complex:
        return generate_complex_building_structure(position, zone_type, zone_importance, building_seed, floor, hub_name, rng)
    else:
        # Fall back to simple building generation
        return generate_building(position, zone_type, zone_importance, building_seed, floor, hub_name)

def should_generate_complex_building(
    zone_type: str,
    zone_importance: float,
    rng: random.Random
) -> bool:
    """
    Determine if a building should have complex shape.
    Higher importance = more likely to be complex.
    """
    if zone_type == "residential":
        # Houses more likely to have attached garages
        return rng.random() < 0.3 + (zone_importance * 0.2)
    elif zone_type == "commercial":
        # Office buildings more likely to have wings
        return rng.random() < 0.2 + (zone_importance * 0.3)
    elif zone_type == "industrial":
        # Warehouses/factories may have multiple wings
        return rng.random() < 0.4 + (zone_importance * 0.2)
    return False

def generate_complex_building_structure(...) -> Dict[str, Any]:
    """
    Generate building with wings or attached structures.
    """
    # Generate main building
    main = generate_main_component(...)
    
    # Generate wings (if applicable)
    wings = []
    if should_have_wings(zone_type, rng):
        wing_count = rng.randint(1, 3)
        for i in range(wing_count):
            wing = generate_wing(main, i, rng)
            wings.append(wing)
    
    # Generate attached structures (if applicable)
    attached = []
    if should_have_attached(zone_type, building_subtype, rng):
        if building_subtype == "house":
            # Houses may have attached garages
            garage = generate_attached_garage(main, rng)
            attached.append(garage)
    
    # Generate windows/doors for each component
    # ...
    
    return {
        "components": {
            "main": main,
            "wings": wings,
            "attached": attached,
        },
        # ... other properties
    }
```

#### Client-Side (structure-manager.js)

**Current Function Signature:**
```javascript
createDetailedBuilding(structureGroup, structure, dimensions) {
  const { width, depth, height } = dimensions;
  // ... create 4 walls + 1 roof
}
```

**Future Function Signature (Backwards Compatible):**
```javascript
createDetailedBuilding(structureGroup, structure, dimensions) {
  // Check if building has components (complex) or simple dimensions
  if (structure.components) {
    return createComplexBuilding(structureGroup, structure, dimensions);
  } else {
    // Use simple dimensions (backwards compatible)
    const { width, depth, height } = dimensions;
    return createSimpleBuilding(structureGroup, structure, { width, depth, height });
  }
}

createComplexBuilding(structureGroup, structure, dimensions) {
  const { main, wings = [], attached = [] } = structure.components;
  
  // Generate geometries for all components
  const componentGeometries = [];
  
  // Main building
  const mainGeometries = generateComponentGeometries(main, structure, 'main');
  componentGeometries.push(...mainGeometries);
  
  // Wings
  for (const wing of wings) {
    const wingGeometries = generateComponentGeometries(wing, structure, 'wing');
    componentGeometries.push(...wingGeometries);
  }
  
  // Attached structures
  for (const att of attached) {
    const attGeometries = generateComponentGeometries(att, structure, 'attached');
    componentGeometries.push(...attGeometries);
  }
  
  // Detect connections and remove shared walls
  const connections = detectConnections(main, wings, attached);
  const cleanedGeometries = removeSharedWalls(componentGeometries, connections);
  
  // Merge all geometries
  const mergedGeometry = mergeComponentGeometries(cleanedGeometries);
  
  // Create materials for each component/facade
  const materials = createComponentMaterials(structure, componentGeometries);
  
  // Create merged mesh
  const mergedMesh = new THREE.Mesh(mergedGeometry, materials);
  structureGroup.add(mergedMesh);
  
  // Generate roofs (may be multiple for complex buildings)
  generateRoofs(structureGroup, structure, main, wings, attached);
}
```

**New Functions to Add:**
- `generateComponentGeometries(component, structure, componentType)` - Generate wall geometries for a component
- `detectConnections(main, wings, attached)` - Find where components connect
- `removeSharedWalls(geometries, connections)` - Remove inner faces of shared walls
- `mergeComponentGeometries(geometries)` - Merge all component geometries
- `createComponentMaterials(structure, geometries)` - Create shader materials for each component
- `generateRoofs(group, structure, main, wings, attached)` - Generate roof geometries (may be multiple)

### Migration Strategy

**Phase 1: Simple Merging (Current Plan)**
- Merge 4 walls + 1 roof for simple rectangular buildings
- Establish geometry merging infrastructure
- Test with existing simple buildings

**Phase 2: Component Support**
- Add component data structure support
- Implement component geometry generation
- Support wings and attached structures
- Test with complex building shapes

**Phase 3: Advanced Features**
- Variable floor heights
- Connection detection and shared wall removal
- Multi-level roofs
- Optimize for performance

## Future Optimizations (Out of Scope)

- Merge roof into same geometry (requires material unification)
- Share merged geometries between identical buildings
- Use instanced rendering for repeated buildings
- Optimize shader for merged geometry (reduce uniform count)
- Advanced shape generation (curved walls, non-rectangular footprints)

