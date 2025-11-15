/**
 * EarthRing Web Client
 * Main entry point for the Three.js-based web client
 */

import * as THREE from 'three';
import { showAuthUI, showUserInfo } from './auth/auth-ui.js';
import { isAuthenticated } from './auth/auth-service.js';
import { showPlayerPanel } from './ui/player-ui.js';
import { showChunkPanel } from './ui/chunk-ui.js';

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

// Basic test: Add a cube
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

camera.position.z = 5;

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

