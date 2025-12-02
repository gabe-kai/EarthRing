/**
 * Structure Manager
 * Handles structure rendering, placement, and management in Three.js
 */

import * as THREE from 'three';
import { toThreeJS, wrapRingPosition, normalizeRelativeToCamera, DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates-new.js';
import { createMeshAtEarthRingPosition } from '../utils/rendering.js';

/**
 * StructureManager coordinates structure data and renders structures as world-positioned meshes.
 */
export class StructureManager {
  constructor(gameStateManager, cameraController, sceneManager) {
    this.gameState = gameStateManager;
    this.cameraController = cameraController;
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getScene();

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

    this.setupListeners();
  }

  setupListeners() {
    // Listen for active floor changes
    this.gameState.on('activeFloorChanged', () => {
      this.updateStructureVisibility();
    });
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

    const cameraPos = this.cameraController.getEarthRingPosition();
    const cameraX = cameraPos.x;
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
    structureGroup.userData.structureID = structure.id;
    structureGroup.userData.structureType = structureType;
    structureGroup.userData.structure = structure;
    structureGroup.userData.lastCameraXUsed = cameraXWrapped;
    
    // Set floating origin position
    structureGroup.position.x = structureOriginX;

    // Calculate structure dimensions from properties
    const dimensions = this.getStructureDimensions(structure);
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

    // Apply rotation
    if (structure.rotation !== undefined) {
      structureGroup.rotation.y = (structure.rotation * Math.PI) / 180; // Convert degrees to radians
    }

    // Apply scale
    if (structure.scale !== undefined) {
      structureGroup.scale.set(structure.scale, structure.scale, structure.scale);
    }

    // Create geometry based on structure type and dimensions
    const geometry = this.createStructureGeometry(structureType, dimensions);
    const material = this.createStructureMaterial(structureType, structure);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    structureGroup.add(mesh);

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
    const cameraPos = this.cameraController.getEarthRingPosition();
    const cameraX = cameraPos.x;
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

    // Extract dimensions from properties JSONB
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
      
      case 'decoration':
        // Decorations can be various shapes - use cylinder for variety
        const radius = Math.min(width, depth) / 2;
        return new THREE.CylinderGeometry(radius, radius, height, 8);
      
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
          child.material.emissive.setHex(0x444444);
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

