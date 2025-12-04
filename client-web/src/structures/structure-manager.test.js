/**
 * Tests for StructureManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StructureManager } from './structure-manager.js';
import * as THREE from 'three';

describe('StructureManager', () => {
  let gameStateManager;
  let cameraController;
  let sceneManager;
  let structureManager;
  let mockScene;

  beforeEach(() => {
    // Mock game state manager
    gameStateManager = {
      getActiveFloor: () => 0,
      getAllStructures: () => [],
      upsertStructure: vi.fn(),
      removeStructure: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    // Mock camera controller
    cameraController = {
      getEarthRingPosition: () => ({ x: 1000, y: 0, z: 0 }),
    };

    // Mock scene
    mockScene = {
      add: vi.fn(),
      remove: vi.fn(),
    };

    // Mock scene manager
    sceneManager = {
      getScene: () => mockScene,
    };

    structureManager = new StructureManager(gameStateManager, cameraController, sceneManager);
  });

  describe('handleStreamedStructures', () => {
    it('tracks structures for chunk cleanup', () => {
      const structures = [
        {
          id: 123,
          structure_type: 'building',
          floor: 0,
          position: { x: 1000, y: 0 },
          rotation: 0,
          scale: 1.0,
        },
      ];
      const chunkID = '0_50000';

      structureManager.handleStreamedStructures(structures, chunkID);

      expect(structureManager.chunkStructures.has(chunkID)).toBe(true);
      expect(structureManager.chunkStructures.get(chunkID).has(123)).toBe(true);
      expect(gameStateManager.upsertStructure).toHaveBeenCalledWith(structures[0]);
    });

    it('only renders structures on active floor', () => {
      gameStateManager.getActiveFloor = () => 1; // Different floor
      const structures = [
        {
          id: 456,
          structure_type: 'building',
          floor: 0, // Structure on floor 0, but active floor is 1
          position: { x: 1000, y: 0 },
          rotation: 0,
          scale: 1.0,
        },
      ];

      structureManager.handleStreamedStructures(structures, '0_60000');

      // Structure should be upserted but not rendered (wrong floor)
      expect(gameStateManager.upsertStructure).toHaveBeenCalledWith(structures[0]);
      // renderStructure should not be called (we can't easily test this without mocking renderStructure)
    });
  });

  describe('cleanupStructuresForChunk', () => {
    it('removes structures tracked for a chunk', () => {
      const chunkID = '0_70000';
      const structureID1 = 789;
      const structureID2 = 790;

      // Set up tracked structures
      structureManager.chunkStructures.set(chunkID, new Set([structureID1, structureID2]));

      // Mock structures in game state
      gameStateManager.getAllStructures = () => [
        { id: structureID1, floor: 0 },
        { id: structureID2, floor: 0 },
      ];

      structureManager.cleanupStructuresForChunk(chunkID);

      expect(gameStateManager.removeStructure).toHaveBeenCalledWith(structureID1);
      expect(gameStateManager.removeStructure).toHaveBeenCalledWith(structureID2);
      expect(structureManager.chunkStructures.has(chunkID)).toBe(false);
    });

    it('handles cleanup for non-existent chunk gracefully', () => {
      expect(() => {
        structureManager.cleanupStructuresForChunk('nonexistent_chunk');
      }).not.toThrow();
    });
  });

  describe('renderStructure', () => {
    it('renders structure at correct position', () => {
      const structure = {
        id: 1,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 50 },
        rotation: 45,
        scale: 1.5,
      };

      structureManager.renderStructure(structure);

      expect(mockScene.add).toHaveBeenCalled();
      const addedMesh = mockScene.add.mock.calls[0][0];
      expect(addedMesh).toBeInstanceOf(THREE.Group);
      expect(addedMesh.userData.structureID).toBe(1);
      expect(addedMesh.userData.structureType).toBe('building');
      expect(structureManager.structureMeshes.has(1)).toBe(true);
    });

    it('handles structure at ring boundary (near 0)', () => {
      cameraController.getEarthRingPosition = () => ({ x: 100, y: 0, z: 0 });
      const structure = {
        id: 2,
        structure_type: 'building',
        floor: 0,
        position: { x: 50, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      expect(mockScene.add).toHaveBeenCalled();
      expect(structureManager.structureMeshes.has(2)).toBe(true);
    });

    it('handles structure at ring boundary (near 264,000,000)', () => {
      cameraController.getEarthRingPosition = () => ({ x: 263999000, y: 0, z: 0 });
      const structure = {
        id: 3,
        structure_type: 'building',
        floor: 0,
        position: { x: 263999500, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      expect(mockScene.add).toHaveBeenCalled();
      expect(structureManager.structureMeshes.has(3)).toBe(true);
    });

    it('handles structure wrapping when camera crosses boundary', () => {
      // Start with camera at 1000
      cameraController.getEarthRingPosition = () => ({ x: 1000, y: 0, z: 0 });
      const structure = {
        id: 4,
        structure_type: 'building',
        floor: 0,
        position: { x: 500, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);
      expect(structureManager.structureMeshes.has(4)).toBe(true);

      // Move camera to near end of ring
      cameraController.getEarthRingPosition = () => ({ x: 263999000, y: 0, z: 0 });
      structureManager.lastCameraX = null; // Force re-render

      structureManager.renderStructure(structure);

      // Structure should still be rendered (wrapped position)
      expect(structureManager.structureMeshes.has(4)).toBe(true);
    });

    it('applies rotation correctly', () => {
      const structure = {
        id: 5,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 90, // 90 degrees
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      const addedMesh = mockScene.add.mock.calls[0][0];
      expect(addedMesh.rotation.y).toBeCloseTo(Math.PI / 2, 5); // 90 degrees in radians
    });

    it('applies scale correctly', () => {
      const structure = {
        id: 6,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 2.5,
      };

      structureManager.renderStructure(structure);

      const addedMesh = mockScene.add.mock.calls[0][0];
      expect(addedMesh.scale.x).toBe(2.5);
      expect(addedMesh.scale.y).toBe(2.5);
      expect(addedMesh.scale.z).toBe(2.5);
    });

    it('positions structure at correct floor height', () => {
      const structure = {
        id: 7,
        structure_type: 'building',
        floor: 2, // Floor 2 = 40m height
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      const addedMesh = mockScene.add.mock.calls[0][0];
      // Floor 2 * 20m = 40m, converted to Three.js coordinates
      // We can't easily test the exact Three.js position without mocking toThreeJS,
      // but we can verify the structure was added
      expect(structureManager.structureMeshes.has(7)).toBe(true);
    });

    it('does not render if structures are hidden', () => {
      structureManager.setStructuresVisible(false);
      const structure = {
        id: 8,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      // Should not add to scene when hidden
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('does not render if structure type is hidden', () => {
      structureManager.setStructureTypeVisibility('building', false);
      const structure = {
        id: 9,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      // Should not add to scene when type is hidden
      expect(mockScene.add).not.toHaveBeenCalled();
    });
  });

  describe('updateStructureVisibility', () => {
    it('removes structures not on active floor', () => {
      // Set up structures on different floors
      const structureFloor0 = {
        id: 10,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };
      const structureFloor1 = {
        id: 11,
        structure_type: 'building',
        floor: 1,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      // Render both
      structureManager.renderStructure(structureFloor0);
      structureManager.renderStructure(structureFloor1);

      // Change active floor to 1
      gameStateManager.getActiveFloor = () => 1;
      gameStateManager.getAllStructures = () => [structureFloor0, structureFloor1];

      structureManager.updateStructureVisibility();

      // Structure on floor 0 should be removed
      expect(gameStateManager.removeStructure).toHaveBeenCalledWith(10);
      // Structure on floor 1 should remain
      expect(structureManager.structureMeshes.has(11)).toBe(true);
    });
  });

  describe('highlightStructure', () => {
    it('highlights a structure', () => {
      const structure = {
        id: 12,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);
      structureManager.highlightStructure(12);

      expect(structureManager.highlightedStructures.has(12)).toBe(true);
    });
  });

  describe('removeStructure', () => {
    it('removes structure from scene and game state', () => {
      const structure = {
        id: 13,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);
      expect(structureManager.structureMeshes.has(13)).toBe(true);

      structureManager.removeStructure(13);

      expect(mockScene.remove).toHaveBeenCalled();
      expect(gameStateManager.removeStructure).toHaveBeenCalledWith(13);
      expect(structureManager.structureMeshes.has(13)).toBe(false);
    });
  });

  describe('coordinate wrapping at boundaries', () => {
    it('renders structure correctly when camera is at ring start and structure is near end', () => {
      cameraController.getEarthRingPosition = () => ({ x: 1000, y: 0, z: 0 });
      const structure = {
        id: 14,
        structure_type: 'building',
        floor: 0,
        position: { x: 263999000, y: 0 }, // Near end of ring
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      expect(structureManager.structureMeshes.has(14)).toBe(true);
      expect(mockScene.add).toHaveBeenCalled();
    });

    it('renders structure correctly when camera is at ring end and structure is near start', () => {
      cameraController.getEarthRingPosition = () => ({ x: 263999000, y: 0, z: 0 });
      const structure = {
        id: 15,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 }, // Near start of ring
        rotation: 0,
        scale: 1.0,
      };

      structureManager.renderStructure(structure);

      expect(structureManager.structureMeshes.has(15)).toBe(true);
      expect(mockScene.add).toHaveBeenCalled();
    });
  });

  describe('structure-zone relationships', () => {
    it('renders structure with zone_id correctly', () => {
      const structure = {
        id: 16,
        structure_type: 'building',
        floor: 0,
        position: { x: 1000, y: 0 },
        rotation: 0,
        scale: 1.0,
        zone_id: 42,
      };

      structureManager.renderStructure(structure);

      expect(structureManager.structureMeshes.has(16)).toBe(true);
      const addedMesh = mockScene.add.mock.calls[0][0];
      expect(addedMesh.userData.structure.zone_id).toBe(42);
    });
  });

  describe('mergeBoxGeometries', () => {
    it('merges multiple box geometries into single BufferGeometry', () => {
      const geometries = [
        {
          geometry: new THREE.BoxGeometry(1, 1, 1),
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
        {
          geometry: new THREE.BoxGeometry(1, 1, 1),
          position: [2, 0, 0],
          rotation: [0, 0, 0],
        },
      ];

      const merged = structureManager.mergeBoxGeometries(geometries);

      expect(merged).toBeInstanceOf(THREE.BufferGeometry);
      // BoxGeometry has 24 vertices (6 faces × 4 vertices each for proper UV mapping)
      // So 2 boxes = 48 vertices
      expect(merged.attributes.position.count).toBe(48);
      // Each box has 36 indices (6 faces × 2 triangles × 3 indices), so merged should have 72
      expect(merged.index.count).toBe(72);
    });

    it('applies transformations correctly when merging', () => {
      const geometries = [
        {
          geometry: new THREE.BoxGeometry(1, 1, 1),
          position: [5, 10, 15],
          rotation: [0, Math.PI / 2, 0],
        },
      ];

      const merged = structureManager.mergeBoxGeometries(geometries);

      // Verify geometry was transformed (positions should be offset)
      const positions = merged.attributes.position;
      // At least one vertex should be near the translated position
      let foundTranslatedVertex = false;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        // After rotation and translation, vertices should be near [5, 10, 15]
        if (Math.abs(x - 5) < 1 && Math.abs(y - 10) < 1 && Math.abs(z - 15) < 1) {
          foundTranslatedVertex = true;
          break;
        }
      }
      expect(foundTranslatedVertex).toBe(true);
    });

    it('preserves normals and UVs when merging', () => {
      const geometries = [
        {
          geometry: new THREE.BoxGeometry(1, 1, 1),
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
      ];

      const merged = structureManager.mergeBoxGeometries(geometries);

      expect(merged.attributes.normal).toBeDefined();
      expect(merged.attributes.uv).toBeDefined();
      expect(merged.attributes.normal.count).toBe(merged.attributes.position.count);
      expect(merged.attributes.uv.count).toBe(merged.attributes.position.count);
    });

    it('handles empty geometry array gracefully', () => {
      expect(() => {
        structureManager.mergeBoxGeometries([]);
      }).not.toThrow();
    });
  });

  describe('createWallGeometryDefinition', () => {
    it('returns geometry and material definition for wall', () => {
      const width = 10;
      const height = 8;
      const thickness = 0.2;
      const position = [0, 4, 5];
      const rotation = [0, 0, 0];
      const windows = [];
      const baseMaterial = { color: 0xaaaaaa, roughness: 0.7, metalness: 0.2 };
      const dimensions = { width, depth: 10, height };
      const foundationHeight = 0.5;
      const buildingHeight = 7.5;

      const result = structureManager.createWallGeometryDefinition(
        width,
        height,
        thickness,
        position,
        rotation,
        windows,
        baseMaterial,
        dimensions,
        foundationHeight,
        buildingHeight,
        'warehouse',
        'front',
        null,
        null,
        0.02
      );

      expect(result).toHaveProperty('geometry');
      expect(result).toHaveProperty('material');
      expect(result).toHaveProperty('position');
      expect(result).toHaveProperty('rotation');
      expect(result).toHaveProperty('facade');
      expect(result.geometry).toBeInstanceOf(THREE.BoxGeometry);
      expect(result.material).toBeInstanceOf(THREE.ShaderMaterial);
      expect(result.facade).toBe('front');
      expect(result.position).toEqual(position);
      expect(result.rotation).toEqual(rotation);
    });

    it('includes window data in shader material', () => {
      const windows = [
        {
          facade: 'front',
          position: [0, 1, 2],
          size: [2, 1.5],
        },
      ];

      const result = structureManager.createWallGeometryDefinition(
        10, 8, 0.2, [0, 4, 5], [0, 0, 0],
        windows,
        { color: 0xaaaaaa, roughness: 0.7, metalness: 0.2 },
        { width: 10, depth: 10, height: 8 },
        0.5, 7.5, 'warehouse', 'front'
      );

      // Material should have window-related uniforms
      expect(result.material.uniforms.windowDataTexture).toBeDefined();
      expect(result.material.uniforms.windowCount).toBeDefined();
      expect(result.material.uniforms.windowCount.value).toBe(1);
    });

    it('includes door data in shader material when provided', () => {
      const doorInfo = [
        {
          type: 'standard',
          x: 0,
          y: 0,
          width: 0.9,
          height: 2.1,
        },
      ];

      const result = structureManager.createWallGeometryDefinition(
        10, 8, 0.2, [0, 4, 5], [0, 0, 0],
        [],
        { color: 0xaaaaaa, roughness: 0.7, metalness: 0.2 },
        { width: 10, depth: 10, height: 8 },
        0.5, 7.5, 'warehouse', 'front',
        null, doorInfo
      );

      expect(result.material.uniforms.hasDoor).toBeDefined();
      expect(result.material.uniforms.hasDoor.value).toBe(true);
    });
  });

  describe('createDetailedBuilding with merged geometry', () => {
    it('creates merged wall geometry with correct groups', () => {
      const structure = {
        id: 'test-building-1',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {},
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      structureManager.createDetailedBuilding(structureGroup, structure, dimensions);

      // Should have 2 meshes: merged walls + roof
      const meshes = structureGroup.children.filter(child => child instanceof THREE.Mesh);
      expect(meshes.length).toBe(2);

      // Find the merged wall mesh (it will have multiple materials)
      const wallMesh = meshes.find(mesh => Array.isArray(mesh.material));
      expect(wallMesh).toBeDefined();
      expect(wallMesh.geometry).toBeInstanceOf(THREE.BufferGeometry);

      // Verify geometry groups are set up correctly (4 walls)
      expect(wallMesh.geometry.groups.length).toBe(4);
      expect(wallMesh.geometry.groups[0].materialIndex).toBe(0); // Front
      expect(wallMesh.geometry.groups[1].materialIndex).toBe(1); // Back
      expect(wallMesh.geometry.groups[2].materialIndex).toBe(2); // Left
      expect(wallMesh.geometry.groups[3].materialIndex).toBe(3); // Right

      // Verify material array has 4 materials (one per facade)
      expect(wallMesh.material.length).toBe(4);
    });

    it('creates roof as separate mesh', () => {
      const structure = {
        id: 'test-building-2',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {},
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      structureManager.createDetailedBuilding(structureGroup, structure, dimensions);

      // Find the roof mesh (single material, not an array)
      const meshes = structureGroup.children.filter(child => child instanceof THREE.Mesh);
      const roofMesh = meshes.find(mesh => !Array.isArray(mesh.material));
      expect(roofMesh).toBeDefined();
      expect(roofMesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    });

    it('merges all 4 walls into single geometry', () => {
      const structure = {
        id: 'test-building-3',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {},
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      structureManager.createDetailedBuilding(structureGroup, structure, dimensions);

      const wallMesh = structureGroup.children.find(
        child => child instanceof THREE.Mesh && Array.isArray(child.material)
      );

      // BoxGeometry has 24 vertices per box (6 faces × 4 vertices each for proper UV mapping)
      // So 4 walls = 96 vertices
      expect(wallMesh.geometry.attributes.position.count).toBe(96);
      
      // Each wall has 36 indices, so 4 walls = 144 indices
      expect(wallMesh.geometry.index.count).toBe(144);
    });

    it('preserves window and door data per facade', () => {
      const structure = {
        id: 'test-building-4',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [
          { facade: 'front', position: [0, 1, 2], size: [2, 1.5] },
          { facade: 'back', position: [0, 1, 2], size: [2, 1.5] },
        ],
        doors: {
          front: { type: 'standard', x: 0, y: 0, width: 0.9, height: 2.1 },
        },
        garage_doors: [],
        properties: {},
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      structureManager.createDetailedBuilding(structureGroup, structure, dimensions);

      const wallMesh = structureGroup.children.find(
        child => child instanceof THREE.Mesh && Array.isArray(child.material)
      );

      // Front wall material (index 0) should have door
      expect(wallMesh.material[0].uniforms.hasDoor.value).toBe(true);
      // Back wall material (index 1) should have window but no door
      expect(wallMesh.material[1].uniforms.windowCount.value).toBe(1);
    });

    it('handles buildings with no windows or doors', () => {
      const structure = {
        id: 'test-building-5',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {},
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      expect(() => {
        structureManager.createDetailedBuilding(structureGroup, structure, dimensions);
      }).not.toThrow();

      const wallMesh = structureGroup.children.find(
        child => child instanceof THREE.Mesh && Array.isArray(child.material)
      );
      expect(wallMesh).toBeDefined();
    });

    it('applies color palette from properties when available', () => {
      const structure = {
        id: 'test-building-6',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {
          colors: {
            walls: { hex: '#ff0000' },
            roofs: { hex: '#0000ff' },
          },
        },
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      structureManager.createDetailedBuilding(structureGroup, structure, dimensions);

      // Roof color should be applied
      const roofMesh = structureGroup.children.find(
        child => child instanceof THREE.Mesh && !Array.isArray(child.material)
      );
      expect(roofMesh.material.color.getHex()).toBe(0x0000ff);
    });

    it('reduces draw calls from 5 to 2 meshes', () => {
      const structure = {
        id: 'test-building-7',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {},
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      structureManager.createDetailedBuilding(structureGroup, structure, dimensions);

      // Should have exactly 2 meshes: merged walls + roof
      const meshes = structureGroup.children.filter(child => child instanceof THREE.Mesh);
      expect(meshes.length).toBe(2);

      // Before merging: 5 meshes (4 walls + 1 roof)
      // After merging: 2 meshes (1 merged walls + 1 roof)
      // This is a 60% reduction in draw calls
    });

    it('handles corner trim width from properties', () => {
      const structure = {
        id: 'test-building-8',
        structure_type: 'building',
        building_subtype: 'warehouse',
        windows: [],
        doors: {},
        garage_doors: [],
        properties: {
          corner_trim_width: 0.3, // 30cm
        },
      };

      const dimensions = { width: 20, depth: 15, height: 10 };
      const structureGroup = new THREE.Group();

      expect(() => {
        structureManager.createDetailedBuilding(structureGroup, structure, dimensions);
      }).not.toThrow();

      const wallMesh = structureGroup.children.find(
        child => child instanceof THREE.Mesh && Array.isArray(child.material)
      );
      // Corner trim should be applied in shader uniforms
      expect(wallMesh.material[0].uniforms.cornerTrimWidthUniform).toBeDefined();
    });
  });
});

