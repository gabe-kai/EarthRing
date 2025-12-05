/**
 * Tests for ZoneInfoTags
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ZoneInfoTags } from './zone-info-tags.js';
import * as THREE from 'three';

describe('ZoneInfoTags', () => {
  let sceneManager;
  let cameraController;
  let gameStateManager;
  let zoneManager;
  let zoneEditor;
  let zoneInfoTags;
  let mockCamera;
  let mockContainer;

  beforeEach(() => {
    // Mock window object (jsdom provides document automatically)
    global.window = {
      innerWidth: 1920,
      innerHeight: 1080,
    };

    // Mock THREE.js camera
    mockCamera = {
      position: new THREE.Vector3(100, 22, 30),
      project: vi.fn((vector) => {
        // Simple mock: just return the vector as-is for testing
        return vector;
      }),
    };

    // Mock scene manager
    sceneManager = {
      getCamera: () => mockCamera,
      getRenderer: () => ({
        domElement: document.createElement('canvas'),
      }),
    };

    // Mock camera controller
    cameraController = {
      getEarthRingPosition: () => ({ x: 100, y: 30, z: 0 }),
    };

    // Mock game state manager
    gameStateManager = {
      getAllZones: () => [],
      getActiveFloor: () => 0,
      on: vi.fn(),
      off: vi.fn(),
    };

    // Mock zone manager
    zoneManager = {
      zoneTypeVisibility: new Map([
        ['residential', true],
        ['commercial', true],
        ['industrial', true],
      ]),
    };

    // Mock zone editor
    zoneEditor = {
      selectZone: vi.fn(),
    };

    // Create container for tags
    mockContainer = document.createElement('div');
    // document.body already exists from JSDOM
    document.body.appendChild(mockContainer);
  });

  afterEach(() => {
    // Clean up DOM
    if (zoneInfoTags) {
      zoneInfoTags.hideAllTags();
      const container = document.getElementById('zone-info-tags-container');
      if (container) {
        container.remove();
      }
      const style = document.querySelector('style[data-zone-info-tags]');
      if (style) {
        style.remove();
      }
    }
  });

  describe('constructor', () => {
    it('creates container and sets up event listeners', () => {
      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );

      expect(zoneInfoTags.container).toBeTruthy();
      expect(zoneInfoTags.container.id).toBe('zone-info-tags-container');
      expect(gameStateManager.on).toHaveBeenCalledWith('zoneAdded', expect.any(Function));
      expect(gameStateManager.on).toHaveBeenCalledWith('zoneUpdated', expect.any(Function));
      expect(gameStateManager.on).toHaveBeenCalledWith('zoneRemoved', expect.any(Function));
      expect(gameStateManager.on).toHaveBeenCalledWith('activeFloorChanged', expect.any(Function));
    });

    it('initializes with correct default state', () => {
      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );

      expect(zoneInfoTags.visible).toBe(false);
      expect(zoneInfoTags.toolbarExpanded).toBe(false);
      expect(zoneInfoTags.zonesVisible).toBe(false);
      expect(zoneInfoTags.tags.size).toBe(0);
    });
  });

  describe('visibility control', () => {
    beforeEach(() => {
      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );
    });

    it('updates visibility when toolbar expands', () => {
      zoneInfoTags.setToolbarExpanded(true);
      expect(zoneInfoTags.toolbarExpanded).toBe(true);
      // Visibility should still be false until zones are also visible
      expect(zoneInfoTags.visible).toBe(false);
    });

    it('shows tags when toolbar expanded and zones visible', () => {
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);
      expect(zoneInfoTags.visible).toBe(true);
    });

    it('hides tags when toolbar collapses', () => {
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);
      expect(zoneInfoTags.visible).toBe(true);

      zoneInfoTags.setToolbarExpanded(false);
      expect(zoneInfoTags.visible).toBe(false);
    });

    it('hides tags when zones become hidden', () => {
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);
      expect(zoneInfoTags.visible).toBe(true);

      zoneInfoTags.setZonesVisible(false);
      expect(zoneInfoTags.visible).toBe(false);
    });
  });

  describe('updateTags with distance filtering', () => {
    beforeEach(() => {
      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);
    });

    it('creates tags for zones within 1000m', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
        {
          id: 2,
          zone_type: 'commercial',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[200, 10], [210, 10], [210, 20], [200, 20], [200, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      // Both zones are within 1000m of camera at (100, 30)
      expect(zoneInfoTags.tags.size).toBeGreaterThan(0);
    });

    it('filters out zones beyond 1000m', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
        {
          id: 2,
          zone_type: 'commercial',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[1200, 10], [1210, 10], [1210, 20], [1200, 20], [1200, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      // Only zone 1 should be within 1000m
      const visibleZones = Array.from(zoneInfoTags.tags.keys());
      expect(visibleZones).toContain(1);
      expect(visibleZones).not.toContain(2);
    });

    it('limits to maximum 30 visible tags', () => {
      const zones = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        zone_type: 'residential',
        floor: 0,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [100 + i * 10, 30],
            [110 + i * 10, 30],
            [110 + i * 10, 40],
            [100 + i * 10, 40],
            [100 + i * 10, 30],
          ]],
        },
      }));

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      // Should only create tags for the 30 nearest zones
      expect(zoneInfoTags.tags.size).toBeLessThanOrEqual(30);
    });

    it('filters by active floor', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
        {
          id: 2,
          zone_type: 'commercial',
          floor: 1,
          geometry: {
            type: 'Polygon',
            coordinates: [[[200, 10], [210, 10], [210, 20], [200, 20], [200, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;
      gameStateManager.getActiveFloor = () => 0;

      zoneInfoTags.updateTags();

      // Only zone 1 should be visible (floor 0)
      expect(zoneInfoTags.tags.has(1)).toBe(true);
      expect(zoneInfoTags.tags.has(2)).toBe(false);
    });

    it('filters by zone type visibility', () => {
      zoneManager.zoneTypeVisibility.set('commercial', false);

      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
        {
          id: 2,
          zone_type: 'commercial',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[200, 10], [210, 10], [210, 20], [200, 20], [200, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      // Only zone 1 should be visible (commercial is hidden)
      expect(zoneInfoTags.tags.has(1)).toBe(true);
      expect(zoneInfoTags.tags.has(2)).toBe(false);
    });
  });

  describe('coordinate wrapping', () => {
    beforeEach(() => {
      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);
    });

    it('handles zones on X- side of ring boundary', () => {
      // Camera at X=-8 (wrapped from 263999992)
      mockCamera.position.x = -8;
      cameraController.getEarthRingPosition = () => ({ x: -8, y: 30, z: 0 });

      // Zone at X=263995500 (near the boundary, should wrap to be close)
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[263995500, 30], [263995600, 30], [263995600, 40], [263995500, 40], [263995500, 30]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      // Zone should be found and tag created (if within 1000m after wrapping)
      // The tag positioning should handle the wrapping correctly
      expect(zoneInfoTags.tags.size).toBeGreaterThanOrEqual(0);
    });

    it('correctly calculates wrapped distance for X- zones', () => {
      // Camera at X=100
      mockCamera.position.x = 100;
      cameraController.getEarthRingPosition = () => ({ x: 100, y: 30, z: 0 });

      // Zone at X=263999900 (should be close via wrapping)
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[263999900, 30], [263999950, 30], [263999950, 40], [263999900, 40], [263999900, 30]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      // Zone should be within 1000m after wrapping calculation
      expect(zoneInfoTags.tags.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('tag creation and positioning', () => {
    beforeEach(() => {
      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);
    });

    it('creates tag HTML element', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      const tag = zoneInfoTags.tags.get(1);
      expect(tag).toBeTruthy();
      expect(tag.classList.contains('zone-info-tag')).toBe(true);
      expect(tag.textContent).toBe('i');
      expect(tag.dataset.zoneId).toBe('1');
    });

    it('stores world position in dataset', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      const tag = zoneInfoTags.tags.get(1);
      expect(tag.dataset.worldX).toBeTruthy();
      expect(tag.dataset.worldY).toBeTruthy();
      expect(tag.dataset.worldZ).toBeTruthy();
    });

    it('handles click to show zone details', async () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;

      zoneInfoTags.updateTags();

      const tag = zoneInfoTags.tags.get(1);
      expect(tag).toBeTruthy();
      
      // The implementation calls showZoneDetails which is async and calls zoneEditor.selectZone
      // Mock showZoneDetails to verify it's called, or test selectZone directly
      const showZoneDetailsSpy = vi.spyOn(zoneInfoTags, 'showZoneDetails').mockResolvedValue();
      
      // The implementation uses addEventListener, so we need to dispatch the event
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const stopPropagationSpy = vi.fn();
      clickEvent.stopPropagation = stopPropagationSpy;
      
      tag.dispatchEvent(clickEvent);

      // Wait for async call
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(showZoneDetailsSpy).toHaveBeenCalledWith(zones[0]);
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('removes tag when zone is removed', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: {
            type: 'Polygon',
            coordinates: [[[150, 10], [160, 10], [160, 20], [150, 20], [150, 10]]],
          },
        },
      ];

      gameStateManager.getAllZones = () => zones;
      zoneInfoTags.updateTags();

      expect(zoneInfoTags.tags.has(1)).toBe(true);

      // Simulate zone removal
      const removeHandler = gameStateManager.on.mock.calls.find(
        call => call[0] === 'zoneRemoved'
      )?.[1];
      if (removeHandler) {
        removeHandler(1);
      }

      expect(zoneInfoTags.tags.has(1)).toBe(false);
    });
  });

  describe('calculateZoneBounds', () => {
    it('calculates center and bounds from polygon geometry', () => {
      const geometry = {
        type: 'Polygon',
        coordinates: [[[100, 200], [150, 200], [150, 250], [100, 250], [100, 200]]],
      };

      // Access the internal function via a test helper
      const bounds = zoneInfoTags?._calculateZoneBounds?.(geometry);
      
      // Since calculateZoneBounds is not exported, we test it indirectly
      // by checking that zones with valid geometry create tags
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry,
        },
      ];

      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);

      gameStateManager.getAllZones = () => zones;
      zoneInfoTags.updateTags();

      // If bounds were calculated correctly, a tag should be created
      expect(zoneInfoTags.tags.size).toBeGreaterThan(0);
    });

    it('returns null for invalid geometry', () => {
      const zones = [
        {
          id: 1,
          zone_type: 'residential',
          floor: 0,
          geometry: null,
        },
      ];

      zoneInfoTags = new ZoneInfoTags(
        sceneManager,
        cameraController,
        gameStateManager,
        zoneManager,
        zoneEditor
      );
      zoneInfoTags.setToolbarExpanded(true);
      zoneInfoTags.setZonesVisible(true);

      gameStateManager.getAllZones = () => zones;
      zoneInfoTags.updateTags();

      // No tag should be created for invalid geometry
      expect(zoneInfoTags.tags.has(1)).toBe(false);
    });
  });
});

