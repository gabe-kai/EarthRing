/**
 * Tests for coordinate conversion utilities
 */

import { describe, it, expect } from 'vitest';
import {
  toThreeJS,
  fromThreeJS,
  toUnreal,
  fromUnreal,
  positionToChunkIndex,
  chunkIndexToPositionRange,
  wrapRingPosition,
  distance,
  validateEarthRingPoint,
  DEFAULT_FLOOR_HEIGHT,
} from './coordinates.js';

describe('Coordinate Conversion', () => {
  describe('toThreeJS', () => {
    it('converts EarthRing coordinates to Three.js coordinates', () => {
      const earthringPoint = { x: 1000, y: 100, z: 2 };
      const result = toThreeJS(earthringPoint);

      expect(result.x).toBe(1000); // X maps directly
      expect(result.y).toBe(40); // Z * floor_height (2 * 20)
      expect(result.z).toBe(100); // Y maps to Z
    });

    it('uses custom floor height when provided', () => {
      const earthringPoint = { x: 1000, y: 100, z: 2 };
      const result = toThreeJS(earthringPoint, 10);

      expect(result.y).toBe(20); // Z * custom_floor_height (2 * 10)
    });
  });

  describe('fromThreeJS', () => {
    it('converts Three.js coordinates to EarthRing coordinates', () => {
      const threeJSPoint = { x: 1000, y: 40, z: 100 };
      const result = fromThreeJS(threeJSPoint);

      expect(result.x).toBe(1000); // X maps directly
      expect(result.y).toBe(100); // Z maps to Y
      expect(result.z).toBe(2); // Y / floor_height (40 / 20)
    });

    it('rounds floor number correctly', () => {
      const threeJSPoint = { x: 1000, y: 35, z: 100 };
      const result = fromThreeJS(threeJSPoint);

      expect(result.z).toBe(2); // 35 / 20 = 1.75, rounded to 2
    });

    it('uses custom floor height when provided', () => {
      const threeJSPoint = { x: 1000, y: 20, z: 100 };
      const result = fromThreeJS(threeJSPoint, 10);

      expect(result.z).toBe(2); // 20 / 10 = 2
    });
  });

  describe('toUnreal', () => {
    it('converts EarthRing coordinates to Unreal Engine coordinates', () => {
      const earthringPoint = { x: 1000, y: 100, z: 2 };
      const result = toUnreal(earthringPoint);

      expect(result.x).toBe(1000); // X maps directly
      expect(result.y).toBe(100); // Y maps directly
      expect(result.z).toBe(40); // Z * floor_height (2 * 20)
    });

    it('uses custom floor height when provided', () => {
      const earthringPoint = { x: 1000, y: 100, z: 2 };
      const result = toUnreal(earthringPoint, 10);

      expect(result.z).toBe(20); // Z * custom_floor_height (2 * 10)
    });
  });

  describe('fromUnreal', () => {
    it('converts Unreal Engine coordinates to EarthRing coordinates', () => {
      const unrealPoint = { x: 1000, y: 100, z: 40 };
      const result = fromUnreal(unrealPoint);

      expect(result.x).toBe(1000); // X maps directly
      expect(result.y).toBe(100); // Y maps directly
      expect(result.z).toBe(2); // Z / floor_height (40 / 20)
    });

    it('rounds floor number correctly', () => {
      const unrealPoint = { x: 1000, y: 100, z: 35 };
      const result = fromUnreal(unrealPoint);

      expect(result.z).toBe(2); // 35 / 20 = 1.75, rounded to 2
    });
  });

  describe('positionToChunkIndex', () => {
    it('converts ring position to chunk index', () => {
      expect(positionToChunkIndex(0)).toBe(0);
      expect(positionToChunkIndex(1000)).toBe(1);
      expect(positionToChunkIndex(5000)).toBe(5);
      expect(positionToChunkIndex(12345000)).toBe(12345);
    });

    it('wraps positions beyond ring circumference', () => {
      expect(positionToChunkIndex(264000000)).toBe(0); // Wraps to start
      expect(positionToChunkIndex(264001000)).toBe(1); // Wraps to chunk 1
      expect(positionToChunkIndex(528000000)).toBe(0); // Two full rotations
    });

    it('handles negative positions by wrapping', () => {
      expect(positionToChunkIndex(-1000)).toBe(263999); // Wraps to end
      expect(positionToChunkIndex(-5000)).toBe(263995);
    });
  });

  describe('chunkIndexToPositionRange', () => {
    it('converts chunk index to position range', () => {
      const range = chunkIndexToPositionRange(0);
      expect(range.min).toBe(0);
      expect(range.max).toBe(1000);

      const range2 = chunkIndexToPositionRange(12345);
      expect(range2.min).toBe(12345000);
      expect(range2.max).toBe(12346000);
    });

    it('handles maximum chunk index', () => {
      const range = chunkIndexToPositionRange(263999);
      expect(range.min).toBe(263999000);
      expect(range.max).toBe(264000000);
    });
  });

  describe('wrapRingPosition', () => {
    it('wraps positions within valid range', () => {
      expect(wrapRingPosition(0)).toBe(0);
      expect(wrapRingPosition(1000)).toBe(1000);
      expect(wrapRingPosition(264000000)).toBe(0);
    });

    it('wraps positions beyond ring circumference', () => {
      expect(wrapRingPosition(264001000)).toBe(1000);
      expect(wrapRingPosition(528000000)).toBe(0);
    });

    it('wraps negative positions', () => {
      expect(wrapRingPosition(-1000)).toBe(263999000);
      expect(wrapRingPosition(-5000)).toBe(263995000);
    });
  });

  describe('distance', () => {
    it('calculates distance between points on same floor', () => {
      const point1 = { x: 0, y: 0, z: 0 };
      const point2 = { x: 1000, y: 0, z: 0 };

      expect(distance(point1, point2)).toBe(1000);
    });

    it('calculates 2D distance with Y coordinate', () => {
      const point1 = { x: 0, y: 0, z: 0 };
      const point2 = { x: 1000, y: 100, z: 0 };

      const expected = Math.sqrt(1000 * 1000 + 100 * 100);
      expect(distance(point1, point2)).toBeCloseTo(expected, 5);
    });

    it('calculates 3D distance for different floors', () => {
      const point1 = { x: 0, y: 0, z: 0 };
      const point2 = { x: 0, y: 0, z: 2 };

      // Vertical distance: 2 floors * 20m = 40m
      expect(distance(point1, point2)).toBe(40);
    });

    it('accounts for ring wrapping (shortest path)', () => {
      const point1 = { x: 1000, y: 0, z: 0 };
      const point2 = { x: 263999000, y: 0, z: 0 };

      // Direct distance would be very large, wrapped distance is shorter
      const wrappedDistance = distance(point1, point2);
      expect(wrappedDistance).toBeLessThan(1000000); // Should be ~2000m (wrapped)
    });
  });

  describe('validateEarthRingPoint', () => {
    it('validates correct EarthRing point', () => {
      const point = { x: 1000, y: 100, z: 0 };
      const result = validateEarthRingPoint(point);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates point at ring boundaries', () => {
      const point1 = { x: 0, y: -2500, z: -10 };
      const result1 = validateEarthRingPoint(point1);
      expect(result1.valid).toBe(true);

      const point2 = { x: 264000000, y: 2500, z: 10 };
      const result2 = validateEarthRingPoint(point2);
      expect(result2.valid).toBe(true);
    });

    it('rejects invalid X coordinate', () => {
      const point1 = { x: -1, y: 0, z: 0 };
      const result1 = validateEarthRingPoint(point1);
      expect(result1.valid).toBe(false);
      expect(result1.errors).toContain('X coordinate must be between 0 and 264,000,000 meters');

      const point2 = { x: 264000001, y: 0, z: 0 };
      const result2 = validateEarthRingPoint(point2);
      expect(result2.valid).toBe(false);
    });

    it('rejects invalid Y coordinate', () => {
      const point1 = { x: 1000, y: -2501, z: 0 };
      const result1 = validateEarthRingPoint(point1);
      expect(result1.valid).toBe(false);
      expect(result1.errors).toContain('Y coordinate must be between -2,500 and +2,500 meters');

      const point2 = { x: 1000, y: 2501, z: 0 };
      const result2 = validateEarthRingPoint(point2);
      expect(result2.valid).toBe(false);
    });

    it('rejects non-integer Z coordinate', () => {
      const point = { x: 1000, y: 0, z: 1.5 };
      const result = validateEarthRingPoint(point);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Z coordinate (floor) must be an integer');
    });

    it('rejects NaN values', () => {
      const point = { x: NaN, y: 0, z: 0 };
      const result = validateEarthRingPoint(point);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects missing properties', () => {
      const point = { x: 1000, y: 0 };
      const result = validateEarthRingPoint(point);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Z coordinate (floor) must be a number');
    });
  });

  describe('round-trip conversion', () => {
    it('maintains EarthRing coordinates through Three.js conversion', () => {
      const original = { x: 12345, y: 500, z: 3 };
      const threeJS = toThreeJS(original);
      const converted = fromThreeJS(threeJS);

      expect(converted.x).toBe(original.x);
      expect(converted.y).toBe(original.y);
      expect(converted.z).toBe(original.z);
    });

    it('maintains EarthRing coordinates through Unreal conversion', () => {
      const original = { x: 12345, y: 500, z: 3 };
      const unreal = toUnreal(original);
      const converted = fromUnreal(unreal);

      expect(converted.x).toBe(original.x);
      expect(converted.y).toBe(original.y);
      expect(converted.z).toBe(original.z);
    });
  });
});

