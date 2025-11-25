/**
 * EarthRing Web Client
 * Main entry point for the Three.js-based web client
 */

import { showAuthUI, showUserInfo } from './auth/auth-ui.js';
import { isAuthenticated } from './auth/auth-service.js';
import { showPlayerPanel } from './ui/player-ui.js';
import { showChunkPanel } from './ui/chunk-ui.js';
import { showAdminModal } from './ui/admin-modal.js';
import { initializeZonesTab } from './ui/zone-ui.js';
import { createBottomToolbar } from './ui/bottom-toolbar.js';
import * as THREE from 'three';
import { SceneManager } from './rendering/scene-manager.js';
import { CameraController } from './input/camera-controller.js';
import { GameStateManager } from './state/game-state.js';
import { ChunkManager } from './chunks/chunk-manager.js';
import { ZoneManager } from './zones/zone-manager.js';
import { ZoneEditor } from './zones/zone-editor.js';
import { GridOverlay } from './rendering/grid-overlay.js';
import { DebugInfoPanel } from './ui/debug-info.js';
import { createZonesToolbar } from './ui/zones-toolbar.js';
import { wsClient } from './network/websocket-client.js';
import { createMeshAtEarthRingPosition } from './utils/rendering.js';
import { positionToChunkIndex } from './utils/coordinates.js';
import { findNearestStation, getStationPosition, getAllStationPositions } from './utils/stations.js';

// Initialize game state manager
const gameStateManager = new GameStateManager();

// Initialize scene manager
const sceneManager = new SceneManager();

// Initialize camera controller
const cameraController = new CameraController(
  sceneManager.getCamera(),
  sceneManager.getRenderer(),
  sceneManager,
  gameStateManager
);

// Initialize chunk manager (pass camera controller for position wrapping)
const chunkManager = new ChunkManager(sceneManager, gameStateManager, cameraController);
const gridOverlay = new GridOverlay(sceneManager, cameraController, gameStateManager, {
  radius: 250, // 250m radius circular grid
  majorSpacing: 5,
  minorSpacing: 1,
  fadeStart: 0.7, // Start fading at 70% of radius
});
const zoneManager = new ZoneManager(gameStateManager, cameraController, sceneManager);
const zoneEditor = new ZoneEditor(sceneManager, cameraController, zoneManager, gameStateManager);
createZonesToolbar(zoneManager, gridOverlay, gameStateManager);

// Initialize debug info panel
const debugPanel = new DebugInfoPanel(
  sceneManager,
  cameraController,
  gridOverlay,
  gameStateManager,
  chunkManager,
  zoneManager
);

// Global mouse position tracker for debug panel
const globalMousePosition = { x: 0, y: 0 };
document.addEventListener('mousemove', (event) => {
  globalMousePosition.x = event.clientX;
  globalMousePosition.y = event.clientY;
});

// Export managers and utilities for debugging/development
// Set this up early so it's available for UI initialization
window.earthring = {
  sceneManager,
  cameraController,
  gameStateManager,
  chunkManager,
  zoneManager,
  zoneEditor,
  gridOverlay,
  debugPanel,
  wsClient,
  mousePosition: globalMousePosition, // Global mouse position for debug panel
  debug: false, // Set to true to enable debug logging
  DEBUG_ZONE_COORDS: false, // Set to true to enable zone coordinate debugging
  stations: {
    findNearestStation,
    getStationPosition,
    getAllStationPositions,
    // Helper function to navigate to a station
    navigateToStation: (index) => {
      const stationPos = getStationPosition(index);
      if (stationPos !== null) {
        // Position camera above station center for good view
        cameraController.moveToPosition({
          x: stationPos,
          y: 0,
          z: 0,
        }, 3); // 3 second smooth movement
        console.log(`Navigating to Station Hub ${index} at position ${stationPos}m`);
      } else {
        console.error(`Invalid station index: ${index}`);
      }
    },
  },
};

// Add a test cube at EarthRing position (0, 0, 0) for demonstration
const scene = sceneManager.getScene();

const earthringPosition = { x: 0, y: 0, z: 0 };
const geometry = new THREE.BoxGeometry(2, 2, 2); // Make cube bigger (2x2x2)
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = createMeshAtEarthRingPosition(geometry, material, earthringPosition);
scene.add(cube);

// Set camera to look at the cube and set OrbitControls target
const cubeThreeJSPos = cube.position;
cameraController.setTargetFromEarthRing(earthringPosition);
const camera = sceneManager.getCamera();

// Position camera for better view of the ring
// EarthRing position: 100m along ring, 0 width, floor 0
const cameraEarthRingPos = { x: 100, y: 0, z: 0 };
cameraController.setPositionFromEarthRing(cameraEarthRingPos);
// Adjust camera to be elevated and angled for better view
camera.position.y += 20; // Higher up for better overview
camera.position.z += 30; // Back from the ring
camera.lookAt(cubeThreeJSPos.x, cubeThreeJSPos.y, cubeThreeJSPos.z);

// Add axes helper for reference
const axesHelper = new THREE.AxesHelper(10);
scene.add(axesHelper);

// Track last camera position for chunk loading (throttle to avoid excessive requests)
let lastCameraChunkIndex = null;
let lastCameraPosition = null; // Track actual position, not just chunk index
let lastChunkLoadTime = 0;
let pendingChunkLoad = false; // Track if a chunk load is in progress
const CHUNK_LOAD_THROTTLE_MS = 1000; // Only check for new chunks every 1 second
const CHUNK_LOAD_DISTANCE_THRESHOLD = 500; // Load new chunks if moved more than 500m

// Set up render loop to update camera controls and load chunks as camera moves
sceneManager.onRender((deltaTime) => {
  // Update camera controller with deltaTime for smooth movement
  cameraController.update(deltaTime);
  
  // Rotate test cube
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  
  // Disabled automatic re-rendering for wrapping to prevent z-fighting
  // Chunks are wrapped when first rendered based on camera position
  // Re-enable this if needed, but it causes flickering due to overlapping chunks
  // if (chunkManager.shouldReRenderChunks()) {
  //   chunkManager.reRenderAllChunks();
  // }
  
  // Check if camera has moved enough to load new chunks
  // Throttle chunk loading to avoid excessive requests
  const now = performance.now();
  if (wsClient.isConnected() && 
      !pendingChunkLoad && 
      (now - lastChunkLoadTime) >= CHUNK_LOAD_THROTTLE_MS) {
    const cameraPos = cameraController.getEarthRingPosition();
    const currentChunkIndex = positionToChunkIndex(cameraPos.x);
    
    // Calculate distance moved (accounting for wrapping)
    let distanceMoved = 0;
    if (lastCameraPosition !== null) {
      const RING_CIRCUMFERENCE = 264000000;
      const directDistance = Math.abs(cameraPos.x - lastCameraPosition);
      const wrappedDistance = RING_CIRCUMFERENCE - directDistance;
      distanceMoved = Math.min(directDistance, wrappedDistance);
    }
    
    // Load chunks if we've moved to a different chunk OR moved far enough
    // This ensures chunks load even when moving within the same chunk
    if (lastCameraChunkIndex === null || 
        currentChunkIndex !== lastCameraChunkIndex ||
        distanceMoved > CHUNK_LOAD_DISTANCE_THRESHOLD) {
      lastCameraChunkIndex = currentChunkIndex;
      lastCameraPosition = cameraPos.x;
      lastChunkLoadTime = now;
      pendingChunkLoad = true;
      
      // Load chunks around camera position (radius of 4 chunks = 9 total chunks, within limit of 10)
      // Use active floor from game state (independent of camera elevation)
      const floor = gameStateManager.getActiveFloor();
      // Only log chunk loading in debug mode
      if (window.earthring?.debug) {
        console.log(`[Chunks] Loading around position ${cameraPos.x.toFixed(0)}m (chunk ${currentChunkIndex}, floor ${floor})`);
      }
      chunkManager.requestChunksAtPosition(cameraPos.x, floor, 4, 'medium')
        .then(() => {
          // Only log success in debug mode
          if (window.earthring?.debug) {
            console.log(`[Chunks] Successfully requested chunks around chunk ${currentChunkIndex}`);
          }
          pendingChunkLoad = false;
        })
        .catch(error => {
          console.error('[Chunks] Failed to load chunks at camera position:', error);
          pendingChunkLoad = false;
        });
    }
  }

  // Refresh zone overlays (ZoneManager throttles internally)
  zoneManager.loadZonesAroundCamera();
  
  // Re-render zones if camera moved significantly (for proper wrapping)
  if (zoneManager.shouldReRenderZones()) {
    zoneManager.reRenderAllZones();
  }
  
  // Update zone editor floor based on camera position
  zoneEditor.updateFloorFromCamera();
  
  // Update grid overlay position to follow camera
  gridOverlay.update();
  
  // Update debug info panel
  debugPanel.update();
});

// Initialize bottom toolbar
createBottomToolbar();

// Start rendering loop
sceneManager.start();

// Authentication initialization
if (isAuthenticated()) {
  showUserInfo();
  console.log('User is authenticated');
  
  // Update game state
  const token = localStorage.getItem('access_token');
  if (token) {
    gameStateManager.updateConnectionState('api', { authenticated: true });
  }
  
  // Initialize zones tab in toolbar
  initializeZonesTab();
} else {
  showAuthUI();
  console.log('Showing authentication UI');
}

// Check if user is already authenticated on page load
if (isAuthenticated()) {
  console.log('User already authenticated on page load');
  showUserInfo();
  gameStateManager.updateConnectionState('api', { authenticated: true });
  
  // Initialize zones tab in toolbar
  initializeZonesTab();
  
  // Connect WebSocket if already authenticated
  wsClient.connect().then(() => {
    gameStateManager.updateConnectionState('websocket', { connected: true });
    console.log('WebSocket connected');
  }).catch(error => {
    console.error('Failed to connect WebSocket:', error);
    gameStateManager.updateConnectionState('websocket', { 
      connected: false, 
      lastError: error.message 
    });
  });
}

// Listen for authentication events
window.addEventListener('auth:login', async () => {
  console.log('User logged in');
  showUserInfo();
  gameStateManager.updateConnectionState('api', { authenticated: true });
  
  // Initialize zones tab in toolbar
  initializeZonesTab();
  
  // Connect WebSocket after authentication
  try {
    await wsClient.connect();
    gameStateManager.updateConnectionState('websocket', { connected: true });
    console.log('WebSocket connected');
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    gameStateManager.updateConnectionState('websocket', { 
      connected: false, 
      lastError: error.message 
    });
  }
});

window.addEventListener('auth:register', async () => {
  console.log('User registered');
  showUserInfo();
  gameStateManager.updateConnectionState('api', { authenticated: true });
  
  // Initialize zones tab in toolbar
  initializeZonesTab();
  
  // Connect WebSocket after registration
  try {
    await wsClient.connect();
    gameStateManager.updateConnectionState('websocket', { connected: true });
    console.log('WebSocket connected');
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    gameStateManager.updateConnectionState('websocket', { 
      connected: false, 
      lastError: error.message 
    });
  }
});

window.addEventListener('auth:logout', () => {
  console.log('User logged out');
  wsClient.disconnect();
  gameStateManager.reset();
  gameStateManager.updateConnectionState('websocket', { 
    connected: false, 
    connecting: false 
  });
  gameStateManager.updateConnectionState('api', { authenticated: false });
  zoneManager.clearAllZones();
});

// Listen for panel show events
window.addEventListener('show:player-panel', () => {
  showPlayerPanel();
});

window.addEventListener('show:chunk-panel', () => {
  showChunkPanel();
});

window.addEventListener('show:admin-modal', () => {
  showAdminModal();
});


// WebSocket connection event handlers
wsClient.onOpen(async () => {
  console.log('WebSocket opened');
  gameStateManager.updateConnectionState('websocket', { 
    connected: true, 
    connecting: false 
  });
  
  // Automatically load chunks around the camera position
  try {
    const cameraPos = cameraController.getEarthRingPosition();
    // Load chunks at camera position using active floor from game state
    const floor = gameStateManager.getActiveFloor();
    await chunkManager.requestChunksAtPosition(cameraPos.x, floor, 4, 'medium');
    // Only log in debug mode
    if (window.earthring?.debug) {
      console.log('[Chunks] Loaded chunks around camera position');
    }
  } catch (error) {
    console.error('[Chunks] Failed to load initial chunks:', error);
  }

  try {
    await zoneManager.loadZonesAroundCamera();
  } catch (error) {
    console.error('Failed to load initial zones:', error);
  }
});

wsClient.onClose(() => {
  console.log('WebSocket closed');
  gameStateManager.updateConnectionState('websocket', { 
    connected: false, 
    connecting: false 
  });
});

wsClient.onError((error) => {
  console.error('WebSocket error:', error);
  gameStateManager.updateConnectionState('websocket', { 
    connected: false, 
    lastError: error?.message || 'Unknown error' 
  });
});

// window.earthring is already set up earlier (after zoneEditor initialization)
// This ensures it's available when initializeZonesTab() is called

// Global debug flag for zone coordinates (accessible via window.DEBUG_ZONE_COORDS)
// Enable by running: window.DEBUG_ZONE_COORDS = true in the browser console
window.DEBUG_ZONE_COORDS = false;

// Client initialization complete
console.log('EarthRing client initialized');
