/**
 * Coordinate System Conversion Utilities
 * 
 * Handles conversion between EarthRing coordinate system and various rendering engine coordinate systems.
 * 
 * EarthRing Standard Convention:
 * - X-axis: Ring position (East-West, 0 to 264,000 km)
 * - Y-axis: Width position (North-South, -2,500 to +2,500 m)
 * - Z-axis: Floor/Level (Elevation, integer floor numbers)
 * 
 * All game logic, database, and API use EarthRing convention.
 * Conversion happens only at the rendering layer boundary.
 */

/**
 * Default floor height in meters (20 meters per level for main ring structure)
 * @constant
 * @type {number}
 */
export const DEFAULT_FLOOR_HEIGHT = 20;

/**
 * EarthRing coordinate point
 * @typedef {Object} EarthRingPoint
 * @property {number} x - Ring position (0 to 264,000,000 meters)
 * @property {number} y - Width position (-2,500 to +2,500 meters)
 * @property {number} z - Floor/Level (integer floor number)
 */

/**
 * Three.js coordinate point
 * @typedef {Object} ThreeJSPoint
 * @property {number} x - Right (maps from EarthRing X)
 * @property {number} y - Up (maps from EarthRing Z * floor_height)
 * @property {number} z - Forward (maps from EarthRing Y)
 */

/**
 * Unreal Engine coordinate point (for future use)
 * @typedef {Object} UnrealPoint
 * @property {number} x - Right (maps from EarthRing X)
 * @property {number} y - Forward (maps from EarthRing Y)
 * @property {number} z - Up (maps from EarthRing Z * floor_height)
 */

/**
 * Convert EarthRing coordinates to Three.js coordinates
 * 
 * Three.js convention: Y-up, Z-forward
 * - X: Right (maps from EarthRing X)
 * - Y: Up (maps from EarthRing Z * floor_height)
 * - Z: Forward (maps from EarthRing Y)
 * 
 * @param {EarthRingPoint} earthringPoint - EarthRing coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {ThreeJSPoint} Three.js coordinate point
 */
export function toThreeJS(earthringPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    x: earthringPoint.x,
    y: earthringPoint.z * floorHeight,
    z: earthringPoint.y,
  };
}

/**
 * Convert Three.js coordinates to EarthRing coordinates
 * 
 * @param {ThreeJSPoint} threeJSPoint - Three.js coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {EarthRingPoint} EarthRing coordinate point
 */
export function fromThreeJS(threeJSPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    x: threeJSPoint.x,
    y: threeJSPoint.z,
    z: Math.round(threeJSPoint.y / floorHeight),
  };
}

/**
 * Convert EarthRing coordinates to Unreal Engine coordinates
 * 
 * Unreal Engine convention: Z-up, Y-forward
 * - X: Right (maps from EarthRing X)
 * - Y: Forward (maps from EarthRing Y)
 * - Z: Up (maps from EarthRing Z * floor_height)
 * 
 * @param {EarthRingPoint} earthringPoint - EarthRing coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {UnrealPoint} Unreal Engine coordinate point
 */
export function toUnreal(earthringPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    x: earthringPoint.x,
    y: earthringPoint.y,
    z: earthringPoint.z * floorHeight,
  };
}

/**
 * Convert Unreal Engine coordinates to EarthRing coordinates
 * 
 * @param {UnrealPoint} unrealPoint - Unreal Engine coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {EarthRingPoint} EarthRing coordinate point
 */
export function fromUnreal(unrealPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    x: unrealPoint.x,
    y: unrealPoint.y,
    z: Math.round(unrealPoint.z / floorHeight),
  };
}

/**
 * Convert EarthRing position to chunk index
 * 
 * Chunk index formula: floor(ring_position / 1000) % 264000
 * Handles negative positions by wrapping around the ring.
 * 
 * @param {number} ringPosition - Ring position in meters (X coordinate)
 * @returns {number} Chunk index (0 to 263,999)
 */
export function positionToChunkIndex(ringPosition) {
  const CHUNK_COUNT = 264000;
  const wrapped = wrapRingPosition(ringPosition);
  return Math.floor(wrapped / 1000) % CHUNK_COUNT;
}

/**
 * Convert chunk index to ring position range
 * 
 * @param {number} chunkIndex - Chunk index (0 to 263,999)
 * @returns {Object} Object with min and max ring positions in meters
 * @property {number} min - Minimum ring position for this chunk
 * @property {number} max - Maximum ring position for this chunk
 */
export function chunkIndexToPositionRange(chunkIndex) {
  const min = chunkIndex * 1000;
  const max = min + 1000;
  return { min, max };
}

/**
 * Wrap ring position to valid range (0 to 264,000,000 meters)
 * 
 * The ring wraps around, so positions outside the range are wrapped using modulo.
 * 
 * @param {number} ringPosition - Ring position in meters
 * @returns {number} Wrapped ring position (0 to 264,000,000)
 */
export function wrapRingPosition(ringPosition) {
  const RING_CIRCUMFERENCE = 264000000; // 264,000 km in meters
  return ((ringPosition % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
}

/**
 * Calculate distance between two EarthRing points
 * 
 * Accounts for ring wrapping (shortest path around the ring).
 * 
 * @param {EarthRingPoint} point1 - First EarthRing point
 * @param {EarthRingPoint} point2 - Second EarthRing point
 * @returns {number} Distance in meters
 */
export function distance(point1, point2) {
  // If points are on different floors, use 3D distance
  if (point1.z !== point2.z) {
    const dx = wrapRingPosition(point2.x - point1.x);
    const dy = point2.y - point1.y;
    const dz = (point2.z - point1.z) * DEFAULT_FLOOR_HEIGHT;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Same floor: calculate 2D distance with ring wrapping
  const RING_CIRCUMFERENCE = 264000000; // 264,000 km in meters
  const dx = wrapRingPosition(point2.x - point1.x);
  const dy = point2.y - point1.y;

  // Check if wrapping around the ring is shorter
  const directDistance = Math.sqrt(dx * dx + dy * dy);
  const wrappedDistance = Math.sqrt((RING_CIRCUMFERENCE - dx) * (RING_CIRCUMFERENCE - dx) + dy * dy);

  return Math.min(directDistance, wrappedDistance);
}

/**
 * Validate EarthRing coordinate point
 * 
 * @param {EarthRingPoint} point - EarthRing coordinate point to validate
 * @returns {Object} Validation result
 * @property {boolean} valid - Whether the point is valid
 * @property {string[]} errors - Array of error messages (empty if valid)
 */
export function validateEarthRingPoint(point) {
  const errors = [];

  if (typeof point.x !== 'number' || isNaN(point.x)) {
    errors.push('X coordinate must be a number');
  } else if (point.x < 0 || point.x > 264000000) {
    errors.push('X coordinate must be between 0 and 264,000,000 meters');
  }

  if (typeof point.y !== 'number' || isNaN(point.y)) {
    errors.push('Y coordinate must be a number');
  } else if (point.y < -2500 || point.y > 2500) {
    errors.push('Y coordinate must be between -2,500 and +2,500 meters');
  }

  if (typeof point.z !== 'number' || isNaN(point.z)) {
    errors.push('Z coordinate (floor) must be a number');
  } else if (!Number.isInteger(point.z)) {
    errors.push('Z coordinate (floor) must be an integer');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

