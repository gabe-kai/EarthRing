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
    // Zones are rendered at floor * DEFAULT_FLOOR_HEIGHT, so floor 0 is at Y=0
    const planeGeometry = new THREE.PlaneGeometry(1000000, 1000000);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
      visible: false,
      side: THREE.DoubleSide 
    });
    this.raycastPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.raycastPlane.rotation.x = -Math.PI / 2; // Horizontal plane
    this.raycastPlane.position.y = this.currentFloor * DEFAULT_FLOOR_HEIGHT; // Match zone rendering position
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
    
    // Get the actual mouse release position from the event
    // This ensures the final zone goes exactly where the cursor is when released
    const endPos = this.getEarthRingPositionFromMouse(event);
    if (!endPos) return;
    
    // Update currentPoint to match
    this.currentPoint = endPos;
    
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
        // Reuse existing mesh and material if possible for better performance
        if (this.previewMesh) {
          // Dispose old geometry
          if (this.previewMesh.geometry) {
            this.previewMesh.geometry.dispose();
          }
          // Update geometry only (keeps material and mesh)
          this.previewMesh.geometry = geometry;
        } else {
          // Create new mesh on first preview
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
          // Use the same floor height calculation as zone rendering
          const floorHeight = this.currentFloor * DEFAULT_FLOOR_HEIGHT;
          this.previewMesh.position.y = floorHeight + 0.001;
          this.previewMesh.renderOrder = 10; // Render above zones
          this.scene.add(this.previewMesh);
        }
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
    // Update raycast plane position to match zone rendering
    // Zones are rendered at floor * DEFAULT_FLOOR_HEIGHT
    if (this.raycastPlane) {
      this.raycastPlane.position.y = floor * DEFAULT_FLOOR_HEIGHT;
    }
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
    // Create the preview by first generating the exact geometry that will be stored
    // then rendering it exactly as zone-manager.js does
    // This ensures 100% match between preview and actual zone
    
    // Step 1: Generate the exact stored geometry (same as createRectangleGeometry)
    let minX = Math.min(start.x, end.x);
    let maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    
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
  
  createTorusPreview(center, edge) {
    // Create the preview by first generating the exact geometry that will be stored
    // then rendering it exactly as zone-manager.js does
    // This ensures 100% match between preview and actual zone
    
    // Step 1: Generate the exact stored geometry (same as createTorusGeometry)
    const outerRadius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const innerRadius = outerRadius * 0.6; // Torus inner radius is 60% of outer
    const segments = 64;
    
    // Convert center to absolute coordinates first (same as final geometry)
    const absCenterX = this.convertRelativeToAbsoluteX(center.x);
    const absCenterY = center.y; // Y doesn't need conversion
    
    // Generate outer and inner ring points using absolute center
    // This matches the exact coordinates that will be stored (before wrapping)
    const outerAbsoluteCoords = [];
    const innerAbsoluteCoords = [];
    
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      // Outer ring
      const outerX = absCenterX + outerRadius * cos;
      const outerY = absCenterY + outerRadius * sin;
      outerAbsoluteCoords.push([outerX, outerY]);
      
      // Inner ring
      const innerX = absCenterX + innerRadius * cos;
      const innerY = absCenterY + innerRadius * sin;
      innerAbsoluteCoords.push([innerX, innerY]);
    }
    
    // Close rings
    if (outerAbsoluteCoords.length > 0) {
      outerAbsoluteCoords.push([outerAbsoluteCoords[0][0], outerAbsoluteCoords[0][1]]);
    }
    if (innerAbsoluteCoords.length > 0) {
      innerAbsoluteCoords.push([innerAbsoluteCoords[0][0], innerAbsoluteCoords[0][1]]);
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
    
    // Build outer ring EXACTLY as zone-manager.js does
    let firstPos = null;
    outerAbsoluteCoords.forEach(([x, y], idx) => {
      const wrappedX = wrapZoneX(x);  // Wrap absolute coordinate relative to camera
      const worldPos = toThreeJS({ x: wrappedX, y: y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Always negate worldPos.z for the fill shape
      const shapeY = -worldPos.z;
      if (idx === 0) {
        firstPos = { x: worldPos.x, z: shapeY };
        shape.moveTo(worldPos.x, shapeY);
      } else {
        shape.lineTo(worldPos.x, shapeY);
      }
    });
    
    // Explicitly close outer ring
    if (firstPos) {
      shape.lineTo(firstPos.x, firstPos.z);
    }
    
    // Build inner ring (hole) - reverse for proper winding (donut hole)
    const holePath = new THREE.Path();
    innerAbsoluteCoords.reverse(); // Reverse for proper winding
    innerAbsoluteCoords.forEach(([x, y], idx) => {
      const wrappedX = wrapZoneX(x);  // Wrap absolute coordinate relative to camera
      const worldPos = toThreeJS({ x: wrappedX, y: y, z: this.currentFloor }, DEFAULT_FLOOR_HEIGHT);
      // Holes use worldPos.z directly (not negated) - matching zone-manager.js behavior
      if (idx === 0) {
        holePath.moveTo(worldPos.x, worldPos.z);
      } else {
        holePath.lineTo(worldPos.x, worldPos.z);
      }
    });
    
    // Add hole to shape
    shape.holes.push(holePath);
    
    // Create geometry from shape (same as zone rendering)
    const geometry = new THREE.ShapeGeometry(shape);
    
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

