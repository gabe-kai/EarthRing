/**
 * EarthRing Web Client
 * Main entry point for the Three.js-based web client
 */

import * as THREE from 'three';
import { showAuthUI, showUserInfo } from './auth/auth-ui.js';
import { isAuthenticated } from './auth/auth-service.js';
import { showPlayerPanel } from './ui/player-ui.js';
import { showChunkPanel } from './ui/chunk-ui.js';
import { setCameraPositionFromEarthRing, createMeshAtEarthRingPosition } from './utils/rendering.js';

// Initialize scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  10000
);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Basic test: Add a cube at EarthRing position (0, 0, 0) = ring start, center width, floor 0
// Using rendering utility that handles coordinate conversion
const earthringPosition = { x: 0, y: 0, z: 0 };
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = createMeshAtEarthRingPosition(geometry, material, earthringPosition);
scene.add(cube);

// Position camera using EarthRing coordinates (1000m along ring, 0 width, floor 0)
// Using rendering utility that handles coordinate conversion
const cameraEarthRingPos = { x: 1000, y: 0, z: 0 };
setCameraPositionFromEarthRing(camera, cameraEarthRingPos);
// Offset camera slightly for better view
camera.position.y += 10;
camera.position.z += 10;
camera.lookAt(cube.position.x, cube.position.y, cube.position.z);

/**
 * Animation loop that continuously renders the scene.
 * Updates cube rotation and renders each frame using requestAnimationFrame.
 */
function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}

animate();

// Authentication initialization
if (isAuthenticated()) {
  showUserInfo();
  console.log('User is authenticated');
} else {
  showAuthUI();
  console.log('Showing authentication UI');
}

// Listen for authentication events
window.addEventListener('auth:login', () => {
  console.log('User logged in');
  showUserInfo();
});

window.addEventListener('auth:register', () => {
  console.log('User registered');
  showUserInfo();
});

window.addEventListener('auth:logout', () => {
  console.log('User logged out');
});

// Listen for panel show events
window.addEventListener('show:player-panel', () => {
  showPlayerPanel();
});

window.addEventListener('show:chunk-panel', () => {
  showChunkPanel();
});

// Client initialization complete

