import * as THREE from 'three';
import { toThreeJS, wrapRingPosition, normalizeRelativeToCamera, DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates-new.js';
import { createMeshAtEarthRingPosition } from '../utils/rendering.js';
import { updateInfoBox } from '../ui/info-box.js';

/**
 * StructureManager coordinates structure data and renders structures as world-positioned meshes.
 */
export class StructureManager {
  constructor(gameStateManager, cameraController, sceneManager) {
    this.gameState = gameStateManager;
    this.cameraController = cameraController;
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getScene();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.structuresVisible = true;
    this.structureMeshes = new Map(); // Map<structureID, THREE.Group>
    this.highlightedStructures = new Set(); // Set of highlighted structure IDs
    this.lastCameraX = null;
    this.WRAP_RE_RENDER_THRESHOLD = 2000; // Re-render if camera moved more than 2km

    // Track which structures belong to which chunks (for cleanup when chunks are removed)
    // Map<chunkID, Set<structureID>>
    this.chunkStructures = new Map();

    // Per-type visibility: Map<structureType, boolean>
    this.structureTypeVisibility = new Map([
      ['building', true],
      ['decoration', true],
      ['furniture', true],
      ['vehicle', true],
    ]);

    // PERFORMANCE: Cache materials and geometries for reuse
    this.materialCache = new Map(); // Map<materialKey, Material>
    this.geometryCache = new Map(); // Map<geometryKey, Geometry>
    
    this.setupListeners();
    this.setupStructureClickHandler();
  }

  /**
   * Get the current camera X position in EarthRing coordinates (raw, unwrapped).
   *
   * Why this exists (and why it must stay raw):
   * - Chunk meshes are positioned using the Three.js camera's raw X (unwrapped).
   * - The cameraController returns a wrapped X (0..circumference); when we normalized
   *   structures relative to that wrapped value, west-of-origin structures were
   *   offset to the opposite side after about -10 km, so they vanished on X- while
   *   still appearing on X+.
   * - Using the raw camera X keeps the structure normalization aligned with the
   *   chunk wrapping math, preventing west-side disappearance.
   *
   * Fallback to the controller is intentionally noisy (warn) so we notice if the
   * raw camera isn’t available.
   */
  getCurrentCameraX() {
    const camera = this.sceneManager?.getCamera ? this.sceneManager.getCamera() : null;
    if (camera) {
      return camera.position.x;
    }
    if (this.cameraController?.getEarthRingPosition) {
      const pos = this.cameraController.getEarthRingPosition();
      if (pos && typeof pos.x === 'number') {
        // Fallback: wrapped, but better than nothing
        console.warn('[Structures] Using wrapped camera position from controller (may reduce rendering range)');
        return pos.x;
      }
    }
    return 0;
  }
  
  /**
   * Merge multiple BoxGeometry objects into a single BufferGeometry
   * @param {Array<{geometry: THREE.BoxGeometry, position: [x, y, z], rotation: [x, y, z]}>} geometries - Array of geometry definitions
   * @returns {THREE.BufferGeometry} Merged geometry
   */
  mergeBoxGeometries(geometries) {
    const mergedGeometry = new THREE.BufferGeometry();
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let indexOffset = 0;
    
    for (const {geometry, position, rotation} of geometries) {
      // Clone geometry to avoid modifying original
      const geom = geometry.clone();
      
      // Apply rotation to geometry
      const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(...rotation, 'XYZ')
      );
      geom.applyMatrix4(rotationMatrix);
      
      // Apply translation to geometry
      const translationMatrix = new THREE.Matrix4().makeTranslation(...position);
      geom.applyMatrix4(translationMatrix);
      
      // Extract attributes
      const posAttr = geom.attributes.position;
      const normalAttr = geom.attributes.normal;
      const uvAttr = geom.attributes.uv;
      const indexAttr = geom.index;
      
      // Add vertices with offset indices
      for (let i = 0; i < posAttr.count; i++) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        normals.push(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        uvs.push(uvAttr.getX(i), uvAttr.getY(i));
      }
      
      // Add indices with offset
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i++) {
          indices.push(indexAttr.getX(i) + indexOffset);
        }
      }
      
      indexOffset += posAttr.count;
    }
    
    // Set merged attributes
    mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mergedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    mergedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    mergedGeometry.setIndex(indices);
    
    return mergedGeometry;
  }

  /**
   * Get or create cached material
   * @param {string} key - Material cache key
   * @param {Function} createFn - Function to create material if not cached
   * @returns {THREE.Material} Cached or new material
   */
  getCachedMaterial(key, createFn) {
    if (!this.materialCache.has(key)) {
      this.materialCache.set(key, createFn());
    }
    return this.materialCache.get(key);
  }

  setupListeners() {
    // Listen for active floor changes
    this.gameState.on('activeFloorChanged', () => {
      this.updateStructureVisibility();
    });
  }

  setupStructureClickHandler() {
    const tryAttach = () => {
      const renderer = this.sceneManager?.getRenderer?.();
      if (!renderer || !renderer.domElement) {
        // Renderer not ready yet; retry shortly
        setTimeout(tryAttach, 250);
        return;
      }
      const canvas = renderer.domElement;
      // Avoid double-binding
      if (canvas._structureClickHandlerAttached) return;
      canvas._structureClickHandlerAttached = true;
      canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return; // left click only
        this.handleStructureClick(event, renderer);
      });
    };
    tryAttach();
  }

  handleStructureClick(event, renderer) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.getCamera());

    const meshes = Array.from(this.structureMeshes.values());
    const intersects = this.raycaster.intersectObjects(meshes, true);
    if (!intersects.length) return;

    let obj = intersects[0].object;
    while (obj && !obj.userData?.structureId) {
      obj = obj.parent;
    }
    if (!obj || !obj.userData?.structureId) return;

    const structureId = String(obj.userData.structureId);
    let structure = this.gameState.getStructure(structureId);
    if (!structure) {
      structure = obj.userData.structure;
      if (!structure) return;
    }

    const info = this.buildStructureInfo(structure);
    updateInfoBox(info, { title: 'Structure', tooltip: 'Selected structure', source: 'structure' });
  }

  setStructureIdRecursive(obj, id, structure) {
    if (!obj || typeof obj !== 'object') return;
    obj.userData = obj.userData || {};
    // Force-set so any existing userData.structureId is replaced by the canonical one
    obj.userData.structureId = id;
    if (structure) {
      obj.userData.structure = structure;
    }
    if (obj.children && obj.children.length) {
      obj.children.forEach(child => this.setStructureIdRecursive(child, id, structure));
    }
  }

  buildStructureInfo(structure) {
    const doors = structure.doors || structure.model_data?.doors || {};
    const garageDoors = structure.garage_doors || structure.model_data?.garage_doors || [];
    const windows = structure.windows || structure.model_data?.windows || [];
    const decorations = structure.decorations || structure.model_data?.decorations || [];
    const dims = structure.dimensions || {};
    return {
      id: structure.id,
      type: structure.structure_type || structure.type || 'unknown',
      building_class: structure.building_class || structure.model_data?.class || 'n/a',
      category: structure.category || 'n/a',
      subcategory: structure.subcategory || 'n/a',
      floor: structure.floor,
      position: `x:${structure.position?.x?.toFixed?.(1) ?? '?'}, y:${structure.position?.y?.toFixed?.(1) ?? '?'}`,
      dimensions: `w:${dims.width ?? '?'}, d:${dims.depth ?? '?'}, h:${dims.height ?? '?'}`,
      doors: JSON.stringify(doors),
      garage_doors: JSON.stringify(garageDoors),
      windows: JSON.stringify(windows),
      decorations: JSON.stringify(decorations),
    };
  }

  /**
   * Add simple decoration meshes to the structure group.
   * Decorations are data-only hints: we render low-poly placeholders.
   */
  addDecorations(structureGroup, structure, dimensions) {
    const decorations = structure.decorations || structure.model_data?.decorations || [];
    if (!decorations || decorations.length === 0) return;

    const { width, depth, height } = dimensions;
    const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.1 });

    const dockInstances = [];
    const hvacInstances = [];

    decorations.forEach((dec) => {
      const type = dec.type || 'decoration';
      if (type === 'utility_band') return; // shader-driven

      const pos = dec.position || [0, 0, 0]; // [x, depthAxis, vertical]
      const size = dec.size || [1, 1, 1];    // [w, d, h]

      // Map generator coords to Three.js (x -> x, y(depth) -> z, z(vertical) -> y)
      let px = pos[0] || 0;
      let pz = pos[1] || 0;
      let py = pos[2] || 0;
      const sx = size[0] || 1;
      const sz = size[1] || 1;
      const sy = size[2] || 1;

      if (type === 'vent_stack') {
        const radius = Math.min(sx, sz) * 0.35;
        const stackHeight = sy;
        py = (height || 0) + stackHeight * 0.5 + 0.05;
        const geom = new THREE.CylinderGeometry(radius, radius * 0.9, stackHeight, 10);
        const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.5 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.position.set(px, py, pz);
        structureGroup.add(mesh);
      } else if (type === 'loading_dock') {
        const facade = dec.facade || 'front';
        const zOffset = sz * 0.5 + 0.05;
        if (facade === 'front') {
          pz = (depth || 0) * 0.5 + zOffset;
        } else if (facade === 'back') {
          pz = -(depth || 0) * 0.5 - zOffset;
        }
        py = sy * 0.5; // top at ~1m
        dockInstances.push({ px, py, pz, sx, sy, sz });
      } else if (type === 'roof_hvac') {
        hvacInstances.push({ px, py, pz, sx, sy, sz });
      } else if (type === 'cooling_tower') {
        const radiusBottom = Math.min(sx, sz) * 0.4;
        const radiusTop = radiusBottom * 0.8;
        const towerHeight = sy;
        const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, towerHeight, 32, 1, false);
        const mat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6, metalness: 0.15 });
        const tower = new THREE.Mesh(geom, mat);

        const stripeH = Math.min(0.8, towerHeight * 0.15);
        const stripeGeom = new THREE.CylinderGeometry(radiusTop * 1.05, radiusTop * 1.05, stripeH, 32, 1, false);
        const stripeMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.2 });
        const stripe = new THREE.Mesh(stripeGeom, stripeMat);
        stripe.position.y = (towerHeight * 0.5) - (stripeH * 0.5) - 0.2;

        const group = new THREE.Group();
        group.add(tower);
        group.add(stripe);
        group.castShadow = false;
        group.receiveShadow = false;
        group.position.set(px, py, pz);
        structureGroup.add(group);
      } else if (type === 'reactor_turbine_hall') {
        const baseH = sy * 0.6;
        const roofH = sy * 0.4;
        const group = new THREE.Group();

        const baseGeom = new THREE.BoxGeometry(sx, baseH, sz);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.65, metalness: 0.2 });
        const base = new THREE.Mesh(baseGeom, baseMat);
        base.position.y = baseH * 0.5;
        group.add(base);

        const radius = sx * 0.5;
        const roofShape = new THREE.Shape();
        roofShape.moveTo(-radius, 0);
        roofShape.absarc(0, 0, radius, Math.PI, 0, false);
        const roofGeom = new THREE.ExtrudeGeometry(roofShape, {
          depth: sz,
          bevelEnabled: false,
          curveSegments: 24,
          steps: 1,
        });
        roofGeom.translate(0, 0, -sz * 0.5);

        const roofMat = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.6, metalness: 0.2 });
        const roof = new THREE.Mesh(roofGeom, roofMat);
        roof.rotation.x = Math.PI; // arc up
        roof.position.y = baseH;
        group.add(roof);

        group.castShadow = false;
        group.receiveShadow = false;
        group.position.set(px, py, pz);
        structureGroup.add(group);
      } else {
        const geom = new THREE.BoxGeometry(sx, sy, sz);
        const mesh = new THREE.Mesh(geom, defaultMaterial);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.position.set(px, py, pz);
        structureGroup.add(mesh);
      }
    });

    // Instanced loading docks
    if (dockInstances.length > 0) {
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.1 });
      const inst = new THREE.InstancedMesh(geom, mat, dockInstances.length);
      const m = new THREE.Matrix4();
      dockInstances.forEach((d, i) => {
        m.compose(
          new THREE.Vector3(d.px, d.py, d.pz),
          new THREE.Quaternion(),
          new THREE.Vector3(d.sx, d.sy, d.sz)
        );
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = false;
      structureGroup.add(inst);
    }

    // Instanced roof HVAC boxes
    if (hvacInstances.length > 0) {
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.2 });
      const inst = new THREE.InstancedMesh(geom, mat, hvacInstances.length);
      const m = new THREE.Matrix4();
      hvacInstances.forEach((d, i) => {
        m.compose(
          new THREE.Vector3(d.px, d.py, d.pz),
          new THREE.Quaternion(),
          new THREE.Vector3(d.sx, d.sy, d.sz)
        );
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = false;
      structureGroup.add(inst);
    }
  }

  buildBandRects(structure, decorations, facade, wallWidth, wallDepth, foundationHeight, buildingHeight) {
    const MAX_BANDS = 8;
    const totalWallHeight = foundationHeight + buildingHeight;
    const wallCenterY = totalWallHeight / 2;
    const decs = decorations.filter(
      (d) => d && d.type === 'utility_band' && (d.facade || 'front') === facade
    );
    const rects = [];
    decs.slice(0, MAX_BANDS).forEach((d) => {
      const pos = d.position || [0, 0, 0]; // [x, depth, z]
      const size = d.size || [0, 0, 0];    // [w, d, h]
      let dx = 0;
      let dw = 0;
      if (facade === 'front' || facade === 'back') {
        dx = (pos[0] || 0) / wallWidth;
        dw = (size[0] || 0) / wallWidth;
      } else {
        // left/right: use depth axis for width
        dx = (pos[1] || 0) / wallWidth;
        dw = (size[0] || 0) / wallWidth;
      }
      const dy = ((pos[2] || 0) - wallCenterY) / totalWallHeight;
      const dh = (size[2] || 0) / totalWallHeight;
      rects.push(new THREE.Vector4(dx, dy, dw, dh));
    });
    while (rects.length < MAX_BANDS) {
      rects.push(new THREE.Vector4(0, 0, 0, 0));
    }
    return { bandRects: rects, bandCount: Math.min(decs.length, MAX_BANDS) };
  }

  /**
   * Handle structures streamed from chunk data
   * @param {Array} structures - Array of structure objects
   * @param {string} chunkID - Chunk ID these structures belong to
   */
  handleStreamedStructures(structures, chunkID) {
    if (!structures || structures.length === 0) {
      return;
    }

    // Track structures for this chunk
    if (!this.chunkStructures.has(chunkID)) {
      this.chunkStructures.set(chunkID, new Set());
    }
    const chunkStructureSet = this.chunkStructures.get(chunkID);

    const activeFloor = this.gameState.getActiveFloor();

    structures.forEach(structure => {

      // Upsert to game state
      this.gameState.upsertStructure(structure);

      // Track for chunk cleanup
      chunkStructureSet.add(structure.id);

      // Only render structures on active floor
      if (structure.floor === activeFloor) {
        this.renderStructure(structure);
      }
    });
  }

  /**
   * Clean up structures for a removed chunk
   * @param {string} chunkID - Chunk ID to clean up
   */
  cleanupStructuresForChunk(chunkID) {
    const structureIDs = this.chunkStructures.get(chunkID);
    if (!structureIDs) {
      return;
    }

    // Remove structures from game state and scene
    structureIDs.forEach(structureID => {
      this.removeStructure(structureID);
    });

    // Remove chunk tracking
    this.chunkStructures.delete(chunkID);
  }

  /**
   * Render a structure as a Three.js mesh
   * @param {Object} structure - Structure object with position, type, etc.
   */
  renderStructure(structure) {
    if (!structure || !structure.position) {
      return;
    }

    const cameraX = this.getCurrentCameraX();
    const cameraXWrapped = wrapRingPosition(cameraX);

    // Check if we need to re-render due to camera movement across wrap boundary
    const needsReRender = this.lastCameraX === null ||
      Math.abs(wrapRingPosition(cameraX) - wrapRingPosition(this.lastCameraX)) > this.WRAP_RE_RENDER_THRESHOLD;

    if (!needsReRender && this.structureMeshes.has(structure.id)) {
      // Structure already rendered, just update position if needed
      const existingMesh = this.structureMeshes.get(structure.id);
      if (existingMesh.userData.lastCameraXUsed !== cameraXWrapped) {
        this.updateStructurePosition(existingMesh, structure, cameraXWrapped);
      }
      return;
    }

    // Remove existing mesh if present
    this.removeStructure(structure.id);

    // Check structure type visibility
    const structureType = structure.structure_type?.toLowerCase() || 'building';
    const typeVisible = this.structureTypeVisibility.get(structureType) ?? true;

    if (!this.structuresVisible || !typeVisible) {
      return;
    }

    // CRITICAL: Floating Origin Pattern for Precision
    // Structure meshes use a floating origin to maintain precision at large distances from X=0.
    // This prevents flickering and "double layer" artifacts at distant pillar hubs (e.g., X=22,000,000m).
    //
    // Implementation:
    // 1. The structureGroup is positioned at the camera's X position (structureOriginX = cameraX)
    // 2. All structure vertices are built relative to this origin (subtract structureOriginX)
    // 3. This keeps vertex coordinates small (typically -500m to +500m), maintaining floating-point precision
    //
    // See: docs/09-zone-system.md "Floating Origin Pattern" section for details
    const structureOriginX = cameraX;
    
    // Create structure mesh group
    const structureGroup = new THREE.Group();
    structureGroup.renderOrder = 10; // Render above zones
    structureGroup.userData.structureId = structure.id;
    structureGroup.userData.structureType = structureType;
    structureGroup.userData.structure = structure;
    structureGroup.userData.lastCameraXUsed = cameraXWrapped;
    
    // Set floating origin position
    structureGroup.position.x = structureOriginX;

    // Calculate structure dimensions from properties
    const dimensions = this.getStructureDimensions(structure);
    
    // Debug: Log building variability
    const structureX = structure.position.x;
    const structureY = structure.position.y;
    const floor = structure.floor ?? 0;
    const floorHeight = floor * DEFAULT_FLOOR_HEIGHT;

    // Wrap structure position relative to camera (for floating origin)
    // This ensures the structure appears at the copy closest to the camera
    const wrappedAbsolute = normalizeRelativeToCamera(structureX, cameraX);
    
    // Convert wrapped absolute coordinate to Three.js coordinates (world position)
    const earthRingPos = {
      x: wrappedAbsolute,
      y: structureY,
      z: floorHeight,
    };
    const threeJSPosWorld = toThreeJS(earthRingPos);
    
    // Convert structureOriginX (camera X) to Three.js coordinates to get the floating origin
    const originEarthRingPos = {
      x: structureOriginX,
      y: 0,
      z: 0,
    };
    const threeJSOrigin = toThreeJS(originEarthRingPos);
    
    // Calculate local position in Three.js space (relative to floating origin)
    // The geometry is centered at (0,0,0) relative to the group, so we offset the group position
    const localOffset = {
      x: threeJSPosWorld.x - threeJSOrigin.x,
      y: threeJSPosWorld.y - threeJSOrigin.y,
      z: threeJSPosWorld.z - threeJSOrigin.z,
    };

    // Set group position using floating origin pattern:
    // - X position is the floating origin (camera X in Three.js space) + local X offset
    // - Y and Z are world positions (since toThreeJS already handles the conversion)
    // This keeps the geometry vertices small, maintaining precision at large distances
    structureGroup.position.set(
      threeJSOrigin.x + localOffset.x,
      threeJSPosWorld.y,
      threeJSPosWorld.z
    );
    structureGroup.userData.structureId = structure.id;

    // Apply rotation
    if (structure.rotation !== undefined) {
      structureGroup.rotation.y = (structure.rotation * Math.PI) / 180; // Convert degrees to radians
    }

    // Apply scale
    if (structure.scale !== undefined) {
      structureGroup.scale.set(structure.scale, structure.scale, structure.scale);
    }

    // For buildings, create detailed geometry with foundation, walls, windows, and doors
    if (structureType === 'building') {
      try {
        this.createDetailedBuilding(structureGroup, structure, dimensions);
      } catch (error) {
        console.error(`[Structures] Error creating detailed building for structure ${structure.id}:`, error);
        // Fallback to simple geometry on error
        const geometry = this.createStructureGeometry(structureType, dimensions);
        const material = this.createStructureMaterial(structureType, structure);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        structureGroup.add(mesh);
      }
    } else {
      // For other structure types, use simple geometry
      const geometry = this.createStructureGeometry(structureType, dimensions);
      const material = this.createStructureMaterial(structureType, structure);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      structureGroup.add(mesh);
    }

    // Render decoration hints (vent stacks, loading docks) if present
    this.addDecorations(structureGroup, structure, dimensions);

    // Ensure every child of the group carries the structureId and structure for reliable picking/fallback
    this.setStructureIdRecursive(structureGroup, structure.id, structure);

    // Add to scene
    this.scene.add(structureGroup);
    this.structureMeshes.set(structure.id, structureGroup);

    this.lastCameraX = cameraXWrapped;
  }

  /**
   * Update structure position when camera moves (for wrapping)
   * Uses floating origin pattern to maintain precision
   * @param {THREE.Group} mesh - Structure mesh group
   * @param {Object} structure - Structure object
   * @param {number} cameraXWrapped - Wrapped camera X position
   */
  updateStructurePosition(mesh, structure, cameraXWrapped) {
    const cameraX = this.getCurrentCameraX();
    const structureOriginX = cameraX;
    
    const structureX = structure.position.x;
    const wrappedAbsolute = normalizeRelativeToCamera(structureX, cameraX);

    const earthRingPos = {
      x: wrappedAbsolute,
      y: structure.position.y,
      z: (structure.floor ?? 0) * DEFAULT_FLOOR_HEIGHT,
    };
    const threeJSPosWorld = toThreeJS(earthRingPos);
    
    // Convert structureOriginX to Three.js coordinates
    const originEarthRingPos = {
      x: structureOriginX,
      y: 0,
      z: 0,
    };
    const threeJSOrigin = toThreeJS(originEarthRingPos);
    
    // Calculate local offset in Three.js space
    const localOffset = {
      x: threeJSPosWorld.x - threeJSOrigin.x,
      y: threeJSPosWorld.y - threeJSOrigin.y,
      z: threeJSPosWorld.z - threeJSOrigin.z,
    };

    // Update floating origin position
    mesh.position.set(
      threeJSOrigin.x + localOffset.x,
      threeJSPosWorld.y,
      threeJSPosWorld.z
    );
    mesh.userData.lastCameraXUsed = cameraXWrapped;
  }

  /**
   * Get structure dimensions from properties
   * @param {Object} structure - Structure object
   * @returns {Object} Dimensions object with width, depth, height
   */
  getStructureDimensions(structure) {
    const defaults = {
      building: { width: 20, depth: 20, height: 20 },
      decoration: { width: 5, depth: 5, height: 5 },
      furniture: { width: 2, depth: 2, height: 2 },
      vehicle: { width: 4, depth: 8, height: 2 },
      road: { width: 10, depth: 0.2, height: 0.1 },
    };

    const structureType = structure.structure_type?.toLowerCase() || 'building';
    const defaultDims = defaults[structureType] || defaults.building;

    // First, try to get dimensions directly from structure.dimensions (new format)
    if (structure.dimensions && typeof structure.dimensions === 'object') {
      return {
        width: structure.dimensions.width ?? defaultDims.width,
        depth: structure.dimensions.depth ?? defaultDims.depth,
        height: structure.dimensions.height ?? defaultDims.height,
      };
    }

    // Fallback: Extract dimensions from properties JSONB (legacy format)
    if (structure.properties) {
      try {
        const props = typeof structure.properties === 'string' 
          ? JSON.parse(structure.properties) 
          : structure.properties;
        
        return {
          width: props.width ?? defaultDims.width,
          depth: props.depth ?? defaultDims.depth,
          height: props.height ?? defaultDims.height,
        };
      } catch (e) {
        // Invalid JSON, use defaults
        return defaultDims;
      }
    }

    return defaultDims;
  }

  /**
   * Create geometry for a structure based on type and dimensions
   * @param {string} structureType - Structure type
   * @param {Object} dimensions - Dimensions object with width, depth, height
   * @returns {THREE.BufferGeometry} Three.js geometry
   */
  createStructureGeometry(structureType, dimensions) {
    const { width, depth, height } = dimensions;

    switch (structureType) {
      case 'building':
        // Buildings are rectangular prisms
        return new THREE.BoxGeometry(width, height, depth);
      
      case 'decoration': {
        // Decorations can be various shapes - use cylinder for variety
        const radius = Math.min(width, depth) / 2;
        return new THREE.CylinderGeometry(radius, radius, height, 8);
      }
      
      case 'furniture':
        // Furniture items are small boxes
        return new THREE.BoxGeometry(width, height, depth);
      
      case 'vehicle':
        // Vehicles are elongated boxes
        return new THREE.BoxGeometry(width, height, depth);
      
      case 'road':
        // Roads are flat planes
        return new THREE.PlaneGeometry(width, depth);
      
      default:
        // Default to box
        return new THREE.BoxGeometry(width, height, depth);
    }
  }

  /**
   * Create material for a structure based on type
   * @param {string} structureType - Structure type
   * @param {Object} structure - Structure object (for potential custom materials)
   * @returns {THREE.Material} Three.js material
   */
  createStructureMaterial(structureType, structure) {
    const color = this.getStructureColor(structureType);
    
    // Check for custom material properties
    let metalness = 0.3;
    let roughness = 0.7;
    
    if (structure.properties) {
      try {
        const props = typeof structure.properties === 'string' 
          ? JSON.parse(structure.properties) 
          : structure.properties;
        
        if (props.metalness !== undefined) metalness = props.metalness;
        if (props.roughness !== undefined) roughness = props.roughness;
        if (props.color !== undefined) {
          // Support hex color strings or numbers
          if (typeof props.color === 'string') {
            return new THREE.MeshStandardMaterial({
              color: parseInt(props.color.replace('#', ''), 16),
              metalness,
              roughness,
            });
          }
        }
      } catch (e) {
        // Invalid JSON, use defaults
      }
    }

    return new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      opacity: 1.0,
      transparent: false,
    });
  }

  /**
   * Create detailed building with foundation, walls, windows, and doors
   * @param {THREE.Group} structureGroup - Group to add building components to
   * @param {Object} structure - Structure object
   * @param {Object} dimensions - Dimensions object with width, depth, height
   */
  createDetailedBuilding(structureGroup, structure, dimensions) {
    const { width, depth, height } = dimensions;
    const buildingSubtype = structure.building_subtype || 'default';
    const decorations = structure.decorations || structure.model_data?.decorations || [];
    
    // Extract windows from structure - check multiple possible locations
    let windows = [];
    if (structure.windows) {
      windows = Array.isArray(structure.windows) ? structure.windows : [];
    } else if (structure.properties && typeof structure.properties === 'object') {
      // Windows might be in properties
      if (structure.properties.windows && Array.isArray(structure.properties.windows)) {
        windows = structure.properties.windows;
      }
    }
    
    // Extract colors from structure properties if available
    let colors = null;
    let cornerTrimWidth = 0.02; // Default: 2% of facade width (fallback)
    if (structure.properties && typeof structure.properties === 'object') {
      if (structure.properties.colors && typeof structure.properties.colors === 'object') {
        colors = structure.properties.colors;
      }
      // Extract corner trim width if available (in meters, 0.1 to 0.5)
      if (structure.properties.corner_trim_width !== undefined) {
        cornerTrimWidth = structure.properties.corner_trim_width;
      }
    }
    
    // Foundation: Concrete base (bottom 0.5m or 10% of height, whichever is smaller)
    const foundationHeight = Math.min(0.5, height * 0.1);
    const buildingHeight = height - foundationHeight;
    
    // Foundation is now rendered as part of the wall shader - no separate mesh needed
    
    // Building walls: Material based on subtype, but override with colors if available
    const wallMaterial = this.getBuildingWallMaterial(buildingSubtype, colors);
    
    // Colors are already handled in getBuildingWallMaterial if colors are provided
    // No need to override here - the function returns the appropriate format
    
    // Create main building structure (hollow box for walls)
    // We'll create the walls by creating individual faces with windows cut out
    const wallThickness = 0.2; // 20cm thick walls
    
    // Extract wall material properties (handle both Material objects and color info objects)
    let wallColor, wallRoughness, wallMetalness;
    if (wallMaterial instanceof THREE.Material) {
      // It's a THREE.Material object
      wallColor = wallMaterial.color ? wallMaterial.color.getHex() : 0xaaaaaa;
      wallRoughness = wallMaterial.roughness !== undefined ? wallMaterial.roughness : 0.7;
      wallMetalness = wallMaterial.metalness !== undefined ? wallMaterial.metalness : 0.2;
    } else {
      // It's a plain object with color info
      wallColor = wallMaterial.color !== undefined ? wallMaterial.color : 0xaaaaaa;
      wallRoughness = wallMaterial.roughness !== undefined ? wallMaterial.roughness : 0.7;
      wallMetalness = wallMaterial.metalness !== undefined ? wallMaterial.metalness : 0.2;
    }
    
    // Extract door information from structure
    // Doors may be at top level, or inside model_data (if loaded from database)
    let doors = structure.doors || {};  // Dictionary mapping facade to door info
    let garageDoors = structure.garage_doors || [];  // List of garage door dictionaries
    
    // If doors not found at top level, try extracting from model_data
    if ((!doors || Object.keys(doors).length === 0) && (!garageDoors || garageDoors.length === 0)) {
      if (structure.model_data) {
        let modelData = structure.model_data;
        // Parse model_data if it's a string
        if (typeof modelData === 'string') {
          try {
            modelData = JSON.parse(modelData);
          } catch (e) {
            console.warn(`[Structures] Failed to parse model_data for structure ${structure.id}:`, e);
          }
        }
        // Extract doors from model_data if present
        if (modelData && typeof modelData === 'object') {
          if (modelData.doors && (!doors || Object.keys(doors).length === 0)) {
            doors = modelData.doors;
          }
          if (modelData.garage_doors && (!garageDoors || garageDoors.length === 0)) {
            garageDoors = modelData.garage_doors;
          }
        }
      }
      // Also check properties for doors (backwards compatibility)
      if (structure.properties) {
        let properties = structure.properties;
        if (typeof properties === 'string') {
          try {
            properties = JSON.parse(properties);
          } catch (e) {
            // Ignore parse errors
          }
        }
        if (properties && typeof properties === 'object') {
          if (properties.doors && (!doors || Object.keys(doors).length === 0)) {
            doors = properties.doors;
          }
          if (properties.garage_doors && (!garageDoors || garageDoors.length === 0)) {
            garageDoors = properties.garage_doors;
          }
        }
      }
    }
    
    // Debug: Log door data for first building (to verify doors are being loaded)
    if (structure.id && typeof structure.id === 'string' && structure.id.includes('proc_') && Object.keys(doors).length === 0 && garageDoors.length === 0) {
      console.warn(`[Structures] No doors found for structure ${structure.id}:`, { 
        doors, 
        garage_doors: garageDoors, 
        has_doors_key: 'doors' in structure, 
        has_garage_doors_key: 'garage_doors' in structure,
        has_model_data: !!structure.model_data,
        model_data_type: typeof structure.model_data,
        has_properties: !!structure.properties
      });
    }
    
    // Helper function to get door info for a facade (includes both regular doors, utility doors, and garage doors)
    // Returns an array of doors (can have multiple doors side-by-side)
    const getDoorInfoForFacade = (facade) => {
      const doorInfo = doors[facade];
      const facadeGarageDoors = garageDoors.filter(gd => gd.facade === facade);
      
      const doorArray = [];
      
      // Add regular doors and utility doors if they exist
      // doorInfo can be a single door object or a list of doors (if multiple utility doors on same facade)
      if (doorInfo) {
        if (Array.isArray(doorInfo)) {
          // Multiple doors on this facade (e.g., regular door + utility doors)
          doorInfo.forEach(door => {
            // Map industrial_main to 'utility' so the shader pairing logic picks it up
            const type =
              door.type === 'industrial_main'
                ? 'utility'
                : (door.type || 'main');
            doorArray.push({
              type,
              x: door.x || 0,
              y: door.y || 0,
              width: door.width || 0.9,
              height: door.height || 2.1,
            });
          });
        } else {
          // Single door on this facade
          const type =
            doorInfo.type === 'industrial_main'
              ? 'utility'
              : (doorInfo.type || 'main');
          doorArray.push({
            type,
            x: doorInfo.x || 0,
            y: doorInfo.y || 0,
            width: doorInfo.width || 0.9,
            height: doorInfo.height || 2.1,
          });
        }
      }
      
      // Add all garage/truck bay doors on this facade
      facadeGarageDoors.forEach(gd => {
        doorArray.push({
          type: gd.type || 'garage',  // Preserve door type (garage, truck_bay, etc.)
          x: gd.x || 0,
          y: gd.y || 0,
          width: gd.width || 3.0,
          height: gd.height || 3.5,
        });
      });
      
      return doorArray.length > 0 ? doorArray : null;
    };
    
    // Wall height includes foundation - extends from ground (0) to foundationHeight + buildingHeight
    const totalWallHeight = foundationHeight + buildingHeight;
    
    // Collect wall geometry definitions for merging
    const wallDefinitions = [];
    
    const frontBands = this.buildBandRects(structure, decorations, 'front', width, depth, foundationHeight, buildingHeight);
    const backBands = this.buildBandRects(structure, decorations, 'back', width, depth, foundationHeight, buildingHeight);
    const leftBands = this.buildBandRects(structure, decorations, 'left', depth, width, foundationHeight, buildingHeight);
    const rightBands = this.buildBandRects(structure, decorations, 'right', depth, width, foundationHeight, buildingHeight);

    // Front wall (positive Y) - with shader-based windows, doors, bands, and trim
    const frontDoor = getDoorInfoForFacade('front');
    wallDefinitions.push(this.createWallGeometryDefinition(
      width, 
      totalWallHeight, // Wall extends from ground to top
      wallThickness,
      [0, totalWallHeight / 2, depth / 2], // Position at center of total height (starts at ground)
      [0, 0, 0], // Rotation
      windows.filter(w => w.facade === 'front'),
      { color: wallColor, roughness: wallRoughness, metalness: wallMetalness },
      dimensions,
      foundationHeight,
      buildingHeight,
      buildingSubtype,
      'front',
      colors,
      frontDoor,
      cornerTrimWidth,
      frontBands.bandRects,
      frontBands.bandCount
    ));
    
    // Back wall (negative Y) - with shader-based windows and trim
    const backDoor = getDoorInfoForFacade('back');
    wallDefinitions.push(this.createWallGeometryDefinition(
      width,
      totalWallHeight, // Wall extends from ground to top
      wallThickness,
      [0, totalWallHeight / 2, -depth / 2],
      [0, Math.PI, 0],
      windows.filter(w => w.facade === 'back'),
      { color: wallColor, roughness: wallRoughness, metalness: wallMetalness },
      dimensions,
      foundationHeight,
      buildingHeight,
      buildingSubtype,
      'back',
      colors,
      backDoor,
      cornerTrimWidth,
      backBands.bandRects,
      backBands.bandCount
    ));
    
    // Left wall (negative X) - with shader-based rendering (includes trim)
    const leftDoor = getDoorInfoForFacade('left');
    wallDefinitions.push(this.createWallGeometryDefinition(
      depth,
      totalWallHeight, // Wall extends from ground to top
      wallThickness,
      [-width / 2, totalWallHeight / 2, 0],
      [0, Math.PI / 2, 0],
      windows.filter(w => w.facade === 'left'),
      { color: wallColor, roughness: wallRoughness, metalness: wallMetalness },
      dimensions,
      foundationHeight,
      buildingHeight,
      buildingSubtype,
      'left',
      colors,
      leftDoor,
      cornerTrimWidth,
      leftBands.bandRects,
      leftBands.bandCount
    ));
    
    // Right wall (positive X) - with shader-based rendering (includes trim)
    const rightDoor = getDoorInfoForFacade('right');
    wallDefinitions.push(this.createWallGeometryDefinition(
      depth,
      totalWallHeight, // Wall extends from ground to top
      wallThickness,
      [width / 2, totalWallHeight / 2, 0],
      [0, -Math.PI / 2, 0],
      windows.filter(w => w.facade === 'right'),
      { color: wallColor, roughness: wallRoughness, metalness: wallMetalness },
      dimensions,
      foundationHeight,
      buildingHeight,
      buildingSubtype,
      'right',
      colors,
      rightDoor,
      cornerTrimWidth,
      rightBands.bandRects,
      rightBands.bandCount
    ));
    
    // Merge all wall geometries
    const geometriesToMerge = wallDefinitions.map(wallDef => ({
      geometry: wallDef.geometry,
      position: wallDef.position,
      rotation: wallDef.rotation,
    }));
    
    const mergedWallGeometry = this.mergeBoxGeometries(geometriesToMerge);
    
    // Create geometry groups for material assignment
    // Each wall gets its own material group
    // BoxGeometry has 6 faces × 2 triangles × 3 indices = 36 indices per box
    const indicesPerWall = 36;
    const totalIndices = mergedWallGeometry.index ? mergedWallGeometry.index.count : 0;
    
    // Verify we have the expected number of indices (4 walls × 36 indices = 144)
    if (totalIndices !== indicesPerWall * 4) {
      console.warn(`[Structures] Unexpected index count in merged geometry: ${totalIndices} (expected ${indicesPerWall * 4})`);
    }
    
    // Create groups for each wall facade
    mergedWallGeometry.groups = [
      { start: 0, count: indicesPerWall, materialIndex: 0 },                    // Front
      { start: indicesPerWall, count: indicesPerWall, materialIndex: 1 },        // Back
      { start: indicesPerWall * 2, count: indicesPerWall, materialIndex: 2 },    // Left
      { start: indicesPerWall * 3, count: indicesPerWall, materialIndex: 3 },    // Right
    ];
    
    // Create material array for each facade (matching the order of wallDefinitions)
    const wallMaterials = [
      wallDefinitions[0].material,  // Front
      wallDefinitions[1].material,  // Back
      wallDefinitions[2].material,  // Left
      wallDefinitions[3].material,  // Right
    ];
    
    // Create merged wall mesh
    const mergedWallMesh = new THREE.Mesh(mergedWallGeometry, wallMaterials);
    mergedWallMesh.castShadow = false;
    mergedWallMesh.receiveShadow = false;
    structureGroup.add(mergedWallMesh);
    
    // Roof - use color from palette if available
    const roofColorHex = colors?.roofs?.hex ? colors.roofs.hex : '#4a4a4a';
    const roofColor = typeof roofColorHex === 'string' ? parseInt(roofColorHex.replace('#', ''), 16) : roofColorHex;
    const roofMaterialKey = `roof_${roofColor}`;
    const roofMaterial = this.getCachedMaterial(roofMaterialKey, () =>
      new THREE.MeshStandardMaterial({
        color: roofColor,
        roughness: 0.8,
        metalness: 0.2,
        opacity: 1.0,
        transparent: false,
      })
    );
    const roofGeometry = new THREE.BoxGeometry(width + wallThickness * 2, 0.1, depth + wallThickness * 2);
    const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
    // Roof positioned at top of total wall height (foundation + building)
    roofMesh.position.y = totalWallHeight;
    roofMesh.castShadow = false; // Disabled for performance
    roofMesh.receiveShadow = false; // Disabled for performance
    structureGroup.add(roofMesh);
    
    // Doors, windows, trim, and foundations are now rendered in shaders - no separate meshes needed
  }
  
  /**
   * Create a wall mesh
   * @param {THREE.Group} group - Group to add wall to
   * @param {number} width - Wall width
   * @param {number} height - Wall height
   * @param {number} thickness - Wall thickness
   * @param {Array<number>} position - [x, y, z] position
   * @param {Array<number>} rotation - [x, y, z] rotation in radians
   * @param {THREE.Material} material - Wall material
   */
  createWall(group, width, height, thickness, position, rotation, material) {
    // PERFORMANCE: Disable shadows on walls for better performance
    // Shadows are expensive and buildings are close together
    const geometry = new THREE.BoxGeometry(width, height, thickness);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = false; // Disabled for performance
    mesh.receiveShadow = false; // Disabled for performance
    group.add(mesh);
  }
  
  /**
   * Create wall geometry and material definition (for merging)
   * Returns geometry definition and shader material instead of creating a mesh
   * @param {number} width - Wall width
   * @param {number} height - Wall height
   * @param {number} thickness - Wall thickness
   * @param {Array<number>} position - [x, y, z] position
   * @param {Array<number>} rotation - [x, y, z] rotation
   * @param {Array} windows - Array of window objects for this facade
   * @param {THREE.Material} baseMaterial - Base wall material properties
   * @param {Object} dimensions - Building dimensions
   * @param {number} foundationHeight - Foundation height offset
   * @param {number} buildingHeight - Building height above foundation
   * @param {string} buildingSubtype - Building subtype
   * @param {string} facade - Facade identifier (front, back, left, right)
   * @param {Object} colors - Color palette
   * @param {Array} doorInfo - Door information array
   * @param {number} cornerTrimWidth - Corner trim width
   * @returns {Object} Object with {geometry, material, facade}
   */
  createWallGeometryDefinition(width, height, thickness, position, rotation, windows, baseMaterial, dimensions, foundationHeight, buildingHeight, buildingSubtype = null, facade = 'front', colors = null, doorInfo = null, cornerTrimWidth = 0.02, bandRects = [], bandCount = 0) {
    // Convert windows to shader-compatible format
    // Limit to 50 windows per wall for shader uniforms
    const MAX_WINDOWS = 50;
    const wallWindows = (windows || []).slice(0, MAX_WINDOWS);
    
    // Prepare window data for shader
    // Each window: [centerX (relative to wall, -0.5 to 0.5), centerY (relative, -0.5 to 0.5), width (normalized), height (normalized)]
    const windowData = new Float32Array(MAX_WINDOWS * 4); // 4 floats per window
    const windowCount = wallWindows.length;
    
    // Wall extends from 0 (ground) to totalWallHeight (foundationHeight + buildingHeight)
    const totalWallHeight = foundationHeight + buildingHeight;
    const wallCenterY = totalWallHeight / 2;
    const foundationHeightNormalized = foundationHeight / totalWallHeight; // Calculate early for door positioning
    
    // Calculate building center Y for window positioning (windows are in the building portion, above foundation)
    const buildingCenterY = foundationHeight + buildingHeight / 2;
    
    wallWindows.forEach((window, index) => {
      if (!window.position || !window.size) return;
      
      const [winX, winY, winZ] = window.position;
      const [winWidth, winHeight] = window.size;
      
      // Convert window position to wall-local coordinates (normalized -0.5 to 0.5)
      // winX is horizontal along building width -> normalized to wall X (-width/2 to +width/2 -> -0.5 to 0.5)
      const normalizedX = (winX / width);
      
      // winZ is vertical offset from building center -> convert to wall Y
      const windowYWorld = buildingCenterY + winZ; // Absolute Y position
      // Wall now extends from 0 to totalWallHeight, normalize to -0.5 to 0.5 relative to wall center
      const normalizedY = ((windowYWorld - wallCenterY) / totalWallHeight);
      
      // Normalize window size
      const normalizedWidth = winWidth / width;
      const normalizedHeight = winHeight / totalWallHeight;
      
      const idx = index * 4;
      windowData[idx] = normalizedX;
      windowData[idx + 1] = normalizedY;
      windowData[idx + 2] = normalizedWidth;
      windowData[idx + 3] = normalizedHeight;
    });
    
    // Door data: pack up to MAX_DOORS for shader (front facade only for now)
    const MAX_DOORS = 6;
    const doorRects = [];
    let doorCount = 0;
    if (facade === 'front' && doorInfo && Array.isArray(doorInfo) && doorInfo.length > 0) {
      doorInfo.slice(0, MAX_DOORS).forEach((d) => {
        if (
          typeof d.x === 'number' &&
          typeof d.y === 'number' &&
          typeof d.width === 'number' &&
          typeof d.height === 'number'
        ) {
          const doorYWorld = wallCenterY + d.y;
          let dx = d.x / width;
          let dy = (doorYWorld - wallCenterY) / totalWallHeight;
          let dw = d.width / width;
          let dh = d.height / totalWallHeight;
          // Ensure bottoms not below foundation
        const foundationTopNormalized = -0.5 + foundationHeightNormalized;
          const doorBottomNormalized = dy - dh / 2;
          if (doorBottomNormalized < foundationTopNormalized) {
            dy = foundationTopNormalized + dh / 2;
          }
          doorRects.push(new THREE.Vector4(dx, dy, dw, dh));
          doorCount++;
        }
      });
    }
    // Pad to MAX_DOORS with zero vectors for stable uniform array length
    while (doorRects.length < MAX_DOORS) {
      doorRects.push(new THREE.Vector4(0, 0, 0, 0));
    }
    
    // Create shader material with window, door, trim, and foundation rendering
    // Normalize corner trim width to ratio of wall width for shader
    const cornerTrimWidthNormalized = cornerTrimWidth / width;
    // foundationHeightNormalized already calculated above for door positioning
    const wallShaderMaterial = this.createWallShaderMaterial(
      baseMaterial, 
      windowData, 
      windowCount, 
      width, 
      totalWallHeight, // Pass total wall height (includes foundation)
      doorRects,
      doorCount,
      bandRects,
      bandCount,
      buildingSubtype,
      colors,
      cornerTrimWidthNormalized,
      foundationHeightNormalized
    );
    
    // Create wall geometry
    const geometry = new THREE.BoxGeometry(width, height, thickness);
    
    // Return geometry definition instead of creating mesh
    return {
      geometry,
      material: wallShaderMaterial,
      position,
      rotation,
      facade,
    };
  }

  /**
   * Create wall with windows using shader-based rendering (legacy method - creates mesh directly)
   * @param {THREE.Group} group - Group to add wall to
   * @param {number} width - Wall width
   * @param {number} height - Wall height
   * @param {number} thickness - Wall thickness
   * @param {Array<number>} position - [x, y, z] position
   * @param {Array<number>} rotation - [x, y, z] rotation
   * @param {Array} windows - Array of window objects for this facade
   * @param {THREE.Material} baseMaterial - Base wall material properties
   * @param {Object} dimensions - Building dimensions
   * @param {number} foundationHeight - Foundation height offset
   * @param {number} buildingHeight - Building height above foundation
   */
  createWallWithWindows(group, width, height, thickness, position, rotation, windows, baseMaterial, dimensions, foundationHeight, buildingHeight, buildingSubtype = null, facade = 'front', colors = null, doorInfo = null, cornerTrimWidth = 0.02) {
    // Get geometry definition
    const wallDef = this.createWallGeometryDefinition(
      width, height, thickness, position, rotation, windows, baseMaterial,
      dimensions, foundationHeight, buildingHeight, buildingSubtype, facade,
      colors, doorInfo, cornerTrimWidth
    );
    
    // Create mesh and add to group
    const mesh = new THREE.Mesh(wallDef.geometry, wallDef.material);
    mesh.position.set(...wallDef.position);
    mesh.rotation.set(...wallDef.rotation);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  
  /**
   * Create shader material for walls with procedurally rendered windows, doors, trim, and foundation details
   * @param {Object} baseMaterialProps - Base material properties (color, roughness, metalness)
   * @param {Float32Array} windowData - Window data array (4 floats per window: x, y, width, height)
   * @param {number} windowCount - Number of windows
   * @param {number} wallWidth - Wall width in meters
   * @param {number} wallHeight - Wall height in meters
   * @param {Array<THREE.Vector4>} doorRects - Packed doors (x,y,w,h normalized), front facade
   * @param {number} doorCount - Number of packed doors
   * @param {string} buildingSubtype - Building subtype for material variation
   * @returns {THREE.ShaderMaterial} Shader material with window, door, trim, and foundation rendering
   */
  createWallShaderMaterial(baseMaterialProps, windowData, windowCount, wallWidth, wallHeight, doorRects = [], doorCount = 0, bandRects = [], bandCount = 0, buildingSubtype = null, colors = null, cornerTrimWidthNormalized = 0.02, foundationHeightNormalized = 0.05) {
    // Helper function to convert hex color to RGB vec3
    const hexToRgb = (hex) => {
      if (!hex || typeof hex === 'number') return null;
      const cleaned = hex.replace('#', '');
      const r = parseInt(cleaned.substring(0, 2), 16) / 255.0;
      const g = parseInt(cleaned.substring(2, 4), 16) / 255.0;
      const b = parseInt(cleaned.substring(4, 6), 16) / 255.0;
      return { r, g, b };
    };
    
    // Extract colors from palette or use defaults
    const frameColorDefault = { r: 0.16, g: 0.16, b: 0.16 }; // #2a2a2a
    const glassColorDefault = { r: 0.53, g: 0.81, b: 0.92 }; // #87ceeb
    const doorColorDefault = { r: 0.29, g: 0.23, b: 0.16 }; // #4a3a2a
    const foundationColorDefault = { r: 0.5, g: 0.5, b: 0.5 }; // Concrete gray
    const trimColorDefault = { r: 0.7, g: 0.7, b: 0.7 }; // Light gray
    
    const frameColorValue = colors?.trim?.hex ? hexToRgb(colors.trim.hex) : frameColorDefault;
    const glassColorValue = colors?.windows_doors?.hex ? hexToRgb(colors.windows_doors.hex) : glassColorDefault;
    const doorColorValue = colors?.windows_doors?.hex ? hexToRgb(colors.windows_doors.hex) : doorColorDefault;
    const foundationColorValue = colors?.foundation?.hex ? hexToRgb(colors.foundation.hex) : foundationColorDefault;
    const trimColorValue = colors?.trim?.hex ? hexToRgb(colors.trim.hex) : trimColorDefault;
    
    const vertexShader = `
      varying vec2 vUv;
      
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    
    const fragmentShader = `
      uniform vec3 baseColor;
      uniform float roughness;
      uniform float metalness;
      uniform float windowCount;
      uniform sampler2D windowDataTexture;
      uniform float textureWidth;
      uniform int doorCount;
      uniform vec4 doorRects[6]; // x,y,w,h normalized
      uniform int bandCount;
      uniform vec4 bandRects[8]; // x,y,w,h normalized
      
      varying vec2 vUv;
      
      uniform vec3 frameColorUniform;
      uniform vec3 glassColorUniform;
      uniform vec3 doorColorUniform;
      uniform vec3 foundationColorUniform;
      uniform vec3 trimColorUniform;
      uniform float cornerTrimWidthUniform;
      uniform float foundationHeightNormalizedUniform;
      
      // Frame/trim thickness relative to wall size
      const float frameThickness = 0.015; // 1.5% of window/door size
      
      // Sample window data from texture
      // Each window takes one pixel: R=x, G=y, B=width, A=height (normalized coordinates)
      vec4 getWindowData(int index) {
        float xCoord = (float(index) + 0.5) / textureWidth;
        return texture2D(windowDataTexture, vec2(xCoord, 0.5));
      }
      
      // Check if point is inside a window
      vec4 checkWindows(vec2 uv) {
        // Convert UV (0-1) to normalized coordinates (-0.5 to 0.5)
        vec2 normalizedPos = (uv - 0.5) * vec2(1.0, 1.0);
        
        int maxIdx = int(windowCount);
        for (int i = 0; i < 50; i++) {
          if (i >= maxIdx) break;
          
          vec4 winData = getWindowData(i);
          float winX = winData.x;
          float winY = winData.y;
          float winWidth = winData.z;
          float winHeight = winData.w;
          
          // Skip invalid windows (zero width/height)
          if (winWidth <= 0.0 || winHeight <= 0.0) continue;
          
          // Calculate window bounds in normalized space (-0.5 to 0.5)
          vec2 winMin = vec2(winX - winWidth * 0.5, winY - winHeight * 0.5);
          vec2 winMax = vec2(winX + winWidth * 0.5, winY + winHeight * 0.5);
          
          // Check if point is inside window bounds
          if (normalizedPos.x >= winMin.x && normalizedPos.x <= winMax.x &&
              normalizedPos.y >= winMin.y && normalizedPos.y <= winMax.y) {
            
            // Calculate normalized distance from window edge (0 at edge, 0.5 at center)
            vec2 distFromEdge = min(normalizedPos - winMin, winMax - normalizedPos);
            float distX = distFromEdge.x / winWidth;
            float distY = distFromEdge.y / winHeight;
            float minDist = min(distX, distY);
            
            // Check if in frame area (within frameThickness of edge)
            if (minDist < frameThickness) {
              return vec4(frameColorUniform, 1.0); // Frame (opaque)
            } else {
              // Glass area - less transparent with slight reflection
              // Increased opacity from 0.3 to 0.65 for better visibility
              // Add slight reflective tint for glass appearance
              vec3 glassTint = glassColorUniform * 1.2; // Slightly brighter for reflection
              return vec4(glassTint, 0.65); // Glass (less transparent, more visible)
            }
          }
        }
        
        return vec4(0.0); // Not a window
      }
      
      // Check if point is in any door area (supports multiple doors)
      vec4 checkDoor(vec2 uv) {
        if (doorCount <= 0) return vec4(0.0);
        
        vec2 normalizedPos = (uv - 0.5);
        for (int i = 0; i < 6; i++) {
          if (i >= doorCount) break;
          vec4 dr = doorRects[i];
          float dx = dr.x;
          float dy = dr.y;
          float dw = dr.z;
          float dh = dr.w;
          if (dw <= 0.0 || dh <= 0.0) continue;
          
          vec2 doorMin = vec2(dx - dw * 0.5, dy - dh * 0.5);
          vec2 doorMax = vec2(dx + dw * 0.5, dy + dh * 0.5);
        
        if (normalizedPos.x >= doorMin.x && normalizedPos.x <= doorMax.x &&
            normalizedPos.y >= doorMin.y && normalizedPos.y <= doorMax.y) {
          
          vec2 distFromEdge = min(normalizedPos - doorMin, doorMax - normalizedPos);
            float distX = distFromEdge.x / dw;
            float distY = distFromEdge.y / dh;
          float minDist = min(distX, distY);
          
            float doorFrameThickness = frameThickness * 1.2;
        
            if (minDist < doorFrameThickness) {
            return vec4(frameColorUniform, 1.0); // Door frame
          } else {
              vec3 doorPanelColor = doorColorUniform * 0.9;
              return vec4(doorPanelColor, 1.0); // Door panel
            }
          }
        }
        
        return vec4(0.0); // Not a door
      }

      // Check if point is in any band area (utility bands)
      vec4 checkBand(vec2 uv) {
        if (bandCount <= 0) return vec4(0.0);
        vec2 normalizedPos = (uv - 0.5);
        for (int i = 0; i < 8; i++) {
          if (i >= bandCount) break;
          vec4 br = bandRects[i];
          float bx = br.x;
          float by = br.y;
          float bw = br.z;
          float bh = br.w;
          if (bw <= 0.0 || bh <= 0.0) continue;

          vec2 bandMin = vec2(bx - bw * 0.5, by - bh * 0.5);
          vec2 bandMax = vec2(bx + bw * 0.5, by + bh * 0.5);

          if (normalizedPos.x >= bandMin.x && normalizedPos.x <= bandMax.x &&
              normalizedPos.y >= bandMin.y && normalizedPos.y <= bandMax.y) {
            // Use trim color for bands
            return vec4(trimColorUniform, 1.0);
          }
        }
        return vec4(0.0);
      }
      
      // Check for corner trim (vertical edges)
      vec3 checkCornerTrim(vec2 uv) {
        vec2 normalizedPos = (uv - 0.5);
        
        // Left edge trim (using uniform variable corner trim width)
        if (normalizedPos.x < -0.5 + cornerTrimWidthUniform) {
          return trimColorUniform;
        }
        // Right edge trim
        if (normalizedPos.x > 0.5 - cornerTrimWidthUniform) {
          return trimColorUniform;
        }
        
        return vec3(0.0); // No trim
      }
      
      // Check for foundation strip at bottom
      vec3 checkFoundation(vec2 uv) {
        vec2 normalizedPos = (uv - 0.5);
        
        // Foundation at very bottom of wall (no offset, starts at ground level)
        float foundationBottom = -0.5;
        float foundationTop = -0.5 + foundationHeightNormalizedUniform;
        
        if (normalizedPos.y >= foundationBottom && normalizedPos.y <= foundationTop) {
          return foundationColorUniform;
        }
        
        return vec3(0.0); // Not foundation
      }
      
      void main() {
        // Base wall color
        vec3 color = baseColor;
        float alpha = 1.0;
        
        // Check for foundation first (drawn at bottom)
        vec3 foundationResult = checkFoundation(vUv);
        if (foundationResult.r > 0.0 || foundationResult.g > 0.0 || foundationResult.b > 0.0) {
          color = foundationResult;
        } else {
          // Check for windows
          vec4 windowResult = checkWindows(vUv);
          
          if (windowResult.a > 0.0) {
            // We're in a window area
            if (windowResult.a < 1.0) {
              // Glass - blend with wall color for depth
              color = mix(baseColor * 0.3, windowResult.rgb, 0.8);
              alpha = windowResult.a;
            } else {
              // Frame - use frame color
              color = windowResult.rgb;
              alpha = 1.0;
            }
          } else {
            // Check for doors (only if not a window)
            vec4 doorResult = checkDoor(vUv);
            if (doorResult.a > 0.0) {
              color = doorResult.rgb;
              alpha = doorResult.a;
            } else {
              // Check for bands
              vec4 bandResult = checkBand(vUv);
              if (bandResult.a > 0.0) {
                color = bandResult.rgb;
                alpha = bandResult.a;
              } else {
                // Check for corner trim
                vec3 trimResult = checkCornerTrim(vUv);
                if (trimResult.r > 0.0 || trimResult.g > 0.0 || trimResult.b > 0.0) {
                  // Blend trim with base color for subtle effect
                  color = mix(baseColor, trimResult, 0.3);
                }
              }
            }
          }
        }
        
        gl_FragColor = vec4(color, alpha);
      }
    `;
    
    // Create data texture from window data
    // Pack window data into a 1D texture: each window = 1 pixel (R=x, G=y, B=width, A=height)
    // Use normalized coordinates: x, y in range [-0.5, 0.5], width/height in range [0, 1]
    const textureWidth = Math.max(1, windowCount); // 1 pixel per window
    const textureHeight = 1;
    const textureData = new Float32Array(textureWidth * 4); // 4 floats per pixel (RGBA)
    
    for (let i = 0; i < windowCount; i++) {
      const dataIdx = i * 4;
      const texIdx = i * 4;
      
      // Store window data: x, y (normalized -0.5 to 0.5), width, height (normalized 0 to 1)
      textureData[texIdx] = windowData[dataIdx] || 0;     // x
      textureData[texIdx + 1] = windowData[dataIdx + 1] || 0; // y
      textureData[texIdx + 2] = windowData[dataIdx + 2] || 0; // width
      textureData[texIdx + 3] = windowData[dataIdx + 3] || 0; // height
    }
    
    const windowDataTexture = new THREE.DataTexture(
      textureData,
      textureWidth,
      textureHeight,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    windowDataTexture.needsUpdate = true;
    
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        baseColor: { value: new THREE.Color(
          colors?.walls?.hex ? parseInt(colors.walls.hex.replace('#', ''), 16) : (baseMaterialProps.color || 0xaaaaaa)
        ) },
        roughness: { value: baseMaterialProps.roughness || 0.7 },
        metalness: { value: baseMaterialProps.metalness || 0.2 },
        windowCount: { value: windowCount },
        windowDataTexture: { value: windowDataTexture },
        textureWidth: { value: textureWidth },
        doorCount: { value: doorCount },
        doorRects: { value: doorRects },
        bandCount: { value: bandCount },
        bandRects: { value: bandRects },
        frameColorUniform: { value: new THREE.Vector3(frameColorValue.r, frameColorValue.g, frameColorValue.b) },
        glassColorUniform: { value: new THREE.Vector3(glassColorValue.r, glassColorValue.g, glassColorValue.b) },
        doorColorUniform: { value: new THREE.Vector3(doorColorValue.r, doorColorValue.g, doorColorValue.b) },
        foundationColorUniform: { value: new THREE.Vector3(foundationColorValue.r, foundationColorValue.g, foundationColorValue.b) },
        trimColorUniform: { value: new THREE.Vector3(trimColorValue.r, trimColorValue.g, trimColorValue.b) },
        cornerTrimWidthUniform: { value: cornerTrimWidthNormalized },
        foundationHeightNormalizedUniform: { value: foundationHeightNormalized },
      },
      transparent: windowCount > 0, // Transparent if windows present (for glass)
      side: THREE.FrontSide,
    });
    
    return material;
  }
  
  /**
   * Get wall material based on building subtype, optionally using colors from palette
   * @param {string} buildingSubtype - Building subtype
   * @param {Object|null} colors - Optional color palette object with foundation, walls, roofs, windows_doors, trim
   * @returns {THREE.Material|Object} Material for walls (or color info object if colors provided)
   */
  getBuildingWallMaterial(buildingSubtype, colors = null) {
    // If colors are provided from palette, use them instead of subtype defaults
    if (colors && colors.walls) {
      const wallHex = colors.walls.hex || colors.walls;
      const colorValue = typeof wallHex === 'string' ? parseInt(wallHex.replace('#', ''), 16) : wallHex;
      // Return color info object instead of material for use in shader
      return {
        color: colorValue,
        roughness: 0.7, // Default roughness, can be adjusted per zone type
        metalness: 0.2, // Default metalness, can be adjusted per zone type
      };
    }
    
    // Fall back to subtype-based materials
    const materialKey = `wall_${buildingSubtype || 'default'}`;
    return this.getCachedMaterial(materialKey, () => {
      let color, roughness, metalness;
      
      switch (buildingSubtype) {
        case 'retail':
        case 'mixed_use':
          // Commercial: Glass and metal
          color = 0xa0c0d0; // Light blue-gray (glass)
          roughness = 0.1;
          metalness = 0.8;
          break;
        case 'factory':
        case 'warehouse':
        case 'agri_industrial':
          // Industrial: Metal panels
          color = 0x808080; // Metal gray
          roughness = 0.3;
          metalness = 0.7;
          break;
        case 'residence':
        default:
          // Residential: Concrete/brick
          color = 0xaaaaaa; // Light gray
          roughness = 0.7;
          metalness = 0.2;
          break;
      }
      
      return new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        opacity: 1.0,
        transparent: false,
      });
    });
  }
  
  /**
   * Create door for building
   * @param {THREE.Group} group - Group to add door to
   * @param {number} width - Building width
   * @param {number} depth - Building depth
   * @param {number} foundationHeight - Foundation height
   * @param {number} buildingHeight - Building height above foundation
   * @param {string} buildingSubtype - Building subtype
   */
  createDoor(group, width, depth, foundationHeight, buildingHeight, buildingSubtype) {
    const doorWidth = 0.9; // 90cm wide door
    const doorHeight = 2.1; // 210cm tall door
    
    // Door material (dark brown wood or metal) - cached
    const isIndustrial = buildingSubtype === 'factory' || buildingSubtype === 'warehouse';
    const doorMaterialKey = `door_${isIndustrial ? 'industrial' : 'residential'}`;
    const doorMaterial = this.getCachedMaterial(doorMaterialKey, () => {
      const doorColor = isIndustrial ? 0x505050 : 0x4a3a2a; // Dark metal or brown wood
      return new THREE.MeshStandardMaterial({
        color: doorColor,
        roughness: 0.8,
        metalness: isIndustrial ? 0.6 : 0.1,
        opacity: 1.0,
        transparent: false,
      });
    });
    
    const doorGeometry = new THREE.BoxGeometry(doorWidth, doorHeight, 0.15);
    const doorMesh = new THREE.Mesh(doorGeometry, doorMaterial);
    
    // Position door on front facade, centered, at foundation level
    doorMesh.position.set(
      0, // Centered horizontally
      foundationHeight + doorHeight / 2, // At foundation level
      depth / 2 + 0.1 // Slightly in front of wall
    );
    
    doorMesh.castShadow = false; // Disabled for performance
    doorMesh.receiveShadow = false; // Disabled for performance
    group.add(doorMesh);
    
    // Door frame - cached material
    const frameMaterial = this.getCachedMaterial('door_frame', () =>
      new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, // Dark frame
        roughness: 0.6,
        metalness: 0.3,
        opacity: 1.0,
        transparent: false,
      })
    );
    
    // Vertical frame pieces
    const frameThickness = 0.1;
    const frameWidth = 0.15;
    
    // Left frame
    const leftFrameGeometry = new THREE.BoxGeometry(frameWidth, doorHeight + 0.2, frameThickness);
    const leftFrame = new THREE.Mesh(leftFrameGeometry, frameMaterial);
    leftFrame.position.set(-doorWidth / 2 - frameWidth / 2, foundationHeight + doorHeight / 2, depth / 2 + 0.1);
    leftFrame.castShadow = false; // Disabled for performance
    group.add(leftFrame);
    
    // Right frame
    const rightFrame = new THREE.Mesh(leftFrameGeometry, frameMaterial);
    rightFrame.position.set(doorWidth / 2 + frameWidth / 2, foundationHeight + doorHeight / 2, depth / 2 + 0.1);
    rightFrame.castShadow = false; // Disabled for performance
    group.add(rightFrame);
    
    // Top frame
    const topFrameGeometry = new THREE.BoxGeometry(doorWidth + frameWidth * 2, frameWidth, frameThickness);
    const topFrame = new THREE.Mesh(topFrameGeometry, frameMaterial);
    topFrame.position.set(0, foundationHeight + doorHeight + frameWidth / 2, depth / 2 + 0.1);
    topFrame.castShadow = false; // Disabled for performance
    group.add(topFrame);
  }
  
  /**
   * Create window meshes from window data
   * @param {THREE.Group} group - Group to add windows to
   * @param {Array} windows - Array of window objects
   * @param {Object} dimensions - Building dimensions
   * @param {number} foundationHeight - Foundation height offset
   */
  createWindows(group, windows, dimensions, foundationHeight, buildingHeight) {
    if (!windows || windows.length === 0) {
      return;
    }
    
    // PERFORMANCE: Limit window count and only render front facade windows
    // Rendering all windows on both facades creates too many draw calls
    const MAX_WINDOWS = 15; // Limit windows per building
    const frontWindows = windows
      .filter(w => w.facade === 'front')
      .slice(0, MAX_WINDOWS); // Only front facade, max 15 windows
    
    if (frontWindows.length === 0) {
      return;
    }
    
    // PERFORMANCE OPTIMIZATION: Use instanced rendering for windows
    // This reduces draw calls from 2*N to just 2 (one instanced mesh for glass, one for frames)
    
    // Window frame thickness
    const frameThickness = 0.05;
    const frameDepth = 0.1;
    
    // Window glass material (cached and shared)
    const glassMaterial = this.getCachedMaterial('window_glass', () =>
      new THREE.MeshStandardMaterial({
        color: 0x87ceeb, // Sky blue (glass tint)
        roughness: 0.1,
        metalness: 0.0,
        opacity: 0.3, // Semi-transparent glass
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false, // Performance: don't write depth for transparent objects
      })
    );
    
    // Window frame material (cached and shared)
    const frameMaterial = this.getCachedMaterial('window_frame', () =>
      new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, // Dark frame
        roughness: 0.6,
        metalness: 0.3,
        opacity: 1.0,
        transparent: false,
      })
    );
    
    // Window geometries - create dynamically based on window size since windows can vary in height
    // We'll create geometries on-demand and cache them by size key
    if (!this._windowGeometryCache) {
      this._windowGeometryCache = new Map(); // Map<"width_height", Geometry>
    }
    
    const getWindowGeometries = (winWidth, winHeight) => {
      const key = `${winWidth.toFixed(2)}_${winHeight.toFixed(2)}`;
      if (!this._windowGeometryCache.has(key)) {
        const glassGeo = new THREE.BoxGeometry(
          winWidth - frameThickness * 2,
          winHeight - frameThickness * 2,
          0.02
        );
        const frameGeo = new THREE.BoxGeometry(winWidth, winHeight, frameDepth);
        this._windowGeometryCache.set(key, { glass: glassGeo, frame: frameGeo });
      }
      return this._windowGeometryCache.get(key);
    };
    
    // Group windows by size for instanced rendering (windows with same size can share geometry)
    const windowsBySize = new Map(); // Map<"width_height", Array<window>>
    
    frontWindows.forEach((window) => {
      if (!window.position || !window.size) {
        return;
      }
      const [winWidth, winHeight] = window.size;
      const sizeKey = `${winWidth.toFixed(2)}_${winHeight.toFixed(2)}`;
      if (!windowsBySize.has(sizeKey)) {
        windowsBySize.set(sizeKey, []);
      }
      windowsBySize.get(sizeKey).push(window);
    });
    
    // Create instanced meshes for each window size
    windowsBySize.forEach((windows, sizeKey) => {
      if (windows.length === 0) return;
      
      const [winWidth, winHeight] = windows[0].size;
      const geometries = getWindowGeometries(winWidth, winHeight);
      
      const glassInstances = new THREE.InstancedMesh(
        geometries.glass,
        glassMaterial,
        windows.length
      );
      const frameInstances = new THREE.InstancedMesh(
        geometries.frame,
        frameMaterial,
        windows.length
      );
      
      const tempMatrix = new THREE.Matrix4();
      const tempPosition = new THREE.Vector3();
      
      windows.forEach((window, index) => {
        // Window position from server: [offset_x, offset_y, offset_z]
        // where offset_x = horizontal along building width (X in Three.js)
        //       offset_y = depth position, positive = front facade, negative = back facade (Z in Three.js)
        //       offset_z = vertical position along building height, centered at building center (Y in Three.js)
        const [winX, winY, winZ] = window.position;
        
        // Window position is relative to building center at (0, 0, 0)
        // The building structure (walls) extend from:
        //   - Y: foundationHeight (bottom) to foundationHeight + buildingHeight (top)
        //   - Building center vertically is at: foundationHeight + buildingHeight / 2
        //   - offset_z is relative to building center, so we add the building center Y position
        const buildingCenterY = foundationHeight + buildingHeight / 2;
        const windowY = buildingCenterY + winZ; // winZ is offset from building center
        
        // winY indicates which facade: positive = front (positive Z), negative = back (negative Z)
        // Position window on the correct facade, slightly in front of the wall
        const windowZ = winY > 0 ? dimensions.depth / 2 + 0.05 : -dimensions.depth / 2 - 0.05;
        
        // Set position and create transform matrix
        tempPosition.set(winX, windowY, windowZ);
        tempMatrix.makeTranslation(tempPosition.x, tempPosition.y, tempPosition.z);
        
        // Set instance matrix
        glassInstances.setMatrixAt(index, tempMatrix);
        frameInstances.setMatrixAt(index, tempMatrix);
      });
      
      glassInstances.instanceMatrix.needsUpdate = true;
      frameInstances.instanceMatrix.needsUpdate = true;
      
      glassInstances.castShadow = false;
      glassInstances.receiveShadow = false;
      frameInstances.castShadow = false; // Disabled for performance
      frameInstances.receiveShadow = false;
      
      group.add(glassInstances);
      group.add(frameInstances);
    });
  }

  /**
   * Get color for structure type
   * @param {string} structureType - Structure type
   * @returns {number} Color hex value
   */
  getStructureColor(structureType) {
    const colors = {
      building: 0x888888,    // Gray
      decoration: 0x00ff00,  // Green
      furniture: 0xff8800,   // Orange
      vehicle: 0x0000ff,     // Blue
      road: 0x444444,        // Dark gray
    };
    return colors[structureType] || 0xffffff;
  }

  /**
   * Remove a structure from the scene
   * @param {number} structureID - Structure ID to remove
   */
  removeStructure(structureID) {
    const mesh = this.structureMeshes.get(structureID);
    if (mesh) {
      this.scene.remove(mesh);
      // Dispose of geometry and materials
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      this.structureMeshes.delete(structureID);
    }

    // Remove from game state
    this.gameState.removeStructure(structureID);
  }

  /**
   * Update structure visibility based on active floor and type visibility
   */
  updateStructureVisibility() {
    const activeFloor = this.gameState.getActiveFloor();
    const allStructures = this.gameState.getAllStructures();

    // Remove structures not on active floor
    this.structureMeshes.forEach((mesh, structureID) => {
      const structure = allStructures.find(s => s.id === structureID);
      if (!structure || structure.floor !== activeFloor) {
        this.removeStructure(structureID);
      }
    });

    // Render structures on active floor
    allStructures.forEach(structure => {
      if (structure.floor === activeFloor) {
        this.renderStructure(structure);
      }
    });
  }

  /**
   * Set structure type visibility
   * @param {string} structureType - Structure type
   * @param {boolean} visible - Visibility state
   */
  setStructureTypeVisibility(structureType, visible) {
    this.structureTypeVisibility.set(structureType.toLowerCase(), visible);
    this.updateStructureVisibility();
  }

  /**
   * Set overall structure visibility
   * @param {boolean} visible - Visibility state
   */
  setStructuresVisible(visible) {
    this.structuresVisible = visible;
    this.structureMeshes.forEach(mesh => {
      mesh.visible = visible;
    });
  }

  /**
   * Highlight a structure
   * @param {number} structureID - Structure ID to highlight
   */
  highlightStructure(structureID) {
    this.highlightedStructures.add(structureID);
    const mesh = this.structureMeshes.get(structureID);
    if (mesh) {
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          // Only set emissive if the material supports it (not all materials have emissive)
          if (child.material.emissive && typeof child.material.emissive.setHex === 'function') {
            child.material.emissive.setHex(0x444444);
          }
        }
      });
    }
  }

  /**
   * Remove highlight from a structure
   * @param {number} structureID - Structure ID to unhighlight
   */
  unhighlightStructure(structureID) {
    this.highlightedStructures.delete(structureID);
    const mesh = this.structureMeshes.get(structureID);
    if (mesh) {
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          child.material.emissive.setHex(0x000000);
        }
      });
    }
  }
}

