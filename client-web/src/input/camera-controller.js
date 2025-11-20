/**
 * Camera Controller
 * Manages camera movement and controls using OrbitControls
 * Includes keyboard controls for smooth movement along the ring
 */

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as THREE from 'three';
import { setCameraPositionFromEarthRing, getEarthRingPositionFromCamera } from '../utils/rendering.js';
import { toThreeJS, wrapRingPosition, DEFAULT_FLOOR_HEIGHT, fromThreeJS } from '../utils/coordinates.js';

const CAMERA_MIN_CLEARANCE = 2; // meters above current floor plane
const POLAR_EPSILON = 0.01;

/**
 * Camera Controller class
 * Wraps OrbitControls and provides EarthRing coordinate integration
 * Includes keyboard movement controls for exploring the ring
 */
export class CameraController {
  constructor(camera, renderer, sceneManager, gameStateManager) {
    this.camera = camera;
    this.renderer = renderer;
    this.sceneManager = sceneManager;
    this.gameStateManager = gameStateManager;
    
    // Create OrbitControls
    this.controls = new OrbitControls(camera, renderer.domElement);
    
    // Movement state
    this.movementSpeed = 500; // meters per second (5 km per 10 seconds for faster exploration)
    this.widthMovementSpeed = 200; // meters per second for width movement
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
    };
    
    // Configure controls
    this.setupControls();
    
    // Set up keyboard listeners
    this.setupKeyboardControls();
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
    
    // Limit rotation so camera stays above the floor plane (horizontal to straight-down)
    this.controls.minPolarAngle = POLAR_EPSILON; // Slightly above straight down
    this.controls.maxPolarAngle = Math.PI / 2 - POLAR_EPSILON; // Just shy of horizontal
    
    // Set auto-rotate (optional - can be enabled for cinematic views)
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 2.0;
    
    // Set target (center of rotation)
    // Default to origin, can be updated based on EarthRing position
    this.controls.target.set(0, 0, 0);
  }
  
  /**
   * Get the current floor from player state (defaults to 0 if not available)
   * @returns {number} Current floor number
   */
  getCurrentFloor() {
    if (!this.gameStateManager) {
      return 0;
    }
    const playerState = this.gameStateManager.getPlayerState();
    if (!playerState || !playerState.position) {
      return 0;
    }
    // Floor is the Z coordinate, round to nearest integer
    return Math.round(playerState.position.z);
  }

  /**
   * Get the base height (in meters) of the current floor.
   * @returns {number}
   */
  getCurrentFloorBaseHeight() {
    return this.getCurrentFloor() * DEFAULT_FLOOR_HEIGHT;
  }

  /**
   * Minimum camera height (floor base + clearance)
   * @returns {number}
   */
  getMinCameraHeight() {
    return this.getCurrentFloorBaseHeight() + CAMERA_MIN_CLEARANCE;
  }

  /**
   * Clamp Z position to not go below the current floor
   * @param {Object} earthringPosition - EarthRing position {x, y, z}
   * @returns {Object} Clamped EarthRing position
   */
  clampToFloor(earthringPosition) {
    const minZ = this.getCurrentFloor() + CAMERA_MIN_CLEARANCE / DEFAULT_FLOOR_HEIGHT;
    if (earthringPosition.z < minZ) {
      earthringPosition.z = minZ;
    }
    return earthringPosition;
  }

  /**
   * Ensure the OrbitControls target stays at or above the active floor plane.
   */
  clampTargetHeight() {
    const minTargetHeight = this.getCurrentFloorBaseHeight();
    if (this.controls.target.y < minTargetHeight) {
      this.controls.target.y = minTargetHeight;
    }
  }

  /**
   * Clamp the camera's world-space height to stay above the floor plane.
   */
  clampCameraHeight() {
    const minHeight = this.getMinCameraHeight();
    if (this.camera.position.y < minHeight) {
      this.camera.position.y = minHeight;
    }
  }

  /**
   * Clamp both camera and target heights.
   */
  clampHeights() {
    this.clampTargetHeight();
    this.clampCameraHeight();
  }

  /**
   * Set camera position using EarthRing coordinates
   * @param {Object} earthringPosition - EarthRing position {x, y, z}
   */
  setPositionFromEarthRing(earthringPosition) {
    // Clamp Z to not go below current floor
    const clamped = this.clampToFloor({ ...earthringPosition });
    setCameraPositionFromEarthRing(this.camera, clamped);
    this.clampCameraHeight();
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
   * Get the OrbitControls target in EarthRing coordinates.
   * @returns {Object} EarthRing position {x, y, z}
   */
  getTargetEarthRingPosition() {
    const target = this.controls.target;
    const earthTarget = fromThreeJS({
      x: target.x,
      y: target.y,
      z: target.z,
    });
    earthTarget.x = wrapRingPosition(earthTarget.x);
    return earthTarget;
  }

  /**
   * Get the OrbitControls target in Three.js coordinates.
   * @returns {THREE.Vector3}
   */
  getTargetThreePosition() {
    return this.controls.target.clone();
  }
  
  /**
   * Set controls target using EarthRing coordinates
   * @param {Object} earthringPosition - EarthRing position {x, y, z}
   */
  setTargetFromEarthRing(earthringPosition) {
    const threeJSPos = toThreeJS(earthringPosition);
    this.controls.target.set(threeJSPos.x, threeJSPos.y, threeJSPos.z);
    this.clampTargetHeight();
    this.controls.update();
  }
  
  /**
   * Check if the user is currently typing in an input field
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {boolean} True if user is typing in an input field
   */
  isTypingInInput(event) {
    const target = event.target;
    const tagName = target.tagName.toLowerCase();
    
    // Check if focus is on input, textarea, or contenteditable element
    if (tagName === 'input' || tagName === 'textarea') {
      return true;
    }
    
    // Check if element is contenteditable
    if (target.isContentEditable) {
      return true;
    }
    
    // Check if element is inside a form (but allow if it's a button)
    if (tagName === 'button' || tagName === 'select') {
      return false;
    }
    
    return false;
  }
  
  /**
   * Set up keyboard controls for camera movement
   */
  setupKeyboardControls() {
    // Handle key down
    document.addEventListener('keydown', (event) => {
      // Don't intercept keys if user is typing in an input field
      if (this.isTypingInInput(event)) {
        return;
      }
      
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = true;
          event.preventDefault();
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = true;
          event.preventDefault();
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = true;
          event.preventDefault();
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = true;
          event.preventDefault();
          break;
        case 'KeyQ':
        case 'KeyE':
          // Q = move "north" (negative Y), E = move "south" (positive Y)
          if (event.code === 'KeyQ') {
            this.keys.up = true;
          } else {
            this.keys.down = true;
          }
          event.preventDefault();
          break;
      }
    });
    
    // Handle key up
    document.addEventListener('keyup', (event) => {
      // Don't intercept keys if user is typing in an input field
      if (this.isTypingInInput(event)) {
        return;
      }
      
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = false;
          event.preventDefault();
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = false;
          event.preventDefault();
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false;
          event.preventDefault();
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false;
          event.preventDefault();
          break;
        case 'KeyQ':
          this.keys.up = false;
          event.preventDefault();
          break;
        case 'KeyE':
          this.keys.down = false;
          event.preventDefault();
          break;
      }
    });
  }
  
  /**
   * Update camera position based on keyboard input
   * Movement is relative to camera direction (forward/backward along camera view, left/right perpendicular)
   * @param {number} deltaTime - Time since last frame in seconds
   */
  updateMovement(deltaTime) {
    // Check if any movement keys are pressed
    const isMoving = this.keys.forward || this.keys.backward || 
                     this.keys.left || this.keys.right || 
                     this.keys.up || this.keys.down;
    
    // Only update if keys are pressed
    if (!isMoving) {
      return;
    }
    
    // Calculate movement distance based on deltaTime
    const forwardSpeed = this.movementSpeed * deltaTime;
    const strafeSpeed = this.widthMovementSpeed * deltaTime;
    
    // Get camera direction vectors (in Three.js space)
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    
    // Create right vector (perpendicular to camera direction and up)
    const rightVector = new THREE.Vector3();
    rightVector.crossVectors(cameraDirection, this.camera.up).normalize();
    
    // Calculate movement vector based on input
    const movement = new THREE.Vector3();
    
    // Forward/backward movement (along camera direction)
    if (this.keys.forward) {
      movement.add(cameraDirection.multiplyScalar(forwardSpeed));
    }
    if (this.keys.backward) {
      movement.add(cameraDirection.multiplyScalar(-forwardSpeed));
    }
    
    // Left/right strafe movement (perpendicular to camera direction)
    if (this.keys.left) {
      movement.add(rightVector.multiplyScalar(-strafeSpeed));
    }
    if (this.keys.right) {
      movement.add(rightVector.multiplyScalar(strafeSpeed));
    }
    
    // Q/E for vertical movement (up/down in world space)
    if (this.keys.up) {
      movement.add(this.camera.up.clone().multiplyScalar(strafeSpeed));
    }
    if (this.keys.down) {
      movement.add(this.camera.up.clone().multiplyScalar(-strafeSpeed));
    }
    
    // Apply movement to camera and target
    if (movement.length() > 0) {
      this.camera.position.add(movement);
      this.controls.target.add(movement);
      this.clampHeights();
    }
  }
  
  /**
   * Update controls (should be called in render loop)
   * @param {number} [deltaTime] - Time since last frame in seconds (for movement)
   */
  update(deltaTime) {
    // Update keyboard movement if deltaTime provided
    if (deltaTime !== undefined) {
      this.updateMovement(deltaTime);
    }
    
    // Update OrbitControls
    this.controls.update();
    this.clampHeights();
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
    this.clampHeights();
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
   * Set movement speed
   * @param {number} speed - Movement speed in meters per second
   */
  setMovementSpeed(speed) {
    this.movementSpeed = speed;
  }
  
  /**
   * Set width movement speed
   * @param {number} speed - Width movement speed in meters per second
   */
  setWidthMovementSpeed(speed) {
    this.widthMovementSpeed = speed;
  }
  
  /**
   * Get current movement speed
   * @returns {number} Movement speed in meters per second
   */
  getMovementSpeed() {
    return this.movementSpeed;
  }
  
  /**
   * Smoothly move camera to a specific EarthRing position
   * @param {Object} targetPosition - Target EarthRing position {x, y, z}
   * @param {number} duration - Duration of movement in seconds (default: 2)
   */
  moveToPosition(targetPosition, duration = 2) {
    const startPos = this.getEarthRingPosition();
    const startTime = performance.now();
    
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      
      // Smooth easing function (ease-in-out)
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const currentPos = {
        x: startPos.x + (targetPosition.x - startPos.x) * eased,
        y: startPos.y + (targetPosition.y - startPos.y) * eased,
        z: startPos.z + (targetPosition.z - startPos.z) * eased,
      };
      
      // Wrap ring position
      currentPos.x = wrapRingPosition(currentPos.x);
      
      // Clamp Z to current floor (setPositionFromEarthRing will handle this, but we do it here too for consistency)
      const clamped = this.clampToFloor(currentPos);
      
      this.setPositionFromEarthRing(clamped);
      this.setTargetFromEarthRing(clamped);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.controls.dispose();
    // Note: Keyboard event listeners persist, but that's acceptable for this implementation
  }
}

