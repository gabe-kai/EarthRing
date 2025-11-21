/**
 * Zone Editor
 * Handles interactive zone creation and editing tools
 * Supports: rectangle, circle, torus, polygon, and paintbrush tools
 */

import * as THREE from 'three';
import { fromThreeJS, toThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition } from '../utils/coordinates.js';
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
      // Right-click to finish polygon
      if (this.currentTool === TOOLS.POLYGON && this.polygonVertices.length >= 3) {
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
   */
  getEarthRingPositionFromMouse(event) {
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Intersect with the floor plane
    const intersects = this.raycaster.intersectObject(this.raycastPlane);
    if (intersects.length > 0) {
      const worldPos = intersects[0].point;
      const earthRingPos = fromThreeJS(worldPos, this.currentFloor);
      
      // Get camera position to normalize coordinates relative to camera
      // This prevents zones from appearing mirrored on the other side of the ring
      const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      const cameraX = cameraPos.x;
      const RING_CIRCUMFERENCE = 264000000;
      
      // Normalize X coordinate relative to camera (like chunks)
      // This ensures zones are created near the camera, not wrapped to the other side
      let x = earthRingPos.x;
      const dx = x - cameraX;
      const half = RING_CIRCUMFERENCE / 2;
      let adjusted = dx;
      while (adjusted > half) adjusted -= RING_CIRCUMFERENCE;
      while (adjusted < -half) adjusted += RING_CIRCUMFERENCE;
      x = cameraX + adjusted;
      
      // Now wrap to valid range [0, 264000000)
      x = wrapRingPosition(x);
      
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
    // Don't interfere with OrbitControls if no tool is active
    if (this.currentTool === TOOLS.NONE) return;
    
    // Don't interfere if clicking on UI elements
    if (event.target !== this.renderer.domElement) return;
    
    // Only handle left mouse button for drawing tools
    if (event.button !== 0 && this.currentTool !== TOOLS.SELECT) return;
    
    const earthRingPos = this.getEarthRingPositionFromMouse(event);
    if (!earthRingPos) return;
    
    // Prevent OrbitControls from interfering when a tool is active
    if (this.currentTool !== TOOLS.NONE) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    if (this.currentTool === TOOLS.SELECT) {
      this.handleZoneSelection(event);
      return;
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
    if (!this.startPoint) return;
    
    // Remove old preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }
    
    let geometry;
    
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
        this.paintbrushPath.push(currentPos);
        geometry = this.createPaintbrushPreview(this.paintbrushPath);
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
      });
      this.previewMesh = new THREE.Mesh(geometry, material);
      this.previewMesh.rotation.x = -Math.PI / 2;
      this.previewMesh.position.y = DEFAULT_FLOOR_HEIGHT + (this.currentFloor * 5) + 0.001;
      this.scene.add(this.previewMesh);
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
    
    // Remove preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }
    
    let geometry;
    
    switch (this.currentTool) {
      case TOOLS.RECTANGLE:
        geometry = this.createRectangleGeometry(this.startPoint, endPos);
        break;
      case TOOLS.CIRCLE:
        geometry = this.createCircleGeometry(this.startPoint, endPos);
        break;
      case TOOLS.TORUS:
        geometry = this.createTorusGeometry(this.startPoint, endPos);
        break;
      case TOOLS.PAINTBRUSH:
        geometry = this.createPaintbrushGeometry(this.paintbrushPath);
        break;
      default:
        this.isDrawing = false;
        return;
    }
    
    if (!geometry) {
      this.isDrawing = false;
      return;
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
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const geometry = new THREE.PlaneGeometry(Math.abs(dx), Math.abs(dy));
    const centerX = start.x + dx / 2;
    const centerY = start.y + dy / 2;
    const threeJSPos = toThreeJS({
      x: centerX,
      y: centerY,
      z: this.currentFloor,
    }, this.currentFloor);
    geometry.translate(threeJSPos.x, 0, threeJSPos.z);
    return geometry;
  }
  
  createRectangleGeometry(start, end) {
    let minX = Math.min(start.x, end.x);
    let maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    
    // Wrap X coordinates to valid range [0, 264000000)
    minX = wrapRingPosition(minX);
    maxX = wrapRingPosition(maxX);
    
    return {
      type: 'Polygon',
      coordinates: [[
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ]],
    };
  }
  
  createCirclePreview(center, edge) {
    const radius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const geometry = new THREE.CircleGeometry(radius, 64);
    const threeJSPos = toThreeJS(center, this.currentFloor);
    geometry.translate(threeJSPos.x, 0, threeJSPos.z);
    return geometry;
  }
  
  createCircleGeometry(center, edge) {
    const radius = Math.sqrt(
      Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
    );
    const segments = 64;
    const coordinates = [];
    
    // Generate points around the circle (excluding the last duplicate)
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      let x = center.x + radius * Math.cos(angle);
      const y = center.y + radius * Math.sin(angle);
      
      // Wrap X coordinate to valid range [0, 264000000)
      x = wrapRingPosition(x);
      
      coordinates.push([x, y]);
    }
    
    // Explicitly close the ring by adding the first point again
    if (coordinates.length > 0) {
      coordinates.push([coordinates[0][0], coordinates[0][1]]);
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
    const threeJSPos = toThreeJS(center, this.currentFloor);
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
    
    // Generate outer ring points (excluding the last duplicate)
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let x = center.x + outerRadius * cos;
      const y = center.y + outerRadius * sin;
      
      // Wrap X coordinate to valid range [0, 264000000)
      x = wrapRingPosition(x);
      
      outerCoords.push([x, y]);
    }
    // Close outer ring explicitly
    if (outerCoords.length > 0) {
      outerCoords.push([outerCoords[0][0], outerCoords[0][1]]);
    }
    
    // Generate inner ring points (excluding the last duplicate)
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let x = center.x + innerRadius * cos;
      const y = center.y + innerRadius * sin;
      
      // Wrap X coordinate to valid range [0, 264000000)
      x = wrapRingPosition(x);
      
      innerCoords.push([x, y]);
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
      // Wrap X coordinate to valid range [0, 264000000)
      const x = wrapRingPosition(v.x);
      return [x, v.y];
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
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        let x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle);
        // Wrap X coordinate to valid range [0, 264000000)
        x = wrapRingPosition(x);
        coords.push([x, y]);
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
      
      let x = p1.x + perpX * radius;
      const y = p1.y + perpY * radius;
      // Wrap X coordinate to valid range [0, 264000000)
      x = wrapRingPosition(x);
      expanded.push([x, y]);
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
      let x = last.x + perpX * radius;
      const y = last.y + perpY * radius;
      // Wrap X coordinate to valid range [0, 264000000)
      x = wrapRingPosition(x);
      expanded.push([x, y]);
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
      
      let x = p1.x + perpX * radius;
      const y = p1.y + perpY * radius;
      // Wrap X coordinate to valid range [0, 264000000)
      x = wrapRingPosition(x);
      expanded.push([x, y]);
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

