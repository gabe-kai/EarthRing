/**
 * Structure Manager
 * Handles structure rendering, placement, and management in Three.js
 */

import * as THREE from 'three';
import { toThreeJS, wrapRingPosition } from '../utils/coordinates-new.js';
import { createMeshAtEarthRingPosition } from '../utils/rendering.js';

const DEFAULT_FLOOR_HEIGHT = 20; // meters per floor level

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

    // Create structure mesh
    const structureGroup = new THREE.Group();
    structureGroup.renderOrder = 10; // Render above zones
    structureGroup.userData.structureID = structure.id;
    structureGroup.userData.structureType = structureType;
    structureGroup.userData.structure = structure;
    structureGroup.userData.lastCameraXUsed = cameraXWrapped;

    // Calculate position with wrapping
    const structureX = structure.position.x;
    const structureY = structure.position.y;
    const floor = structure.floor ?? 0;
    const floorHeight = floor * DEFAULT_FLOOR_HEIGHT;

    // Wrap structure position relative to camera
    const wrappedX = wrapRingPosition(structureX - cameraXWrapped) + cameraXWrapped;

    // Convert to Three.js coordinates
    const earthRingPos = {
      x: wrappedX,
      y: structureY,
      z: floorHeight,
    };
    const threeJSPos = toThreeJS(earthRingPos);

    structureGroup.position.set(threeJSPos.x, threeJSPos.y, threeJSPos.z);

    // Apply rotation
    if (structure.rotation !== undefined) {
      structureGroup.rotation.y = (structure.rotation * Math.PI) / 180; // Convert degrees to radians
    }

    // Apply scale
    if (structure.scale !== undefined) {
      structureGroup.scale.set(structure.scale, structure.scale, structure.scale);
    }

    // Create placeholder geometry (will be replaced with actual models later)
    const geometry = new THREE.BoxGeometry(10, 10, 10); // 10m cube placeholder
    const material = new THREE.MeshStandardMaterial({
      color: this.getStructureColor(structureType),
      metalness: 0.3,
      roughness: 0.7,
    });
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
   * @param {THREE.Group} mesh - Structure mesh group
   * @param {Object} structure - Structure object
   * @param {number} cameraXWrapped - Wrapped camera X position
   */
  updateStructurePosition(mesh, structure, cameraXWrapped) {
    const structureX = structure.position.x;
    const wrappedX = wrapRingPosition(structureX - cameraXWrapped) + cameraXWrapped;

    const earthRingPos = {
      x: wrappedX,
      y: structure.position.y,
      z: (structure.floor ?? 0) * DEFAULT_FLOOR_HEIGHT,
    };
    const threeJSPos = toThreeJS(earthRingPos);

    mesh.position.set(threeJSPos.x, threeJSPos.y, threeJSPos.z);
    mesh.userData.lastCameraXUsed = cameraXWrapped;
  }

  /**
   * Get color for structure type
   * @param {string} structureType - Structure type
   * @returns {number} Color hex value
   */
  getStructureColor(structureType) {
    const colors = {
      building: 0x888888,
      decoration: 0x00ff00,
      furniture: 0xff8800,
      vehicle: 0x0000ff,
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

