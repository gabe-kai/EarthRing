/**
 * EarthRing Web Client
 * Main entry point for the Three.js-based web client
 */

import { showAuthUI, showUserInfo } from './auth/auth-ui.js';
import { isAuthenticated } from './auth/auth-service.js';
import { showPlayerPanel } from './ui/player-ui.js';
import { showChunkPanel } from './ui/chunk-ui.js';
import * as THREE from 'three';
import { SceneManager } from './rendering/scene-manager.js';
import { CameraController } from './input/camera-controller.js';
import { GameStateManager } from './state/game-state.js';
import { ChunkManager } from './chunks/chunk-manager.js';
import { wsClient } from './network/websocket-client.js';
import { createMeshAtEarthRingPosition } from './utils/rendering.js';

// Initialize game state manager
const gameStateManager = new GameStateManager();

// Initialize scene manager
const sceneManager = new SceneManager();

// Initialize camera controller
const cameraController = new CameraController(
  sceneManager.getCamera(),
  sceneManager.getRenderer(),
  sceneManager
);

// Initialize chunk manager
const chunkManager = new ChunkManager(sceneManager, gameStateManager);

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

// Position camera closer to cube for better view
// EarthRing position: 5m along ring, 0 width, floor 0
const cameraEarthRingPos = { x: 5, y: 0, z: 0 };
cameraController.setPositionFromEarthRing(cameraEarthRingPos);
// Adjust camera to be above and behind the cube
camera.position.y += 5;
camera.position.z += 5;
camera.lookAt(cubeThreeJSPos.x, cubeThreeJSPos.y, cubeThreeJSPos.z);

// Add grid helper for better visibility
const gridHelper = new THREE.GridHelper(100, 10, 0x444444, 0x222222);
scene.add(gridHelper);

// Add axes helper for reference
const axesHelper = new THREE.AxesHelper(10);
scene.add(axesHelper);

// Set up render loop to update camera controls
sceneManager.onRender(() => {
  cameraController.update();
  
  // Rotate test cube
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
});

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
} else {
  showAuthUI();
  console.log('Showing authentication UI');
}

// Listen for authentication events
window.addEventListener('auth:login', async () => {
  console.log('User logged in');
  showUserInfo();
  gameStateManager.updateConnectionState('api', { authenticated: true });
  
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
});

// Listen for panel show events
window.addEventListener('show:player-panel', () => {
  showPlayerPanel();
});

window.addEventListener('show:chunk-panel', () => {
  showChunkPanel();
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
    // Load chunks at camera position (floor 0, radius 2 chunks)
    await chunkManager.requestChunksAtPosition(cameraPos.x, 0, 2, 'medium');
    console.log('Loaded chunks around camera position');
  } catch (error) {
    console.error('Failed to load initial chunks:', error);
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

// Export managers for debugging/development
window.earthring = {
  sceneManager,
  cameraController,
  gameStateManager,
  chunkManager,
  wsClient,
};

// Client initialization complete
console.log('EarthRing client initialized');
