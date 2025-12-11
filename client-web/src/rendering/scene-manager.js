/**
 * Scene Manager
 * Manages Three.js scene, camera, renderer, lighting, and rendering loop
 */

import * as THREE from 'three';
import { setCameraPositionFromEarthRing } from '../utils/rendering.js';

/**
 * Scene Manager class
 * Handles Three.js scene initialization, lighting, rendering loop, and window resize
 */
export class SceneManager {
  constructor(container) {
    this.container = container || document.body;
    
    // Initialize Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      100000 // Large far plane for ring (264,000 km)
    );
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false,
    });
    
    // Enable local clipping planes for construction animations (bottom-to-top reveal)
    this.renderer.localClippingEnabled = true;
    
    // Set up renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Append canvas to container
    this.container.appendChild(this.renderer.domElement);
    
    // Initialize lighting
    this.setupLighting();
    
    // Set initial camera position (EarthRing coordinates: 1000m along ring, 0 width, floor 0)
    const initialPosition = { x: 1000, y: 0, z: 0 };
    setCameraPositionFromEarthRing(this.camera, initialPosition);
    this.camera.position.y += 10; // Offset for better view
    this.camera.position.z += 10;
    
    // Animation frame ID for cleanup
    this.animationFrameId = null;
    
    // Render loop callback
    this.onRenderCallbacks = [];
    
    // Time tracking for deltaTime calculation
    this.lastFrameTime = performance.now();
    
    // Set up window resize handler
    this.setupResizeHandler();
  }
  
  /**
   * Set up lighting for the scene
   */
  setupLighting() {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    // Directional light (sun) - positioned to simulate sunlight
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1000, 1000, 500);
    directionalLight.castShadow = true;
    
    // Configure shadow map
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 5000;
    directionalLight.shadow.camera.left = -2000;
    directionalLight.shadow.camera.right = 2000;
    directionalLight.shadow.camera.top = 2000;
    directionalLight.shadow.camera.bottom = -2000;
    
    this.scene.add(directionalLight);
  }
  
  /**
   * Set up window resize handler
   */
  setupResizeHandler() {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      // Update camera aspect ratio
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      
      // Update renderer size
      this.renderer.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Store handler for cleanup if needed
    this.resizeHandler = handleResize;
  }
  
  /**
   * Register a callback to be called each frame during render
   * @param {Function} callback - Function to call each frame
   */
  onRender(callback) {
    this.onRenderCallbacks.push(callback);
  }
  
  /**
   * Remove a render callback
   * @param {Function} callback - Function to remove
   */
  offRender(callback) {
    const index = this.onRenderCallbacks.indexOf(callback);
    if (index > -1) {
      this.onRenderCallbacks.splice(index, 1);
    }
  }
  
  /**
   * Start the rendering loop
   */
  start() {
    if (this.animationFrameId !== null) {
      return; // Already running
    }
    
    this.lastFrameTime = performance.now();
    
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      
      // Calculate deltaTime (time since last frame in seconds)
      const currentTime = performance.now();
      const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
      this.lastFrameTime = currentTime;
      
      // Cap deltaTime to prevent large jumps (e.g., when tab is inactive)
      const clampedDeltaTime = Math.min(deltaTime, 0.1); // Max 100ms per frame
      
      // Call all render callbacks with deltaTime
      this.onRenderCallbacks.forEach(callback => {
        callback(clampedDeltaTime);
      });
      
      // Render the scene
      this.renderer.render(this.scene, this.camera);
    };
    
    animate();
  }
  
  /**
   * Stop the rendering loop
   */
  stop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    
    // Remove resize handler
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    
    // Dispose of renderer
    this.renderer.dispose();
    
    // Remove canvas from DOM
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    
    // Clear callbacks
    this.onRenderCallbacks = [];
  }
  
  /**
   * Get the scene
   * @returns {THREE.Scene}
   */
  getScene() {
    return this.scene;
  }
  
  /**
   * Get the camera
   * @returns {THREE.PerspectiveCamera}
   */
  getCamera() {
    return this.camera;
  }
  
  /**
   * Get the renderer
   * @returns {THREE.WebGLRenderer}
   */
  getRenderer() {
    return this.renderer;
  }
}
