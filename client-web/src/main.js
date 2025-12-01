/**
 * EarthRing Web Client
 * Main entry point for the Three.js-based web client
 */

import { showAuthUI, showUserInfo } from './auth/auth-ui.js';
import { createConsole } from './ui/console.js';
import { isAuthenticated } from './auth/auth-service.js';
import { showPlayerPanel } from './ui/player-ui.js';
import { showChunkPanel } from './ui/chunk-ui.js';
import { showAdminModal } from './ui/admin-modal.js';
import { initializeZonesTab } from './ui/zone-ui.js';
import { initializeStructuresTab } from './ui/structure-ui.js';
import { createBottomToolbar } from './ui/bottom-toolbar.js';
import { SceneManager } from './rendering/scene-manager.js';
import { CameraController } from './input/camera-controller.js';
import { GameStateManager } from './state/game-state.js';
import { ChunkManager } from './chunks/chunk-manager.js';
import { ZoneManager } from './zones/zone-manager.js';
import { ZoneEditor } from './zones/zone-editor.js';
import { StructureManager } from './structures/structure-manager.js';
import { GridOverlay } from './rendering/grid-overlay.js';
import { DebugInfoPanel } from './ui/debug-info.js';
import { Minimap } from './ui/minimap.js';
import { createZonesToolbar } from './ui/zones-toolbar.js';
import { createInfoBox } from './ui/info-box.js';
import { wsClient } from './network/websocket-client.js';
import { positionToChunkIndex } from './utils/coordinates-new.js';
import { findNearestStation, getStationPosition, getAllStationPositions, getStationName } from './utils/stations.js';

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

// Initialize zone manager first (needed by chunk manager)
const zoneManager = new ZoneManager(gameStateManager, cameraController, sceneManager);
// Expose zone manager globally for debugging/access
window.zoneManager = zoneManager;

// Initialize structure manager
const structureManager = new StructureManager(gameStateManager, cameraController, sceneManager);
// Expose structure manager globally for debugging/access
window.structureManager = structureManager;

// Initialize chunk manager (pass camera controller for position wrapping and zone/structure managers for tracking)
const chunkManager = new ChunkManager(sceneManager, gameStateManager, cameraController, zoneManager);
// Wire structure manager into chunk manager for streamed structures and cleanup
chunkManager.structureManager = structureManager;
const gridOverlay = new GridOverlay(sceneManager, cameraController, gameStateManager, {
  radius: 250, // 250m radius circular grid
  majorSpacing: 5,
  minorSpacing: 1,
  fadeStart: 0.7, // Start fading at 70% of radius
});
const zoneEditor = new ZoneEditor(sceneManager, cameraController, zoneManager, gameStateManager);
// Expose zone editor globally for debugging/access
window.zoneEditor = zoneEditor;
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

// Initialize minimap (manages its own lifecycle)
const _minimap = new Minimap(cameraController, gameStateManager, sceneManager, chunkManager);

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
  debugInfoPanel: debugPanel,
  zoneManager,
  zoneEditor,
  structureManager,
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
    getStationName,
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
        const stationName = getStationName(index) || `Hub ${index}`;
        console.log(`Navigating to ${stationName} at position ${stationPos}m`);
      } else {
        console.error(`Invalid station index: ${index}`);
      }
    },
  },
};

// Set initial camera position for better view of the ring
// EarthRing position: 100m along ring, 0 width, floor 0
const cameraEarthRingPos = { x: 100, y: 0, z: 0 };
cameraController.setPositionFromEarthRing(cameraEarthRingPos);
const camera = sceneManager.getCamera();
// Adjust camera to be elevated and angled for better view
camera.position.y += 20; // Higher up for better overview
camera.position.z += 30; // Back from the ring

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
  const userAuthenticated = gameStateManager.isUserAuthenticated
    ? gameStateManager.isUserAuthenticated()
    : isAuthenticated();
  
  
  // Check if camera has moved enough to load new chunks
  // Throttle chunk loading to avoid excessive requests
  const now = performance.now();
  if (userAuthenticated &&
      wsClient.isConnected() && 
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
  } else if (!userAuthenticated) {
    pendingChunkLoad = false;
  }

  // Zones are loaded via chunk streaming now, not separately
  // Only re-render zones if camera moved significantly (for proper wrapping)
  if (userAuthenticated) {
    if (zoneManager.shouldReRenderZones()) {
      zoneManager.reRenderAllZones();
    }
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
  
  // Initialize console (hidden by default)
  createConsole();

// Start rendering loop
sceneManager.start();

// Create info box (permanent UI element)
createInfoBox();

// Helper function to connect WebSocket and update game state
const connectWebSocket = async () => {
  try {
    await wsClient.connect();
    gameStateManager.updateConnectionState('websocket', { connected: true });
    if (window.earthring?.debug) {
      console.log('WebSocket connected');
    }
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    gameStateManager.updateConnectionState('websocket', { 
      connected: false, 
      lastError: error.message 
    });
  }
};

// Helper function to initialize authenticated user UI
const initializeAuthenticatedUser = () => {
  showUserInfo();
  gameStateManager.updateConnectionState('api', { authenticated: true });
  initializeZonesTab();
  initializeStructuresTab();
};

// Authentication initialization
if (isAuthenticated()) {
  if (window.earthring?.debug) {
    console.log('User is authenticated');
  }
  
  // Update game state
  const token = localStorage.getItem('access_token');
  if (token) {
    initializeAuthenticatedUser();
  }
  
  // Connect WebSocket if already authenticated
  connectWebSocket();
} else {
  showAuthUI();
  if (window.earthring?.debug) {
    console.log('Showing authentication UI');
  }
}

// Listen for authentication events
window.addEventListener('auth:login', async () => {
  if (window.earthring?.debug) {
    console.log('User logged in');
  }
  initializeAuthenticatedUser();
  await connectWebSocket();
});

window.addEventListener('auth:register', async () => {
  if (window.earthring?.debug) {
    console.log('User registered');
  }
  initializeAuthenticatedUser();
  await connectWebSocket();
});

window.addEventListener('auth:logout', async (event) => {
  const reason = event.detail?.reason || 'Session expired';
  if (window.earthring?.debug) {
    console.log(`[Auth] User logged out: ${reason}`);
  }
  
  // Disconnect WebSocket
  try {
    wsClient.disconnect();
    gameStateManager.updateConnectionState('websocket', { 
      connected: false,
      connecting: false 
    });
  } catch (error) {
    console.warn('Error disconnecting WebSocket:', error);
  }
  
  // Clear game state
  gameStateManager.reset();
  gameStateManager.updateConnectionState('api', { authenticated: false });
  
  // Clear zones
  if (typeof zoneManager !== 'undefined' && zoneManager) {
    zoneManager.clearAllZones();
  }
  
  // Hide user info and show auth UI
  const userBar = document.getElementById('user-info-bar');
  if (userBar) {
    userBar.remove();
  }
  showAuthUI();
  
  // Stop any ongoing operations
  if (window.earthring?.debug) {
    console.log('[Auth] Cleared game state and disconnected from server. Please log in again.');
  }
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
  if (window.earthring?.debug) {
    console.log('WebSocket opened');
  }
  gameStateManager.updateConnectionState('websocket', { 
    connected: true, 
    connecting: false 
  });
  
  if (!gameStateManager.isUserAuthenticated?.() && !isAuthenticated()) {
    // User is not authenticated yet; skip auto-loading world data
    return;
  }
  
  // Subscribe to server-driven streaming for chunks and zones
  try {
    const cameraPos = cameraController.getEarthRingPosition();
    const floor = gameStateManager.getActiveFloor();
    
    // Use streaming subscription (server-driven) instead of individual requests
    // This automatically delivers chunks and zones based on camera pose
    const radiusMeters = 5000; // 5km radius
    const widthMeters = 5000;  // 5km width
    
    await chunkManager.subscribeToStreaming(cameraPos.x, floor, radiusMeters, widthMeters);
    
    if (window.earthring?.debug) {
      console.log('[Chunks] Subscribed to server-driven streaming');
    }
  } catch (error) {
    console.error('[Chunks] Failed to subscribe to streaming:', error);
    throw error;
  }

  // Zones are now delivered via stream_delta messages when include_zones is true in subscription
  // ZoneManager will automatically handle streamed zones via its WebSocket handlers
  // Legacy zone loading is kept as fallback (ZoneManager.loadZonesAroundCamera checks streaming state)
});

wsClient.onClose(() => {
  if (window.earthring?.debug) {
    console.log('WebSocket closed');
  }
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

// Global debug flags for zone editor debugging
// Enable by running: window.DEBUG_ZONE_COORDS = true or window.DEBUG_ZONE_PREVIEW = true in the browser console
window.DEBUG_ZONE_COORDS = false;
window.DEBUG_ZONE_PREVIEW = false;

// Client initialization complete
if (window.earthring?.debug) {
  console.log('EarthRing client initialized');
}
