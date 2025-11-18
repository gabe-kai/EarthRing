/**
 * Decompression utilities for chunk data
 * Handles decompression of geometry and metadata from server
 */

import pako from 'pako';
import { decode } from '@msgpack/msgpack';

/**
 * Check if geometry data is compressed
 * @param {Object} geometry - Geometry data (may be compressed or uncompressed)
 * @returns {boolean} True if geometry is in compressed format
 */
export function isCompressedGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return false;
  }
  return geometry.format === 'binary_gzip' && 
         typeof geometry.data === 'string' &&
         typeof geometry.size === 'number';
}

/**
 * Decompress chunk geometry from compressed format
 * @param {Object} compressedGeometry - Compressed geometry object with format, data, size
 * @returns {Object} Decompressed geometry in standard format
 */
export async function decompressChunkGeometry(compressedGeometry) {
  if (!isCompressedGeometry(compressedGeometry)) {
    // Not compressed, return as-is
    return compressedGeometry;
  }

  try {
    // 1. Decode base64 to binary
    const base64Data = compressedGeometry.data;
    const binaryData = base64ToArrayBuffer(base64Data);

    // 2. Decompress gzip
    const decompressedBinary = pako.inflate(binaryData);

    // 3. Decode binary format to geometry
    // pako.inflate returns Uint8Array, but DataView needs ArrayBuffer
    const geometry = decodeGeometryBinary(decompressedBinary.buffer);

    return geometry;
  } catch (error) {
    console.error('Failed to decompress chunk geometry:', error);
    throw new Error(`Geometry decompression failed: ${error.message}`);
  }
}

/**
 * Convert base64 string to ArrayBuffer
 * @param {string} base64 - Base64-encoded string
 * @returns {ArrayBuffer} Binary data
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decode binary format to geometry object
 * @param {ArrayBuffer} binaryData - Decompressed binary data (ArrayBuffer)
 * @returns {Object} Geometry object with vertices, faces, normals, etc.
 */
function decodeGeometryBinary(binaryData) {
  const view = new DataView(binaryData);
  let offset = 0;

  // Read header (16 bytes)
  const magic = String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
  offset += 4;

  if (magic !== 'CHNK') {
    throw new Error(`Invalid geometry format: expected 'CHNK', got '${magic}'`);
  }

  const version = view.getUint8(offset);
  offset += 1;

  if (version !== 1) {
    throw new Error(`Unsupported geometry version: ${version}`);
  }

  const formatFlags = view.getUint8(offset);
  offset += 1;

  const use32BitIndices = (formatFlags & 0x01) !== 0;

  const vertexCount = view.getUint16(offset, true); // Little endian
  offset += 2;

  const indexCount = view.getUint16(offset, true); // Little endian
  offset += 2;

  // Read base X coordinate (quantized) - this is added to all relative X values
  // Use getBigInt64 and convert to Number (int64 to handle large positions)
  const baseXQuantized = Number(view.getBigInt64(offset, true)); // Little endian
  offset += 8;

  // Read vertices
  const vertices = [];
  const QuantizationX = 0.01;  // 1cm precision
  const QuantizationY = 0.001; // 1mm precision
  const QuantizationZ = 0.01;  // 1cm precision

  for (let i = 0; i < vertexCount; i++) {
    // Read relative X (relative to base), then add base X back
    const relativeX = view.getInt32(offset, true) * QuantizationX;
    offset += 4;
    const y = view.getInt32(offset, true) * QuantizationY;
    offset += 4;
    const z = view.getInt32(offset, true) * QuantizationZ;
    offset += 4;
    // Add base X back to get absolute position
    const x = relativeX + (baseXQuantized * QuantizationX);
    vertices.push([x, y, z]);
  }

  // Read indices (faces)
  const faces = [];
  const faceCount = indexCount / 3;

  for (let i = 0; i < faceCount; i++) {
    const indices = [];
    for (let j = 0; j < 3; j++) {
      if (use32BitIndices) {
        indices.push(view.getUint32(offset, true));
        offset += 4;
      } else {
        indices.push(view.getUint16(offset, true));
        offset += 2;
      }
    }
    faces.push(indices);
  }

  // Generate normals (simplified - in production we'd read from binary if stored)
  // For now, we'll generate flat normals for ring_floor geometry
  const normals = [];
  for (let i = 0; i < vertices.length; i++) {
    normals.push([0, 0, 1]); // Upward normal for ring floor
  }

  // Calculate width and length from vertices
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const vertex of vertices) {
    minX = Math.min(minX, vertex[0]);
    maxX = Math.max(maxX, vertex[0]);
    minY = Math.min(minY, vertex[1]);
    maxY = Math.max(maxY, vertex[1]);
  }

  const width = maxY - minY;
  const length = maxX - minX;

  return {
    type: 'ring_floor',
    vertices,
    faces,
    normals,
    width,
    length
  };
}

/**
 * Check if metadata is compressed
 * @param {Object} metadata - Metadata data (may be compressed or uncompressed)
 * @returns {boolean} True if metadata is in compressed format
 */
export function isCompressedMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return metadata.format === 'msgpack_gzip' && 
         typeof metadata.data === 'string';
}

/**
 * Decompress chunk metadata from compressed format
 * @param {Object} compressedMetadata - Compressed metadata object
 * @returns {Object} Decompressed metadata
 */
export async function decompressMetadata(compressedMetadata) {
  if (!isCompressedMetadata(compressedMetadata)) {
    // Not compressed, return as-is
    return compressedMetadata;
  }

  try {
    // 1. Decode base64 to binary
    const base64Data = compressedMetadata.data;
    const binaryData = base64ToArrayBuffer(base64Data);

    // 2. Decompress gzip
    const decompressedBinary = pako.inflate(binaryData);

    // 3. Decode MessagePack
    // decode can handle Uint8Array directly
    const metadata = decode(decompressedBinary);

    return metadata;
  } catch (error) {
    console.error('Failed to decompress metadata:', error);
    throw new Error(`Metadata decompression failed: ${error.message}`);
  }
}

