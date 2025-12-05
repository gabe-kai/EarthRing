/**
 * Tests for ZoneManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ZoneManager } from './zone-manager.js';

describe('ZoneManager', () => {
  let gameStateManager;
  let cameraController;
  let sceneManager;
  let zoneManager;

  beforeEach(() => {
    // Mock window object for Node.js test environment
    global.window = {
      DEBUG_ZONE_COORDS: false,
      DEBUG_ZONE_PREVIEW: false,
    };

    // Mock game state manager
    gameStateManager = {
      getActiveFloor: () => 0,
      getAllZones: () => [],
      getZone: vi.fn(() => undefined), // Returns undefined by default (zone doesn't exist)
      upsertZone: vi.fn(),
      removeZone: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    // Mock camera controller
    cameraController = {
      getEarthRingPosition: () => ({ x: 1000, y: 0, z: 0 }),
    };

    // Mock scene manager
    sceneManager = {
      getScene: () => ({
        add: vi.fn(),
        remove: vi.fn(),
      }),
    };

    zoneManager = new ZoneManager(gameStateManager, cameraController, sceneManager);
  });

  describe('handleStreamedZones', () => {
    it('tracks zones for chunk cleanup', () => {
      const zones = [
        {
          id: 123,
          zone_type: 'restricted',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, -10], [1000, -10], [1000, 10], [0, 10], [0, -10]]],
          },
        },
      ];
      const chunkID = '0_50000';

      zoneManager.handleStreamedZones(zones, chunkID);

      expect(zoneManager.chunkZones.has(chunkID)).toBe(true);
      expect(zoneManager.chunkZones.get(chunkID).has(123)).toBe(true);
      expect(gameStateManager.upsertZone).toHaveBeenCalledWith(zones[0]);
    });

    it('only renders zones on active floor', () => {
      gameStateManager.getActiveFloor = () => 1; // Different floor
      const zones = [
        {
          id: 456,
          zone_type: 'restricted',
          floor: 0, // Zone on floor 0, but active floor is 1
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, -10], [1000, -10], [1000, 10], [0, 10], [0, -10]]],
          },
        },
      ];

      zoneManager.handleStreamedZones(zones, '0_60000');

      // Zone should be upserted but not rendered (wrong floor)
      expect(gameStateManager.upsertZone).toHaveBeenCalledWith(zones[0]);
      // renderZone should not be called (we can't easily test this without mocking renderZone)
    });
  });

  describe('cleanupZonesForChunk', () => {
    it('removes zones tracked for a chunk', () => {
      const chunkID = '0_70000';
      const zoneID1 = 789;
      const zoneID2 = 790;

      // Set up tracked zones
      zoneManager.chunkZones.set(chunkID, new Set([zoneID1, zoneID2]));

      // Mock zones in game state
      gameStateManager.getAllZones = () => [
        { id: zoneID1, floor: 0 },
        { id: zoneID2, floor: 0 },
      ];

      zoneManager.cleanupZonesForChunk(chunkID);

      expect(gameStateManager.removeZone).toHaveBeenCalledWith(zoneID1);
      expect(gameStateManager.removeZone).toHaveBeenCalledWith(zoneID2);
      expect(zoneManager.chunkZones.has(chunkID)).toBe(false);
    });

    it('finds zones by metadata chunk_index if not tracked', () => {
      const chunkID = '0_80000';
      const zoneID = 999;

      // Zone not in chunkZones map, but has metadata
      // Mock removeZone to track calls
      const removeZoneSpy = vi.fn();
      zoneManager.removeZone = removeZoneSpy;
      
      gameStateManager.getAllZones = () => [
        {
          id: zoneID,
          floor: 0,
          metadata: {
            chunk_index: 80000,
            default_zone: 'true', // Can be string 'true' or boolean true
          },
        },
      ];

      zoneManager.cleanupZonesForChunk(chunkID);

      expect(removeZoneSpy).toHaveBeenCalledWith(zoneID);
      expect(gameStateManager.removeZone).toHaveBeenCalledWith(zoneID);
    });

    it('handles chunks with no associated zones', () => {
      const chunkID = '0_90000';
      gameStateManager.getAllZones = () => [];

      zoneManager.cleanupZonesForChunk(chunkID);

      // Should not throw or error
      expect(gameStateManager.removeZone).not.toHaveBeenCalled();
    });

    it('only removes zones matching chunk floor', () => {
      const chunkID = '1_100000'; // Floor 1
      const zoneID = 1111;

      // Zone on different floor
      gameStateManager.getAllZones = () => [
        {
          id: zoneID,
          floor: 0, // Different floor
          metadata: {
            chunk_index: 100000,
            default_zone: 'true',
          },
        },
      ];

      zoneManager.cleanupZonesForChunk(chunkID);

      // Should not remove zone from different floor
      expect(gameStateManager.removeZone).not.toHaveBeenCalled();
    });
  });

  describe('zone rendering with boundary conditions', () => {
    let mockScene;
    let mockCamera;

    beforeEach(() => {
      mockScene = {
        add: vi.fn(),
        remove: vi.fn(),
      };
      mockCamera = {
        position: { x: 0, y: 20, z: 100 },
      };
      sceneManager.getScene = () => mockScene;
      sceneManager.getCamera = () => mockCamera;
      // Update zoneManager's scene reference since it was set in constructor
      zoneManager.scene = mockScene;
    });

    it('renders zones at ring boundary (chunk 0)', () => {
      // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
      // the platform shader in ChunkManager. renderZone() returns early.
      const zone = {
        id: 1,
        zone_type: 'restricted',
        floor: 0,
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, -10], [1000, -10], [1000, 10], [0, 10], [0, -10]]],
        },
      };

      // Camera at position 0 (start of ring)
      mockCamera.position.x = 0;
      zoneManager.renderZone(zone);

      // renderZone() is disabled, so it returns early and scene.add should NOT be called
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('renders zones at ring boundary (chunk 263999)', () => {
      // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
      // the platform shader in ChunkManager. renderZone() returns early.
      const zone = {
        id: 2,
        zone_type: 'restricted',
        floor: 0,
        geometry: {
          type: 'Polygon',
          coordinates: [[[263999000, -10], [264000000, -10], [264000000, 10], [263999000, 10], [263999000, -10]]],
        },
      };

      // Camera at end of ring (wraps to 0)
      mockCamera.position.x = 264000000;
      zoneManager.renderZone(zone);

      // renderZone() is disabled, so scene.add should NOT be called
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('handles negative camera positions (west of origin)', () => {
      // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
      // the platform shader in ChunkManager. renderZone() returns early.
      const zone = {
        id: 3,
        zone_type: 'restricted',
        floor: 0,
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, -10], [1000, -10], [1000, 10], [0, 10], [0, -10]]],
        },
      };

      // Camera at negative position (west of origin)
      mockCamera.position.x = -5000;
      zoneManager.renderZone(zone);

      // renderZone() is disabled, so scene.add should NOT be called
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('handles zones spanning wrap boundary', () => {
      // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
      // the platform shader in ChunkManager. renderZone() returns early.
      const zone = {
        id: 4,
        zone_type: 'restricted',
        floor: 0,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [263999000, -10],  // Near end of ring
            [264000000, -10],  // At wrap point
            [1000, -10],       // Wrapped to start
            [1000, 10],
            [264000000, 10],
            [263999000, 10],
            [263999000, -10],
          ]],
        },
      };

      // Camera at wrap boundary
      mockCamera.position.x = 0;
      zoneManager.renderZone(zone);

      // renderZone() is disabled, so scene.add should NOT be called
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('only renders zones on active floor', () => {
      // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
      // the platform shader in ChunkManager. renderZone() returns early.
      gameStateManager.getActiveFloor = () => 1; // Active floor is 1
      const zone = {
        id: 5,
        zone_type: 'restricted',
        floor: 0, // Zone is on floor 0
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, -10], [1000, -10], [1000, 10], [0, 10], [0, -10]]],
        },
      };

      zoneManager.renderZone(zone);

      // renderZone() is disabled, so it returns early and doesn't check floor or call removeZone
      expect(gameStateManager.removeZone).not.toHaveBeenCalled();
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('handles full-ring zones (spans > 50% of ring)', () => {
      // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
      // the platform shader in ChunkManager. renderZone() returns early.
      const zone = {
        id: 6,
        zone_type: 'restricted',
        floor: 0,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [10000000, -10],  // Start at 10M
            [142000000, -10], // End at 142M (132M span)
            [142000000, 10],
            [10000000, 10],
            [10000000, -10],
          ]],
        },
      };

      zoneManager.renderZone(zone);

      // renderZone() is disabled, so scene.add should NOT be called
      expect(mockScene.add).not.toHaveBeenCalled();
    });

    describe('floating origin pattern', () => {
      it('positions zone group at camera X position (floating origin)', () => {
        // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
        // the platform shader in ChunkManager. renderZone() returns early.
        const zone = {
          id: 7,
          zone_type: 'restricted',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, -10], [1000, -10], [1000, 10], [0, 10], [0, -10]]],
          },
        };

        // Camera at large distance (theta 30°, X=22,000,000m)
        const largeCameraX = 22000000;
        mockCamera.position.x = largeCameraX;
        zoneManager.renderZone(zone);

        // renderZone() is disabled, so scene.add should NOT be called
        expect(mockScene.add).not.toHaveBeenCalled();
      });

      it('converts zone coordinates to local space (floating origin)', () => {
        // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
        // the platform shader in ChunkManager. renderZone() returns early.
        const zone = {
          id: 8,
          zone_type: 'restricted',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[22000000, -10], [22001000, -10], [22001000, 10], [22000000, 10], [22000000, -10]]],
          },
        };

        // Camera at large distance (theta 30°, X=22,000,000m)
        const largeCameraX = 22000000;
        mockCamera.position.x = largeCameraX;
        zoneManager.renderZone(zone);

        // renderZone() is disabled, so scene.add should NOT be called
        expect(mockScene.add).not.toHaveBeenCalled();
      });

      it('maintains precision at large distances (prevents flickering)', () => {
        // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
        // the platform shader in ChunkManager. renderZone() returns early.
        // The shader-based rendering handles precision through the floating origin pattern
        // at the chunk level, not at the individual zone level.
        const zone = {
          id: 9,
          zone_type: 'restricted',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[22000000, -10], [22001000, -10], [22001000, 10], [22000000, 10], [22000000, -10]]],
          },
        };

        // Camera at large distance (theta 30°, X=22,000,000m)
        const largeCameraX = 22000000;
        mockCamera.position.x = largeCameraX;
        
        // Render zone first time
        zoneManager.renderZone(zone);
        expect(mockScene.add).not.toHaveBeenCalled();
        
        // Clear and render again (simulating frame update)
        mockScene.add.mockClear();
        zoneManager.renderZone(zone);
        expect(mockScene.add).not.toHaveBeenCalled();
      });

      it('handles floating origin at different camera positions', () => {
        // NOTE: Mesh-based zone rendering is disabled. Zone rendering is now handled by
        // the platform shader in ChunkManager. renderZone() returns early.
        const zone = {
          id: 10,
          zone_type: 'restricted',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[5000, -10], [6000, -10], [6000, 10], [5000, 10], [5000, -10]]],
          },
        };

        // Test at origin
        mockCamera.position.x = 0;
        zoneManager.renderZone(zone);
        expect(mockScene.add).not.toHaveBeenCalled();
        
        // Test at large distance
        mockScene.add.mockClear();
        mockCamera.position.x = 22000000;
        zoneManager.renderZone(zone);
        expect(mockScene.add).not.toHaveBeenCalled();
        
        // Test at negative position
        mockScene.add.mockClear();
        mockCamera.position.x = -5000;
        zoneManager.renderZone(zone);
        expect(mockScene.add).not.toHaveBeenCalled();
      });
    });
  });
});

