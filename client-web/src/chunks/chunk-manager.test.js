/**
 * Tests for ChunkManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChunkManager } from './chunk-manager.js';
import * as THREE from 'three';

describe('ChunkManager', () => {
  let sceneManager;
  let gameStateManager;
  let cameraController;
  let chunkManager;
  let mockCamera;

  beforeEach(() => {
    // Mock window.earthring for debug checks
    global.window = {
      earthring: {
        debug: false,
      },
    };

    // Mock scene manager
    mockCamera = {
      position: new THREE.Vector3(1000, 20, 100),
    };
    sceneManager = {
      getCamera: () => mockCamera,
      getScene: () => ({
        add: vi.fn(),
        remove: vi.fn(),
      }),
    };

    // Mock game state manager
    gameStateManager = {
      getActiveFloor: () => 0,
      on: vi.fn(),
      off: vi.fn(),
    };

    // Mock camera controller (returns wrapped position)
    cameraController = {
      getEarthRingPosition: () => ({ x: 1000, y: 0, z: 0 }), // Wrapped position
    };

    chunkManager = new ChunkManager(sceneManager, gameStateManager, cameraController);
  });

  describe('getCurrentCameraX', () => {
    it('returns raw (unwrapped) camera position from Three.js camera', () => {
      // Set camera to negative position (should not be wrapped)
      mockCamera.position.set(-1000, 20, 100);
      
      const cameraX = chunkManager.getCurrentCameraX();
      
      // Should return raw position, not wrapped
      // -1000 in Three.js X maps to -1000 in EarthRing X (raw)
      expect(cameraX).toBeLessThan(0);
      expect(cameraX).toBeCloseTo(-1000, 0);
    });

    it('returns raw position even when camera controller wraps it', () => {
      // Camera at negative position
      mockCamera.position.set(-1000, 20, 100);
      
      // Camera controller would wrap this to 263999000
      cameraController.getEarthRingPosition = () => ({ x: 263999000, y: 0, z: 0 });
      
      const cameraX = chunkManager.getCurrentCameraX();
      
      // Should still return raw position from Three.js camera, not wrapped value
      expect(cameraX).toBeLessThan(0);
    });

    it('handles large positive positions correctly', () => {
      // Camera at position near ring end (should not wrap)
      mockCamera.position.set(263999000, 20, 100);
      
      const cameraX = chunkManager.getCurrentCameraX();
      
      // Should return raw position
      expect(cameraX).toBeGreaterThan(264000000 / 2);
    });

    it('falls back to camera controller if scene manager unavailable', () => {
      chunkManager.sceneManager = null;
      
      const cameraX = chunkManager.getCurrentCameraX();
      
      // Should use wrapped value from controller (with warning)
      expect(cameraX).toBe(1000);
    });

    it('returns 0 if no camera available', () => {
      chunkManager.sceneManager = null;
      chunkManager.cameraController = null;
      
      const cameraX = chunkManager.getCurrentCameraX();
      
      expect(cameraX).toBe(0);
    });
  });

  describe('createRingFloorMesh with negative camera positions', () => {
    it('correctly wraps chunks when camera is at negative position', () => {
      // Camera at negative position
      mockCamera.position.set(-1000, 20, 100);
      
      const chunkData = {
        geometry: {
          type: 'ring_floor',
          vertices: [
            [0, 0, 0],    // Chunk 0 starts at position 0
            [1000, 0, 0], // Chunk 0 ends at position 1000
            [0, 100, 0],
            [1000, 100, 0],
          ],
          faces: [
            [0, 1, 2],
            [1, 3, 2],
          ],
          width: 400,
          length: 1000,
        },
        chunk_index: 0,
      };

      const mesh = chunkManager.createRingFloorMesh('0_0', chunkData);
      
      expect(mesh).not.toBeNull();
      
      // Chunk should be positioned relative to camera (negative position)
      // The offset calculation should place chunk closest to camera
      // Camera at -1000, chunk at 0, so offset should be 0 (no wrapping needed)
      expect(mesh.position.x).toBeCloseTo(0, 0);
    });

    it('handles chunk wrapping at ring boundary with negative camera', () => {
      // Camera at position -1000 (wrapped would be 263999000)
      mockCamera.position.set(-1000, 20, 100);
      
      const chunkData = {
        geometry: {
          type: 'ring_floor',
          vertices: [
            [263999000, 0, 0],    // Chunk 263999 starts at position 263999000
            [264000000, 0, 0],    // Chunk 263999 ends at position 264000000 (wraps to 0)
            [263999000, 100, 0],
            [264000000, 100, 0],
          ],
          faces: [
            [0, 1, 2],
            [1, 3, 2],
          ],
          width: 400,
          length: 1000,
        },
        chunk_index: 263999,
      };

      const mesh = chunkManager.createRingFloorMesh('0_263999', chunkData);
      
      expect(mesh).not.toBeNull();
      
      // Chunk 263999 should be wrapped to be near camera at -1000
      // Offset should be -1 * circumference to bring it close
      const RING_CIRCUMFERENCE = 264000000;
      const expectedOffset = -1 * RING_CIRCUMFERENCE;
      expect(mesh.position.x).toBeCloseTo(263999000 + expectedOffset, 0);
    });
  });

  describe('createRingFloorMesh chunk-local grid attributes', () => {
    it('sets chunk-local grid attributes correctly', () => {
      const chunkData = {
        geometry: {
          type: 'ring_floor',
          vertices: [
            [5000, -100, 0],    // Chunk 5, vertex at local X=0, Y=-100
            [6000, -100, 0],    // Chunk 5, vertex at local X=1000, Y=-100
            [5000, 100, 0],     // Chunk 5, vertex at local X=0, Y=100
            [6000, 100, 0],     // Chunk 5, vertex at local X=1000, Y=100
          ],
          faces: [
            [0, 1, 2],
            [1, 3, 2],
          ],
          width: 400,
          length: 1000,
        },
        chunk_index: 5, // Chunk 5 = base X = 5000
      };

      const mesh = chunkManager.createRingFloorMesh('0_5', chunkData);
      
      expect(mesh).not.toBeNull();
      expect(mesh.geometry).toBeDefined();
      
      // Check that chunk-local attributes exist
      const chunkLocalX = mesh.geometry.getAttribute('chunkLocalX');
      const chunkLocalZ = mesh.geometry.getAttribute('chunkLocalZ');
      const chunkBaseWorldX = mesh.geometry.getAttribute('chunkBaseWorldX');
      
      expect(chunkLocalX).toBeDefined();
      expect(chunkLocalZ).toBeDefined();
      expect(chunkBaseWorldX).toBeDefined();
      
      // Verify attribute values
      // Vertex 0: absolute X=5000, chunk base=5000, so local X should be 0
      expect(chunkLocalX.getX(0)).toBe(0);
      // Vertex 0: Y=-100 in EarthRing coords (radial offset)
      expect(chunkLocalZ.getX(0)).toBe(-100);
      // All vertices should have same chunk base world X
      expect(chunkBaseWorldX.getX(0)).toBe(5000);
      expect(chunkBaseWorldX.getX(1)).toBe(5000);
      
      // Vertex 1: absolute X=6000, chunk base=5000, so local X should be 1000
      expect(chunkLocalX.getX(1)).toBe(1000);
      // Vertex 1: Y=-100 in EarthRing coords
      expect(chunkLocalZ.getX(1)).toBe(-100);
    });

    it('calculates chunk-local X correctly for different chunk indices', () => {
      const chunkData = {
        geometry: {
          type: 'ring_floor',
          vertices: [
            [12345000, 0, 0],   // Chunk 12345, vertex at absolute X=12345000
            [12346000, 0, 0],   // Chunk 12345, vertex at absolute X=12346000
          ],
          faces: [[0, 1, 0]],
          width: 400,
          length: 1000,
        },
        chunk_index: 12345, // Chunk 12345 = base X = 12345000
      };

      const mesh = chunkManager.createRingFloorMesh('0_12345', chunkData);
      
      const chunkLocalX = mesh.geometry.getAttribute('chunkLocalX');
      const chunkBaseWorldX = mesh.geometry.getAttribute('chunkBaseWorldX');
      
      // Vertex 0: absolute X=12345000, chunk base=12345000, so local X should be 0
      expect(chunkLocalX.getX(0)).toBe(0);
      // Vertex 1: absolute X=12346000, chunk base=12345000, so local X should be 1000
      expect(chunkLocalX.getX(1)).toBe(1000);
      // Chunk base should be 12345000
      expect(chunkBaseWorldX.getX(0)).toBe(12345000);
    });

    it('ensures grid attributes are set for chunk-normalized grid alignment', () => {
      // Grid alignment: Each chunk's grid starts on a major line at chunkLocalX = 0 (west edge)
      // This test verifies that chunk-local attributes are present to support this alignment
      const chunkData = {
        geometry: {
          type: 'ring_floor',
          vertices: [
            [10000, 0, 0],
            [11000, 0, 0],
            [10000, 50, 0],
            [11000, 50, 0],
          ],
          faces: [[0, 1, 2], [1, 3, 2]],
          width: 400,
          length: 1000,
        },
        chunk_index: 10, // Chunk 10 = base X = 10000
      };

      const mesh = chunkManager.createRingFloorMesh('0_10', chunkData);
      
      const chunkLocalX = mesh.geometry.getAttribute('chunkLocalX');
      const chunkLocalZ = mesh.geometry.getAttribute('chunkLocalZ');
      const chunkBaseWorldX = mesh.geometry.getAttribute('chunkBaseWorldX');
      
      // Verify attributes exist
      expect(chunkLocalX).toBeDefined();
      expect(chunkLocalZ).toBeDefined();
      expect(chunkBaseWorldX).toBeDefined();
      
      // Verify chunkLocalX values are in 0-1000m range (chunk-local)
      expect(chunkLocalX.getX(0)).toBe(0);  // West edge
      expect(chunkLocalX.getX(1)).toBe(1000); // East edge
      
      // Verify chunkBaseWorldX is stored correctly for potential future use
      expect(chunkBaseWorldX.getX(0)).toBe(10000);
    });
  });

  describe('grid visibility', () => {
    it('toggles grid visibility', () => {
      expect(chunkManager.sharedPlatformMaterial).toBeDefined();
      
      // Grid should be visible by default
      expect(chunkManager.sharedPlatformMaterial.uniforms.uShowGrid.value).toBe(true);
      
      // Hide grid
      chunkManager.setGridVisible(false);
      expect(chunkManager.sharedPlatformMaterial.uniforms.uShowGrid.value).toBe(false);
      
      // Show grid
      chunkManager.setGridVisible(true);
      expect(chunkManager.sharedPlatformMaterial.uniforms.uShowGrid.value).toBe(true);
    });
  });

  describe('updateCameraPosition', () => {
    it('updates camera position uniform for grid fade', () => {
      expect(chunkManager.sharedPlatformMaterial).toBeDefined();
      
      const initialPos = chunkManager.sharedPlatformMaterial.uniforms.uCameraPosition.value.clone();
      
      // Move camera
      mockCamera.position.set(5000, 30, 200);
      chunkManager.updateCameraPosition();
      
      const updatedPos = chunkManager.sharedPlatformMaterial.uniforms.uCameraPosition.value;
      expect(updatedPos.x).toBe(5000);
      expect(updatedPos.y).toBe(30);
      expect(updatedPos.z).toBe(200);
      expect(updatedPos).not.toEqual(initialPos);
    });

    it('handles missing camera gracefully', () => {
      chunkManager.sceneManager = null;
      
      // Should not throw
      expect(() => chunkManager.updateCameraPosition()).not.toThrow();
    });

    it('handles missing material gracefully', () => {
      chunkManager.sharedPlatformMaterial = null;
      
      // Should not throw
      expect(() => chunkManager.updateCameraPosition()).not.toThrow();
    });
  });

  describe('extractZonesFromChunk', () => {
    let zoneManager;

    beforeEach(() => {
      // Mock zone manager
      zoneManager = {
        handleStreamedZones: vi.fn(),
      };
      chunkManager.zoneManager = zoneManager;
    });

    it('extracts zones from chunk data in GeoJSON Feature format', () => {
      const chunkID = '0_50000';
      const chunkData = {
        zones: [
          {
            type: 'Feature',
            properties: {
              id: 123,
              name: 'Test Zone',
              zone_type: 'restricted',
              floor: 0,
              is_system_zone: true,
              metadata: {
                default_zone: 'true',
                chunk_index: 50000,
              },
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[[50000000, -10], [50001000, -10], [50001000, 10], [50000000, 10], [50000000, -10]]],
            },
          },
        ],
      };

      chunkManager.extractZonesFromChunk(chunkID, chunkData);

      expect(zoneManager.handleStreamedZones).toHaveBeenCalledTimes(1);
      const [zones, extractedChunkID] = zoneManager.handleStreamedZones.mock.calls[0];
      expect(extractedChunkID).toBe(chunkID);
      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe(123);
      expect(zones[0].zone_type).toBe('restricted');
      expect(zones[0].floor).toBe(0);
      expect(zones[0].metadata.chunk_index).toBe(50000);
      expect(zones[0].metadata.default_zone).toBe('true');
    });

    it('handles zones with string geometry (from database)', () => {
      const chunkID = '0_60000';
      const chunkData = {
        zones: [
          {
            type: 'Feature',
            properties: {
              id: 456,
              zone_type: 'restricted',
              floor: 0,
              is_system_zone: true,
            },
            geometry: JSON.stringify({
              type: 'Polygon',
              coordinates: [[[60000000, -10], [60001000, -10], [60001000, 10], [60000000, 10], [60000000, -10]]],
            }),
          },
        ],
      };

      chunkManager.extractZonesFromChunk(chunkID, chunkData);

      expect(zoneManager.handleStreamedZones).toHaveBeenCalledTimes(1);
      const [zones] = zoneManager.handleStreamedZones.mock.calls[0];
      expect(zones).toHaveLength(1);
      expect(zones[0].geometry).toBeDefined();
      expect(typeof zones[0].geometry).toBe('object');
    });

    it('handles chunks with no zones', () => {
      const chunkID = '0_70000';
      const chunkData = {
        zones: [],
      };

      chunkManager.extractZonesFromChunk(chunkID, chunkData);

      expect(zoneManager.handleStreamedZones).not.toHaveBeenCalled();
    });

    it('handles chunks with missing zones array', () => {
      const chunkID = '0_80000';
      const chunkData = {};

      chunkManager.extractZonesFromChunk(chunkID, chunkData);

      expect(zoneManager.handleStreamedZones).not.toHaveBeenCalled();
    });

    it('generates zone ID if missing', () => {
      const chunkID = '0_90000';
      const chunkData = {
        zones: [
          {
            type: 'Feature',
            properties: {
              zone_type: 'restricted',
              floor: 0,
              is_system_zone: true,
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[[90000000, -10], [90001000, -10], [90001000, 10], [90000000, 10], [90000000, -10]]],
            },
          },
        ],
      };

      chunkManager.extractZonesFromChunk(chunkID, chunkData);

      expect(zoneManager.handleStreamedZones).toHaveBeenCalledTimes(1);
      const [zones] = zoneManager.handleStreamedZones.mock.calls[0];
      expect(zones[0].id).toBeDefined();
      expect(zones[0].id).toContain('chunk_');
    });
  });

  describe('extractStructuresFromChunk', () => {
    let structureManager;

    beforeEach(() => {
      // Mock structure manager
      structureManager = {
        handleStreamedStructures: vi.fn(),
      };
      chunkManager.structureManager = structureManager;
    });

    it('extracts structures from chunk data in GeoJSON Feature format', () => {
      const chunkID = '0_50000';
      const chunkData = {
        structures: [
          {
            type: 'Feature',
            properties: {
              id: 123,
              structure_type: 'building',
              floor: 0,
              rotation: 45,
              scale: 1.5,
              owner_id: 1,
              zone_id: 42,
            },
            geometry: {
              type: 'Point',
              coordinates: [50000000, 0],
            },
          },
        ],
      };

      chunkManager.extractStructuresFromChunk(chunkID, chunkData);

      expect(structureManager.handleStreamedStructures).toHaveBeenCalledTimes(1);
      const [structures, extractedChunkID] = structureManager.handleStreamedStructures.mock.calls[0];
      expect(extractedChunkID).toBe(chunkID);
      expect(structures).toHaveLength(1);
      expect(structures[0].id).toBe(123);
      expect(structures[0].structure_type).toBe('building');
      expect(structures[0].floor).toBe(0);
      expect(structures[0].position.x).toBe(50000000);
      expect(structures[0].position.y).toBe(0);
      expect(structures[0].rotation).toBe(45);
      expect(structures[0].scale).toBe(1.5);
      expect(structures[0].zone_id).toBe(42);
    });

    it('handles structures with string geometry (from database)', () => {
      const chunkID = '0_60000';
      const chunkData = {
        structures: [
          {
            type: 'Feature',
            properties: {
              id: 456,
              structure_type: 'decoration',
              floor: 1,
            },
            geometry: JSON.stringify({
              type: 'Point',
              coordinates: [60000000, 50],
            }),
          },
        ],
      };

      chunkManager.extractStructuresFromChunk(chunkID, chunkData);

      const [structures] = structureManager.handleStreamedStructures.mock.calls[0];
      expect(structures).toHaveLength(1);
      expect(structures[0].position.x).toBe(60000000);
      expect(structures[0].position.y).toBe(50);
    });

    it('handles direct structure object format', () => {
      const chunkID = '0_70000';
      const chunkData = {
        structures: [
          {
            id: 789,
            structure_type: 'building',
            floor: 0,
            position: { x: 70000000, y: 0 },
            rotation: 0,
            scale: 1.0,
          },
        ],
      };

      chunkManager.extractStructuresFromChunk(chunkID, chunkData);

      const [structures] = structureManager.handleStreamedStructures.mock.calls[0];
      expect(structures).toHaveLength(1);
      expect(structures[0].id).toBe(789);
      expect(structures[0].position.x).toBe(70000000);
    });

    it('handles chunks with no structures', () => {
      const chunkID = '0_80000';
      const chunkData = {
        structures: [],
      };

      chunkManager.extractStructuresFromChunk(chunkID, chunkData);

      expect(structureManager.handleStreamedStructures).not.toHaveBeenCalled();
    });

    it('handles chunks with missing structures array', () => {
      const chunkID = '0_90000';
      const chunkData = {};

      chunkManager.extractStructuresFromChunk(chunkID, chunkData);

      expect(structureManager.handleStreamedStructures).not.toHaveBeenCalled();
    });

    it('filters out invalid structures', () => {
      const chunkID = '0_100000';
      const chunkData = {
        structures: [
          {
            type: 'Feature',
            properties: {
              id: 100,
              structure_type: 'building',
            },
            geometry: {
              type: 'Polygon', // Invalid - should be Point
              coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
            },
          },
          {
            type: 'Feature',
            properties: {
              id: 101,
              // Missing structure_type
            },
            geometry: {
              type: 'Point',
              coordinates: [100000000, 0],
            },
          },
          {
            type: 'Feature',
            properties: {
              id: 102,
              structure_type: 'building',
            },
            geometry: {
              type: 'Point',
              coordinates: [100000000, 0],
            },
          },
        ],
      };

      chunkManager.extractStructuresFromChunk(chunkID, chunkData);

      const [structures] = structureManager.handleStreamedStructures.mock.calls[0];
      // Only the valid structure (id: 102) should be extracted
      expect(structures).toHaveLength(1);
      expect(structures[0].id).toBe(102);
    });
  });
});

