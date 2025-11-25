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
});

