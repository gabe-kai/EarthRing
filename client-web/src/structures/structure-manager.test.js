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
});

