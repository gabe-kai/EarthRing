/**
 * Zone Editor
 * Handles interactive zone creation and editing tools
 * Supports: rectangle, circle, torus, polygon, and paintbrush tools
 */

import * as THREE from 'three';
import { fromThreeJS, toThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition, normalizeRelativeToCamera, denormalizeFromCamera } from '../utils/coordinates.js';
import { createZone, deleteZone } from '../api/zone-service.js';
import { getCurrentUser } from '../auth/auth-service.js';

const TOOLS = {
  NONE: 'none',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  TORUS: 'torus',
  POLYGON: 'polygon',
  PAINTBRUSH: 'paintbrush',
  SELECT: 'select',
};

export class ZoneEditor {
  constructor(sceneManager, cameraController, zoneManager, gameStateManager) {
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
    this.currentFloor = 0;
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
    this.paintbrushRadius = 50; // meters
    this.paintbrushPath = []; // Array of points for paintbrush
    
    // Event handlers
    this.onToolChangeCallbacks = [];
    this.onZoneCreatedCallbacks = [];
    this.onZoneSelectedCallbacks = [];
    
    // Create invisible plane for raycasting (at floor level)
    this.createRaycastPlane();
    
    // Set up mouse event listeners
    this.setupMouseListeners();
  }
  
  /**
   * Create an invisible plane at the floor level for raycasting
   */
  createRaycastPlane() {
    // Create a large plane at floor 0 for raycasting
    const planeGeometry = new THREE.PlaneGeometry(1000000, 1000000);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
      visible: false,
      side: THREE.DoubleSide 
    });
    this.raycastPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.raycastPlane.rotation.x = -Math.PI / 2; // Horizontal plane
    this.raycastPlane.position.y = DEFAULT_FLOOR_HEIGHT;
    this.scene.add(this.raycastPlane);
  }
  
  /**
   * Set up mouse event listeners
   */
  setupMouseListeners() {
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.renderer.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.renderer.domElement.addEventListener('click', this.onClick.bind(this));
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
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Intersect with the floor plane
    const intersects = this.raycaster.intersectObject(this.raycastPlane);
    if (intersects.length > 0) {
      const worldPos = intersects[0].point;
      // Convert Three.js coordinates to EarthRing coordinates
      // Note: floorHeight is used to calculate floor from Y, but we already know the floor
      // So we use DEFAULT_FLOOR_HEIGHT and then override z with currentFloor
      const earthRingPos = fromThreeJS(worldPos, DEFAULT_FLOOR_HEIGHT);
      earthRingPos.z = this.currentFloor; // Override with actual floor
      
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
    
    return null;
  }
  
  /**
   * Handle mouse down event
   */
  onMouseDown(event) {
    // Don't interfere if clicking on UI elements
    if (event.target !== this.renderer.domElement) return;
    
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
    if (this.currentTool === TOOLS.NONE) return;
    
    const earthRingPos = this.getEarthRingPositionFromMouse(event);
    if (!earthRingPos) return;
    
    this.currentPoint = earthRingPos;
    
    if (this.isDrawing) {
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
    
    const earthRingPos = this.getEarthRingPositionFromMouse(event);
    if (!earthRingPos) return;
    
    // DEBUG: Log release position
    if (window.DEBUG_ZONE_COORDS) {
      const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      console.log('[ZoneEditor] Mouse UP:', {
        earthRingPos: { ...earthRingPos },
        cameraX: cameraPos.x,
        tool: this.currentTool,
        startPoint: this.startPoint,
      });
    }
    
    // Finish drawing for drag-based tools
    if (this.currentTool !== TOOLS.POLYGON && this.currentTool !== TOOLS.SELECT) {
      this.finishDrawing(earthRingPos);
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
    this.isDrawing = true;
    this.startPoint = startPos;
    this.currentPoint = startPos;
    
    if (this.currentTool === TOOLS.PAINTBRUSH) {
      this.paintbrushPath = [startPos];
    }
  }
  
  /**
   * Update preview geometry while drawing
   */
  updatePreview(currentPos) {
    if (!this.startPoint || !currentPos) return;
    
    // Remove old preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
      if (this.previewMesh.material) this.previewMesh.material.dispose();
      this.previewMesh = null;
    }
    
    let geometry;
    
    try {
      switch (this.currentTool) {
        case TOOLS.RECTANGLE:
          geometry = this.createRectanglePreview(this.startPoint, currentPos);
          break;
        case TOOLS.CIRCLE:
          geometry = this.createCirclePreview(this.startPoint, currentPos);
          break;
        case TOOLS.TORUS:
          geometry = this.createTorusPreview(this.startPoint, currentPos);
          break;
        case TOOLS.PAINTBRUSH:
          // Don't modify paintbrushPath here - it's managed in onMouseMove
          if (this.paintbrushPath.length > 0) {
            geometry = this.createPaintbrushPreview(this.paintbrushPath);
          }
          break;
        default:
          return;
      }
      
      if (geometry) {
        const material = new THREE.MeshBasicMaterial({
          color: this.getToolColor(),
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        });
        this.previewMesh = new THREE.Mesh(geometry, material);
        this.previewMesh.rotation.x = -Math.PI / 2;
        this.previewMesh.position.y = DEFAULT_FLOOR_HEIGHT + (this.currentFloor * 5) + 0.001;
        this.previewMesh.renderOrder = 10; // Render above zones
        this.scene.add(this.previewMesh);
      }
    } catch (error) {
      console.error('Error creating preview geometry:', error);
    }
  }
  
  /**
   * Update paintbrush preview (shown even when not dragging)
   */
  updatePaintbrushPreview(pos) {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
    }
    
    const geometry = new THREE.CircleGeometry(this.paintbrushRadius, 32);
    const material = new THREE.MeshBasicMaterial({
      color: this.getToolColor(),
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    this.previewMesh = new THREE.Mesh(geometry, material);
    this.previewMesh.rotation.x = -Math.PI / 2;
    
    const threeJSPos = toThreeJS(pos, this.currentFloor);
    this.previewMesh.position.set(threeJSPos.x, DEFAULT_FLOOR_HEIGHT + 0.001, threeJSPos.z);
    this.scene.add(this.previewMesh);
  }
  
  /**
   * Finish drawing and create zone
   */
  async finishDrawing(endPos) {
    if (!this.startPoint) return;
    
    // DEBUG: Log which tool is being used
    console.log('[ZoneEditor] finishDrawing CALLED', {
      currentTool: this.currentTool,
      startPoint: this.startPoint,
      endPos,
      paintbrushPathLength: this.paintbrushPath?.length,
    });
    
    // Remove preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }
    
    let geometry;
    
    switch (this.currentTool) {
      case TOOLS.RECTANGLE:
        console.log('[ZoneEditor] Using RECTANGLE tool');
        geometry = this.createRectangleGeometry(this.startPoint, endPos);
        break;
      case TOOLS.CIRCLE:
        console.log('[ZoneEditor] Using CIRCLE tool');
        geometry = this.createCircleGeometry(this.startPoint, endPos);
        break;
      case TOOLS.TORUS:
        console.log('[ZoneEditor] Using TORUS tool');
        geometry = this.createTorusGeometry(this.startPoint, endPos);
        break;
      case TOOLS.PAINTBRUSH:
        console.log('[ZoneEditor] Using PAINTBRUSH tool', {
          pathLength: this.paintbrushPath?.length,
          path: this.paintbrushPath,
        });
        geometry = this.createPaintbrushGeometry(this.paintbrushPath);
        break;
      default:
        console.log('[ZoneEditor] Unknown tool or NONE:', this.currentTool);
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
      const zone = await createZone({
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
      
      // DEBUG: Log created zone
      if (window.DEBUG_ZONE_COORDS) {
        const parsedGeometry = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;
        console.log('[ZoneEditor] finishDrawing - zone created:', {
          id: zone.id,
          geometry: parsedGeometry,
          firstCoordinate: parsedGeometry?.coordinates?.[0]?.[0],
          allCoordinates: parsedGeometry?.coordinates?.[0],
        });
      }
      
      // Add to game state and render
      this.gameStateManager.upsertZone(zone);
      this.zoneManager.renderZone(zone);
      
      // Notify callbacks
      this.onZoneCreatedCallbacks.forEach(cb => cb(zone));
      
    } catch (error) {
      console.error('Failed to create zone:', error);
      alert(`Failed to create zone: ${error.message}`);
    }
    
    // Reset drawing state
    this.isDrawing = false;
    this.startPoint = null;
    this.currentPoint = null;
    this.paintbrushPath = [];
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
        opacity: 0.5,
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
      const zone = await createZone({
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
      
      this.gameStateManager.upsertZone(zone);
      this.zoneManager.renderZone(zone);
      this.onZoneCreatedCallbacks.forEach(cb => cb(zone));
      
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
  }
  
  /**
   * Delete selected zone
   */
  async deleteSelectedZone() {
    if (!this.selectedZone) return;
    
    if (!confirm(`Delete zone "${this.selectedZone.name || this.selectedZone.id}"?`)) {
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
      this.scene.remove(this.previewMesh);
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
    this.currentFloor = floor;
    // Update raycast plane position
    this.raycastPlane.position.y = DEFAULT_FLOOR_HEIGHT + (floor * 5); // Assuming 5m per floor
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
    const colors = {
      residential: 0x6fcf97,
      commercial: 0x56ccf2,
      industrial: 0xf2c94c,
      'mixed-use': 0xffd666,
      mixed_use: 0xffd666,
      park: 0x27ae60,
      restricted: 0xe74c3c,
    };
    return colors[this.currentZoneType] || 0xffffff;
  }
  
  // Geometry creation methods
  
  createRectanglePreview(start, end) {
    // Use the same coordinate conversion as final geometry to ensure preview matches
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    
    // Convert to absolute coordinates (same as final geometry)
    const absMinX = this.convertRelativeToAbsoluteX(minX);
    const absMaxX = this.convertRelativeToAbsoluteX(maxX);
    
    // Create preview using the same wrapping logic as final rendering
    // Wrap each corner point relative to camera (same as wrapZoneX in zone-manager.js)
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = wrapRingPosition(cameraPos.x);
    
    // Wrap coordinates relative to camera for preview (same as rendering)
    const wrappedMinX = normalizeRelativeToCamera(absMinX, cameraX);
    const wrappedMaxX = normalizeRelativeToCamera(absMaxX, cameraX);
    
    // Create shape from rectangle corners (same approach as zone rendering)
    // Negate Y coordinate (worldPos.z) for negative Y to ensure correct face direction after rotation
    const hasNegativeY = minY < 0 || maxY < 0;
    const shape = new THREE.Shape();
    const corners = [
      [wrappedMinX, minY],
      [wrappedMaxX, minY],
      [wrappedMaxX, maxY],
      [wrappedMinX, maxY],
    ];
    
    let firstPos = null;
    corners.forEach(([x, y], idx) => {
      const worldPos = toThreeJS({ x, y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Negate worldPos.z (EarthRing Y) if Y is negative to fix face direction
      const shapeY = hasNegativeY ? -worldPos.z : worldPos.z;
      if (idx === 0) {
        firstPos = { x: worldPos.x, z: shapeY };
        shape.moveTo(worldPos.x, shapeY);
      } else {
        shape.lineTo(worldPos.x, shapeY);
      }
    });
    // Close the shape by returning to first point
    if (firstPos) {
      shape.lineTo(firstPos.x, firstPos.z);
    }
    
    // Create geometry from shape (same as zone rendering)
    const geometry = new THREE.ShapeGeometry(shape);
    
    // No logging here - this function is called on every mouse move during dragging
    // Key information is logged in onMouseDown, onMouseUp, and finishDrawing
    
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
    
    // DEBUG: Log geometry input
    console.log('[ZoneEditor] createRectangleGeometry CALLED', {
      start: { ...start },
      end: { ...end },
      minX, maxX, minY, maxY,
      DEBUG_FLAG: window.DEBUG_ZONE_COORDS,
    });
    
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
    const radius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const geometry = new THREE.CircleGeometry(radius, 64);
    
    // Convert center to absolute coordinates (same as final geometry)
    const absCenterX = this.convertRelativeToAbsoluteX(center.x);
    const threeJSPos = toThreeJS({
      x: absCenterX,
      y: center.y,
      z: this.currentFloor,
    }, this.currentFloor);
    geometry.translate(threeJSPos.x, 0, threeJSPos.z);
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
  
  createTorusPreview(center, edge) {
    const outerRadius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const innerRadius = outerRadius * 0.6; // Torus inner radius is 60% of outer
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64);
    
    // Convert center to absolute coordinates (same as final geometry)
    const absCenterX = this.convertRelativeToAbsoluteX(center.x);
    const threeJSPos = toThreeJS({
      x: absCenterX,
      y: center.y,
      z: this.currentFloor,
    }, this.currentFloor);
    geometry.translate(threeJSPos.x, 0, threeJSPos.z);
    return geometry;
  }
  
  createTorusGeometry(center, edge) {
    const outerRadius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const innerRadius = outerRadius * 0.6;
    const segments = 64;
    const outerCoords = [];
    const innerCoords = [];
    
    // Convert center to absolute coordinates first
    const absCenterX = this.convertRelativeToAbsoluteX(center.x);
    const absCenterY = center.y; // Y doesn't need conversion
    
    // Generate outer ring points using absolute center
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = absCenterX + outerRadius * cos;
      const y = absCenterY + outerRadius * sin;
      
      // Wrap X coordinate to valid range
      const wrappedX = wrapRingPosition(x);
      
      outerCoords.push([wrappedX, y]);
    }
    // Close outer ring explicitly
    if (outerCoords.length > 0) {
      outerCoords.push([outerCoords[0][0], outerCoords[0][1]]);
    }
    
    // Generate inner ring points using absolute center
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = absCenterX + innerRadius * cos;
      const y = absCenterY + innerRadius * sin;
      
      // Wrap X coordinate to valid range
      const wrappedX = wrapRingPosition(x);
      
      innerCoords.push([wrappedX, y]);
    }
    // Close inner ring explicitly
    if (innerCoords.length > 0) {
      innerCoords.push([innerCoords[0][0], innerCoords[0][1]]);
    }
    
    // Reverse inner ring for proper winding (donut hole)
    innerCoords.reverse();
    
    // Combine outer and inner rings into a single polygon
    // The polygon should be: outer ring (clockwise) + inner ring (counter-clockwise)
    const combinedCoords = outerCoords.concat(innerCoords);
    
    // Ensure the combined polygon is closed
    if (combinedCoords.length > 0) {
      const first = combinedCoords[0];
      const last = combinedCoords[combinedCoords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        combinedCoords.push([first[0], first[1]]);
      }
    }
    
    return {
      type: 'Polygon',
      coordinates: [combinedCoords],
    };
  }
  
  createPolygonPreview(vertices) {
    if (vertices.length < 2) return null;
    
    const shape = new THREE.Shape();
    const first = toThreeJS(vertices[0], this.currentFloor);
    shape.moveTo(first.x, first.z);
    
    for (let i = 1; i < vertices.length; i++) {
      const pos = toThreeJS(vertices[i], this.currentFloor);
      shape.lineTo(pos.x, pos.z);
    }
    
    if (vertices.length >= 3) {
      shape.lineTo(first.x, first.z); // Close polygon
    }
    
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
    if (path.length < 2) return null;
    
    // Create a shape from the paintbrush path
    const shape = new THREE.Shape();
    const first = toThreeJS(path[0], this.currentFloor);
    shape.moveTo(first.x, first.z);
    
    for (let i = 1; i < path.length; i++) {
      const pos = toThreeJS(path[i], this.currentFloor);
      shape.lineTo(pos.x, pos.z);
    }
    
    // Expand path by paintbrush radius
    const expandedShape = this.expandPath(path, this.paintbrushRadius);
    if (expandedShape) {
      const geometry = new THREE.ShapeGeometry(expandedShape);
      return geometry;
    }
    
    return null;
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
    
    // Expand path similar to expandPath but return EarthRing coordinates
    const expanded = [];
    
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
      
      // Convert relative coordinates to absolute
      const absP1X = this.convertRelativeToAbsoluteX(p1.x);
      const x = absP1X + perpX * radius;
      const y = p1.y + perpY * radius;
      // Wrap X coordinate to valid range [0, 264000000)
      const wrappedX = wrapRingPosition(x);
      expanded.push([wrappedX, y]);
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
      const x = absLastX + perpX * radius;
      const y = last.y + perpY * radius;
      // Wrap X coordinate to valid range [0, 264000000)
      const wrappedX = wrapRingPosition(x);
      expanded.push([wrappedX, y]);
    }
    
    // Return path
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
      const x = absP1X + perpX * radius;
      const y = p1.y + perpY * radius;
      // Wrap X coordinate to valid range [0, 264000000)
      const wrappedX = wrapRingPosition(x);
      expanded.push([wrappedX, y]);
    }
    
    // Close polygon
    if (expanded.length > 0) {
      expanded.push([expanded[0][0], expanded[0][1]]);
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

