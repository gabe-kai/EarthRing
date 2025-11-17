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
- Event system for state changes
- State reset functionality

**Key Features**:
- Chunk caching with add/remove/get operations
- Player state updates with event notifications
- Connection state tracking (WebSocket and API)
- Event listeners for state changes (chunkAdded, chunkRemoved, playerStateChanged, connectionStateChanged)
- State reset for logout/cleanup

**Usage Example**:
```javascript
import { GameStateManager } from './state/game-state.js';

const gameStateManager = new GameStateManager();

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
- Basic chunk visualization (placeholders for Phase 1)
- Position-based chunk loading
- Mesh management and cleanup

**Key Features**:
- Request chunks via WebSocket (`chunk_request` message)
- Position-based chunk loading (converts ring position to chunk indices)
- Automatic chunk rendering when added to game state
- Ring floor geometry rendering (Phase 1: basic gray planes visible)
- Mesh cleanup and resource disposal
- Integration with game state manager for caching

**Usage Example**:
```javascript
import { ChunkManager } from './chunks/chunk-manager.js';

const chunkManager = new ChunkManager(sceneManager, gameStateManager);

// Request chunks by ID
await chunkManager.requestChunks(['0_0', '0_1', '0_2'], 0);

// Request chunks at a position (ring position, floor, radius, LOD)
await chunkManager.requestChunksAtPosition(5000, 0, 2, 0);
```

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
│   ├── api/
│   │   ├── player-service.js          ✅ Player API service
│   │   └── chunk-service.js           ✅ Chunk API service
│   ├── auth/
│   │   ├── auth-service.js            ✅ Authentication service
│   │   └── auth-ui.js                 ✅ Authentication UI
│   ├── ui/
│   │   ├── player-ui.js               ✅ Player panel
│   │   └── chunk-ui.js                ✅ Chunk panel
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
   - Player info (level, currency)
   - Minimap
   - Notifications

2. **Zone Editor**
   - Polygon drawing interface
   - Zone properties panel
   - Zone list

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
   - Camera movement (WASD)
   - Actions (E to interact, R to race)
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
   - Left panel: Toolbars, menus, zone editor
   - Right panel: Information displays, minimap, chat, notifications
   - Bottom panel: HUD elements (when in standard mode)
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

