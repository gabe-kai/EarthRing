# Client Architecture

## Table of Contents

- [Overview](#overview)
- [Client Types](#client-types)
  - [Phase 1: Web Client (Initial)](#phase-1-web-client-initial)
  - [Phase 2: Light Local Client (Future)](#phase-2-light-local-client-future)
  - [Phase 3: Heavy Local Client (Future)](#phase-3-heavy-local-client-future)
- [Architecture Layers](#architecture-layers)
  - [Layer 1: Network Layer](#layer-1-network-layer)
  - [Layer 2: Game State Manager](#layer-2-game-state-manager)
  - [Layer 3: Rendering Engine](#layer-3-rendering-engine)
  - [Layer 4: Input Handler](#layer-4-input-handler)
  - [Layer 5: Chunk Loader](#layer-5-chunk-loader)
- [Web Client Architecture (Three.js)](#web-client-architecture-threejs)
  - [Technology Stack Decision](#technology-stack-decision)
  - [Technology Stack](#technology-stack)
  - [Project Structure](#project-structure)
  - [Utility Modules](#utility-modules-implemented)
  - [Rendering Pipeline](#rendering-pipeline)
  - [Performance Optimization](#performance-optimization)
- [Graphics Abstraction Layer](#graphics-abstraction-layer)
  - [Purpose](#purpose)
  - [Interface](#interface)
  - [Implementation Strategy](#implementation-strategy)
- [State Management](#state-management)
  - [Local State](#local-state)
  - [Server State Synchronization](#server-state-synchronization)
- [Asset Management](#asset-management)
  - [Asset Types](#asset-types)
  - [Asset Loading](#asset-loading)
- [UI System](#ui-system)
  - [UI Components](#ui-components)
  - [UI Framework](#ui-framework)
- [Input Handling](#input-handling)
  - [Input Types](#input-types)
  - [Camera Controls](#camera-controls)
- [Future Client Migration](#future-client-migration)
  - [Migration Path](#migration-path)
  - [Compatibility Strategy](#compatibility-strategy)
- [Performance Targets](#performance-targets)
  - [Web Client](#web-client)
  - [Light Client](#light-client)
  - [Unreal Client](#unreal-client)
- [Display and UI Layout](#display-and-ui-layout)
  - [Aspect Ratio Strategy](#aspect-ratio-strategy)
  - [UI Layout System](#ui-layout-system)
- [Modding and User-Generated Content](#modding-and-user-generated-content)
  - [Modding Support](#modding-support)
  - [User-Generated Content](#user-generated-content)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

The EarthRing client architecture is designed to support multiple client types while maintaining compatibility with the same server API. The architecture emphasizes modularity, allowing graphics and rendering to evolve independently while maintaining game logic consistency.

## Client Types

### Phase 1: Web Client (Initial)

**Technology**: Three.js (see Technology Stack Decision section for rationale)

**Rationale**:
- No installation required
- Cross-platform compatibility
- Rapid development and iteration
- Easy updates and deployment
- Good performance for initial game mechanics

**Limitations**:
- Graphics quality limited by browser capabilities
- Network dependency
- Performance constraints
- Limited access to system resources

### Phase 2: Light Local Client (Future)

**Technology**: Electron or native application with web rendering

**Rationale**:
- Better performance than browser
- Can cache assets locally
- More control over rendering pipeline
- Still uses web technologies for faster development
- Can access more system resources

**Advantages over Web**:
- Local asset caching
- Better performance
- More control over rendering
- Can run offline (with cached data)

### Phase 3: Heavy Local Client (Future)

**Technology**: Unreal Engine

**Rationale**:
- Maximum graphics fidelity
- Advanced lighting and effects
- Better physics simulation
- Professional game engine features
- High-performance rendering

**Considerations**:
- Requires graphics abstraction layer
- More complex development
- Larger download size
- Higher system requirements

## Architecture Layers

### Layer 1: Network Layer

Handles all communication with the server.

#### Responsibilities
- WebSocket connection management
- REST API client
- Message queuing and handling
- Reconnection logic
- Message serialization/deserialization

#### Implementation

```javascript
class NetworkLayer {
  constructor(serverUrl, authToken) {
    this.ws = new WebSocket(serverUrl);
    this.restClient = new RESTClient(serverUrl, authToken);
    this.messageQueue = [];
    this.reconnectAttempts = 0;
  }
  
  sendWebSocketMessage(type, data) {
    const message = { type, data };
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }
  
  requestChunks(chunkIds, lodLevel) {
    return this.sendWebSocketMessage('chunk_request', {
      chunks: chunkIds,
      lod_level: lodLevel
    });
  }
}
```

### Layer 2: Game State Manager ✅ **IMPLEMENTED**

Manages local game state and synchronization with server.

#### Responsibilities
- Local state cache
- State synchronization
- Conflict resolution
- State persistence
- Event handling

#### Implementation ✅ **IMPLEMENTED**

**Game State Manager** (`client-web/src/state/game-state.js`):
- Chunk cache management (Map-based storage)
- Player state management (ID, username, position, authentication)
- Connection state tracking (WebSocket and API status)
- **Active Floor management** (independent of camera elevation)
- Event system for state changes
- State reset functionality

**Key Features**:
- Chunk caching with add/remove/get operations
- Player state updates with event notifications
- Connection state tracking (WebSocket and API)
- **Active Floor**: Player-selected floor (-2 to +2) that determines which floor's content is loaded and where actions occur, independent of camera elevation
- **Authentication signal**: `gameStateManager.isUserAuthenticated()` mirrors `connectionState.api.authenticated`, allowing rendering systems to completely idle chunk/zone streaming until a login succeeds. This prevents the unauthenticated fetch loops we previously saw on cold starts.
- Event listeners for state changes (chunkAdded, chunkRemoved, playerStateChanged, connectionStateChanged, activeFloorChanged)
- State reset for logout/cleanup

**Active Floor System**:
- The active floor is a player-selected floor (-2 to +2) that determines which floor's content is loaded and where actions occur
- **Independent of camera elevation**: The camera can zoom out for a wider view while keeping actions on the selected floor
- **System-wide filtering**: All rendering systems (ChunkManager, ZoneManager, GridOverlay) filter content by active floor
- **Automatic cleanup**: When the active floor changes, all content from the old floor is removed and content for the new floor is loaded
- **Event-driven**: Systems listen to `activeFloorChanged` events to update automatically
- **UI Control**: Active floor can be changed using the `+`/`−` buttons in the zones toolbar (click "Z" icon to expand)

**Usage Example**:
```javascript
import { GameStateManager } from './state/game-state.js';

const gameStateManager = new GameStateManager();

// Get current active floor
const currentFloor = gameStateManager.getActiveFloor(); // Returns 0 (default)

// Change active floor
gameStateManager.setActiveFloor(1); // Switch to floor +1
// This triggers 'activeFloorChanged' event, causing all systems to update

// Add chunk to cache
gameStateManager.addChunk('0_12345', chunkData);

// Update player state
gameStateManager.updatePlayerState({ 
  id: 'player123', 
  username: 'Player1',
  position: { x: 1000, y: 0, z: 0 }
});

// Listen to state changes
gameStateManager.on('chunkAdded', ({ chunkID, chunkData }) => {
  console.log('Chunk added:', chunkID);
});

// Listen to active floor changes
gameStateManager.on('activeFloorChanged', ({ oldFloor, newFloor }) => {
  console.log(`Floor changed from ${oldFloor} to ${newFloor}`);
  // All systems automatically handle the floor change
});
```

#### Implementation (Original Example)

```javascript
class GameStateManager {
  constructor() {
    this.zones = new Map();
    this.structures = new Map();
    this.chunks = new Map();
    this.players = new Map();
  }
  
  updateZone(zoneData) {
    this.zones.set(zoneData.id, zoneData);
    this.emit('zone_updated', zoneData);
  }
  
  getZoneAtPosition(x, y, floor) {
    // Check cached zones first
    for (const zone of this.zones.values()) {
      if (this.pointInPolygon(x, y, zone.geometry)) {
        return zone;
      }
    }
    // Request from server if not cached
    return null;
  }
}
```

### Layer 3: Rendering Engine ✅ **IMPLEMENTED**

Handles 3D rendering using the chosen graphics library.

#### Responsibilities
- Scene rendering
- Camera management
- Lighting and effects
- Asset loading
- LOD management

#### Implementation ✅ **IMPLEMENTED**

**Scene Manager** (`client-web/src/rendering/scene-manager.js`):
- Manages Three.js scene, camera, and renderer
- Handles window resize automatically
- Sets up lighting (ambient + directional with shadows)
- Provides render loop with callback system
- Resource cleanup and disposal

**Camera Controller** (`client-web/src/input/camera-controller.js`):
- OrbitControls integration for camera movement
- EarthRing coordinate integration
- Smooth damping for camera movement
- Zoom, rotate, and pan controls
- Camera positioning from EarthRing coordinates
- **Keyboard Controls**:
  - **WASD**: Forward, left, backward, right movement (horizontal only, maintains elevation)
  - **Q/E**: Rotate camera counter-clockwise/clockwise around target
  - **R/F**: Pan camera up/down (vertical movement)
  - **PageUp/PageDown**: Zoom in/out
- **Mouse Controls**:
  - **Scroll Wheel**: Zoom in/out
  - **Middle Mouse Button (Hold)**: Rotate/orbit and tilt camera around target
  - **Right Mouse Button (Hold)**: Pan camera
  - **Left Mouse Button**: Select tool (default) - used for zone selection and drawing tools when active
- **Elevation-based speed scaling**: Movement speed automatically adjusts based on camera height above ground (slower near ground for precise control, faster at higher elevations)
  - Speed multiplier ranges from 0.1x (at 2m elevation) to 10.0x (at very high elevations)
  - Uses logarithmic scaling for smooth transitions
  - Reference elevation: 50m = 1.0x speed multiplier
  - Applies to WASD movement and R/F panning
- Programmatic camera movement (`moveToPosition()`) for smooth transitions

**Key Features**:
- Automatic window resize handling
- Shadow mapping support
- Render loop with callback system
- EarthRing coordinate system integration
- Camera controls (orbit, zoom, pan)

**Usage Example**:
```javascript
import { SceneManager } from './rendering/scene-manager.js';
import { CameraController } from './input/camera-controller.js';

const sceneManager = new SceneManager();
const cameraController = new CameraController(
  sceneManager.getCamera(),
  sceneManager.getRenderer(),
  sceneManager
);

// Set up render callbacks
sceneManager.onRender(() => {
  cameraController.update();
});

// Start rendering
sceneManager.start();
```

### Layer 4: Input Handler

Processes user input and converts to game actions.

#### Responsibilities
- Mouse/keyboard input
- Touch input (mobile)
- Camera controls
- UI interaction
- Action queuing

#### Implementation

```javascript
class InputHandler {
  constructor(renderingEngine, gameStateManager) {
    this.renderingEngine = renderingEngine;
    this.gameStateManager = gameStateManager;
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }
  
  onClick(event) {
    const worldPosition = this.screenToWorld(event.clientX, event.clientY);
    const zone = this.gameStateManager.getZoneAtPosition(
      worldPosition.x, worldPosition.y, 0
    );
    if (zone) {
      this.emit('zone_selected', zone);
    }
  }
}
```

### Layer 5: Chunk Loader ✅ **IMPLEMENTED**

Manages chunk loading and unloading based on viewport.

#### Responsibilities
- Chunk request management
- Chunk caching
- Memory management
- LOD selection
- Preloading

#### Implementation ✅ **IMPLEMENTED**

**Chunk Manager** (`client-web/src/chunks/chunk-manager.js`):
- WebSocket-based chunk requests
- Chunk caching integration with game state manager
- Automatic geometry decompression (transparent to rendering code)
- Position-based chunk loading
- **Active Floor filtering**: Only loads and renders chunks matching the active floor
- **Floor change handling**: Automatically clears chunks from other floors and reloads for new floor when active floor changes
- Mesh management and cleanup
- Seam-aware rendering with chunk wrapping
- **Upcoming change**: The chunk manager is being slimmed into a pure rendering adapter. Once the server-driven `stream_subscribe` contract is fully implemented, the client will stop issuing `chunk_request` messages entirely and simply consume streamed deltas (see `docs/07-streaming-system.md`).

**Chunk UI** (`client-web/src/ui/chunk-ui.js`):
- Chunk metadata retrieval interface
- Chunk deletion interface (with confirmation dialog)
- Position to chunk index conversion utility
- Quick example chunk buttons

**Key Features**:
- Request chunks via WebSocket (`chunk_request` message)
- Position-based chunk loading (converts ring position to chunk indices)
- **Active Floor filtering**: Chunks are requested and rendered only for the active floor (from `gameStateManager.getActiveFloor()`)
- Automatic chunk rendering when added to game state (only if chunk matches active floor)
- **Automatic geometry decompression**: Compressed geometry is automatically detected and decompressed (<3ms per chunk)
- Ring floor geometry rendering with variable width from station flares
- **Mesh reuse + precision fix**: Each `renderChunk()` call now computes a chunk-local origin, stores the large absolute X coordinate on the mesh transform, and caches meshes keyed by a `chunkVersionToken`. Identical geometry is skipped entirely unless the camera wraps by >5 km. This both eliminated the far-side platform flicker and keeps 264,000 km coordinates numerically stable inside `Float32Array` buffers.
- Keyboard-relative camera controls (WASD for forward/backward/strafe movement relative to camera view, QE for vertical up/down) integrated with OrbitControls while respecting focused input fields
- Seam-aware rendering: each chunk mesh is shifted by integer multiples of the ring circumference so the copy closest to the camera is rendered, eliminating gaps/overlaps at the 0/263999 seam. The wrapping calculation uses the raw camera position (which may be negative or > RING_CIRCUMFERENCE) to correctly determine which copy of each chunk to render.
- **Floor change handling**: When active floor changes, all chunk meshes from the old floor are removed, chunks are removed from game state, and chunks for the new floor are automatically loaded
- Mesh cleanup and resource disposal
- Integration with game state manager for caching
- Compression ratio logging (2.6-3.1:1 achieved in production)

#### Zone Rendering & Management ✅ **IMPLEMENTED**

**Zone Manager** (`client-web/src/zones/zone-manager.js`):
- Throttled bounding-box fetches (`GET /api/zones/area`) based on camera position
- Renders zones as world-anchored Three.js meshes (not camera-relative) with ring wrapping support
- Converts GeoJSON polygons/multipolygons to `THREE.ShapeGeometry` meshes with translucent fills and colored outlines
- Per-zone-type visibility controls (Residential, Commercial, Industrial, Mixed-Use, Park, Restricted)
- Keeps zone meshes in sync with `GameStateManager` events (`zoneAdded`, `zoneUpdated`, `zoneRemoved`, `zonesCleared`)
- Zone colors: Residential (green), Commercial (blue), Industrial (orange), Mixed-Use (yellow-orange gradient), Park (light green), Restricted (red)
- Exposes `loadZonesAroundCamera()`, `setVisibility()`, `setZoneTypeVisibility()` for UI control

**Grid Overlay** (`client-web/src/rendering/grid-overlay.js`):
- Circular 250m radius grid overlay centered on camera target
- 5m major grid lines (red horizontal, blue vertical) with 1m minor subdivisions
- Sharpened rendering via dynamic `THREE.LineSegments` geometry (no textures, no blurring at zoom)
- Shader-driven fade at the outer radius (currently directional: horizontal lines fade N-S, vertical fade E-W; TODO: implement true radial fade)
- Base opacity controls so zones stay fully visible
- Medium-thickness lines on every 20m multiple and a bold centerline at Y=0 for station spine navigation
- Minor-line LOD automatically hides fine lines when the camera zooms far away or gains altitude
- **TODO: Platform edge clipping** - The grid currently shows over the edge of platforms where they flare. Previous attempts to implement platform-aware clipping caused severe performance issues (FPS dropped to <1) and were reverted. A future implementation should clip grid lines to follow the curved edges of platform flares, but must do so without impacting performance.
- Visibility control via `setVisible()` method

**Zone Service** (`client-web/src/api/zone-service.js`):
- Typed helpers for area queries, owner listing, and CRUD operations (auth-required)
- Centralizes error handling / token injection for the new zone endpoints

**Bottom Toolbar** (`client-web/src/ui/bottom-toolbar.js`):
- Horizontal toolbar fixed at the bottom of the screen
- Tab-based system for different tool categories
- "Zones" tab contains zone type selection, drawing tools, and settings
- Zone type buttons: Residential, Commercial, Industrial, Mixed-Use, Park, Restricted
- Drawing tools: Select, Rectangle, Circle, Polygon, Paintbrush
- Settings: Paintbrush radius (always visible), Brush size keyboard shortcuts (`[` and `]`)
- Single-row horizontal layout with horizontal scrolling for overflow

**Zones Toolbar** (`client-web/src/ui/zones-toolbar.js`):
- Left-side vertical expandable toolbar with "Z" icon
- **Active Floor selector**: `+`/`−` buttons to change the active floor (-2 to +2)
- Displays current active floor number
- Controls for grid visibility and all zone types
- Per-zone-type visibility toggles (Show/Hide buttons)
- Smooth expand/collapse animation
- Automatically updates when active floor changes via game state events

**Zone UI** (`client-web/src/ui/zone-ui.js`):
- Integrated into bottom toolbar "Zones" tab
- Provides interface for:
  - Zone type selection (6 types: Residential, Commercial, Industrial, Mixed-Use, Park, Restricted)
  - Drawing tool selection (Select, Rectangle, Circle, Polygon, Paintbrush)
  - Paintbrush radius setting (always visible, default 10m)
  - Brush size keyboard shortcuts (`[` and `]` to decrease/increase)
  - Current tool and zone type display
- **Active Floor System**: Zones, chunks, and all game content are loaded based on the **active floor** (player-selected floor), not camera elevation. This allows the camera to zoom out for a wider view while keeping actions on the selected floor. The active floor can be changed using the `+`/`−` buttons in the zones toolbar.
- Zone selection: Click zones to select and view info window with details and "Dezone" button
- Integrated with ZoneEditor, ZoneManager, and GameStateManager for real-time updates
- Delete functionality removes zones from scene and game state immediately
- Future work: vertex editing, overlap indicators, advanced conflict resolution

**Usage Example**:
```javascript
import { ZoneManager } from './zones/zone-manager.js';
import { ZoneEditor } from './zones/zone-editor.js';
import { GridOverlay } from './rendering/grid-overlay.js';
import { createBottomToolbar } from './ui/bottom-toolbar.js';
import { initializeZonesTab } from './ui/zone-ui.js';

const zoneManager = new ZoneManager(gameStateManager, cameraController, sceneManager);
const gridOverlay = new GridOverlay(sceneManager, cameraController, { radius: 250 });
const zoneEditor = new ZoneEditor(sceneManager, cameraController, zoneManager, gameStateManager);

// Initialize bottom toolbar
const toolbar = createBottomToolbar();

// Initialize zones tab (after authentication)
initializeZonesTab();

// Zones are automatically fetched and rendered based on camera position
// Call in render loop:
zoneManager.loadZonesAroundCamera();

// Control visibility:
zoneManager.setVisibility(true); // Show all zones
zoneManager.setZoneTypeVisibility('industrial', false); // Hide industrial zones
gridOverlay.setVisible(false); // Hide grid
```

#### Technical Implementation Details

**Zone Rendering Architecture:**

1. **World-Anchored Rendering:**
   - Zones are rendered as separate `THREE.Group` objects positioned at their actual world coordinates
   - Each zone group contains:
     - `THREE.Mesh` with `THREE.ShapeGeometry` for the translucent fill
     - `THREE.LineLoop` with `THREE.BufferGeometry` for the colored outline
   - Zones use `renderOrder = 5` to appear above the grid (`renderOrder = 1`)
   - Materials use `depthWrite: false` and `depthTest: false` to prevent z-fighting with floor geometry
   - **Shape Coordinate System**: Fill shapes (ShapeGeometry) always negate `worldPos.z` for shape Y coordinates to ensure correct face orientation after -90° X rotation, regardless of whether the zone is on the Y+ or Y- side of the ring

2. **Ring Wrapping:**
   - Zones wrap around the 264,000 km ring circumference using the same logic as chunks
   - Zone coordinates are stored as absolute values [0, RING_CIRCUMFERENCE) in the database
   - During rendering, coordinates are wrapped relative to the camera using unwrapped camera position
   - `normalizeRelativeToCamera` expects unwrapped camera position and handles wrapping internally

3. **Preview Rendering (Zone Editor):**
   - All drawing tools (Rectangle, Circle, Polygon, Paintbrush) use identical coordinate conversion logic
   - Previews generate the exact absolute coordinates that will be stored in the database
   - Coordinates are then wrapped using the same logic as zone-manager.js (unwrapped camera position, always negate worldPos.z for fill shapes)
   - Preview mesh position is set to `(0, floorHeight + 0.001, 0)` since geometry coordinates are already in world space
   - This ensures perfect cursor alignment and 100% match between preview and final rendered zone
   - The `wrapZoneX()` function calculates the shortest path around the ring:
     ```javascript
     const wrapZoneX = (x) => {
       const dx = x - cameraX;
       const half = RING_CIRCUMFERENCE / 2;
       let adjusted = dx;
       while (adjusted > half) adjusted -= RING_CIRCUMFERENCE;
       while (adjusted < -half) adjusted += RING_CIRCUMFERENCE;
       return cameraX + adjusted;
     };
     ```
   - This ensures zones always render at the copy closest to the camera, preventing gaps at the 0/263999 seam

3. **Coordinate Conversion:**
   - Zone coordinates (EarthRing X/Y/Z) are converted to Three.js coordinates using `toThreeJS()`:
     - EarthRing X (ring position) → Three.js X (right)
     - EarthRing Y (width) → Three.js Z (forward)
     - EarthRing Z (floor) → Three.js Y (up) via `floor * DEFAULT_FLOOR_HEIGHT`
   - Shape geometry uses X/Z plane (horizontal), then rotated -90° around X-axis to lie flat
   - **Y Coordinate Handling**: The shape's Y coordinate (`worldPos.z`) is always negated before creating the fill shape. This ensures correct face orientation after rotation, preventing zones from appearing mirrored on the opposite side of the Y-axis for zones on both Y+ and Y- sides. The outline (stroke) uses `worldPos.z` directly without negation, as it renders correctly regardless of Y sign.

4. **Fetching and Caching:**
   - Zones are fetched via `GET /api/zones/area` with a bounding box around the camera
   - Default fetch range: 5000m along ring (X), 3000m across width (Y)
   - Fetch throttling: 4 seconds between requests (`fetchThrottleMs = 4000`)
   - **Active Floor filtering**: Zones are fetched for the active floor (from `gameStateManager.getActiveFloor()`), not camera elevation
   - Zones are cached in `GameStateManager.zones` Map (keyed by zone ID)
   - **Zone Merging**: When zones are fetched, they are merged with existing zones rather than replacing them. This preserves manually added zones (e.g., newly created zones) that may be outside the current fetch bounds due to coordinate wrapping near X=0. Only zones that are far from the camera (more than 2x the fetch range) are removed.
   - `GameStateManager.setZones()` emits `zoneAdded`, `zoneUpdated`, `zoneRemoved` events
   - `ZoneManager` listens to these events and renders/updates meshes accordingly
   - **Floor change handling**: When active floor changes, all zones from the old floor are removed and zones for the new floor are loaded
   - **Coordinate Normalization**: Zones use unwrapped camera position for coordinate normalization. The `normalizeRelativeToCamera` function handles wrapping internally and expects the actual camera position (which may be negative or outside [0, RING_CIRCUMFERENCE)) rather than a pre-wrapped position.

5. **Visibility System:**
   - Two-level visibility control:
     - Global: `zonesVisible` (all zones on/off)
     - Per-type: `zoneTypeVisibility` Map (individual zone types)
   - **Active Floor filtering**: Only zones matching the active floor are rendered, regardless of visibility settings
   - Zone visibility = `zonesVisible && zoneTypeVisibility.get(zoneType) && (zoneFloor === activeFloor)`
   - When visibility changes, `updateAllZoneVisibility()` updates all existing meshes
   - New zones respect current visibility state when rendered

6. **Grid Overlay Separation:**
   - Grid is rendered separately as a circular `THREE.LineSegments` group with shader fade/LOD
   - Geometry recenters around the camera target each frame so lines stay sharp regardless of zoom
   - Bold Y=0 axis and 20m multiples are recomputed world-relative so they remain consistent even when the camera moves
   - Zones are NOT part of the grid overlay (they're separate meshes)
   - This allows zones to remain fully visible while the grid fades and thins based on distance

**Troubleshooting:**

1. **Zones Not Appearing:**
   - Check authentication: `isAuthenticated()` must return true
   - Check fetch throttling: Wait 4 seconds between manual fetches
   - Check visibility: `zoneManager.zonesVisible` and per-type visibility
   - Check console for errors: `zoneManager.logZoneState()` for debug info
   - Verify zone data: Check `gameStateManager.getAllZones()` for cached zones

2. **Zones Moving with Camera:**
   - This indicates wrapping logic failure - check `wrapZoneX()` function
   - Ensure camera position is correctly retrieved: `cameraController.getEarthRingPosition()`
   - Verify zone coordinates are in EarthRing space (not already converted)

3. **Performance Issues:**
   - Limit zone count: Current implementation handles ~100 zones efficiently
   - Check mesh count: `zoneManager.zoneMeshes.size` - each zone creates 2-3 meshes (fill + outline per polygon)
   - Reduce fetch range: Modify `DEFAULT_ZONE_RANGE` and `DEFAULT_WIDTH_RANGE`
   - Increase fetch throttle: Modify `fetchThrottleMs` to reduce API calls

4. **Visibility Not Working:**
   - Check both global and per-type visibility: `zoneManager.zonesVisible` and `zoneManager.zoneTypeVisibility`
   - Call `zoneManager.updateAllZoneVisibility()` after manual visibility changes
   - Verify zone type normalization: `mixed_use` vs `mixed-use` handling

**Authentication Service** (`client-web/src/auth/auth-service.js`):
- Automatic token refresh: Tokens are automatically refreshed 2 minutes before expiration
- Token expiration checking: `isTokenExpired()` validates token expiration with configurable buffer
- Rate-limited refresh: Refresh attempts are rate-limited (5 second minimum between attempts) to prevent server overload
- Graceful error handling: Failed refresh attempts clear tokens and require re-authentication
- API request integration: All API requests automatically check and refresh tokens before making requests
- Stops pinging server: Zone loading stops making requests when authentication fails, preventing "too many requests" errors

**Authentication UI** (`client-web/src/auth/auth-ui.js`):
- Login/registration overlay modal (centered on screen)
- User info bar: Top-right panel showing "Logged In As [username]" with Player, Chunks, and Logout buttons
- Zones button removed from user info bar (zone editor now accessible via bottom toolbar "Zones" tab)
- Automatically shows/hides based on authentication state

**Expanding the System:**

1. **Adding a New Zone Type:**
   ```javascript
   // 1. Add to ZONE_STYLES in zone-manager.js
   const ZONE_STYLES = {
     // ... existing types
     'new-type': { fill: 'rgba(r,g,b,0.4)', stroke: 'rgba(r,g,b,0.95)' },
   };
   
   // 2. Add to zoneTypeVisibility Map in constructor
   this.zoneTypeVisibility = new Map([
     // ... existing types
     ['new-type', true],
   ]);
   
   // 3. Add to zones-toolbar.js zoneTypes array
   const zoneTypes = [
     // ... existing types
     { label: 'New Type', key: 'new-type' },
   ];
   
   // 4. Update server-side validation if needed (server/internal/database/zones.go)
   ```

2. **Modifying Zone Rendering:**
   - Fill material: Modify `fillMaterial` properties in `renderZone()` (opacity, color, side)
   - Outline material: Modify `outlineMaterial` properties (linewidth, color, opacity)
   - Elevation: Change `floorHeight + 0.001` offset for fill, `floorHeight + 0.002` for outline
   - Geometry: Modify `THREE.Shape` creation or use different geometry types

3. **Extending the API:**
   - Add new endpoints in `server/internal/api/zone_handlers.go`
   - Add corresponding service methods in `client-web/src/api/zone-service.js`
   - Update `ZoneManager` to use new endpoints if needed

4. **Architecture Decisions:**
   - **Why world-anchored meshes?** Ensures zones stay fixed to their world positions, making them useful for building placement and spatial queries
   - **Why separate from grid?** Allows independent visibility control and prevents zones from fading with the grid
   - **Why ring wrapping?** Essential for seamless rendering across the 264,000 km ring boundary
   - **Why per-type visibility?** Allows players to focus on specific zone types during planning and building

#### Implementation (Future Enhancement)

```javascript
class ChunkLoader {
  constructor(networkLayer, renderingEngine) {
    this.networkLayer = networkLayer;
    this.renderingEngine = renderingEngine;
    this.loadedChunks = new Set();
    this.chunkCache = new Map();
    this.viewportChunks = new Set();
  }
  
  updateViewport(playerPosition, viewportSize) {
    const chunksToLoad = this.calculateChunksToLoad(playerPosition, viewportSize);
    const chunksToUnload = this.calculateChunksToUnload(playerPosition);
    
    chunksToLoad.forEach(chunkId => {
      if (!this.loadedChunks.has(chunkId)) {
        this.loadChunk(chunkId);
      }
    });
    
    chunksToUnload.forEach(chunkId => {
      this.unloadChunk(chunkId);
    });
  }
  
  loadChunk(chunkId) {
    if (this.chunkCache.has(chunkId)) {
      this.renderingEngine.renderChunk(this.chunkCache.get(chunkId));
      this.loadedChunks.add(chunkId);
    } else {
      this.networkLayer.requestChunks([chunkId], 'medium');
    }
  }
}
```

## Web Client Architecture (Three.js)

### Technology Stack Decision

**Design Decision**: Build from scratch using Three.js rather than using a game framework like Phaser.

**Rationale**:
- **3D Requirements**: EarthRing requires full 3D rendering (Phaser is primarily 2D-focused)
- **Architecture Alignment**: Three.js aligns with the graphics abstraction layer and future Unreal migration path
- **Custom Systems**: EarthRing needs custom systems (chunk streaming, microgravity physics, coordinate conversions) that frameworks don't provide
- **Flexibility**: Building from scratch allows choosing best-in-class libraries for each need
- **Multi-Client Strategy**: Graphics abstraction layer supports web (Three.js) → Unreal migration, which frameworks would complicate

### Technology Stack

- **Rendering**: Three.js (direct usage, not via framework)
- **Networking**: WebSocket API, Fetch API (custom implementation)
- **State Management**: Custom state management (tailored to EarthRing's needs)
- **UI**: HTML/CSS/React or Vue
- **Build Tool**: Webpack or Vite
- **Physics**: Custom microgravity physics system (not using existing physics engines)

### Project Structure ✅ **IMPLEMENTED**

```
client-web/
├── src/
│   ├── network/
│   │   └── websocket-client.js        ✅ WebSocket client
│   ├── state/
│   │   └── game-state.js              ✅ Game state manager
│   ├── rendering/
│   │   └── scene-manager.js           ✅ Scene manager
│   ├── input/
│   │   └── camera-controller.js       ✅ Camera controller
│   ├── chunks/
│   │   └── chunk-manager.js           ✅ Chunk manager
│   ├── zones/
│   │   └── zone-manager.js            ✅ Zone manager
│   ├── api/
│   │   ├── player-service.js          ✅ Player API service
│   │   ├── chunk-service.js           ✅ Chunk API service
│   │   └── zone-service.js            ✅ Zone API service
│   ├── auth/
│   │   ├── auth-service.js            ✅ Authentication service
│   │   └── auth-ui.js                 ✅ Authentication UI
│   ├── ui/
│   │   ├── player-ui.js               ✅ Player panel
│   │   ├── chunk-ui.js                ✅ Chunk panel
│   │   ├── zone-ui.js                 ✅ Zone UI (bottom toolbar integration)
│   │   ├── zone-info-window.js        ✅ Zone info window
│   │   ├── bottom-toolbar.js          ✅ Bottom toolbar (tabs system)
│   │   ├── zones-toolbar.js           ✅ Zones toolbar (legacy, left-side)
│   │   └── debug-info.js              ✅ Debug info panel
│   ├── rendering/
│   │   ├── scene-manager.js           ✅ Scene manager
│   │   └── grid-overlay.js            ✅ Grid overlay
│   ├── utils/
│   │   ├── coordinates.js             ✅ Coordinate conversion
│   │   └── rendering.js               ✅ Rendering utilities
│   ├── config.js                      ✅ Configuration
│   ├── test-utils.js                  ✅ Test utilities
│   └── main.js                        ✅ Main entry point
├── assets/                            # Game assets (models, textures, shaders)
├── public/                            # Static files
└── package.json                       # Dependencies
```

### Utility Modules ✅ **IMPLEMENTED**

**Decompression Utilities** (`client-web/src/utils/decompression.js`):
- Automatic detection of compressed geometry format
- Gzip decompression using `pako` library
- Binary format decoding with Base X restoration
- Metadata decompression support (MessagePack + gzip)
- Error handling with fallback to uncompressed format
- Performance: <3ms decompression time per chunk

#### Coordinate Conversion Utilities

**Location**: `client-web/src/utils/coordinates.js`

Coordinate conversion utilities handle conversion between EarthRing's coordinate system and various rendering engine coordinate systems.

**Available Functions**:

1. **EarthRing ↔ Three.js Conversion**:
   - `toThreeJS(earthringPoint, floorHeight?)` - Convert EarthRing to Three.js coordinates
   - `fromThreeJS(threeJSPoint, floorHeight?)` - Convert Three.js to EarthRing coordinates

2. **EarthRing ↔ Unreal Engine Conversion** (for future use):
   - `toUnreal(earthringPoint, floorHeight?)` - Convert EarthRing to Unreal coordinates
   - `fromUnreal(unrealPoint, floorHeight?)` - Convert Unreal to EarthRing coordinates

3. **Ring Position Utilities**:
   - `positionToChunkIndex(ringPosition)` - Convert ring position to chunk index (0-263,999)
   - `chunkIndexToPositionRange(chunkIndex)` - Get position range for a chunk
   - `wrapRingPosition(ringPosition)` - Wrap position around 264,000 km ring

4. **Distance Calculations**:
   - `distance(point1, point2)` - Calculate distance accounting for ring wrapping

5. **Validation**:
   - `validateEarthRingPoint(point)` - Validate EarthRing coordinate point

**Usage Example**:
```javascript
import { toThreeJS, fromThreeJS, positionToChunkIndex } from './utils/coordinates.js';

// Convert EarthRing coordinates to Three.js for rendering
const earthringPos = { x: 1000, y: 100, z: 2 };
const threeJSPos = toThreeJS(earthringPos);
// Result: { x: 1000, y: 40, z: 100 }

// Convert back from Three.js to EarthRing
const backToEarthRing = fromThreeJS(threeJSPos);
// Result: { x: 1000, y: 100, z: 2 }

// Get chunk index from position
const chunkIndex = positionToChunkIndex(1000);
// Result: 1
```

**Default Floor Height**: 20 meters per level (configurable via optional parameter)

**Testing**: Comprehensive test suite in `client-web/src/utils/coordinates.test.js` (30 tests, all passing)

#### Rendering Utilities ✅ **IMPLEMENTED**

**Location**: `client-web/src/utils/rendering.js`

Rendering utilities provide helper functions for Three.js operations that automatically handle coordinate conversion between EarthRing and Three.js coordinate systems.

**Available Functions**:

1. **Object Positioning**:
   - `setObjectPositionFromEarthRing(object, earthringPosition, floorHeight?)` - Position Three.js object from EarthRing coordinates
   - `getEarthRingPositionFromObject(object, floorHeight?)` - Get EarthRing position from Three.js object

2. **Camera Positioning**:
   - `setCameraPositionFromEarthRing(camera, earthringPosition, floorHeight?)` - Position camera from EarthRing coordinates
   - `getEarthRingPositionFromCamera(camera, floorHeight?)` - Get EarthRing position from camera

3. **Mesh Creation**:
   - `createMeshAtEarthRingPosition(geometry, material, earthringPosition, floorHeight?)` - Create Three.js mesh at EarthRing position

**Usage Example**:
```javascript
import { setCameraPositionFromEarthRing, createMeshAtEarthRingPosition } from './utils/rendering.js';
import * as THREE from 'three';

// Create a mesh at EarthRing position (0, 0, 0)
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const mesh = createMeshAtEarthRingPosition(geometry, material, { x: 0, y: 0, z: 0 });
scene.add(mesh);

// Position camera using EarthRing coordinates
setCameraPositionFromEarthRing(camera, { x: 1000, y: 0, z: 0 });
```

**Integration Status**: ✅ **IMPLEMENTED** - Rendering utilities are integrated into `main.js` for camera and object positioning. Chunk UI includes position-to-chunk conversion tools.

### Rendering Pipeline

1. **Initialization**
   - Create Three.js scene, camera, renderer
   - Set up lighting
   - Load initial assets

2. **Game Loop**
   - Update camera position
   - Update chunk loader (check viewport)
   - Process input
   - Update game state
   - Render scene
   - Request animation frame

3. **Chunk Rendering**
   - Parse chunk geometry data
   - Create Three.js meshes
   - Apply materials and textures
   - Add to scene

4. **Structure Rendering**
   - Load structure models
   - Position and orient structures
   - Apply player customizations
   - Add to scene

### Performance Optimization

1. **Frustum Culling**
   - Only render chunks/structures in viewport
   - Use Three.js built-in frustum culling

2. **LOD System**
   - Render high-detail chunks close to camera
   - Render low-detail chunks far from camera
   - Switch LOD based on distance

3. **Instancing**
   - Use instanced rendering for repeated structures
   - Reduce draw calls

4. **Texture Atlasing**
   - Combine textures into atlases
   - Reduce texture switches

5. **Geometry Optimization**
   - Simplify geometry for distant objects
   - Use compressed geometry formats

## Graphics Abstraction Layer

### Purpose

Abstract graphics operations to support multiple rendering backends (Three.js, Unreal, etc.). This layer also handles coordinate system conversion between EarthRing's convention (X=ring, Y=width, Z=floor) and each rendering engine's native convention.

**Coordinate Conversion**: ✅ **IMPLEMENTED** - Coordinate conversion utilities are available in `client-web/src/utils/coordinates.js` and rendering utilities in `client-web/src/utils/rendering.js`. See [Map System Design](../docs/02-map-system.md#coordinate-system-convention) for details on coordinate system conventions and conversion requirements.

The coordinate conversion utilities provide:
- **EarthRing ↔ Three.js**: `toThreeJS()` and `fromThreeJS()` functions (Y-up, Z-forward)
- **EarthRing ↔ Unreal Engine**: `toUnreal()` and `fromUnreal()` functions (Z-up, Y-forward) for future use
- **Ring Position Utilities**: `positionToChunkIndex()`, `chunkIndexToPositionRange()`, `wrapRingPosition()`
- **Distance Calculations**: `distance()` function accounting for ring wrapping
- **Validation**: `validateEarthRingPoint()` for coordinate validation

**Rendering Utilities** provide helper functions that automatically handle coordinate conversion:
- `setObjectPositionFromEarthRing()`, `setCameraPositionFromEarthRing()` - Position objects/camera from EarthRing coordinates
- `createMeshAtEarthRingPosition()` - Create meshes at EarthRing positions
- `getEarthRingPositionFromObject()`, `getEarthRingPositionFromCamera()` - Get EarthRing positions from Three.js objects

**Integration Status**: ✅ **IMPLEMENTED** - Coordinate conversion is integrated into the main client code (`main.js`) for camera and object positioning. Chunk UI includes position-to-chunk conversion tools.

Conversion happens transparently within the abstraction layer. All game logic, database, and API use EarthRing convention (X=ring, Y=width, Z=floor). Conversion only occurs at the rendering layer boundary.

### Interface

```javascript
class GraphicsAbstraction {
  // Scene management
  createScene() {}
  addToScene(object) {}
  removeFromScene(object) {}
  
  // Geometry
  createMesh(geometry, material) {}
  updateMesh(mesh, geometry) {}
  
  // Materials
  createMaterial(properties) {}
  updateMaterial(material, properties) {}
  
  // Lighting
  addLight(light) {}
  setAmbientLight(color, intensity) {}
  
  // Camera
  setCameraPosition(x, y, z) {}
  setCameraRotation(x, y, z) {}
  
  // Rendering
  render() {}
}
```

### Implementation Strategy

1. **Web Client**: Direct Three.js implementation
2. **Unreal Client**: Map to Unreal Engine APIs
3. **Future Clients**: Implement interface for new backends

## State Management

### Local State

- Cached chunks
- Cached zones and structures
- Player position and camera state
- UI state

### Server State Synchronization

1. **Optimistic Updates**
   - Update local state immediately
   - Send action to server
   - Revert if server rejects

2. **Server Updates**
   - Receive updates via WebSocket
   - Merge with local state
   - Update rendering

3. **Conflict Resolution**
   - Detect conflicts
   - Resolve based on rules
   - Update local state

## Asset Management

### Asset Types

1. **3D Models**
   - Buildings, structures
   - Vehicles
   - NPCs
   - Decorative elements

2. **Textures**
   - Building textures
   - Terrain textures
   - UI textures

3. **Shaders**
   - Custom shaders for effects
   - Post-processing shaders

### Asset Loading

1. **Initial Load**
   - Load essential assets on startup
   - Show loading screen

2. **On-Demand Loading**
   - Load assets when needed
   - Cache loaded assets
   - Unload unused assets

3. **Asset Formats**
   - Models: GLTF/GLB (web), FBX (Unreal)
   - Textures: PNG, JPEG, KTX2
   - Shaders: GLSL (web), HLSL (Unreal)

## UI System

### UI Components

1. **HUD (Heads-Up Display)**
   - Player info (level, currency) - Top-right "Logged In As" panel
   - Minimap - Future
   - Notifications - Future

2. **Debug Info Panel** (`client-web/src/ui/debug-info.js`):
   - Positioned top-right, below user info panel
   - Starts minimized (collapsed) by default
   - Displays performance metrics (FPS, frame time, draw calls, triangles, geometries, textures)
   - Shows camera position (EarthRing and Three.js coordinates), floor, and target
   - Shows grid position, radius, and spacing
   - Shows rendering stats (scene objects, chunks loaded, zones loaded, renderer size)
   - Collapsible sections for each category
   - Click header to expand/collapse entire panel

3. **Zone Editor**
   - Bottom toolbar "Zones" tab with zone type selection and drawing tools
   - Tools: Select, Rectangle, Circle, Polygon, Paintbrush
   - Zone selection with info window showing details and delete option
   - Current implementation: zone creation, selection, deletion via REST API
   - Roadmap: vertex editing, overlap indicators, advanced conflict resolution

3. **Structure Placer**
   - Structure selection
   - Placement preview
   - Properties panel

4. **Racing UI**
   - Speedometer
   - Checkpoint counter (for illegal street racing)
   - Leaderboard
   - Race timer

### UI Framework

- **Web**: React or Vue for component-based UI
- **Unreal**: UMG (Unreal Motion Graphics)

## Input Handling

### Input Types

1. **Mouse**
   - Camera rotation (drag)
   - Object selection (click)
   - Zone drawing (click and drag)

2. **Keyboard**
   - Camera movement (WASD for forward/backward/strafe, QE for vertical movement)
   - Actions (E to interact, R to race) - **PENDING** (Phase 3+)
   - UI shortcuts

3. **Touch** (Mobile)
   - Gesture recognition
   - Touch controls for camera
   - UI interaction

### Camera Controls

1. **Orbit Camera**
   - Rotate around point
   - Zoom in/out
   - Pan

2. **First-Person Camera** (Racing)
   - Vehicle-mounted camera
   - Smooth following
   - Camera shake effects

## Future Client Migration

### Migration Path

1. **Web → Light Client**
   - Package web client in Electron
   - Add local asset caching
   - Improve performance

2. **Light Client → Unreal**
   - Implement graphics abstraction layer
   - Port rendering to Unreal
   - Maintain same game logic
   - Enhance graphics capabilities

### Compatibility Strategy

- Maintain same API contracts
- Graphics abstraction layer enables backend swapping
- Game logic remains client-agnostic
- Gradual migration possible

## Performance Targets

### Web Client

- **Frame Rate**: 30-60 FPS
- **Chunk Load Time**: < 500ms
- **Memory Usage**: < 2GB
- **Initial Load**: < 10 seconds

### Light Client

- **Frame Rate**: 60 FPS
- **Chunk Load Time**: < 200ms (cached)
- **Memory Usage**: < 4GB
- **Initial Load**: < 5 seconds (with cache)

### Unreal Client

- **Frame Rate**: 60+ FPS
- **Chunk Load Time**: < 100ms
- **Memory Usage**: < 8GB
- **Initial Load**: < 30 seconds (larger assets)

## Display and UI Layout

### Aspect Ratio Strategy

**Design Decision**: Standard aspect ratio for main game display with adaptive UI layout for wider screens.

1. **Primary Aspect Ratio**: 16:9 (1920x1080 base resolution)
   - Standard widescreen format
   - Most common display format
   - Good balance of horizontal and vertical space
   - Base resolution: 1920x1080, scales up/down proportionally

2. **Wide Screen Support**:
   - Screens wider than 16:9 (e.g., 21:9 ultrawide, 32:9 super ultrawide)
   - **Adaptive UI Layout**: Menus and toolbars move to side panels instead of overlaying game space
   - Game viewport maintains 16:9 aspect ratio centered
   - Extra horizontal space used for:
     - Side panels for menus, toolbars, information displays
     - Minimap, inventory, chat, etc.
     - No UI elements overlay the main game viewport
   - Benefits:
     - Full game viewport visibility
     - More efficient use of screen real estate
     - Better multitasking (game + UI simultaneously visible)

3. **Narrow Screen Support**:
   - Screens narrower than 16:9 (e.g., 4:3, 16:10)
   - UI elements overlay game space (traditional approach)
   - Minimize UI footprint to preserve game viewport
   - Collapsible panels and toolbars

### UI Layout System

1. **Layout Modes**:
   - **Standard Mode** (16:9 or narrower): Traditional overlay UI
   - **Wide Mode** (wider than 16:9): Side panel UI with centered game viewport

2. **Panel System**:
   - **Top-right**: User info panel ("Logged In As [username]" with Player/Chunks/Logout buttons), Debug Info panel (below user info, starts minimized)
   - **Bottom**: Horizontal toolbar with tabs (Zones tab contains zone editor tools: zone type selection, drawing tools, settings)
   - **Left-side**: Legacy zones toolbar (may be deprecated in favor of bottom toolbar)
   - **Future panels**: Minimap, chat, notifications (to be positioned as needed)
   - Panels slide in/out based on screen width and user preferences

3. **Viewport Management**:
   - Game viewport always maintains 16:9 aspect ratio
   - Centered on screen
   - Black bars or panel backgrounds fill extra space
   - User can toggle between fullscreen game (with overlay UI) and paneled layout

## Modding and User-Generated Content

### Modding Support

**Design Decision**: Plan for modding and user-generated content from the start.

1. **Mod Types**:
   - **Visual Mods**: Custom textures, models, shaders
   - **Gameplay Mods**: Custom structures, vehicles, NPCs
   - **UI Mods**: Custom interfaces, themes, layouts
   - **Content Mods**: Custom zones, buildings, racing routes

2. **Modding Architecture**:
   - **Mod Loader**: System to load and manage mods
   - **Mod API**: Exposed APIs for mod developers
   - **Mod Validation**: Server-side validation for multiplayer compatibility
   - **Mod Marketplace**: Optional platform for sharing mods

3. **Modding Capabilities**:
   - **Asset Replacement**: Replace default models/textures with custom ones
   - **New Asset Addition**: Add new structures, vehicles, NPCs
   - **Scripting Support**: Limited scripting for custom behaviors (future)
   - **UI Customization**: Custom UI themes and layouts

4. **Mod Compatibility**:
   - **Client-Side Mods**: Visual/UI mods that don't affect gameplay
   - **Server-Validated Mods**: Gameplay mods require server approval
   - **Mod Versioning**: Handle mod updates and version conflicts
   - **Mod Dependencies**: Support for mod dependencies and load order

### User-Generated Content

1. **Content Types**:
   - **Custom Structures**: Player-designed buildings and structures
   - **Custom Vehicles**: Player-designed racing vehicles
   - **Custom Zones**: Player-designed zone templates
   - **Custom Racing Routes**: Player-designed race routes
   - **Custom NPCs**: Player-designed NPC appearances/personalities

2. **Content Creation Tools**:
   - **In-Game Editor**: Basic structure/zone editor
   - **External Tools**: Support for external 3D modeling tools
   - **Asset Import**: Import custom models/textures
   - **Validation Tools**: Check content for compatibility

3. **Content Sharing**:
   - **Content Library**: Repository for user-generated content
   - **Rating System**: Community ratings and reviews
   - **Search and Discovery**: Find content by tags, popularity, etc.
   - **Integration**: Easy import/export of content

4. **Content Validation**:
   - **Technical Validation**: Check for errors, compatibility
   - **Content Guidelines**: Enforce community standards
   - **Server Validation**: Ensure multiplayer compatibility
   - **Moderation**: Review and moderate user content

## Open Questions

None - all major architectural decisions have been made.

## Future Considerations

- Advanced graphics features (ray tracing, global illumination)
- Multi-monitor support
- Streaming/cloud gaming support
- Expanded modding capabilities (scripting, advanced APIs)
- Content creation tools improvements

