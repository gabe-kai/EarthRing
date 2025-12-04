/**
 * Zone Editor
 * Handles interactive zone creation and editing tools
 * Supports: rectangle, circle, dezone, polygon, and paintbrush tools
 */

// Debug toggles are initialized in main.js
// Set window.DEBUG_ZONE_PREVIEW = true or window.DEBUG_ZONE_COORDS = true to enable debug logging

import * as THREE from 'three';
import { fromThreeJS, toThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition, normalizeRelativeToCamera, denormalizeFromCamera } from '../utils/coordinates-new.js';
import { createZone, deleteZone } from '../api/zone-service.js';
import { getCurrentUser } from '../auth/auth-service.js';

const TOOLS = {
  NONE: 'none',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  POLYGON: 'polygon',
  PAINTBRUSH: 'paintbrush',
  SELECT: 'select',
};

export class ZoneEditor {
  constructor(sceneManager, cameraController, zoneManager, gameStateManager) {
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== ZoneEditor CONSTRUCTOR CALLED ===');
      console.error('ZoneEditor instance created', {
        hasSceneManager: !!sceneManager,
        hasCameraController: !!cameraController,
        hasZoneManager: !!zoneManager,
        hasGameStateManager: !!gameStateManager
      });
    }
    
    this.scene = sceneManager.getScene();
    this.camera = sceneManager.getCamera();
    this.renderer = sceneManager.getRenderer();
    this.cameraController = cameraController;
    this.zoneManager = zoneManager;
    this.gameStateManager = gameStateManager;
    
    // Raycaster for mouse-to-world coordinate conversion
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Editor state
    this.currentTool = TOOLS.NONE;
    this.isDrawing = false;
    this.currentFloor = 0; // Will be synced with gameState.activeFloor
    this.currentZoneType = 'residential';
    
    // Drawing state
    this.startPoint = null; // EarthRing coordinates
    this.currentPoint = null;
    this.polygonVertices = []; // For polygon tool
    this.previewMesh = null; // Preview geometry while drawing
    
    // Selection state
    this.selectedZone = null;
    this.selectedZoneMesh = null;
    
    // Paintbrush state
    this.paintbrushRadius = 10; // meters (default brush size)
    this.paintbrushPath = []; // Array of points for paintbrush
    
    // Track last floor to avoid unnecessary updates
    this.lastFloor = null;
    
    // Event handlers
    this.onToolChangeCallbacks = [];
    this.onZoneCreatedCallbacks = [];
    this.onZoneSelectedCallbacks = [];
    this.onZoneDeselectedCallbacks = [];
    
    // Create invisible plane for raycasting (at floor level)
    this.createRaycastPlane();
    
    // Set up mouse event listeners
    this.setupMouseListeners();
    
    // Initialize floor from game state (active floor, not camera)
    this.currentFloor = this.gameStateManager.getActiveFloor();
    
    // Listen for active floor changes
    this.gameStateManager.on('activeFloorChanged', ({ newFloor }) => {
      this.setFloor(newFloor);
    });
  }
  
  /**
   * Create an invisible plane at the floor level for raycasting
   */
  createRaycastPlane() {
    // Create a very large plane at floor 0 for raycasting
    // Make it extremely large to ensure it's always hit regardless of camera angle/distance
    // Zones are rendered at floor * DEFAULT_FLOOR_HEIGHT, so floor 0 is at Y=0
    const planeGeometry = new THREE.PlaneGeometry(10000000, 10000000); // Increased from 1M to 10M
    const planeMaterial = new THREE.MeshBasicMaterial({ 
      visible: false,
      side: THREE.DoubleSide 
    });
    this.raycastPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.raycastPlane.rotation.x = -Math.PI / 2; // Horizontal plane
    this.raycastPlane.position.y = this.currentFloor * DEFAULT_FLOOR_HEIGHT; // Match zone rendering position
    // Ensure the plane is always in the scene and properly positioned
    this.scene.add(this.raycastPlane);
  }
  
  /**
   * Set up mouse event listeners
   */
  setupMouseListeners() {
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] setupMouseListeners CALLED ===', {
        rendererElement: this.renderer.domElement,
        hasRenderer: !!this.renderer
      });
    }
    
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.renderer.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.renderer.domElement.addEventListener('click', this.onClick.bind(this));
    
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] Event listeners ATTACHED ===');
    }
    this.renderer.domElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Right-click to dismiss tool and return to select mode
      if (this.currentTool !== TOOLS.NONE && this.currentTool !== TOOLS.SELECT) {
        // Cancel any active drawing
        if (this.isDrawing) {
          this.cancelDrawing();
        }
        // Return to select mode
        this.setTool(TOOLS.SELECT);
      }
      // Right-click to finish polygon (if in polygon mode)
      else if (this.currentTool === TOOLS.POLYGON && this.polygonVertices.length >= 3) {
        this.finishPolygon();
      }
    });
    // Double-click to finish polygon
    this.renderer.domElement.addEventListener('dblclick', (e) => {
      if (this.currentTool === TOOLS.POLYGON && this.polygonVertices.length >= 3) {
        e.preventDefault();
        this.finishPolygon();
      }
    });
  }
  
  /**
   * Convert mouse coordinates to normalized device coordinates
   */
  updateMousePosition(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }
  
  /**
   * Get EarthRing coordinates from mouse position via raycasting
   * Returns coordinates normalized relative to camera (not wrapped to [0, 264000000))
   * This prevents mirroring and ensures preview matches final geometry
   */
  getEarthRingPositionFromMouse(event) {
    if (window.DEBUG_ZONE_COORDS && this.isDrawing) {
      console.log('[ZoneEditor] getEarthRingPositionFromMouse called', {
        mouse: { x: this.mouse.x, y: this.mouse.y },
        cameraPosition: this.camera.position,
        cameraRotation: this.camera.rotation
      });
    }
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Ensure raycast plane is at the correct floor position and in the scene
    if (this.raycastPlane) {
      const floorHeight = this.currentFloor * DEFAULT_FLOOR_HEIGHT;
      this.raycastPlane.position.y = floorHeight;
      // Ensure plane is in scene (might have been removed)
      if (!this.raycastPlane.parent) {
        this.scene.add(this.raycastPlane);
      }
    } else {
      // Plane doesn't exist - recreate it
      this.createRaycastPlane();
    }
    
    // Intersect with the floor plane
    // Use intersectObjects with an array to ensure proper intersection
    const intersects = this.raycaster.intersectObject(this.raycastPlane, false);
    if (window.DEBUG_ZONE_COORDS && this.isDrawing) {
      console.log('[ZoneEditor] getEarthRingPositionFromMouse: Mesh intersection result', {
        intersectsCount: intersects.length,
        raycastPlaneExists: !!this.raycastPlane,
        raycastPlaneInScene: !!this.raycastPlane?.parent,
        raycastPlanePosition: this.raycastPlane?.position
      });
    }
    if (intersects.length > 0) {
      const worldPos = intersects[0].point;
      // Convert Three.js coordinates to EarthRing coordinates
      // We use DEFAULT_FLOOR_HEIGHT for the conversion, then override z with the actual floor
      const earthRingPos = fromThreeJS(worldPos, DEFAULT_FLOOR_HEIGHT);
      earthRingPos.z = this.currentFloor;
      
      // Get camera position to normalize coordinates relative to camera
      // This prevents zones from appearing mirrored on the other side of the ring
      const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      const cameraX = cameraPos.x;
      
      // Normalize X coordinate relative to camera (like chunks)
      // This ensures zones are created near the camera, not wrapped to the other side
      // DON'T wrap here - keep relative to camera for consistent preview/final geometry
      const x = normalizeRelativeToCamera(earthRingPos.x, cameraX);
      
      // Return coordinates normalized relative to camera (not wrapped)
      // Wrapping will happen in geometry creation functions when creating GeoJSON
      return {
        x,
        y: earthRingPos.y,
        z: earthRingPos.z,
      };
    }
    
    // If raycast failed, try alternative method: intersect with a mathematical plane
    // This helps when looking straight down where the mesh intersection might fail
    const floorHeight = this.currentFloor * DEFAULT_FLOOR_HEIGHT;
    const planeNormal = new THREE.Vector3(0, 1, 0); // Up vector (Y axis)
    const planeConstant = -floorHeight; // Distance from origin
    const plane = new THREE.Plane(planeNormal, planeConstant);
    
    const intersectionPoint = new THREE.Vector3();
    const didIntersect = this.raycaster.ray.intersectPlane(plane, intersectionPoint);
    
    if (window.DEBUG_ZONE_COORDS && this.isDrawing) {
      console.log('[ZoneEditor] getEarthRingPositionFromMouse: Fallback plane intersection', {
        didIntersect: didIntersect,
        intersectionPoint: intersectionPoint,
        floorHeight: floorHeight,
        rayDirection: this.raycaster.ray.direction
      });
    }
    
    // Check if intersection is valid (not at infinity and not null)
    if (didIntersect !== null && 
        intersectionPoint.x !== Infinity && 
        intersectionPoint.y !== Infinity && 
        intersectionPoint.z !== Infinity &&
        !isNaN(intersectionPoint.x) &&
        !isNaN(intersectionPoint.y) &&
        !isNaN(intersectionPoint.z)) {
      try {
        const earthRingPos = fromThreeJS(intersectionPoint, DEFAULT_FLOOR_HEIGHT);
        earthRingPos.z = this.currentFloor;
        
        const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
        const cameraX = cameraPos.x;
        const x = normalizeRelativeToCamera(earthRingPos.x, cameraX);
        
        return {
          x,
          y: earthRingPos.y,
          z: earthRingPos.z,
        };
      } catch (error) {
        if (window.DEBUG_ZONE_COORDS) {
          console.warn('[ZoneEditor] Fallback intersection succeeded but coordinate conversion failed:', error);
        }
      }
    }
    
    // Third fallback: Use camera position and ray direction to intersect floor plane
    // This is a last resort when both intersection methods fail
    try {
      const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      const cameraWorldPos = this.camera.position.clone();
      
      // Get the ray direction from the raycaster (already set from camera)
      const rayDirection = this.raycaster.ray.direction.clone();
      
      // Calculate intersection with floor plane using ray equation: point = origin + t * direction
      // Floor plane: y = floorHeight, so we solve: cameraWorldPos.y + t * rayDirection.y = floorHeight
      const t = (floorHeight - cameraWorldPos.y) / rayDirection.y;
      
      // Check if intersection is valid (ray is not parallel to floor and t is reasonable)
      if (Math.abs(rayDirection.y) > 0.001 && !isNaN(t) && isFinite(t) && t > 0 && t < 100000) {
        const fallbackPoint = cameraWorldPos.clone();
        fallbackPoint.addScaledVector(rayDirection, t);
        
        // Validate the point is reasonable
        if (Math.abs(fallbackPoint.y - floorHeight) < 1000 && // Close to floor
            Math.abs(fallbackPoint.x) < 100000000 && // Reasonable X range
            Math.abs(fallbackPoint.z) < 100000000) { // Reasonable Z range
          const earthRingPos = fromThreeJS(fallbackPoint, DEFAULT_FLOOR_HEIGHT);
          earthRingPos.z = this.currentFloor;
          const cameraX = cameraPos.x;
          const x = normalizeRelativeToCamera(earthRingPos.x, cameraX);
          
          return {
            x,
            y: earthRingPos.y,
            z: earthRingPos.z,
          };
        }
      }
    } catch (error) {
      if (window.DEBUG_ZONE_COORDS) {
        console.warn('[ZoneEditor] Third fallback method failed:', error);
      }
    }
    
    // If both methods failed, log for debugging (only in debug mode to avoid spam)
    if (window.DEBUG_ZONE_COORDS) {
      console.warn('[ZoneEditor] getEarthRingPositionFromMouse: No intersection with raycast plane', {
        mouse: { x: this.mouse.x, y: this.mouse.y },
        cameraPosition: this.camera.position,
        cameraRotation: this.camera.rotation,
        raycastPlanePosition: this.raycastPlane?.position,
        raycastPlaneRotation: this.raycastPlane?.rotation,
      });
    }
    
    return null;
  }
  
  /**
   * Handle mouse down event
   */
  onMouseDown(event) {
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] onMouseDown CALLED ===', {
        button: event.button,
        currentTool: this.currentTool,
        isDrawing: this.isDrawing,
        target: event.target,
        rendererElement: this.renderer.domElement
      });
    }
    
    // Don't interfere if clicking on UI elements
    if (event.target !== this.renderer.domElement) {
      return;
    }
    
    // Right mouse button (2): Dismiss tool and return to select mode
    if (event.button === 2) {
      if (this.currentTool !== TOOLS.NONE && this.currentTool !== TOOLS.SELECT) {
        // Cancel any active drawing
        if (this.isDrawing) {
          this.cancelDrawing();
        }
        // Return to select mode
        this.setTool(TOOLS.SELECT);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // If already in select mode or no tool, let OrbitControls handle it (pan)
      return;
    }
    
    // Left mouse button (0) when no tool is active: default to select tool
    if (this.currentTool === TOOLS.NONE && event.button === 0) {
      this.setTool(TOOLS.SELECT);
      // Fall through to handle the selection
    }
    
    // If still no tool active after handling defaults, let OrbitControls handle it
    if (this.currentTool === TOOLS.NONE) {
      return;
    }
    
    // Only handle left mouse button (0) for tools
    if (event.button !== 0) return;
    
    // Prevent OrbitControls from interfering when a tool is active
    if (this.currentTool !== TOOLS.NONE) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    // Handle selection tool - doesn't need earthRingPos (uses raycasting)
    if (this.currentTool === TOOLS.SELECT) {
      this.handleZoneSelection(event);
      return;
    }
    
    // Other tools need earthRingPos
    const earthRingPos = this.getEarthRingPositionFromMouse(event);
    if (!earthRingPos) return;
    
    // DEBUG: Log click position
    if (window.DEBUG_ZONE_COORDS) {
      const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      console.log('[ZoneEditor] Mouse DOWN:', {
        earthRingPos: { ...earthRingPos },
        cameraX: cameraPos.x,
        tool: this.currentTool,
        button: event.button,
      });
    }
    
    if (this.currentTool === TOOLS.POLYGON) {
      this.handlePolygonClick(earthRingPos);
      return;
    }
    
    // Start drawing for drag-based tools
    if (!this.isDrawing) {
      this.startDrawing(earthRingPos, event);
    }
  }
  
  /**
   * Handle mouse move event
   */
  onMouseMove(event) {
    if (this.currentTool === TOOLS.NONE) {
      // Don't log every mouse move when no tool is active (too noisy)
      return;
    }
    
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] onMouseMove CALLED ===', {
        currentTool: this.currentTool,
        isDrawing: this.isDrawing,
        hasStartPoint: !!this.startPoint
      });
    }
    
    if (window.DEBUG_ZONE_COORDS && this.isDrawing) {
      console.log('[ZoneEditor] onMouseMove: tool active, isDrawing=true', {
        tool: this.currentTool,
        hasStartPoint: !!this.startPoint
      });
    }
    
    const earthRingPos = this.getEarthRingPositionFromMouse(event);
    if (!earthRingPos) {
      if (window.DEBUG_ZONE_PREVIEW) {
        console.error('=== [ZoneEditor] onMouseMove: getEarthRingPositionFromMouse returned NULL ===', {
          isDrawing: this.isDrawing,
          hasCurrentPoint: !!this.currentPoint,
          hasStartPoint: !!this.startPoint,
          currentPoint: this.currentPoint,
          startPoint: this.startPoint
        });
      }
      // If raycast failed, try to use the last known position if we're drawing
      // This helps maintain preview when raycasting is unreliable at certain angles
      if (this.isDrawing && this.currentPoint) {
        if (window.DEBUG_ZONE_PREVIEW) {
          console.error('=== [ZoneEditor] onMouseMove: Using fallback currentPoint ===', this.currentPoint);
        }
        // Use last known position to keep preview updating
        // This prevents preview from disappearing when raycast temporarily fails
        this.updatePreview(this.currentPoint);
      } else if (this.isDrawing && this.startPoint) {
        if (window.DEBUG_ZONE_PREVIEW) {
          console.error('=== [ZoneEditor] onMouseMove: Using fallback startPoint ===', this.startPoint);
        }
        // If we have a start point but no current position, use start point
        // This ensures preview appears even if first raycast fails
        this.updatePreview(this.startPoint);
      } else {
        if (window.DEBUG_ZONE_PREVIEW) {
          console.error('=== [ZoneEditor] onMouseMove: No fallback available, returning ===');
        }
      }
      return;
    }
    
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] onMouseMove: getEarthRingPositionFromMouse SUCCEEDED ===', {
        earthRingPos: earthRingPos,
        isDrawing: this.isDrawing
      });
    }
    
    this.currentPoint = earthRingPos;
    
    if (this.isDrawing) {
      if (window.DEBUG_ZONE_PREVIEW) {
        console.error('=== [ZoneEditor] onMouseMove: Calling updatePreview ===', earthRingPos);
      }
      // For paintbrush, add points to the path while dragging
      if (this.currentTool === TOOLS.PAINTBRUSH) {
        // Add point to path if it's far enough from the last point (prevent too many points)
        // Use smaller distance threshold to ensure smooth brush strokes
        const MIN_DISTANCE = 1; // meters - reduced from 2 to capture more points during drag
        if (this.paintbrushPath.length === 0) {
          this.paintbrushPath.push(earthRingPos);
        } else {
          const lastPoint = this.paintbrushPath[this.paintbrushPath.length - 1];
          const dx = earthRingPos.x - lastPoint.x;
          const dy = earthRingPos.y - lastPoint.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance >= MIN_DISTANCE) {
            this.paintbrushPath.push(earthRingPos);
          } else if (this.paintbrushPath.length === 1) {
            // If we only have 1 point so far, always add the second point even if close
            // This ensures we can create a stroke even for short movements
            this.paintbrushPath.push(earthRingPos);
          } else {
            // If distance is too small, update the last point to the current position
            // This ensures smooth brush strokes even when moving slowly
            this.paintbrushPath[this.paintbrushPath.length - 1] = earthRingPos;
          }
        }
      }
      
      this.updatePreview(earthRingPos);
    } else if (this.currentTool === TOOLS.PAINTBRUSH) {
      // Show paintbrush preview
      this.updatePaintbrushPreview(earthRingPos);
    }
  }
  
  /**
   * Handle mouse up event
   */
  onMouseUp(event) {
    if (event.button !== 0) return;
    if (!this.isDrawing) return;
    
    // Get the actual mouse release position from the event
    // This ensures the final zone goes exactly where the cursor is when released
    const endPos = this.getEarthRingPositionFromMouse(event);
    if (!endPos) {
      // If we can't get position, still stop drawing
      this.isDrawing = false;
      return;
    }
    
    // Update currentPoint to match
    this.currentPoint = endPos;
    
    // Stop drawing immediately to prevent preview from continuing to update
    // This ensures the preview stays at the release position
    this.isDrawing = false;
    
    // Update preview one final time with the actual release position
    // This ensures the preview shows exactly what will be created
    if (this.currentTool !== TOOLS.POLYGON && this.currentTool !== TOOLS.SELECT) {
      this.updatePreview(endPos);
    }
    
    // DEBUG: Log release position
    if (window.DEBUG_ZONE_COORDS) {
      const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      console.log('[ZoneEditor] Mouse UP:', {
        earthRingPos: { ...endPos },
        cameraX: cameraPos.x,
        tool: this.currentTool,
        startPoint: this.startPoint,
      });
    }
    
    // Finish drawing for drag-based tools
    // Note: isDrawing is already false, so preview won't update during async operations
    if (this.currentTool !== TOOLS.POLYGON && this.currentTool !== TOOLS.SELECT) {
      this.finishDrawing(endPos);
    }
  }
  
  /**
   * Handle click event (for polygon tool)
   */
  onClick(_event) {
    if (this.currentTool !== TOOLS.POLYGON) return;
    // Polygon clicks are handled in onMouseDown
  }
  
  /**
   * Start drawing
   */
  startDrawing(startPos, _event) {
    if (window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] startDrawing CALLED ===', {
        tool: this.currentTool,
        startPos: startPos,
        isDrawing: this.isDrawing
      });
    }
    
    this.isDrawing = true;
    this.startPoint = startPos;
    this.currentPoint = startPos;
    
    if (this.currentTool === TOOLS.PAINTBRUSH) {
      this.paintbrushPath = [startPos];
    }
    
    // Create initial preview immediately when starting to draw
    // This ensures preview appears even if mouse doesn't move
    if (this.currentTool !== TOOLS.POLYGON && this.currentTool !== TOOLS.SELECT) {
      // Use a small offset to ensure preview geometry is valid
      const offsetPos = {
        x: startPos.x + 0.1,
        y: startPos.y + 0.1,
        z: startPos.z
      };
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneEditor] startDrawing: Calling updatePreview with offset', offsetPos);
      }
      this.updatePreview(offsetPos);
    }
  }
  
  /**
   * Update preview geometry while drawing
   */
  updatePreview(currentPos) {
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] updatePreview called', {
        hasStartPoint: !!this.startPoint,
        hasCurrentPos: !!currentPos,
        tool: this.currentTool,
        isDrawing: this.isDrawing,
        startPoint: this.startPoint,
        currentPos: currentPos
      });
    }
    
    if (!this.startPoint || !currentPos) {
      // If we don't have required data, remove preview if it exists
      if (window.DEBUG_ZONE_COORDS) {
        console.warn('[ZoneEditor] updatePreview: Missing required data', {
          hasStartPoint: !!this.startPoint,
          hasCurrentPos: !!currentPos
        });
      }
      if (this.previewMesh) {
        this.scene.remove(this.previewMesh);
        if (this.previewMesh.geometry) {
          this.previewMesh.geometry.dispose();
        }
        this.previewMesh = null;
      }
      return;
    }
    
    // Validate coordinates are reasonable (not wrapped to far side of ring)
    // If coordinates are way out of bounds, they're likely wrapped incorrectly
    const RING_CIRCUMFERENCE = 264000000;
    const MAX_REASONABLE_DISTANCE = RING_CIRCUMFERENCE / 2; // Half the ring
    
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x;
    
    // Check if coordinates are too far from camera (likely wrapped incorrectly)
    const startDist = Math.abs(this.startPoint.x - cameraX);
    const currentDist = Math.abs(currentPos.x - cameraX);
    
    // If distance is more than half the ring, wrap it back
    const wrapCoordinate = (x) => {
      const dist = x - cameraX;
      if (dist > MAX_REASONABLE_DISTANCE) {
        return x - RING_CIRCUMFERENCE;
      } else if (dist < -MAX_REASONABLE_DISTANCE) {
        return x + RING_CIRCUMFERENCE;
      }
      return x;
    };
    
    // Fix wrapped coordinates
    const fixedStartPoint = {
      ...this.startPoint,
      x: wrapCoordinate(this.startPoint.x)
    };
    const fixedCurrentPos = {
      ...currentPos,
      x: wrapCoordinate(currentPos.x)
    };
    
    if ((startDist > MAX_REASONABLE_DISTANCE || currentDist > MAX_REASONABLE_DISTANCE) && window.DEBUG_ZONE_PREVIEW) {
      console.error('=== [ZoneEditor] updatePreview: Coordinates wrapped incorrectly, fixing ===', {
        originalStart: this.startPoint,
        originalCurrent: currentPos,
        fixedStart: fixedStartPoint,
        fixedCurrent: fixedCurrentPos,
        cameraX: cameraX,
        startDist: startDist,
        currentDist: currentDist
      });
    }
    
    let geometry;
    
    try {
      switch (this.currentTool) {
        case TOOLS.RECTANGLE:
          geometry = this.createRectanglePreview(fixedStartPoint, fixedCurrentPos);
          if (window.DEBUG_ZONE_COORDS) {
            console.log('[ZoneEditor] createRectanglePreview returned', {
              geometry: geometry,
              hasGeometry: !!geometry,
              hasAttributes: geometry?.attributes,
              hasPosition: geometry?.attributes?.position
            });
          }
          break;
        case TOOLS.CIRCLE:
          geometry = this.createCirclePreview(this.startPoint, currentPos);
          break;
        case TOOLS.PAINTBRUSH:
          // Don't modify paintbrushPath here - it's managed in onMouseMove
          if (this.paintbrushPath.length > 0) {
            geometry = this.createPaintbrushPreview(this.paintbrushPath);
          }
          break;
        default:
          // Remove preview for unsupported tools
          if (this.previewMesh) {
            this.scene.remove(this.previewMesh);
            if (this.previewMesh.geometry) {
              this.previewMesh.geometry.dispose();
            }
            this.previewMesh = null;
          }
          return;
      }
      
      if (!geometry) {
        // Geometry creation failed - remove preview if it exists
        console.warn('[ZoneEditor] updatePreview: Geometry creation returned null/undefined', {
          tool: this.currentTool,
          startPoint: this.startPoint,
          currentPos: currentPos,
          paintbrushPathLength: this.paintbrushPath?.length || 0
        });
        if (this.previewMesh) {
          this.scene.remove(this.previewMesh);
          if (this.previewMesh.geometry) {
            this.previewMesh.geometry.dispose();
          }
          this.previewMesh = null;
        }
        return;
      }
      
      // Validate geometry before using it
      if (!geometry.attributes || !geometry.attributes.position) {
        console.warn('[ZoneEditor] updatePreview: Invalid geometry structure', {
          tool: this.currentTool,
          geometry: geometry,
          hasAttributes: !!geometry.attributes,
          hasPosition: !!geometry?.attributes?.position
        });
        return;
      }
      
      // Reuse existing mesh and material if possible for better performance
      if (this.previewMesh) {
        // Ensure mesh is in scene (might have been removed elsewhere)
        if (!this.previewMesh.parent) {
          if (window.DEBUG_ZONE_COORDS) {
            console.log('[ZoneEditor] Re-adding preview mesh to scene');
          }
          this.scene.add(this.previewMesh);
        }
        // Dispose old geometry
        if (this.previewMesh.geometry) {
          this.previewMesh.geometry.dispose();
        }
        // Update geometry only (keeps material and mesh)
        this.previewMesh.geometry = geometry;
        if (window.DEBUG_ZONE_COORDS) {
          console.log('[ZoneEditor] Updated existing preview mesh geometry');
        }
      } else {
        // Create new mesh on first preview
        // Use brighter colors and higher opacity for better visibility
        const previewColor = this.getToolColor();
        const material = new THREE.MeshBasicMaterial({
          color: previewColor,
          transparent: true,
          opacity: 0.7, // Increased from 0.5 for better visibility
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        });
        this.previewMesh = new THREE.Mesh(geometry, material);
        this.previewMesh.rotation.x = -Math.PI / 2;
        // Use the same floor height calculation as zone rendering
        // Position at origin - geometry coordinates are already in world space
        const floorHeight = this.currentFloor * DEFAULT_FLOOR_HEIGHT;
        this.previewMesh.position.set(0, floorHeight + 0.001, 0);
        this.previewMesh.renderOrder = 10; // Render above zones
        this.previewMesh.visible = true; // Ensure it's visible
        this.scene.add(this.previewMesh);
        if (window.DEBUG_ZONE_COORDS) {
          console.log('[ZoneEditor] Created new preview mesh', {
            position: this.previewMesh.position,
            visible: this.previewMesh.visible,
            inScene: !!this.previewMesh.parent,
            geometryVertices: geometry.attributes.position?.count || 0
          });
        }
      }
      
      // Always reset position to origin - geometry coordinates are already in world space
      // This ensures preview aligns with cursor (geometry is calculated from cursor position)
      const floorHeight = this.currentFloor * DEFAULT_FLOOR_HEIGHT;
      this.previewMesh.position.set(0, floorHeight + 0.001, 0);
      this.previewMesh.visible = true; // Ensure it stays visible
      
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneEditor] Preview mesh state', {
          exists: !!this.previewMesh,
          visible: this.previewMesh?.visible,
          inScene: !!this.previewMesh?.parent,
          position: this.previewMesh?.position,
          geometryVertices: this.previewMesh?.geometry?.attributes?.position?.count || 0
        });
      }
    } catch (error) {
      console.error('Error creating preview geometry:', error);
      // On error, remove preview to avoid showing stale/invalid geometry
      if (this.previewMesh) {
        this.scene.remove(this.previewMesh);
        if (this.previewMesh.geometry) {
          this.previewMesh.geometry.dispose();
        }
        this.previewMesh = null;
      }
    }
  }
  
  /**
   * Update paintbrush preview (shown even when not dragging)
   * Only shows when NOT actively drawing (isDrawing === false)
   */
  updatePaintbrushPreview(pos) {
    // Don't show paintbrush preview if we're actively drawing - let updatePreview handle it
    if (this.isDrawing) {
      return;
    }
    
    if (!pos) {
      // Remove preview if no position
      if (this.previewMesh) {
        this.scene.remove(this.previewMesh);
        if (this.previewMesh.geometry) {
          this.previewMesh.geometry.dispose();
        }
        this.previewMesh = null;
      }
      return;
    }
    
    try {
      const geometry = new THREE.CircleGeometry(this.paintbrushRadius, 32);
      const material = new THREE.MeshBasicMaterial({
        color: this.getToolColor(),
        transparent: true,
        opacity: 0.7, // Increased from 0.3 for better visibility
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      
      if (this.previewMesh) {
        // Reuse existing mesh
        if (!this.previewMesh.parent) {
          this.scene.add(this.previewMesh);
        }
        if (this.previewMesh.geometry) {
          this.previewMesh.geometry.dispose();
        }
        this.previewMesh.geometry = geometry;
        this.previewMesh.material = material;
      } else {
        // Create new mesh
        this.previewMesh = new THREE.Mesh(geometry, material);
        this.previewMesh.rotation.x = -Math.PI / 2;
        this.previewMesh.renderOrder = 10; // Render above zones
        this.scene.add(this.previewMesh);
      }
      
      // Convert EarthRing position to Three.js coordinates
      // CircleGeometry creates a circle centered at origin, so we position the mesh at the cursor position
      const threeJSPos = toThreeJS(pos, this.currentFloor);
      const floorHeight = this.currentFloor * DEFAULT_FLOOR_HEIGHT;
      this.previewMesh.position.set(threeJSPos.x, floorHeight + 0.001, threeJSPos.z);
    } catch (error) {
      console.error('Error creating paintbrush preview:', error);
      // On error, remove preview
      if (this.previewMesh) {
        this.scene.remove(this.previewMesh);
        if (this.previewMesh.geometry) {
          this.previewMesh.geometry.dispose();
        }
        this.previewMesh = null;
      }
    }
  }
  
  /**
   * Finish drawing and create zone
   */
  async finishDrawing(endPos) {
    if (!this.startPoint) return;
    
    // For paintbrush, ensure the end point is in the path
    if (this.currentTool === TOOLS.PAINTBRUSH && this.paintbrushPath.length > 0) {
      const lastPoint = this.paintbrushPath[this.paintbrushPath.length - 1];
      const dx = endPos.x - lastPoint.x;
      const dy = endPos.y - lastPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Add end point if it's different from the last point
      if (distance > 0.1) {
        this.paintbrushPath.push(endPos);
      }
      // If path only has start point, ensure we have end point for expansion
      if (this.paintbrushPath.length === 1) {
        this.paintbrushPath.push(endPos);
      }
    }
    
    // Remove preview immediately when starting to finish drawing
    // This prevents the preview from continuing to follow the mouse
    if (this.previewMesh) {
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneEditor] finishDrawing: Removing preview mesh', {
          inScene: !!this.previewMesh.parent,
          visible: this.previewMesh.visible
        });
      }
      this.scene.remove(this.previewMesh);
      if (this.previewMesh.geometry) {
        this.previewMesh.geometry.dispose();
      }
      if (this.previewMesh.material) {
        this.previewMesh.material.dispose();
      }
      this.previewMesh = null;
    }
    
    // Ensure isDrawing is false (should already be set in onMouseUp, but double-check)
    this.isDrawing = false;
    
    let geometry;
    
    switch (this.currentTool) {
      case TOOLS.RECTANGLE:
        geometry = this.createRectangleGeometry(this.startPoint, endPos);
        break;
      case TOOLS.CIRCLE:
        geometry = this.createCircleGeometry(this.startPoint, endPos);
        break;
      case TOOLS.PAINTBRUSH:
        geometry = this.createPaintbrushGeometry(this.paintbrushPath);
        break;
      default:
        console.warn('[ZoneEditor] Unknown tool or NONE:', this.currentTool);
        this.isDrawing = false;
        return;
    }
    
    if (!geometry) {
      this.isDrawing = false;
      return;
    }
    
    // Validate geometry before creating zone
    if (!geometry || !geometry.coordinates || geometry.coordinates.length === 0) {
      console.error('Invalid geometry created');
      alert('Failed to create zone: Invalid geometry');
      this.isDrawing = false;
      return;
    }
    
    // DEBUG: Log geometry before validation
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] finishDrawing - geometry before validation:', {
        type: geometry.type,
        coordinates: geometry.coordinates,
        startPoint: this.startPoint,
        endPos,
      });
    }
    
    // Validate coordinates are within valid range
    const RING_CIRCUMFERENCE = 264000000;
    const coords = geometry.coordinates[0];
    const invalidCoords = coords.some(([x, y]) => {
      return isNaN(x) || isNaN(y) || 
             x < 0 || x >= RING_CIRCUMFERENCE ||
             y < -2500 || y > 2500;
    });
    
    if (invalidCoords) {
      console.error('Invalid coordinates in geometry:', geometry);
      alert('Failed to create zone: Coordinates out of bounds');
      this.isDrawing = false;
      return;
    }
    
    // DEBUG: Log geometry being sent to API
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] finishDrawing - sending to API:', {
        geometry: JSON.parse(JSON.stringify(geometry)), // Deep clone to see actual values
        zoneType: this.currentZoneType,
        floor: this.currentFloor,
        startPoint: this.startPoint,
        endPos,
      });
    }
    
    // Create zone via API
    try {
      const currentUser = getCurrentUser();
      
      let response = await createZone({
        name: `${this.currentZoneType} Zone`,
        zone_type: this.currentZoneType,
        floor: this.currentFloor,
        geometry,
        properties: {
          created_by: 'zone-editor',
          tool: this.currentTool,
          owner_id: currentUser?.id,
        },
      });
      
      // Check if response indicates a conflict (HTTP 409)
      if (response && response.error === 'zone_conflict') {
        // Show prompt asking which zone should win
        const conflictResult = await this.promptConflictResolution(response.conflicts, response.new_zone_type);
        if (!conflictResult) {
          // User cancelled
          this.isDrawing = false;
          this.paintbrushPath = [];
          this.startPoint = null;
          return;
        }
        
        // Build request with per-zone resolutions if provided, otherwise use bulk resolution
        const createRequest = {
          name: `${this.currentZoneType} Zone`,
          zone_type: this.currentZoneType,
          floor: this.currentFloor,
          geometry,
          properties: {
            created_by: 'zone-editor',
            tool: this.currentTool,
            owner_id: currentUser?.id,
          },
        };
        
        // If per-zone resolutions are provided, convert Map to object
        if (conflictResult.perZone && conflictResult.perZone.size > 0) {
          const conflictResolutions = {};
          conflictResult.perZone.forEach((resolution, zoneId) => {
            conflictResolutions[zoneId] = resolution;
          });
          createRequest.conflict_resolutions = conflictResolutions;
        } else if (conflictResult.resolution) {
          // Use bulk resolution if no per-zone resolutions
          createRequest.conflict_resolution = conflictResult.resolution;
        }
        
        // Retry zone creation with conflict resolution
        response = await createZone(createRequest);
      }
      
      // Handle response: can be single zone or multiple zones (when bisected)
      const zones = response.zones ? response.zones : [response];
      
      // DEBUG: Log created zones
      if (window.DEBUG_ZONE_COORDS) {
        zones.forEach((zone, idx) => {
          const parsedGeometry = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;
          console.log(`[ZoneEditor] finishDrawing - zone ${idx + 1} created:`, {
            id: zone.id,
            geometry: parsedGeometry,
            firstCoordinate: parsedGeometry?.coordinates?.[0]?.[0],
            allCoordinates: parsedGeometry?.coordinates?.[0],
          });
        });
      }
      
      // For dezone zone type, the server subtracts from all overlapping zones
      if (this.currentZoneType === 'dezone') {
        // Server returns a list of updated zones (with holes cut out)
        // Dezone itself is not created - it's just used for subtraction
        if (response && response.updated_zones) {
          response.updated_zones.forEach(updatedZone => {
            this.gameStateManager.upsertZone(updatedZone);
            this.zoneManager.renderZone(updatedZone);
          });
        } else if (response && Array.isArray(response)) {
          // Handle case where server returns array directly
          response.forEach(updatedZone => {
            this.gameStateManager.upsertZone(updatedZone);
            this.zoneManager.renderZone(updatedZone);
          });
        }
        // Deselect any selected zone after dezone operation
        this.deselectZone();
      } else {
        // Normal zone creation - handle single or multiple zones (bisection)
        // Check for existing zones BEFORE upserting (to detect merges)
        const existingZoneIDs = new Set();
        if (zones.length === 1) {
          const existingZone = this.gameStateManager.getZone(zones[0].id);
          if (existingZone) {
            existingZoneIDs.add(zones[0].id);
          }
        }
        
        zones.forEach(zone => {
          this.gameStateManager.upsertZone(zone);
          this.zoneManager.renderZone(zone);
          
          // Notify callbacks
          this.onZoneCreatedCallbacks.forEach(cb => cb(zone));
        });
        
        // Handle updated zones (from conflict resolution)
        if (response.updated_zones && Array.isArray(response.updated_zones)) {
          response.updated_zones.forEach(updatedZone => {
            this.gameStateManager.upsertZone(updatedZone);
            this.zoneManager.renderZone(updatedZone);
            if (window.DEBUG_ZONE_COORDS) {
              console.log(`[ZoneEditor] Updated zone ${updatedZone.id} after conflict resolution`);
            }
          });
        }
        
        // If multiple zones were created (bisection), log it
        if (zones.length > 1) {
          if (window.DEBUG_ZONE_COORDS) {
            console.log(`[ZoneEditor] Zone was bisected into ${zones.length} parts`);
          }
        } else if (zones.length === 1) {
          // Single zone returned - might be a merge
          const zone = zones[0];
          
          // If this zone already existed, it was merged with other zones
          // The server handles deletion of merged zones, so we don't need to clean up here
          // The client will receive zone updates via WebSocket chunks
          if (existingZoneIDs.has(zone.id) && window.DEBUG_ZONE_COORDS) {
            console.log(`[ZoneEditor] Zone ${zone.id} was merged with other zones - server will handle deletions`);
          }
        }
      }
      
    } catch (error) {
      console.error('Failed to create zone:', error);
      alert(`Failed to create zone: ${error.message}`);
    }
    
    // Reset drawing state IMMEDIATELY to prevent further path accumulation
    // Reset these before any potential errors
    this.isDrawing = false;
    this.paintbrushPath = [];
    this.startPoint = null;
    this.currentPoint = null;
  }

  /**
   * Prompt user to resolve zone conflicts
   * @param {Array} conflicts - Array of conflicting zones
   * @param {string} newZoneType - Type of the new zone being created
   * @returns {Promise<Object|null>} {resolution: string, perZone: Map} or null if cancelled
   */
  async promptConflictResolution(conflicts, newZoneType) {
    const { showConflictResolutionModal } = await import('../ui/game-modal.js');
    const result = await showConflictResolutionModal({
      newZoneType,
      conflicts: conflicts.map(c => ({
        id: c.id,
        name: c.name,
        zone_type: c.zone_type,
        zoneType: c.zone_type // Support both formats
      }))
    });
    
    if (!result) {
      return null; // Cancelled
    }
    
    return result; // Return the full result object with resolution and/or perZone
  }
  
  /**
   * Handle polygon tool clicks
   */
  handlePolygonClick(pos) {
    this.polygonVertices.push(pos);
    
    // Update preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
    }
    
    if (this.polygonVertices.length >= 2) {
      const geometry = this.createPolygonPreview(this.polygonVertices);
      const material = new THREE.MeshBasicMaterial({
        color: this.getToolColor(),
        transparent: true,
        opacity: 0.7, // Increased from 0.5 for better visibility
        side: THREE.DoubleSide,
      });
      this.previewMesh = new THREE.Mesh(geometry, material);
      this.previewMesh.rotation.x = -Math.PI / 2;
      this.scene.add(this.previewMesh);
    }
  }
  
  /**
   * Finish polygon (double-click or right-click)
   */
  async finishPolygon() {
    if (this.polygonVertices.length < 3) {
      alert('Polygon needs at least 3 vertices');
      return;
    }
    
    // Remove preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }
    
    const geometry = this.createPolygonGeometry(this.polygonVertices);
    
    try {
      const currentUser = getCurrentUser();
      const response = await createZone({
        name: `${this.currentZoneType} Zone`,
        zone_type: this.currentZoneType,
        floor: this.currentFloor,
        geometry,
        properties: {
          created_by: 'zone-editor',
          tool: TOOLS.POLYGON,
          owner_id: currentUser?.id,
        },
      });
      
      // Handle response: can be single zone or multiple zones (when bisected)
      const zones = response.zones ? response.zones : [response];
      
      zones.forEach(zone => {
        this.gameStateManager.upsertZone(zone);
        this.zoneManager.renderZone(zone);
        this.onZoneCreatedCallbacks.forEach(cb => cb(zone));
      });
      
      // If multiple zones were created (bisection), log it
      if (zones.length > 1 && window.DEBUG_ZONE_COORDS) {
        console.log(`[ZoneEditor] Zone was bisected into ${zones.length} parts`);
      }
      
    } catch (error) {
      console.error('Failed to create polygon zone:', error);
      alert(`Failed to create zone: ${error.message}`);
    }
    
    // Reset polygon state
    this.polygonVertices = [];
  }
  
  /**
   * Handle zone selection
   */
  handleZoneSelection(event) {
    // Use the actual mouse event for raycasting
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Get all zone meshes from zone manager
    const zoneMeshes = Array.from(this.zoneManager.zoneMeshes.values());
    const intersects = this.raycaster.intersectObjects(zoneMeshes, true);
    
    if (intersects.length > 0) {
      const intersectedObject = intersects[0].object;
      // Find which zone this mesh belongs to
      const zone = this.zoneManager.getZoneFromMesh(intersectedObject);
      if (zone) {
        this.selectZone(zone);
      }
    } else {
      this.deselectZone();
    }
  }
  
  /**
   * Find zone ID from a mesh object
   */
  findZoneIDFromMesh(mesh) {
    let current = mesh;
    while (current) {
      if (current.userData && current.userData.zoneID) {
        return current.userData.zoneID;
      }
      current = current.parent;
    }
    return null;
  }
  
  /**
   * Select a zone
   */
  selectZone(zone) {
    this.selectedZone = zone;
    
    // Highlight selected zone
    const zoneMesh = this.zoneManager.zoneMeshes.get(zone.id);
    if (zoneMesh) {
      this.selectedZoneMesh = zoneMesh;
      // Add selection highlight (we'll implement this in zone-manager)
      this.zoneManager.highlightZone(zone.id, true);
    }
    
    // Notify callbacks
    this.onZoneSelectedCallbacks.forEach(cb => cb(zone));
  }
  
  /**
   * Deselect current zone
   */
  deselectZone() {
    if (this.selectedZone) {
      this.zoneManager.highlightZone(this.selectedZone.id, false);
    }
    this.selectedZone = null;
    this.selectedZoneMesh = null;
    
    // Trigger deselection callbacks
    this.onZoneDeselectedCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in zone deselection callback:', error);
      }
    });
  }
  
  /**
   * Delete selected zone
   */
  async deleteSelectedZone() {
    if (!this.selectedZone) return;
    
    const { showConfirmationModal } = await import('../ui/game-modal.js');
    const confirmed = await showConfirmationModal({
      title: 'Delete Zone',
      message: `Are you sure you want to delete zone "${this.selectedZone.name || this.selectedZone.id}"?`,
      checkboxLabel: 'I understand this zone will be permanently deleted',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      confirmColor: '#ff4444'
    });
    
    if (!confirmed) {
      return;
    }
    
    try {
      await deleteZone(this.selectedZone.id);
      this.gameStateManager.removeZone(this.selectedZone.id);
      this.zoneManager.removeZone(this.selectedZone.id);
      this.deselectZone();
    } catch (error) {
      console.error('Failed to delete zone:', error);
      alert(`Failed to delete zone: ${error.message}`);
    }
  }
  
  /**
   * Set current tool
   */
  setTool(tool) {
    // Cancel current drawing if switching tools
    if (this.isDrawing) {
      this.cancelDrawing();
    }
    
    // Finish polygon if switching away from polygon tool
    if (this.currentTool === TOOLS.POLYGON && this.polygonVertices.length >= 3) {
      this.finishPolygon().catch(err => {
        console.error('Error finishing polygon:', err);
      });
    }
    
    this.currentTool = tool;
    this.polygonVertices = [];
    
    // Clean up preview when switching tools (unless switching to paintbrush which has its own preview)
    if (tool !== TOOLS.PAINTBRUSH && this.previewMesh) {
      this.scene.remove(this.previewMesh);
      if (this.previewMesh.geometry) {
        this.previewMesh.geometry.dispose();
      }
      if (this.previewMesh.material) {
        this.previewMesh.material.dispose();
      }
      this.previewMesh = null;
    }
    
    // Disable OrbitControls when a drawing tool is active
    if (this.cameraController && this.cameraController.controls) {
      if (tool !== TOOLS.NONE && tool !== TOOLS.SELECT) {
        this.cameraController.controls.enabled = false;
      } else {
        this.cameraController.controls.enabled = true;
      }
    }
    
    // Notify callbacks
    this.onToolChangeCallbacks.forEach(cb => cb(tool));
  }
  
  /**
   * Cancel current drawing
   */
  cancelDrawing() {
    if (this.previewMesh) {
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneEditor] cancelDrawing: Removing preview mesh', {
          inScene: !!this.previewMesh.parent,
          visible: this.previewMesh.visible
        });
      }
      this.scene.remove(this.previewMesh);
      if (this.previewMesh.geometry) {
        this.previewMesh.geometry.dispose();
      }
      if (this.previewMesh.material) {
        this.previewMesh.material.dispose();
      }
      this.previewMesh = null;
    }
    this.isDrawing = false;
    this.startPoint = null;
    this.currentPoint = null;
    this.paintbrushPath = [];
    this.polygonVertices = [];
  }
  
  /**
   * Set current floor
   */
  setFloor(floor) {
    if (this.currentFloor === floor) {
      return; // No change needed
    }
    this.currentFloor = floor;
    // Update raycast plane position to match zone rendering
    // Zones are rendered at floor * DEFAULT_FLOOR_HEIGHT
    if (this.raycastPlane) {
      this.raycastPlane.position.y = floor * DEFAULT_FLOOR_HEIGHT;
    }
  }
  
  /**
   * @deprecated Floor is now managed by gameState.activeFloor, not camera position
   * This method is kept for backwards compatibility but does nothing
   */
  updateFloorFromCamera() {
    // Floor is now managed by gameState.activeFloor, not camera position
    // This method is kept for backwards compatibility but does nothing
  }
  
  /**
   * Set current zone type
   */
  setZoneType(zoneType) {
    this.currentZoneType = zoneType;
  }
  
  /**
   * Set paintbrush radius
   */
  setPaintbrushRadius(radius) {
    this.paintbrushRadius = Math.max(10, Math.min(500, radius)); // Clamp between 10-500m
  }
  
  /**
   * Get color for current tool/zone type
   */
  getToolColor() {
    // Brighter, more saturated colors for better preview visibility
    const colors = {
      residential: 0x7fefb1, // Brighter green
      commercial: 0x66e4ff, // Brighter blue
      industrial: 0xffe966, // Brighter yellow
      'mixed-use': 0xffe666, // Brighter yellow-orange
      mixed_use: 0xffe666, // Brighter yellow-orange
      park: 0x37ce70, // Brighter green
      restricted: 0xff6b5c, // Brighter red
      dezone: 0x8b4513, // Brown for dezone
    };
    return colors[this.currentZoneType] || 0xffffff;
  }
  
  // Geometry creation methods
  
  createRectanglePreview(start, end) {
    // Create the preview by first generating the exact geometry that will be stored
    // then rendering it exactly as zone-manager.js does
    // This ensures 100% match between preview and actual zone
    
    // Step 1: Generate the exact stored geometry (same as createRectangleGeometry)
    let minX = Math.min(start.x, end.x);
    let maxX = Math.max(start.x, end.x);
    let minY = Math.min(start.y, end.y);
    let maxY = Math.max(start.y, end.y);
    
    // Ensure we have a valid rectangle (minimum size)
    // If start and end are the same or very close, create a small rectangle
    const MIN_SIZE = 1; // 1 meter minimum
    if (Math.abs(maxX - minX) < MIN_SIZE) {
      const centerX = (minX + maxX) / 2;
      minX = centerX - MIN_SIZE / 2;
      maxX = centerX + MIN_SIZE / 2;
    }
    if (Math.abs(maxY - minY) < MIN_SIZE) {
      const centerY = (minY + maxY) / 2;
      minY = centerY - MIN_SIZE / 2;
      maxY = centerY + MIN_SIZE / 2;
    }
    
    // DEBUG: Log preview input coordinates
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectanglePreview input:', {
        start: { ...start },
        end: { ...end },
        minX, maxX, minY, maxY,
      });
    }
    
    // Convert to absolute coordinates (EXACT same conversion as final geometry)
    const originalMinX = minX;
    const originalMaxX = maxX;
    minX = this.convertRelativeToAbsoluteX(minX);
    maxX = this.convertRelativeToAbsoluteX(maxX);
    
    // DEBUG: Log after conversion
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectanglePreview after conversion:', {
        originalMinX,
        originalMaxX,
        convertedMinX: minX,
        convertedMaxX: maxX,
      });
    }
    
    // Ensure minX < maxX (same as createRectangleGeometry)
    if (minX >= maxX) {
      [minX, maxX] = [Math.min(minX, maxX), Math.max(minX, maxX)];
      if (minX >= maxX) {
        const RING_CIRCUMFERENCE = 264000000;
        minX = Math.max(0, minX - 1000);
        maxX = Math.min(RING_CIRCUMFERENCE, maxX + 1000);
      }
    }
    
    // Step 2: Now render this exact geometry exactly as zone-manager.js does
    // Wrap absolute coordinates relative to camera (same as renderZone)
    // Use unwrapped camera position for normalizeRelativeToCamera - it handles wrapping internally
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x; // Use unwrapped camera position
    
    // DEBUG: Log camera and wrapping info
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectanglePreview wrapping:', {
        cameraPos: { ...cameraPos },
        cameraX,
        absMinX: minX,
        absMaxX: maxX,
      });
    }
    
    // Use the EXACT same wrapping function as zone-manager.js
    const wrapZoneX = (x) => {
      const wrapped = normalizeRelativeToCamera(x, cameraX);
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneEditor] Preview wrapZoneX:', {
          absoluteX: x,
          cameraX,
          wrapped,
        });
      }
      return wrapped;
    };
    
    // Step 3: Create shape using the EXACT same coordinates that will be rendered
    // Check if ANY Y coordinate is negative (same logic as zone-manager.js)
    const corners = [
      [minX, minY],  // These are the absolute coordinates that will be stored
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    const hasNegativeY = corners.some(([_x, y]) => y < 0);
    const shape = new THREE.Shape();
    
    // Build shape EXACTLY as zone-manager.js does (identical code)
    let firstPos = null;
    corners.forEach(([x, y], idx) => {
      const wrappedX = wrapZoneX(x);  // Wrap absolute coordinate relative to camera
      const worldPos = toThreeJS({ x: wrappedX, y: y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Use worldPos.x for shape X
      // For shape Y, use worldPos.z (EarthRing Y)
      // The outline uses worldPos.z directly and shows correctly on Y+,
      // but the fill (ShapeGeometry) needs to be negated to face the correct direction after rotation
      // Based on testing: always negate worldPos.z for the fill shape
      const shapeY = -worldPos.z;
      if (idx === 0) {
        firstPos = { x: worldPos.x, z: shapeY };
        shape.moveTo(worldPos.x, shapeY);
      } else {
        shape.lineTo(worldPos.x, shapeY);
      }
    });
    
    // Explicitly close the shape
    if (firstPos) {
      shape.lineTo(firstPos.x, firstPos.z);
    }
    
    // DEBUG: Log final preview shape info
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectanglePreview final:', {
        storedMinX: minX,
        storedMaxX: maxX,
        storedMinY: minY,
        storedMaxY: maxY,
        firstShapePos: firstPos,
        hasNegativeY,
      });
    }
    
    // Create geometry from shape (same as zone rendering)
    const geometry = new THREE.ShapeGeometry(shape);
    
    return geometry;
  }
  
  /**
   * Convert camera-relative X coordinate to absolute coordinate [0, RING_CIRCUMFERENCE)
   * Coordinates from getEarthRingPositionFromMouse are normalized relative to camera.
   * This function converts them to absolute coordinates for the API.
   * @param {number} x - X coordinate relative to camera
   * @returns {number} - Absolute X coordinate [0, RING_CIRCUMFERENCE)
   */
  convertRelativeToAbsoluteX(x) {
    // Convert a coordinate that's normalized relative to the camera to an absolute coordinate [0, RING_CIRCUMFERENCE)
    // This is used when creating final geometry for the API
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x;
    
    // Use the centralized helper function
    const absoluteX = denormalizeFromCamera(x, cameraX);
    
    // No logging here - this function is called frequently during preview updates
    // Logging happens in finishDrawing/createRectangleGeometry instead
    
    return absoluteX;
  }

  createRectangleGeometry(start, end) {
    // DEBUG: Log geometry creation
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectangleGeometry CALLED - START', {
        start: { ...start },
        end: { ...end },
      });
    }
    
    // Coordinates from getEarthRingPositionFromMouse are normalized relative to camera
    // Convert them to absolute coordinates [0, RING_CIRCUMFERENCE) for the API
    let minX = Math.min(start.x, end.x);
    let maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectangleGeometry input:', {
        start: { ...start },
        end: { ...end },
        minX, maxX, minY, maxY,
        rawMinX: minX,
        rawMaxX: maxX,
      });
    }
    
    // Convert relative coordinates to absolute using helper function
    const originalMinX = minX;
    const originalMaxX = maxX;
    minX = this.convertRelativeToAbsoluteX(minX);
    
    // DEBUG: Log after first conversion
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectangleGeometry after minX conversion:', {
        originalMinX,
        convertedMinX: minX,
      });
    }
    
    maxX = this.convertRelativeToAbsoluteX(maxX);
    
    // DEBUG: Log after both conversions
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectangleGeometry after both conversions:', {
        originalMinX,
        originalMaxX,
        convertedMinX: minX,
        convertedMaxX: maxX,
      });
    }
    
    // Ensure minX < maxX (handle wrap-around case)
    // If coordinates wrapped such that minX > maxX, the rectangle spans the wrap boundary
    // In this case, we need to ensure the coordinates are valid
    if (minX >= maxX) {
      // This shouldn't happen with proper conversion, but handle it as a safety check
      // Swap if needed (though this indicates a bug in conversion)
      [minX, maxX] = [Math.min(minX, maxX), Math.max(minX, maxX)];
      // If still invalid, clamp to valid range
      if (minX >= maxX) {
        const RING_CIRCUMFERENCE = 264000000;
        minX = Math.max(0, minX - 1000); // Small buffer
        maxX = Math.min(RING_CIRCUMFERENCE, maxX + 1000);
      }
    }
    
    const geometry = {
      type: 'Polygon',
      coordinates: [[
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ]],
    };
    
    // DEBUG: Log final geometry
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createRectangleGeometry final:', {
        minX, maxX, minY, maxY,
        coordinates: geometry.coordinates[0],
      });
    }
    
    return geometry;
  }
  
  createCirclePreview(center, edge) {
    // Create the preview by first generating the exact geometry that will be stored
    // then rendering it exactly as zone-manager.js does
    // This ensures 100% match between preview and actual zone
    
    // Step 1: Generate the exact stored geometry (same as createCircleGeometry)
    const radius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const segments = 64;
    
    // Convert center to absolute coordinates first (same as final geometry)
    const absCenterX = this.convertRelativeToAbsoluteX(center.x);
    const absCenterY = center.y; // Y doesn't need conversion
    
    // Generate points around the circle using absolute center
    // This matches the exact coordinates that will be stored
    const absoluteCoords = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = absCenterX + radius * Math.cos(angle);
      const y = absCenterY + radius * Math.sin(angle);
      absoluteCoords.push([x, y]);
    }
    // Close the circle
    if (absoluteCoords.length > 0) {
      absoluteCoords.push([absoluteCoords[0][0], absoluteCoords[0][1]]);
    }
    
    // Step 2: Now render this exact geometry exactly as zone-manager.js does
    // Wrap absolute coordinates relative to camera (same as renderZone)
    // Use unwrapped camera position for normalizeRelativeToCamera - it handles wrapping internally
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x; // Use unwrapped camera position
    
    // Use the EXACT same wrapping function as zone-manager.js
    const wrapZoneX = (x) => {
      return normalizeRelativeToCamera(x, cameraX);
    };
    
    // Step 3: Create shape using the EXACT same coordinates that will be rendered
    const shape = new THREE.Shape();
    
    // Build shape EXACTLY as zone-manager.js does (identical code)
    let firstPos = null;
    absoluteCoords.forEach(([x, y], idx) => {
      const wrappedX = wrapZoneX(x);  // Wrap absolute coordinate relative to camera
      const worldPos = toThreeJS({ x: wrappedX, y: y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Use worldPos.x for shape X
      // For shape Y, use worldPos.z (EarthRing Y)
      // The outline uses worldPos.z directly and shows correctly on Y+,
      // but the fill (ShapeGeometry) needs to be negated to face the correct direction after rotation
      // Based on testing: always negate worldPos.z for the fill shape
      const shapeY = -worldPos.z;
      if (idx === 0) {
        firstPos = { x: worldPos.x, z: shapeY };
        shape.moveTo(worldPos.x, shapeY);
      } else {
        shape.lineTo(worldPos.x, shapeY);
      }
    });
    
    // Explicitly close the shape
    if (firstPos) {
      shape.lineTo(firstPos.x, firstPos.z);
    }
    
    // Create geometry from shape (same as zone rendering)
    const geometry = new THREE.ShapeGeometry(shape);
    
    return geometry;
  }
  
  createCircleGeometry(center, edge) {
    const radius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const segments = 64;
    const coordinates = [];
    
    // Convert center to absolute coordinates first
    const absCenterX = this.convertRelativeToAbsoluteX(center.x);
    const absCenterY = center.y; // Y doesn't need conversion
    
    const RING_CIRCUMFERENCE = 264000000;
    
    // Generate points around the circle using absolute center
    const rawCoords = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = absCenterX + radius * Math.cos(angle);
      const y = absCenterY + radius * Math.sin(angle);
      rawCoords.push({ x, y });
    }
    
    // Check if circle crosses the ring boundary (would cause wrapping)
    // A circle crosses the boundary if any point would wrap to a very different X value
    const wrappedCoords = rawCoords.map(p => wrapRingPosition(p.x));
    const minWrappedX = Math.min(...wrappedCoords);
    const maxWrappedX = Math.max(...wrappedCoords);
    const wrappedSpan = maxWrappedX - minWrappedX;
    
    // DEBUG: Log circle geometry creation
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] createCircleGeometry:', {
        center: { x: absCenterX, y: absCenterY },
        radius,
        minWrappedX,
        maxWrappedX,
        wrappedSpan,
        crossesBoundary: wrappedSpan > RING_CIRCUMFERENCE / 2,
      });
    }
    
    // If wrapped span is > half the ring, the circle crosses the boundary
    // In this case, we need to keep coordinates in one contiguous range
    if (wrappedSpan > RING_CIRCUMFERENCE / 2) {
      // Circle crosses boundary - shift coordinates to keep them contiguous
      // Find where the center wraps to - this is where we want the center to be
      const centerWrapped = wrapRingPosition(absCenterX);
      
      // Find the minimum raw X value
      const minRawX = Math.min(...rawCoords.map(p => p.x));
      const maxRawX = Math.max(...rawCoords.map(p => p.x));
      
      // Calculate shift to keep center at centerWrapped while making coordinates contiguous
      // If center is at X=0 (wraps to 0) and minRawX=-45, we want:
      // - Shift coordinates so they're contiguous (shift by -minRawX = +45)
      // - But this moves center from 0 to 45
      // - So we need to shift back by (centerWrapped - newCenterAfterShift)
      const baseShift = -minRawX; // Makes minimum become 0, center moves to radius
      const newCenterAfterBaseShift = absCenterX + baseShift;
      const newCenterAfterBaseShiftWrapped = wrapRingPosition(newCenterAfterBaseShift);
      
      // Calculate additional shift to move center back to centerWrapped
      let additionalShift = 0;
      if (newCenterAfterBaseShiftWrapped !== centerWrapped) {
        // Calculate the difference, accounting for wrapping
        const diff = centerWrapped - newCenterAfterBaseShiftWrapped;
        // If difference is > half ring, go the other way
        additionalShift = Math.abs(diff) > RING_CIRCUMFERENCE / 2 
          ? (diff > 0 ? diff - RING_CIRCUMFERENCE : diff + RING_CIRCUMFERENCE)
          : diff;
      }
      
      const totalShift = baseShift + additionalShift;
      
      rawCoords.forEach(p => {
        const shiftedX = p.x + totalShift;
        const wrappedX = wrapRingPosition(shiftedX);
        coordinates.push([wrappedX, p.y]);
      });
      
      if (window.DEBUG_ZONE_COORDS) {
        const finalMinX = Math.min(...coordinates.map(c => c[0]));
        const finalMaxX = Math.max(...coordinates.map(c => c[0]));
        const finalSpan = finalMaxX - finalMinX;
        const finalCenterX = (finalMinX + finalMaxX) / 2;
        console.log('[ZoneEditor] Circle crosses boundary - shifted coordinates:', {
          centerX: absCenterX,
          centerWrapped,
          minRawX,
          maxRawX,
          baseShift,
          newCenterAfterBaseShiftWrapped,
          additionalShift,
          totalShift,
          finalMinX,
          finalMaxX,
          finalCenterX,
          finalSpan,
          expectedSpan: radius * 2,
        });
      }
    } else {
      // Circle doesn't cross boundary - wrap normally
      rawCoords.forEach(p => {
        const wrappedX = wrapRingPosition(p.x);
        coordinates.push([wrappedX, p.y]);
      });
    }
    
    // Explicitly close the ring by adding the first point again
    if (coordinates.length > 0) {
      coordinates.push([coordinates[0][0], coordinates[0][1]]);
    }
    
    // DEBUG: Log final geometry
    if (window.DEBUG_ZONE_COORDS) {
      const finalMinX = Math.min(...coordinates.map(c => c[0]));
      const finalMaxX = Math.max(...coordinates.map(c => c[0]));
      const finalSpan = finalMaxX - finalMinX;
      console.log('[ZoneEditor] Final circle geometry:', {
        pointCount: coordinates.length,
        minX: finalMinX,
        maxX: finalMaxX,
        span: finalSpan,
        expectedSpan: radius * 2,
      });
    }
    
    return {
      type: 'Polygon',
      coordinates: [coordinates],
    };
  }
  
  createPolygonPreview(vertices) {
    if (vertices.length < 2) return null;
    
    // Create the preview by first generating the exact geometry that will be stored
    // then rendering it exactly as zone-manager.js does
    // This ensures 100% match between preview and actual zone
    
    // Step 1: Generate the exact stored geometry (same as createPolygonGeometry)
    // Convert vertices to absolute coordinates (same as final geometry)
    const absoluteCoords = vertices.map(v => {
      // Convert relative coordinate to absolute (same as createPolygonGeometry)
      const absX = this.convertRelativeToAbsoluteX(v.x);
      // Don't wrap here - we'll wrap during rendering to match zone-manager.js
      return [absX, v.y];
    });
    
    // Close polygon if not already closed
    if (absoluteCoords.length > 0 && 
        (absoluteCoords[0][0] !== absoluteCoords[absoluteCoords.length - 1][0] ||
         absoluteCoords[0][1] !== absoluteCoords[absoluteCoords.length - 1][1])) {
      absoluteCoords.push([absoluteCoords[0][0], absoluteCoords[0][1]]);
    }
    
    // Step 2: Now render this exact geometry exactly as zone-manager.js does
    // Wrap absolute coordinates relative to camera (same as renderZone)
    // Use unwrapped camera position for normalizeRelativeToCamera - it handles wrapping internally
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x; // Use unwrapped camera position
    
    // Use the EXACT same wrapping function as zone-manager.js
    const wrapZoneX = (x) => {
      return normalizeRelativeToCamera(x, cameraX);
    };
    
    // Step 3: Create shape using the EXACT same coordinates that will be rendered
    const shape = new THREE.Shape();
    
    // Build shape EXACTLY as zone-manager.js does (identical code)
    let firstPos = null;
    absoluteCoords.forEach(([x, y], idx) => {
      const wrappedX = wrapZoneX(x);  // Wrap absolute coordinate relative to camera
      const worldPos = toThreeJS({ x: wrappedX, y: y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Use worldPos.x for shape X
      // For shape Y, use worldPos.z (EarthRing Y)
      // The outline uses worldPos.z directly and shows correctly on Y+,
      // but the fill (ShapeGeometry) needs to be negated to face the correct direction after rotation
      // Based on testing: always negate worldPos.z for the fill shape
      const shapeY = -worldPos.z;
      if (idx === 0) {
        firstPos = { x: worldPos.x, z: shapeY };
        shape.moveTo(worldPos.x, shapeY);
      } else {
        shape.lineTo(worldPos.x, shapeY);
      }
    });
    
    // Explicitly close the shape
    if (firstPos) {
      shape.lineTo(firstPos.x, firstPos.z);
    }
    
    // Create geometry from shape (same as zone rendering)
    const geometry = new THREE.ShapeGeometry(shape);
    
    return geometry;
  }
  
  createPolygonGeometry(vertices) {
    const coordinates = vertices.map(v => {
      // Convert relative coordinate to absolute, then wrap
      const absX = this.convertRelativeToAbsoluteX(v.x);
      const wrappedX = wrapRingPosition(absX);
      return [wrappedX, v.y];
    });
    // Close polygon
    if (coordinates.length > 0 && 
        (coordinates[0][0] !== coordinates[coordinates.length - 1][0] ||
         coordinates[0][1] !== coordinates[coordinates.length - 1][1])) {
      coordinates.push([coordinates[0][0], coordinates[0][1]]);
    }
    
    return {
      type: 'Polygon',
      coordinates: [coordinates],
    };
  }
  
  createPaintbrushPreview(path) {
    // Handle single point case (same as createPaintbrushGeometry)
    if (path.length < 2) {
      // Single point - create a circle (use circle preview logic)
      return this.createCirclePreview(path[0], {
        x: path[0].x + this.paintbrushRadius,
        y: path[0].y,
        z: path[0].z,
      });
    }
    
    // Create the preview by first generating the exact geometry that will be stored
    // then rendering it exactly as zone-manager.js does
    // This ensures 100% match between preview and actual zone
    
    // Step 1: Generate the exact stored geometry (same as createPaintbrushGeometry via expandPathCoords)
    // Expand path by paintbrush radius to generate absolute coordinates (before wrapping)
    const absoluteCoords = [];
    
    // Forward path
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      const perpX = -dy / length;
      const perpY = dx / length;
      
      // Convert relative coordinates to absolute (same as expandPathCoords)
      const absP1X = this.convertRelativeToAbsoluteX(p1.x);
      const x = absP1X + perpX * this.paintbrushRadius;
      const y = p1.y + perpY * this.paintbrushRadius;
      // Don't wrap here - we'll wrap during rendering to match zone-manager.js
      absoluteCoords.push([x, y]);
    }
    
    // Last point
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0) {
      const perpX = -dy / length;
      const perpY = dx / length;
      // Convert relative coordinate to absolute
      const absLastX = this.convertRelativeToAbsoluteX(last.x);
      const x = absLastX + perpX * this.paintbrushRadius;
      const y = last.y + perpY * this.paintbrushRadius;
      // Don't wrap here
      absoluteCoords.push([x, y]);
    }
    
    // Return path (other side)
    for (let i = path.length - 1; i > 0; i--) {
      const p1 = path[i];
      const p2 = path[i - 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      const perpX = dy / length;
      const perpY = -dx / length;
      
      // Convert relative coordinate to absolute
      const absP1X = this.convertRelativeToAbsoluteX(p1.x);
      const x = absP1X + perpX * this.paintbrushRadius;
      const y = p1.y + perpY * this.paintbrushRadius;
      // Don't wrap here
      absoluteCoords.push([x, y]);
    }
    
    // Close polygon
    if (absoluteCoords.length > 0) {
      absoluteCoords.push([absoluteCoords[0][0], absoluteCoords[0][1]]);
    }
    
    // Step 2: Now render this exact geometry exactly as zone-manager.js does
    // Wrap absolute coordinates relative to camera (same as renderZone)
    // Use unwrapped camera position for normalizeRelativeToCamera - it handles wrapping internally
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x; // Use unwrapped camera position
    
    // Use the EXACT same wrapping function as zone-manager.js
    const wrapZoneX = (x) => {
      return normalizeRelativeToCamera(x, cameraX);
    };
    
    // Step 3: Create shape using the EXACT same coordinates that will be rendered
    const shape = new THREE.Shape();
    
    // Build shape EXACTLY as zone-manager.js does (identical code)
    let firstPos = null;
    absoluteCoords.forEach(([x, y], idx) => {
      const wrappedX = wrapZoneX(x);  // Wrap absolute coordinate relative to camera
      const worldPos = toThreeJS({ x: wrappedX, y: y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Use worldPos.x for shape X
      // For shape Y, use worldPos.z (EarthRing Y)
      // The outline uses worldPos.z directly and shows correctly on Y+,
      // but the fill (ShapeGeometry) needs to be negated to face the correct direction after rotation
      // Based on testing: always negate worldPos.z for the fill shape
      const shapeY = -worldPos.z;
      if (idx === 0) {
        firstPos = { x: worldPos.x, z: shapeY };
        shape.moveTo(worldPos.x, shapeY);
      } else {
        shape.lineTo(worldPos.x, shapeY);
      }
    });
    
    // Explicitly close the shape
    if (firstPos) {
      shape.lineTo(firstPos.x, firstPos.z);
    }
    
    // Create geometry from shape (same as zone rendering)
    const geometry = new THREE.ShapeGeometry(shape);
    
    return geometry;
  }
  
  createPaintbrushGeometry(path) {
    if (path.length < 2) {
      // Single point - create a circle
      return this.createCircleGeometry(path[0], {
        x: path[0].x + this.paintbrushRadius,
        y: path[0].y,
        z: path[0].z,
      });
    }
    
    // Expand path by paintbrush radius and create polygon
    const expandedCoords = this.expandPathCoords(path, this.paintbrushRadius);
    
    return {
      type: 'Polygon',
      coordinates: [expandedCoords],
    };
  }
  
  /**
   * Expand a path by a radius (for paintbrush tool)
   */
  expandPath(path, radius) {
    if (path.length < 2) return null;
    
    const expandedPoints = [];
    
    // Expand each segment
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      // Perpendicular vector
      const perpX = -dy / length;
      const perpY = dx / length;
      
      // Add expanded points
      const p1Three = toThreeJS(p1, this.currentFloor);
      
      expandedPoints.push({
        x: p1Three.x + perpX * radius,
        z: p1Three.z + perpY * radius,
      });
    }
    
    // Add last point
    const last = path[path.length - 1];
    const lastThree = toThreeJS(last, this.currentFloor);
    const prev = path[path.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0) {
      const perpX = -dy / length;
      const perpY = dx / length;
      expandedPoints.push({
        x: lastThree.x + perpX * radius,
        z: lastThree.z + perpY * radius,
      });
    }
    
    // Create return path (other side)
    const returnPoints = [];
    for (let i = path.length - 1; i > 0; i--) {
      const p1 = path[i];
      const p2 = path[i - 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      const perpX = dy / length;
      const perpY = -dx / length;
      
      const p1Three = toThreeJS(p1, this.currentFloor);
      returnPoints.push({
        x: p1Three.x + perpX * radius,
        z: p1Three.z + perpY * radius,
      });
    }
    
    // Combine paths
    const allPoints = expandedPoints.concat(returnPoints.reverse());
    if (allPoints.length < 3) return null;
    
    const shape = new THREE.Shape();
    shape.moveTo(allPoints[0].x, allPoints[0].z);
    for (let i = 1; i < allPoints.length; i++) {
      shape.lineTo(allPoints[i].x, allPoints[i].z);
    }
    shape.lineTo(allPoints[0].x, allPoints[0].z); // Close
    
    return shape;
  }
  
  expandPathCoords(path, radius) {
    if (path.length < 2) {
      // Single point - return circle
      const center = path[0];
      const segments = 32;
      const coords = [];
      // Convert center to absolute first
      const absCenterX = this.convertRelativeToAbsoluteX(center.x);
      const absCenterY = center.y;
      
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = absCenterX + radius * Math.cos(angle);
        const y = absCenterY + radius * Math.sin(angle);
        // Wrap X coordinate to valid range [0, 264000000)
        const wrappedX = wrapRingPosition(x);
        coords.push([wrappedX, y]);
      }
      return coords;
    }
    
    // For 2-point paths, check if points are very close (then treat as single point/circle)
    // If they're far apart, create a stroke
    if (path.length === 2) {
      const p1 = path[0];
      const p2 = path[1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Only treat as circle if points are very close together (< 0.5 * radius)
      // Otherwise, create a stroke (continue to main expansion logic)
      if (distance < radius * 0.3) {
        // Points are very close - treat as single point (circle)
        const centerX = (this.convertRelativeToAbsoluteX(p1.x) + this.convertRelativeToAbsoluteX(p2.x)) / 2;
        const centerY = (p1.y + p2.y) / 2;
        const segments = 32;
        const coords = [];
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          const wrappedX = wrapRingPosition(x);
          coords.push([wrappedX, y]);
        }
        return coords;
      }
      // Points are far apart - continue to create a stroke
    }
    
    // Check if path forms a closed loop (first and last points are close)
    const first = path[0];
    const last = path[path.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distToClose = Math.sqrt(dx * dx + dy * dy);
    // For closed loops, be more lenient - consider closed if within 3x brush radius
    // This helps catch circles where start and end might not be exactly at the same spot
    const isClosed = path.length > 2 && distToClose < radius * 3;
    
    // Expand path to create a thick stroke polygon
    // We'll create points on both sides of the path and connect them
    const leftSide = [];  // One side of the stroke
    const rightSide = []; // Other side of the stroke
    
    // For closed loops, calculate first point's perpendicular direction first
    // and reuse it for the last point to ensure smooth connection
    let firstPerpX = null;
    let firstPerpY = null;
    
    // Build both sides of the stroke
    for (let i = 0; i < path.length; i++) {
      let perpX, perpY;
      
      if (i === 0) {
        // First point: use direction to next point, or to last point if closed
        const p1 = path[i];
        if (isClosed && path.length > 2) {
          // For closed loops, calculate direction that considers wrapping around
          // Use direction from last point through first point to second point
          const prev = path[path.length - 1]; // Last point (wraps around)
          const next = path[i + 1]; // Second point
          const dx1 = next.x - p1.x;
          const dy1 = next.y - p1.y;
          const dx2 = p1.x - prev.x; // From last to first
          const dy2 = p1.y - prev.y;
          const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
          const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
          if (len1 > 0 && len2 > 0) {
            // Average the perpendiculars from both directions
            const perpX1 = -dy1 / len1;
            const perpY1 = dx1 / len1;
            const perpX2 = -dy2 / len2;
            const perpY2 = dx2 / len2;
            const avgLen = Math.sqrt((perpX1 + perpX2) ** 2 + (perpY1 + perpY2) ** 2);
            if (avgLen > 0) {
              perpX = (perpX1 + perpX2) / avgLen;
              perpY = (perpY1 + perpY2) / avgLen;
            } else {
              perpX = perpX1;
              perpY = perpY1;
            }
          } else if (len1 > 0) {
            perpX = -dy1 / len1;
            perpY = dx1 / len1;
          } else {
            continue;
          }
          // Store for reuse at last point
          firstPerpX = perpX;
          firstPerpY = perpY;
        } else {
          const p2 = path[i + 1];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length === 0) continue;
          perpX = -dy / length;
          perpY = dx / length;
        }
      } else if (i === path.length - 1) {
        // Last point: use direction from previous point, or to first point if closed
        if (isClosed && path.length > 2 && firstPerpX !== null && firstPerpY !== null) {
          // For closed loops, reuse the first point's perpendicular direction
          // This ensures smooth connection between first and last points
          perpX = firstPerpX;
          perpY = firstPerpY;
        } else {
          // For non-closed paths, use direction from previous point
          const p1 = path[i - 1];
          const p2 = path[i];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length > 0) {
            perpX = -dy / length;
            perpY = dx / length;
          } else {
            continue;
          }
        }
      } else {
        // Middle point: average direction from previous and next
        const prev = path[i - 1];
        const curr = path[i];
        const next = path[i + 1];
        const dx1 = curr.x - prev.x;
        const dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (len1 === 0 || len2 === 0) continue;
        // Average the perpendicular vectors
        const perpX1 = -dy1 / len1;
        const perpY1 = dx1 / len1;
        const perpX2 = -dy2 / len2;
        const perpY2 = dx2 / len2;
        const avgLen = Math.sqrt((perpX1 + perpX2) ** 2 + (perpY1 + perpY2) ** 2);
        if (avgLen === 0) continue;
        perpX = (perpX1 + perpX2) / avgLen;
        perpY = (perpY1 + perpY2) / avgLen;
      }
      
      // Convert point to absolute coordinates
      const absX = this.convertRelativeToAbsoluteX(path[i].x);
      const absY = path[i].y;
      
      // Create points on both sides
      const leftX = absX + perpX * radius;
      const leftY = absY + perpY * radius;
      const rightX = absX - perpX * radius;
      const rightY = absY - perpY * radius;
      
      leftSide.push([wrapRingPosition(leftX), leftY]);
      rightSide.push([wrapRingPosition(rightX), rightY]);
    }
    
    // For closed loops, ensure smooth connection by making first and last points identical
    // This prevents gaps or overlaps where the loop closes
    if (isClosed && path.length > 2 && leftSide.length > 0 && rightSide.length > 0) {
      // Use the first point's position for both first and last on leftSide
      const firstLeft = leftSide[0];
      leftSide[leftSide.length - 1] = [firstLeft[0], firstLeft[1]];
      
      // Use the first point's position for both first and last on rightSide
      const firstRight = rightSide[0];
      rightSide[rightSide.length - 1] = [firstRight[0], firstRight[1]];
    }
    
    // Combine: left side forward, then right side backward
    const expanded = [...leftSide, ...rightSide.reverse()];
    
    if (window.DEBUG_ZONE_COORDS) {
      console.log('[ZoneEditor] expandPathCoords:', {
        pathLength: path.length,
        radius,
        isClosed,
        distToClose,
        leftSidePoints: leftSide.length,
        rightSidePoints: rightSide.length,
        totalPoints: expanded.length,
        firstPoint: expanded[0],
        lastPoint: expanded[expanded.length - 1],
      });
    }
    
    // Ensure we have at least 4 distinct points (PostGIS requires at least 4 points total including closing duplicate)
    if (expanded.length < 4) {
      // Not enough points - fall back to creating a circle around the path points
      const centerX = path.reduce((sum, p) => sum + this.convertRelativeToAbsoluteX(p.x), 0) / path.length;
      const centerY = path.reduce((sum, p) => sum + p.y, 0) / path.length;
      const segments = 32;
      expanded.length = 0; // Clear and recreate
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        const wrappedX = wrapRingPosition(x);
        expanded.push([wrappedX, y]);
      }
    }
    
    // Close polygon (ensure first and last points match)
    if (expanded.length > 0) {
      const first = expanded[0];
      const last = expanded[expanded.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        expanded.push([first[0], first[1]]);
      }
    }
    
    return expanded;
  }
  
  /**
   * Cleanup
   */
  dispose() {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
    }
    if (this.raycastPlane) {
      this.scene.remove(this.raycastPlane);
    }
    this.cancelDrawing();
    this.deselectZone();
  }
}

export { TOOLS };

