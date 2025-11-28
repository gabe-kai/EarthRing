# Minimap System Documentation

## Overview

The minimap system provides a 2D top-down view of the player's position and surrounding environment. It displays platform chunks, player facing direction, and supports two zoom levels: full ring view and local area view.

## User Interface

### Title Display

The minimap displays a title overlay at the bottom center showing:
- **First line**: Location name (Ring or Hub name) and Floor number
  - Format: `"{Location} - F: {Floor}"`
  - Example: `"Kongo Hub - F: 0"` or `"Ring - F: 0"`
- **Second line**: Current coordinates
  - Format: `"s: {s}km; r: {r}m"`
  - Example: `"s: 125.5km; r: 200m"`

The title is displayed as a semi-transparent, rounded container that overlays the minimap canvas without taking up layout space.

### Date and Time Display

Above the minimap are three containers aligned at the top edge:

#### Date Display (Left)
- **Format**: `YYYY.MM.DD`
- **Position**: Left side, aligned with Earth icon container top
- **Example**: `2024.12.25`
- Shows the local date for Earth directly below the player's position on the ring

#### Time Display (Right)
- **Format**: Two rows
  - **Top row**: `HH:mm:ss` (24-hour format)
  - **Bottom row**: `GMT±X` (timezone offset)
- **Position**: Right side, aligned with Earth icon container top
- **Example**: 
  ```
  14:23:45
  GMT-3
  ```
- Shows the local time and timezone for Earth directly below the player's position

**Timezone Calculation:**
- Based on player's theta (ring angle) converted to longitude
- Theta 0° = GMT+0 (Prime Meridian)
- Theta -60° = GMT-3 (Brazil standard time)
- Uses 20° per hour for timezone calculation
- Updates in real-time as the player moves around the ring

#### Earth Icon (Center)
- **Visual**: Earth with orbital ring, showing real-time day/night cycle
- **Position**: Center, overlapping the top border of the minimap (half inside, half outside)
- **Size**: 33% of minimap width, square aspect ratio
- **Features**:
  - Real-time day/night terminator based on current UTC time
  - Ring visualization matching the favicon design
  - Marker showing Gulf of Guinea position (0° longitude, 0° latitude)
  - Updates every second to reflect changing time of day
- **Rendering**: Canvas-based with gradient shading for day/night transition

### Zoom Controls

Zoom control buttons are positioned on the right side of the minimap, overlapping the border:
- **Plus button (+)**: Zooms in to local area view (2km radius)
- **Minus button (−)**: Zooms out to full ring view
- Buttons are centered vertically and half-inside/half-outside the minimap border

### Click to Copy Coordinates

Clicking anywhere on the minimap canvas (excluding zoom controls and title) copies the current camera target coordinates to the clipboard. The coordinates are formatted as `"x.xx, y.yy, z.zz"` in EarthRing legacy coordinates.

A notification appears in the Info box confirming the coordinates were copied. This feature allows players to quickly share or record their position.

**Implementation details:**
- Click handler is attached to the canvas container
- Excludes clicks on zoom buttons and title overlay
- Uses `navigator.clipboard.writeText()` API
- Shows notification via `addNotification()` in Info box

## Architecture

### Components

- **Minimap Class** (`client-web/src/ui/minimap.js`): Main minimap component
- **Coordinate Systems**: Uses EarthRing coordinate system utilities
- **Rendering**: HTML5 Canvas 2D API for drawing

### Key Dependencies

- `cameraController`: Provides player position and camera state
- `gameStateManager`: Provides chunk data and active floor
- `sceneManager`: Provides Three.js camera for direction calculation
- `chunkManager`: Provides Three.js mesh geometry for platform rendering

## Coordinate System Conversions

### Overview

The minimap performs multiple coordinate system conversions to transform 3D world positions into 2D screen coordinates:

```
Three.js World Space → RingArc Coordinates → Local Coordinates → Screen Coordinates
```

### Step-by-Step Conversion Process

#### 1. Get Player Position

```javascript
// Get camera target (focus point) in EarthRing coordinates
const erPos = this.cameraController.getTargetEarthRingPosition();
// erPos = { x, y, z } in EarthRing legacy coordinate system

// Convert to RingArc coordinates
const polar = legacyPositionToRingPolar(erPos.x, erPos.y, erPos.z);
const arc = ringPolarToRingArc(polar);
// arc = { s, r, z }
//   s: arc length along ring (0 to RING_CIRCUMFERENCE)
//   r: radial offset from ring centerline (north/south)
//   z: vertical offset from equatorial plane
```

**Why use camera target instead of camera position?**
- Prevents the map from "gyrating" when zoomed out
- The arrow spins in place rather than the entire map rotating
- Provides a stable reference point for the minimap

#### 2. Get Chunk Position

```javascript
// Get chunk's base position from chunk index
const chunkArc = chunkIndexToRingArc(chunkIndex);
// chunkArc.s = (chunkIndex + 0.5) * CHUNK_LENGTH
// chunkArc.r = 0 (default - chunks may have different r positions)
// chunkArc.z = 0 (default)

// Calculate actual chunk radial position (r) from geometry
// This is critical because chunkIndexToRingArc always returns r=0
let chunkR = 0; // Default

// Option 1: From chunk data geometry vertices
if (chunkData?.geometry?.vertices) {
  // Vertex format: [x, y, z] where y is radial offset
  chunkR = average of vertex[1] values
}

// Option 2: From Three.js mesh geometry
if (mesh?.geometry?.attributes?.position) {
  // Sample mesh vertices, transform to world space,
  // convert to RingArc, and average the r values
  chunkR = average of ringArc.r values from sampled vertices
}
```

#### 3. Calculate Local Coordinates (Relative to Player)

```javascript
// Calculate arc difference (east/west offset)
let arcDiff = chunkCenterS - playerArcS;

// Handle ring wrapping (ring is circular, so positions wrap)
if (arcDiff > RING_CIRCUMFERENCE / 2) {
  arcDiff -= RING_CIRCUMFERENCE; // Wrap west
} else if (arcDiff < -RING_CIRCUMFERENCE / 2) {
  arcDiff += RING_CIRCUMFERENCE; // Wrap east
}

// Calculate radial difference (north/south offset)
const localX = arcDiff;        // East/west in meters
const localY = chunkR - arc.r; // North/south in meters
```

**Coordinate System Notes:**
- `localX` (arc difference): Positive = east of player, Negative = west of player
- `localY` (radial difference): Positive = north of player (radial outward), Negative = south of player (radial inward)

#### 4. Convert to Screen Coordinates

```javascript
// Minimap view settings
const viewSize = 2000; // 2km view radius
const scale = Math.min(canvasWidth, canvasHeight) / viewSize;
// scale = pixels per meter

// Screen coordinate system:
//   +X = right (east)
//   +Y = down (south)
//   Center = player position

const screenX = centerX + (localX * scale);
const screenY = centerY + (localY * scale);
```

**Important:** We do NOT negate `localY` when calculating `screenY`. This means:
- Positive `localY` (north) → Positive `screenY` (down on screen)
- This matches the coordinate system where north appears "down" initially
- The grid and platforms move correctly with this convention

## Platform Chunk Rendering

### Overview

Platform chunks are rendered as polygons (when mesh geometry is available) or rectangles (as fallback). The rendering process involves:

1. Finding chunks in range
2. Converting chunk positions to screen coordinates
3. Extracting platform geometry from mesh
4. Drawing filled polygons with proper ordering

### Finding Chunks in Range

```javascript
// Calculate which chunks are visible in the 2km view
const viewRadius = 1000; // 1km radius (half of 2km view)
const playerChunkIndex = Math.floor(playerArcS / CHUNK_LENGTH);
const chunksNeeded = Math.ceil(viewSize / CHUNK_LENGTH) + 2; // Extra chunks for safety
const halfChunks = Math.ceil(chunksNeeded / 2);

// Get chunks around player (with wrapping)
for (let offset = -halfChunks; offset <= halfChunks; offset++) {
  const absoluteIndex = playerChunkIndex + offset;
  const wrappedIndex = ((absoluteIndex % CHUNK_COUNT) + CHUNK_COUNT) % CHUNK_COUNT;
  const chunkID = `${activeFloor}_${wrappedIndex}`;
  
  // Get chunk data and mesh
  let chunkData = gameStateManager.getChunk(chunkID);
  let mesh = chunkManager?.chunkMeshes?.get(chunkID);
}
```

### Distance Filtering

```javascript
// Calculate distance from player to chunk center
const directDist = Math.abs(chunkCenterS - playerArcS);
const wrappedDist = RING_CIRCUMFERENCE - directDist;
const distance = Math.min(directDist, wrappedDist);

// Only render chunks within view radius + chunk length
if (distance > viewRadius + CHUNK_LENGTH) {
  return; // Skip this chunk
}
```

### Mesh Geometry Projection (Polygon Rendering)

When a Three.js mesh is available, we project its geometry to 2D:

#### Step 1: Sample Vertices

```javascript
const positions = mesh.geometry.attributes.position;
const vertexCount = positions.count;
const targetSampleCount = 40; // Sample ~40 points for smooth curves
const sampleStep = Math.max(1, Math.floor(vertexCount / targetSampleCount));

const rawPoints = [];

for (let i = 0; i < vertexCount; i += sampleStep) {
  // Get vertex in local mesh space
  const x = positions.getX(i);
  const y = positions.getY(i);
  const z = positions.getZ(i);
  
  // Transform to world space
  mesh.updateMatrixWorld();
  const worldPos = new THREE.Vector3(x, y, z);
  worldPos.applyMatrix4(mesh.matrixWorld);
  
  // Convert to RingArc coordinates
  const ringArc = threeJSToRingArc({ 
    x: worldPos.x, 
    y: worldPos.y, 
    z: worldPos.z 
  });
  
  // Convert to local coordinates relative to player
  let localS = ringArc.s - playerArcS;
  // Handle wrapping...
  const localR = ringArc.r - arc.r;
  
  // Convert to screen coordinates
  const screenX = centerX + (localS * scale);
  const screenY = centerY + (localR * scale);
  
  rawPoints.push({ x: screenX, y: screenY });
}
```

#### Step 2: Sort Points by Angle (Critical!)

**Problem:** Mesh vertices are not guaranteed to be in perimeter order. Drawing them in mesh order can create self-intersecting polygons, causing moire patterns or incorrect fills.

**Solution:** Sort points by angle around the polygon center:

```javascript
// Calculate center of all points
const centerX_points = rawPoints.reduce((sum, p) => sum + p.x, 0) / rawPoints.length;
const centerY_points = rawPoints.reduce((sum, p) => sum + p.y, 0) / rawPoints.length;

// Sort by angle around center (counter-clockwise)
const points = rawPoints.sort((a, b) => {
  const angleA = Math.atan2(a.y - centerY_points, a.x - centerX_points);
  const angleB = Math.atan2(b.y - centerY_points, b.x - centerX_points);
  return angleA - angleB;
});
```

**Why this works:**
- `atan2(y, x)` gives angle from positive X axis
- Sorting by angle ensures points are in perimeter order
- Prevents self-intersections and ensures correct polygon winding

#### Step 3: Draw Polygon

```javascript
if (points.length >= 3) {
  this.ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
  this.ctx.strokeStyle = '#00ff00';
  this.ctx.lineWidth = 2;
  
  // Draw polygon path
  this.ctx.beginPath();
  this.ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    this.ctx.lineTo(points[i].x, points[i].y);
  }
  this.ctx.closePath();
  
  // Fill with 'evenodd' rule (handles complex polygons)
  this.ctx.fill('evenodd');
  this.ctx.stroke();
}
```

**Fill Rule:**
- `'evenodd'`: Fills based on how many times a ray from a point crosses polygon edges
- Works regardless of polygon winding order
- Handles complex/self-intersecting polygons better than default 'nonzero' rule

### Rectangle Fallback

When mesh geometry is not available, draw a simple rectangle:

```javascript
const chunkLengthScreen = CHUNK_LENGTH * scale; // 1000m * scale
const platformWidthMeters = platformMaxR - platformMinR;
const chunkWidthScreen = Math.max(8, platformWidthMeters * scale);

// Calculate rectangle bounds
const platformCenterR = (platformMinR + platformMaxR) / 2;
const platformCenterLocalY = platformCenterR - arc.r;
const platformCenterScreenY = centerY + (platformCenterLocalY * scale);

const platformMinY = platformCenterScreenY - chunkWidthScreen / 2;
const platformMaxY = platformCenterScreenY + chunkWidthScreen / 2;
const platformMinX = screenX - chunkLengthScreen / 2;
const platformMaxX = screenX + chunkLengthScreen / 2;

// Draw rectangle
this.ctx.fillRect(platformMinX, platformMinY, 
                  platformMaxX - platformMinX, 
                  platformMaxY - platformMinY);
this.ctx.strokeRect(platformMinX, platformMinY, 
                    platformMaxX - platformMinX, 
                    platformMaxY - platformMinY);
```

## Player-Facing Arrow

### Overview

The arrow indicates the direction the player (camera target) is facing. It's always drawn at the center of the minimap and rotates to match camera orientation.

### Coordinate System Mapping

**Three.js Coordinate System:**
- `+X`: Eastward along the ring
- `+Y`: Vertical (up/down, floors)
- `+Z`: Radial outward from ring (north/south)

**Minimap Screen Coordinate System:**
- `+X`: Right (east)
- `+Y`: Down (south)
- Center: Player position

**Mapping:**
- Three.js `+X` (east) → Screen `+X` (right)
- Three.js `+Z` (north/radial outward) → Screen `+Y` (down)

### Calculation Process

#### Step 1: Get Camera Forward Direction

```javascript
const camera = sceneManager.getCamera();
const forward = new THREE.Vector3();
camera.getWorldDirection(forward);
// forward = normalized vector pointing in camera's forward direction
```

#### Step 2: Project onto XZ Plane (Ignore Vertical)

```javascript
// Get X and Z components (ignore Y/vertical)
const forwardX = forward.x; // East/west component
const forwardZ = forward.z; // North/south component (radial)
const forwardLength = Math.sqrt(forwardX * forwardX + forwardZ * forwardZ);

if (forwardLength > 0.01) { // Only draw if meaningful horizontal direction
  // Normalize
  const dirX = forwardX / forwardLength; // East/West (-1 to +1)
  const dirZ = forwardZ / forwardLength; // North/South (-1 to +1)
}
```

**Why project onto XZ plane?**
- Minimap is top-down view (2D)
- We only care about horizontal direction, not camera pitch
- Ensures arrow is always flat in the minimap

#### Step 3: Map to Screen Coordinates

```javascript
// Three.js XZ → Screen XY mapping
const screenDirX = dirX;  // East → Right
const screenDirY = dirZ;  // North → Down (positive Y on screen)
```

**Note:** `screenDirY = dirZ` (not negated). This means:
- When facing north (`dirZ = +1`), arrow points down on screen
- This matches the coordinate system where north appears "down" initially
- The arrow direction matches platform movement correctly

#### Step 4: Draw Arrow Triangle

```javascript
const arrowLength = 12; // pixels
const arrowWidth = 8;   // pixels

// Arrow tip (pointing in facing direction)
const tipX = centerX + screenDirX * arrowLength;
const tipY = centerY + screenDirY * arrowLength;

// Perpendicular vector for arrow base width
// Perpendicular to (screenDirX, screenDirY) is (-screenDirY, screenDirX)
const perpX = -screenDirY;
const perpY = screenDirX;

// Arrow base (behind tip)
const baseBackX = centerX - screenDirX * (arrowLength * 0.3);
const baseBackY = centerY - screenDirY * (arrowLength * 0.3);

// Arrow base corners
const baseLeftX = baseBackX + perpX * (arrowWidth / 2);
const baseLeftY = baseBackY + perpY * (arrowWidth / 2);
const baseRightX = baseBackX - perpX * (arrowWidth / 2);
const baseRightY = baseBackY - perpY * (arrowWidth / 2);

// Draw filled triangle
this.ctx.fillStyle = '#00ff00';
this.ctx.beginPath();
this.ctx.moveTo(tipX, tipY);
this.ctx.lineTo(baseLeftX, baseLeftY);
this.ctx.lineTo(baseRightX, baseRightY);
this.ctx.closePath();
this.ctx.fill();
```

## Grid System

### Overview

The grid provides spatial reference in the local view. It moves with the player to maintain relative positioning.

### Grid Configuration

```javascript
const gridSpacing = 500; // 500 meters between grid lines
const viewSize = 2000;   // 2km view radius
```

### Grid Offset Calculation

The grid must move with the player to maintain correct relative positions:

```javascript
// Calculate offset based on player position modulo grid spacing
const offsetS = ((arc.s % gridSpacing) + gridSpacing) % gridSpacing;
const offsetR = ((arc.r % gridSpacing) + gridSpacing) % gridSpacing;
```

**How it works:**
- `arc.s % gridSpacing` gives remainder when dividing arc position by grid spacing
- Adding `gridSpacing` and taking modulo again ensures positive value
- This offset shifts grid lines so they align with player position

### Drawing Grid Lines

#### Vertical Lines (East/West)

```javascript
// Calculate range of grid lines to draw
const startS = Math.floor(-viewSize / gridSpacing) * gridSpacing - offsetS;
const endS = Math.ceil(viewSize / gridSpacing) * gridSpacing - offsetS;

// Draw vertical lines
for (let s = startS; s <= endS; s += gridSpacing) {
  const x = centerX + (s * scale);
  if (x >= -50 && x <= width + 50) { // Only draw if visible
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x, height);
    this.ctx.stroke();
  }
}
```

#### Horizontal Lines (North/South)

```javascript
// Calculate range of grid lines to draw
const startR = Math.floor(-viewSize / gridSpacing) * gridSpacing - offsetR;
const endR = Math.ceil(viewSize / gridSpacing) * gridSpacing - offsetR;

// Draw horizontal lines
for (let r = startR; r <= endR; r += gridSpacing) {
  const y = centerY + (r * scale);
  if (y >= -50 && y <= height + 50) { // Only draw if visible
    this.ctx.beginPath();
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(width, y);
    this.ctx.stroke();
  }
}
```

**Key Points:**
- Grid lines are positioned relative to player (offset by `offsetS`/`offsetR`)
- Lines are drawn in world space coordinates (`s` and `r`), then converted to screen
- Only lines within canvas bounds (with margin) are drawn for performance

## Zoom Levels

### Full Ring View

- **View**: Entire planetary ring (264,000 km circumference)
- **Display**: Circular view with ring outline
- **Features**:
  - 12 pillar stations at 30-degree intervals
  - Player position as dot on ring
  - Station markers
- **No platforms shown** (too small at this scale)

### Local View

- **View**: 2km radius around player
- **Display**: Top-down 2D map
- **Features**:
  - Moving grid (500m spacing)
  - Platform chunks as polygons/rectangles
  - Player-facing arrow
  - North indicator
- **Scale**: `scale = min(canvasWidth, canvasHeight) / 2000` (pixels per meter)
- **Drawing Order**: Grid → Platforms → Arrow/North (arrow and north indicator are drawn last to appear on top of all other elements)

## Performance Considerations

### Update Frequency

```javascript
// Update every 200ms (5 FPS)
this.updateInterval = setInterval(() => {
  this.update();
}, 200);
```

**Why 200ms?**
- Minimap doesn't need 60 FPS
- Reduces CPU usage
- Still feels responsive

### Chunk Filtering

- Only chunks within `viewRadius + CHUNK_LENGTH` are considered
- Distance calculation handles ring wrapping correctly
- Chunks are filtered before expensive geometry operations

### Vertex Sampling

- Samples ~40 vertices from mesh (not all vertices)
- Reduces computation while maintaining visual quality
- Sampling step: `Math.max(1, Math.floor(vertexCount / 40))`

### Canvas Clipping

- Canvas automatically clips drawing outside bounds
- No need to manually filter off-screen points
- Allows drawing complete polygons even when partially off-screen

## Common Issues and Solutions

### Issue: Platforms Not Visible

**Causes:**
1. Chunks not in range (check distance calculation)
2. Chunk data/mesh not available (check chunkManager)
3. Coordinate conversion errors (check screen coordinates)

**Debug:**
- Enable `window.earthring.debug = true`
- Check console logs for chunk processing
- Verify screen coordinates are within canvas bounds

### Issue: Moire Patterns in Fill

**Cause:** Polygon vertices not in correct order

**Solution:** Sort points by angle around center before drawing

### Issue: Grid Not Moving

**Cause:** Grid offset calculation incorrect

**Solution:** Ensure offset uses modulo operation: `((value % spacing) + spacing) % spacing`

### Issue: Arrow Pointing Wrong Direction

**Cause:** Coordinate system mapping incorrect

**Solution:** Verify Three.js XZ → Screen XY mapping matches coordinate conventions

### Issue: Platforms Moving in Reverse

**Cause:** Y coordinate sign incorrect

**Solution:** Ensure `screenY = centerY + (localY * scale)` (no negation) matches coordinate system

## Drawing Order

The minimap uses a specific drawing order to ensure proper visual layering:

1. **Grid Lines** (drawn first, lowest layer)
   - Vertical lines (east/west)
   - Horizontal lines (north/south)
   - Semi-transparent green color

2. **Platform Chunks** (drawn second, middle layer)
   - Polygons (from mesh geometry) or rectangles (fallback)
   - Opaque green fill with bright green outline
   - All platforms drawn before arrow/north

3. **Player-Facing Arrow** (drawn third, top layer)
   - Green triangle at center
   - Always visible above platforms

4. **North Indicator** (drawn last, top layer)
   - "N" text and arrow at top
   - Always visible above all other elements

**Implementation**: The arrow and north indicator are drawn at the very end of `drawLocalView()` to ensure they appear on top of all other minimap elements.

## Future Improvements

1. **LOD System**: Use simpler geometry for distant chunks
2. **Caching**: Cache polygon points to avoid recalculation
3. **Smoothing**: Interpolate between updates for smoother movement
4. **Labels**: Add chunk/zone labels in local view
5. **Waypoints**: Show waypoints or markers on minimap
6. **Zoom Levels**: Add intermediate zoom levels (e.g., 5km, 10km)

