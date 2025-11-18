/**
 * Tests for decompression utilities
 */

import { describe, it, expect } from 'vitest';
import { 
  isCompressedGeometry, 
  decompressChunkGeometry,
  isCompressedMetadata,
  decompressMetadata
} from './decompression.js';

describe('decompression utilities', () => {
  describe('isCompressedGeometry', () => {
    it('should return true for compressed geometry format', () => {
      const compressed = {
        format: 'binary_gzip',
        data: 'base64data',
        size: 100,
        uncompressed_size: 500
      };
      expect(isCompressedGeometry(compressed)).toBe(true);
    });

    it('should return false for uncompressed geometry', () => {
      const uncompressed = {
        type: 'ring_floor',
        vertices: [[0, 0, 0]],
        faces: [[0, 1, 2]]
      };
      expect(isCompressedGeometry(uncompressed)).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isCompressedGeometry(null)).toBe(false);
      expect(isCompressedGeometry(undefined)).toBe(false);
    });

    it('should return false for invalid format', () => {
      const invalid = {
        format: 'invalid',
        data: 'test'
      };
      expect(isCompressedGeometry(invalid)).toBe(false);
    });
  });

  describe('decompressChunkGeometry', () => {
    it('should return geometry as-is if not compressed', async () => {
      const uncompressed = {
        type: 'ring_floor',
        vertices: [[0, 0, 0], [1000, 0, 0]],
        faces: [[0, 1, 2]]
      };
      const result = await decompressChunkGeometry(uncompressed);
      expect(result).toEqual(uncompressed);
    });

    it('should throw error for invalid compressed data', async () => {
      const invalid = {
        format: 'binary_gzip',
        data: 'invalid_base64!!!',
        size: 10,
        uncompressed_size: 100
      };
      await expect(decompressChunkGeometry(invalid)).rejects.toThrow();
    });

    // Note: Full round-trip test would require actual compressed data from server
    // This would be better as an integration test
  });

  describe('isCompressedMetadata', () => {
    it('should return true for compressed metadata format', () => {
      const compressed = {
        format: 'msgpack_gzip',
        data: 'base64data'
      };
      expect(isCompressedMetadata(compressed)).toBe(true);
    });

    it('should return false for uncompressed metadata', () => {
      const uncompressed = {
        chunk_id: '0_123',
        floor: 0,
        chunk_index: 123
      };
      expect(isCompressedMetadata(uncompressed)).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isCompressedMetadata(null)).toBe(false);
      expect(isCompressedMetadata(undefined)).toBe(false);
    });
  });

  describe('decompressMetadata', () => {
    it('should return metadata as-is if not compressed', async () => {
      const uncompressed = {
        chunk_id: '0_123',
        floor: 0
      };
      const result = await decompressMetadata(uncompressed);
      expect(result).toEqual(uncompressed);
    });

    it('should throw error for invalid compressed data', async () => {
      const invalid = {
        format: 'msgpack_gzip',
        data: 'invalid_base64!!!'
      };
      await expect(decompressMetadata(invalid)).rejects.toThrow();
    });
  });
});

