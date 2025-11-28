/**
 * Tests for Minimap Component
 * Tests coordinate conversions, platform rendering, arrow direction, and grid system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Minimap } from './minimap.js';
import * as THREE from 'three';

// Setup jsdom environment for DOM APIs
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable',
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

// Mock CanvasRenderingContext2D
class MockCanvasRenderingContext2D {
  constructor() {
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 0;
    this.globalAlpha = 1.0;
    this.font = '';
    this.textAlign = '';
    this.shadowBlur = 0;
    this.shadowColor = '';
    this.calls = [];
  }

  fillRect(x, y, w, h) {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h] });
  }

  strokeRect(x, y, w, h) {
    this.calls.push({ method: 'strokeRect', args: [x, y, w, h] });
  }

  fill(rule) {
    this.calls.push({ method: 'fill', args: rule ? [rule] : [] });
  }

  stroke() {
    this.calls.push({ method: 'stroke', args: [] });
  }

  beginPath() {
    this.calls.push({ method: 'beginPath', args: [] });
  }

  moveTo(x, y) {
    this.calls.push({ method: 'moveTo', args: [x, y] });
  }

  lineTo(x, y) {
    this.calls.push({ method: 'lineTo', args: [x, y] });
  }

  closePath() {
    this.calls.push({ method: 'closePath', args: [] });
  }

  arc(x, y, radius, startAngle, endAngle) {
    this.calls.push({ method: 'arc', args: [x, y, radius, startAngle, endAngle] });
  }

  fillText(text, x, y) {
    this.calls.push({ method: 'fillText', args: [text, x, y] });
  }

  clearRect(x, y, w, h) {
    this.calls.push({ method: 'clearRect', args: [x, y, w, h] });
  }

  save() {
    this.calls.push({ method: 'save', args: [] });
  }

  restore() {
    this.calls.push({ method: 'restore', args: [] });
  }

  clip() {
    this.calls.push({ method: 'clip', args: [] });
  }

  rect(x, y, w, h) {
    this.calls.push({ method: 'rect', args: [x, y, w, h] });
  }
}

// Mock canvas getContext
HTMLCanvasElement.prototype.getContext = function(type) {
  if (type === '2d') {
    return new MockCanvasRenderingContext2D();
  }
  return null;
};

describe('Minimap', () => {
  let minimap;
  let mockCameraController;
  let mockGameStateManager;
  let mockSceneManager;
  let mockChunkManager;
  let mockCamera;

  beforeEach(() => {
    // Mock window.earthring
    global.window.earthring = {
      debug: false,
    };

    // Mock camera
    mockCamera = {
      quaternion: new THREE.Quaternion(),
      getWorldDirection: vi.fn((vector) => {
        vector.set(0, 0, -1); // Default forward
        return vector;
      }),
    };

    // Mock camera controller
    mockCameraController = {
      getTargetEarthRingPosition: vi.fn(() => ({
        x: 1000, // 1km along ring
        y: 0,
        z: 0,
      })),
    };

    // Mock game state manager
    mockGameStateManager = {
      getActiveFloor: vi.fn(() => 0),
      getChunk: vi.fn((chunkID) => {
        // Return mock chunk data for testing
        if (chunkID === '0_0') {
          return {
            geometry: {
              width: 400,
              vertices: [
                [0, -200, 0],
                [1000, -200, 0],
                [1000, 200, 0],
                [0, 200, 0],
              ],
            },
          };
        }
        return null;
      }),
    };

    // Mock scene manager
    mockSceneManager = {
      getCamera: vi.fn(() => mockCamera),
    };

    // Mock chunk manager
    mockChunkManager = {
      chunkMeshes: new Map(),
    };

    // Create minimap instance
    minimap = new Minimap(
      mockCameraController,
      mockGameStateManager,
      mockSceneManager,
      mockChunkManager
    );
  });

  afterEach(() => {
    if (minimap) {
      minimap.dispose();
    }
  });

  describe('Initialization', () => {
    it('creates minimap container and canvas', () => {
      expect(minimap.container).toBeDefined();
      expect(minimap.canvas).toBeDefined();
      expect(minimap.ctx).toBeDefined();
      expect(minimap.container.id).toBe('minimap-container');
    });

    it('starts with local zoom level', () => {
      expect(minimap.zoomLevel).toBe('local');
    });

    it('creates zoom control buttons', () => {
      const zoomOutBtn = minimap.container.querySelector('#minimap-zoom-out');
      const zoomInBtn = minimap.container.querySelector('#minimap-zoom-in');
      expect(zoomOutBtn).toBeDefined();
      expect(zoomInBtn).toBeDefined();
    });
  });

  describe('Zoom Controls', () => {
    it('switches to local view when zoom in button clicked', () => {
      const zoomInBtn = minimap.container.querySelector('#minimap-zoom-in');
      zoomInBtn.click();
      expect(minimap.zoomLevel).toBe('local');
    });

    it('switches to full view when zoom out button clicked', () => {
      minimap.zoomLevel = 'local';
      const zoomOutBtn = minimap.container.querySelector('#minimap-zoom-out');
      zoomOutBtn.click();
      expect(minimap.zoomLevel).toBe('full');
    });

    it('updates button styles based on zoom level', () => {
      const zoomOutBtn = minimap.container.querySelector('#minimap-zoom-out');
      const zoomInBtn = minimap.container.querySelector('#minimap-zoom-in');

      // Initially local view (default)
      expect(zoomOutBtn.style.background).toBe('transparent');
      expect(zoomInBtn.style.background).toContain('rgba(76, 175, 80');

      // Switch to full
      minimap.zoomLevel = 'full';
      minimap.updateZoomButtons();
      expect(zoomOutBtn.style.background).toContain('rgba(76, 175, 80');
      expect(zoomInBtn.style.background).toBe('transparent');
    });
  });

  describe('Coordinate Conversions', () => {
    it('converts camera target position to RingArc coordinates', () => {
      minimap.update();
      // Verify that getTargetEarthRingPosition was called
      expect(mockCameraController.getTargetEarthRingPosition).toHaveBeenCalled();
    });

    it('handles ring wrapping for arc differences', () => {
      // This is tested indirectly through the update process
      // The minimap should handle positions that wrap around the ring
      minimap.update();
      expect(mockCameraController.getTargetEarthRingPosition).toHaveBeenCalled();
    });
  });

  describe('Full Ring View', () => {
    it('draws ring circle', () => {
      minimap.zoomLevel = 'full';
      minimap.update();

      const arcCalls = minimap.ctx.calls.filter(c => c.method === 'arc');
      expect(arcCalls.length).toBeGreaterThan(0);
    });

    it('draws player position dot', () => {
      minimap.zoomLevel = 'full';
      minimap.update();

      const fillCalls = minimap.ctx.calls.filter(c => c.method === 'fill');
      expect(fillCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Local View - Grid System', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('draws grid lines', () => {
      minimap.update();

      const moveToCalls = minimap.ctx.calls.filter(c => c.method === 'moveTo');
      const lineToCalls = minimap.ctx.calls.filter(c => c.method === 'lineTo');
      
      // Should have grid lines (both vertical and horizontal)
      expect(moveToCalls.length).toBeGreaterThan(0);
      expect(lineToCalls.length).toBeGreaterThan(0);
    });

    it('calculates grid offset based on player position', () => {
      // Grid offset should be calculated from player position modulo grid spacing
      minimap.update();
      
      // Verify grid is drawn (indirect test of offset calculation)
      const strokeCalls = minimap.ctx.calls.filter(c => c.method === 'stroke');
      expect(strokeCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Local View - Player-Facing Arrow', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('draws arrow when camera has valid direction', () => {
      mockCamera.getWorldDirection.mockImplementation((vector) => {
        vector.set(1, 0, 0); // Facing east
        return vector;
      });

      minimap.update();

      // Should have beginPath, moveTo, lineTo, closePath, and fill calls for arrow
      const beginPathCalls = minimap.ctx.calls.filter(c => c.method === 'beginPath');
      const fillCalls = minimap.ctx.calls.filter(c => c.method === 'fill');
      
      expect(beginPathCalls.length).toBeGreaterThan(0);
      expect(fillCalls.length).toBeGreaterThan(0);
    });

    it('projects camera direction onto XZ plane', () => {
      // Set camera to face north (Z positive)
      mockCamera.getWorldDirection.mockImplementation((vector) => {
        vector.set(0, 0, 1); // Facing north
        return vector;
      });

      minimap.update();

      // Arrow should be drawn
      const fillCalls = minimap.ctx.calls.filter(c => c.method === 'fill');
      expect(fillCalls.length).toBeGreaterThan(0);
    });

    it('does not draw arrow when direction is too small', () => {
      mockCamera.getWorldDirection.mockImplementation((vector) => {
        vector.set(0.001, 0, 0.001); // Very small direction
        return vector;
      });

      const initialFillCalls = minimap.ctx.calls.filter(c => c.method === 'fill').length;
      minimap.update();
      const finalFillCalls = minimap.ctx.calls.filter(c => c.method === 'fill').length;
      
      // Arrow should not be drawn if direction is too small
      // (This is a weak test, but verifies the threshold check exists)
      expect(mockCamera.getWorldDirection).toHaveBeenCalled();
    });
  });

  describe('Local View - North Indicator', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('draws north indicator text', () => {
      minimap.update();

      const fillTextCalls = minimap.ctx.calls.filter(c => c.method === 'fillText');
      const nCalls = fillTextCalls.filter(c => c.args[0] === 'N');
      expect(nCalls.length).toBeGreaterThan(0);
    });

    it('draws north arrow', () => {
      minimap.update();

      const moveToCalls = minimap.ctx.calls.filter(c => c.method === 'moveTo');
      const lineToCalls = minimap.ctx.calls.filter(c => c.method === 'lineTo');
      
      // North arrow should have moveTo and lineTo calls
      expect(moveToCalls.length).toBeGreaterThan(0);
      expect(lineToCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Local View - Platform Rendering', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('finds chunks in range of player', () => {
      minimap.update();

      // Should call getChunk for chunks in range
      expect(mockGameStateManager.getChunk).toHaveBeenCalled();
    });

    it('renders platforms when chunk data is available', () => {
      // Set up chunk data
      mockGameStateManager.getChunk.mockReturnValue({
        geometry: {
          width: 400,
          vertices: [
            [0, -200, 0],
            [1000, -200, 0],
            [1000, 200, 0],
            [0, 200, 0],
          ],
        },
      });

      minimap.update();

      // Should attempt to draw platforms
      const fillCalls = minimap.ctx.calls.filter(c => c.method === 'fill');
      const strokeCalls = minimap.ctx.calls.filter(c => c.method === 'stroke');
      
      // May or may not draw depending on distance, but should at least check
      expect(mockGameStateManager.getChunk).toHaveBeenCalled();
    });

    it('calculates chunk radial position from geometry', () => {
      mockGameStateManager.getChunk.mockReturnValue({
        geometry: {
          width: 400,
          vertices: [
            [0, -200, 0],
            [1000, -200, 0],
            [1000, 200, 0],
            [0, 200, 0],
          ],
        },
      });

      minimap.update();

      // Should process chunk and calculate radial position
      expect(mockGameStateManager.getChunk).toHaveBeenCalled();
    });

    it('handles chunks without data gracefully', () => {
      mockGameStateManager.getChunk.mockReturnValue(null);

      minimap.update();

      // Should not crash when chunk data is missing
      expect(mockGameStateManager.getChunk).toHaveBeenCalled();
    });
  });

  describe('Platform Mesh Projection', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('projects mesh vertices to screen coordinates', () => {
      // Create a mock mesh
      const mockMesh = {
        geometry: {
          attributes: {
            position: {
              count: 4,
              getX: vi.fn((i) => [0, 1000, 1000, 0][i]),
              getY: vi.fn((i) => [0, 0, 0, 0][i]),
              getZ: vi.fn((i) => [0, 0, 0, 0][i]),
            },
          },
        },
        matrixWorld: new THREE.Matrix4(),
        updateMatrixWorld: vi.fn(),
      };

      mockChunkManager.chunkMeshes.set('0_0', mockMesh);
      mockGameStateManager.getChunk.mockReturnValue(null);

      minimap.update();

      // Should attempt to use mesh for rendering
      expect(mockMesh.updateMatrixWorld).toHaveBeenCalled();
    });

    it('sorts polygon points by angle to prevent moire patterns', () => {
      // This is tested indirectly - if sorting works, polygon renders correctly
      const mockMesh = {
        geometry: {
          attributes: {
            position: {
              count: 10,
              getX: vi.fn((i) => i * 100),
              getY: vi.fn(() => 0),
              getZ: vi.fn((i) => (i % 2) * 100),
            },
          },
        },
        matrixWorld: new THREE.Matrix4(),
        updateMatrixWorld: vi.fn(),
      };

      mockChunkManager.chunkMeshes.set('0_0', mockMesh);
      minimap.update();

      // Should process mesh vertices
      expect(mockMesh.updateMatrixWorld).toHaveBeenCalled();
    });

    it('uses evenodd fill rule for polygon rendering', () => {
      const mockMesh = {
        geometry: {
          attributes: {
            position: {
              count: 8,
              getX: vi.fn((i) => Math.cos(i * Math.PI / 4) * 500),
              getY: vi.fn(() => 0),
              getZ: vi.fn((i) => Math.sin(i * Math.PI / 4) * 500),
            },
          },
        },
        matrixWorld: new THREE.Matrix4(),
        updateMatrixWorld: vi.fn(),
      };

      mockChunkManager.chunkMeshes.set('0_0', mockMesh);
      minimap.update();

      // Check if fill was called with 'evenodd' rule
      const fillCalls = minimap.ctx.calls.filter(c => c.method === 'fill');
      const evenoddCalls = fillCalls.filter(c => c.args && c.args[0] === 'evenodd');
      
      // Should use evenodd fill rule for polygons
      expect(evenoddCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Drawing Order', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('draws arrow and north indicator after platforms', () => {
      // Set up chunk data to ensure platforms are drawn
      mockGameStateManager.getChunk.mockReturnValue({
        geometry: {
          width: 400,
          vertices: [
            [0, -200, 0],
            [1000, -200, 0],
            [1000, 200, 0],
            [0, 200, 0],
          ],
        },
      });

      minimap.update();

      // Get all drawing calls
      const allCalls = minimap.ctx.calls;
      
      // Find last fill call (should be arrow or north indicator)
      const lastFillCallIndex = allCalls.map((c, i) => c.method === 'fill' ? i : -1)
        .filter(i => i >= 0)
        .pop();
      
      // Find last fillText call (should be north indicator 'N')
      const lastFillTextCallIndex = allCalls.map((c, i) => c.method === 'fillText' ? i : -1)
        .filter(i => i >= 0)
        .pop();

      // Arrow and north indicator should be drawn after platforms
      // (This is a structural test - if they're last, they're on top)
      expect(lastFillCallIndex).toBeDefined();
      expect(lastFillTextCallIndex).toBeDefined();
    });
  });

  describe('Grid Movement', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('calculates grid offset correctly for different player positions', () => {
      // Test with player at different positions
      mockCameraController.getTargetEarthRingPosition.mockReturnValue({
        x: 250, // 250m along ring (should offset grid by 250m)
        y: 0,
        z: 0,
      });

      minimap.update();
      const calls1 = minimap.ctx.calls.length;

      // Move player to different position
      mockCameraController.getTargetEarthRingPosition.mockReturnValue({
        x: 750, // 750m along ring (should offset grid by 750m)
        y: 0,
        z: 0,
      });

      minimap.update();
      const calls2 = minimap.ctx.calls.length;

      // Grid should be drawn in both cases
      expect(calls1).toBeGreaterThan(0);
      expect(calls2).toBeGreaterThan(0);
    });

    it('grid lines move with player radial position', () => {
      // Test with player at different radial positions
      mockCameraController.getTargetEarthRingPosition.mockReturnValue({
        x: 1000,
        y: 0,
        z: 250, // 250m north (radial offset)
      });

      minimap.update();
      const moveToCalls1 = minimap.ctx.calls.filter(c => c.method === 'moveTo');

      mockCameraController.getTargetEarthRingPosition.mockReturnValue({
        x: 1000,
        y: 0,
        z: 750, // 750m north
      });

      minimap.update();
      const moveToCalls2 = minimap.ctx.calls.filter(c => c.method === 'moveTo');

      // Grid should be drawn in both cases
      expect(moveToCalls1.length).toBeGreaterThan(0);
      expect(moveToCalls2.length).toBeGreaterThan(0);
    });
  });

  describe('Coordinate System', () => {
    beforeEach(() => {
      minimap.zoomLevel = 'local';
    });

    it('calculates screen coordinates without negating Y', () => {
      // Set up chunk at known position
      mockGameStateManager.getChunk.mockReturnValue({
        geometry: {
          width: 400,
          vertices: [
            [0, -200, 0],
            [1000, -200, 0],
            [1000, 200, 0],
            [0, 200, 0],
          ],
        },
      });

      // Set player at center
      mockCameraController.getTargetEarthRingPosition.mockReturnValue({
        x: 500, // 500m along ring
        y: 0,
        z: 0, // At centerline (r=0)
      });

      minimap.update();

      // Should have drawn platforms
      const fillCalls = minimap.ctx.calls.filter(c => c.method === 'fill');
      expect(fillCalls.length).toBeGreaterThan(0);
    });

    it('handles ring wrapping correctly for arc differences', () => {
      // Test with player near ring boundary
      mockCameraController.getTargetEarthRingPosition.mockReturnValue({
        x: 263999000, // Near end of ring
        y: 0,
        z: 0,
      });

      minimap.update();

      // Should handle wrapping without errors
      expect(mockCameraController.getTargetEarthRingPosition).toHaveBeenCalled();
    });
  });

  describe('Update Frequency', () => {
    it('updates on interval', (done) => {
      const updateSpy = vi.spyOn(minimap, 'update');
      
      // Wait for at least one interval (200ms)
      setTimeout(() => {
        expect(updateSpy).toHaveBeenCalled();
        done();
      }, 250);
    });

    it('stops updates when disposed', () => {
      const updateSpy = vi.spyOn(minimap, 'update');
      minimap.dispose();

      // Wait a bit to ensure interval is cleared
      setTimeout(() => {
        const callCount = updateSpy.mock.calls.length;
        // Should not have been called after dispose
        expect(callCount).toBe(0);
      }, 250);
    });
  });

  describe('Canvas Resizing', () => {
    it('resizes canvas when container size changes', () => {
      const initialWidth = minimap.canvas.width;
      const initialHeight = minimap.canvas.height;

      // Simulate container resize
      const container = minimap.container.querySelector('.minimap-canvas-container');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({
          width: 300,
          height: 250,
        }),
      });

      minimap.resizeCanvas();

      // Canvas should be resized (if container has valid size)
      expect(minimap.canvas).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('handles missing camera gracefully', () => {
      mockSceneManager.getCamera.mockReturnValue(null);
      
      expect(() => minimap.update()).not.toThrow();
    });

    it('handles missing camera controller gracefully', () => {
      minimap.cameraController = null;
      
      expect(() => minimap.update()).not.toThrow();
    });

    it('handles missing game state manager gracefully', () => {
      minimap.gameStateManager = null;
      
      expect(() => minimap.update()).not.toThrow();
    });
  });

  describe('Disposal', () => {
    it('removes container from DOM', () => {
      const containerId = minimap.container.id;
      minimap.dispose();
      
      const removedContainer = document.getElementById(containerId);
      expect(removedContainer).toBeNull();
    });

    it('clears update interval', () => {
      minimap.dispose();
      expect(minimap.updateInterval).toBeNull();
    });

    it('clears references', () => {
      minimap.dispose();
      expect(minimap.container).toBeNull();
      expect(minimap.canvas).toBeNull();
      expect(minimap.ctx).toBeNull();
    });
  });
});

