/**
 * Camera Controller
 * Manages camera movement and controls using OrbitControls
 */

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { setCameraPositionFromEarthRing, getEarthRingPositionFromCamera } from '../utils/rendering.js';
import { toThreeJS } from '../utils/coordinates.js';

/**
 * Camera Controller class
 * Wraps OrbitControls and provides EarthRing coordinate integration
 */
export class CameraController {
  constructor(camera, renderer, sceneManager) {
    this.camera = camera;
    this.renderer = renderer;
    this.sceneManager = sceneManager;
    
    // Create OrbitControls
    this.controls = new OrbitControls(camera, renderer.domElement);
    
    // Configure controls
    this.setupControls();
  }
  
  /**
   * Set up OrbitControls configuration
   */
  setupControls() {
    // Enable damping for smooth movement
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    
    // Enable zoom
    this.controls.enableZoom = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 50000;
    
    // Enable rotation
    this.controls.enableRotate = true;
    
    // Enable panning
    this.controls.enablePan = true;
    
    // Set rotation limits (optional - can be adjusted based on game needs)
    // For a ring world, we might want to limit vertical rotation
    // this.controls.minPolarAngle = Math.PI / 6; // 30 degrees
    // this.controls.maxPolarAngle = Math.PI / 2; // 90 degrees
    
    // Set auto-rotate (optional - can be enabled for cinematic views)
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 2.0;
    
    // Set target (center of rotation)
    // Default to origin, can be updated based on EarthRing position
    this.controls.target.set(0, 0, 0);
  }
  
  /**
   * Set camera position using EarthRing coordinates
   * @param {Object} earthringPosition - EarthRing position {x, y, z}
   */
  setPositionFromEarthRing(earthringPosition) {
    setCameraPositionFromEarthRing(this.camera, earthringPosition);
    this.controls.update();
  }
  
  /**
   * Get current camera position in EarthRing coordinates
   * @returns {Object} EarthRing position {x, y, z}
   */
  getEarthRingPosition() {
    return getEarthRingPositionFromCamera(this.camera);
  }
  
  /**
   * Set controls target using EarthRing coordinates
   * @param {Object} earthringPosition - EarthRing position {x, y, z}
   */
  setTargetFromEarthRing(earthringPosition) {
    const threeJSPos = toThreeJS(earthringPosition);
    this.controls.target.set(threeJSPos.x, threeJSPos.y, threeJSPos.z);
    this.controls.update();
  }
  
  /**
   * Update controls (should be called in render loop)
   */
  update() {
    this.controls.update();
  }
  
  /**
   * Enable or disable controls
   * @param {boolean} enabled - Whether controls are enabled
   */
  setEnabled(enabled) {
    this.controls.enabled = enabled;
  }
  
  /**
   * Reset camera to default position
   */
  reset() {
    const defaultPosition = { x: 1000, y: 0, z: 0 };
    this.setPositionFromEarthRing(defaultPosition);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
  
  /**
   * Get the OrbitControls instance
   * @returns {OrbitControls}
   */
  getControls() {
    return this.controls;
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.controls.dispose();
  }
}

