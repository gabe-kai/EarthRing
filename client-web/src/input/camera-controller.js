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
    this.movementSpeed = 500; // meters per second (base speed at reference elevation)
    this.widthMovementSpeed = 200; // meters per second for width movement (base speed)
    this.rotationSpeed = 90; // degrees per second for Q/E rotation
    this.panSpeed = 200; // meters per second for R/F vertical panning
    this.zoomSpeed = 1000; // meters per second for PageUp/PageDown zoom
    
    // Elevation-based speed scaling
    this.minElevation = 2; // meters (minimum height above floor)
    this.referenceElevation = 50; // meters (elevation where speed multiplier is 1.0)
    this.minSpeedMultiplier = 0.1; // Speed multiplier at minimum elevation (fine-grained control)
    this.maxSpeedMultiplier = 10.0; // Speed multiplier at very high elevations
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      rotateLeft: false,    // Q - counter-clockwise
      rotateRight: false,  // E - clockwise
      panUp: false,        // R - pan up
      panDown: false,      // F - pan down
      zoomIn: false,       // PageUp
      zoomOut: false,      // PageDown
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
    
    // Enable zoom (mouse wheel)
    this.controls.enableZoom = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 50000;
    this.controls.zoomSpeed = 1.0;
    
    // Enable rotation (left mouse button)
    this.controls.enableRotate = true;
    
    // Enable panning (right mouse button or middle mouse button)
    this.controls.enablePan = true;
    // Middle mouse button for panning/tilting
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY_PAN, // Pan and zoom with middle mouse
      RIGHT: THREE.MOUSE.PAN,
    };
    
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
          // Q = rotate counter-clockwise
          this.keys.rotateLeft = true;
          event.preventDefault();
          break;
        case 'KeyE':
          // E = rotate clockwise
          this.keys.rotateRight = true;
          event.preventDefault();
          break;
        case 'KeyR':
          // R = pan up
          this.keys.panUp = true;
          event.preventDefault();
          break;
        case 'KeyF':
          // F = pan down
          this.keys.panDown = true;
          event.preventDefault();
          break;
        case 'PageUp':
          // PageUp = zoom in
          this.keys.zoomIn = true;
          event.preventDefault();
          break;
        case 'PageDown':
          // PageDown = zoom out
          this.keys.zoomOut = true;
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
          this.keys.rotateLeft = false;
          event.preventDefault();
          break;
        case 'KeyE':
          this.keys.rotateRight = false;
          event.preventDefault();
          break;
        case 'KeyR':
          this.keys.panUp = false;
          event.preventDefault();
          break;
        case 'KeyF':
          this.keys.panDown = false;
          event.preventDefault();
          break;
        case 'PageUp':
          this.keys.zoomIn = false;
          event.preventDefault();
          break;
        case 'PageDown':
          this.keys.zoomOut = false;
          event.preventDefault();
          break;
      }
    });
  }
  
  /**
   * Calculate speed multiplier based on camera elevation above ground
   * Uses logarithmic scaling: closer to ground = slower, higher = faster
   * @returns {number} Speed multiplier (0.1 to maxSpeedMultiplier)
   */
  getElevationSpeedMultiplier() {
    const floorHeight = this.getCurrentFloorBaseHeight();
    const cameraElevation = this.camera.position.y - floorHeight;
    
    // Clamp elevation to minimum
    const elevation = Math.max(cameraElevation, this.minElevation);
    
    // Use logarithmic scaling for smooth speed increase with elevation
    // Formula: multiplier = minMultiplier * (elevation / minElevation) ^ logScale
    // At minElevation: multiplier = minSpeedMultiplier
    // At referenceElevation: multiplier ≈ 1.0
    // At higher elevations: multiplier increases logarithmically
    
    // Calculate log scale factor to make referenceElevation = 1.0 multiplier
    const logScale = Math.log(1.0 / this.minSpeedMultiplier) / Math.log(this.referenceElevation / this.minElevation);
    
    // Calculate speed multiplier
    const multiplier = this.minSpeedMultiplier * Math.pow(elevation / this.minElevation, logScale);
    
    // Clamp to maximum
    return Math.min(multiplier, this.maxSpeedMultiplier);
  }

  /**
   * Update camera position based on keyboard input
   * Movement is relative to camera direction (forward/backward along camera view, left/right perpendicular)
   * Speed scales with elevation: closer to ground = slower, higher = faster
   * @param {number} deltaTime - Time since last frame in seconds
   */
  updateMovement(deltaTime) {
    // Check if any movement keys are pressed
    const isMoving = this.keys.forward || this.keys.backward || 
                     this.keys.left || this.keys.right || 
                     this.keys.rotateLeft || this.keys.rotateRight ||
                     this.keys.panUp || this.keys.panDown ||
                     this.keys.zoomIn || this.keys.zoomOut;
    
    // Only update if keys are pressed
    if (!isMoving) {
      return;
    }
    
    // Get elevation-based speed multiplier
    const speedMultiplier = this.getElevationSpeedMultiplier();
    
    // Calculate movement distance based on deltaTime and elevation
    const forwardSpeed = this.movementSpeed * speedMultiplier * deltaTime;
    const strafeSpeed = this.widthMovementSpeed * speedMultiplier * deltaTime;
    const rotationSpeed = (this.rotationSpeed * Math.PI / 180) * deltaTime; // Convert to radians (not affected by elevation)
    const panSpeed = this.panSpeed * speedMultiplier * deltaTime; // Pan speed also scales with elevation
    const zoomSpeed = this.zoomSpeed * deltaTime; // Zoom speed not affected by elevation
    
    // Get camera direction vectors (in Three.js space)
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    
    // Project camera direction onto XZ plane (horizontal) for forward/backward movement
    // This maintains elevation when moving forward/backward
    const horizontalDirection = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z).normalize();
    
    // Create right vector (perpendicular to horizontal direction and up)
    const rightVector = new THREE.Vector3();
    rightVector.crossVectors(horizontalDirection, this.camera.up).normalize();
    
    // Calculate movement vector based on input
    const movement = new THREE.Vector3();
    
    // Forward/backward movement (along horizontal camera direction, maintaining elevation)
    if (this.keys.forward) {
      movement.add(horizontalDirection.multiplyScalar(forwardSpeed));
    }
    if (this.keys.backward) {
      movement.add(horizontalDirection.multiplyScalar(-forwardSpeed));
    }
    
    // Left/right strafe movement (perpendicular to camera direction)
    if (this.keys.left) {
      movement.add(rightVector.multiplyScalar(-strafeSpeed));
    }
    if (this.keys.right) {
      movement.add(rightVector.multiplyScalar(strafeSpeed));
    }
    
    // R/F for vertical panning (up/down in world space)
    if (this.keys.panUp) {
      movement.add(this.camera.up.clone().multiplyScalar(panSpeed));
    }
    if (this.keys.panDown) {
      movement.add(this.camera.up.clone().multiplyScalar(-panSpeed));
    }
    
    // Apply movement to camera and target
    if (movement.length() > 0) {
      this.camera.position.add(movement);
      this.controls.target.add(movement);
      this.clampHeights();
    }
    
    // Q/E for rotation (rotate around target)
    if (this.keys.rotateLeft || this.keys.rotateRight) {
      const rotationAxis = new THREE.Vector3(0, 1, 0); // Y-axis (vertical)
      const rotationAngle = this.keys.rotateLeft ? rotationSpeed : -rotationSpeed;
      
      // Rotate camera around target
      const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      offset.applyAxisAngle(rotationAxis, rotationAngle);
      this.camera.position.copy(this.controls.target).add(offset);
      
      // Update camera to look at target
      this.camera.lookAt(this.controls.target);
    }
    
    // PageUp/PageDown for zoom (move camera closer/farther from target)
    if (this.keys.zoomIn || this.keys.zoomOut) {
      const direction = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
      const zoomAmount = this.keys.zoomIn ? -zoomSpeed : zoomSpeed;
      
      // Calculate new distance
      const currentDistance = this.camera.position.distanceTo(this.controls.target);
      const newDistance = Math.max(5, Math.min(50000, currentDistance + zoomAmount));
      
      // Move camera along direction vector
      this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(newDistance));
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

