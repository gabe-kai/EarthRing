/**
 * New Coordinate System Utilities
 * 
 * Implements ER0 (Earth-Centered, Earth-Fixed) and EarthRing coordinate systems.
 * 
 * Coordinate Systems:
 * 1. ER0: Earth-Centered, Earth-Fixed Frame
 *    - Origin: (0,0,0) = center of Earth
 *    - +X axis: intersection of equator and prime meridian (Kongo Pillar vertical line)
 *    - +Y axis: 90°E on the equator
 *    - +Z axis: North Pole
 * 
 * 2. RingPolar: (theta, r, z)
 *    - theta: angle around ring in radians (0 at Kongo Hub, wraps at ±π)
 *    - r: radial offset from ring centerline in meters
 *    - z: vertical offset from equatorial plane in meters
 * 
 * 3. RingArc: (s, r, z)
 *    - s: arc length along ring in meters (0 at Kongo Hub, wraps at circumference)
 *    - r: radial offset from ring centerline in meters
 *    - z: vertical offset from equatorial plane in meters
 */

// Earth-Centered, Earth-Fixed (ER0) Frame Constants
export const EARTH_RADIUS = 6378137.0; // WGS84 equatorial radius in meters
export const RING_ORBITAL_RADIUS = 42164000.0; // Geostationary orbit radius in meters
export const KONGO_HUB_ALTITUDE = 500000.0; // Kongo Hub altitude above Earth's surface in meters
export const KONGO_HUB_RADIUS = EARTH_RADIUS + KONGO_HUB_ALTITUDE;
export const RING_CIRCUMFERENCE = 264000000; // Ring circumference in meters
export const CHUNK_LENGTH = 1000; // Chunk length in meters (1 km)
export const CHUNK_COUNT = 264000; // Total number of chunks around the ring
export const DEFAULT_FLOOR_HEIGHT = 20; // Default floor height in meters (20 meters per level for main ring structure)


/**
 * ER0Point represents a point in Earth-Centered, Earth-Fixed coordinates
 * @typedef {Object} ER0Point
 * @property {number} x - X coordinate in meters
 * @property {number} y - Y coordinate in meters
 * @property {number} z - Z coordinate in meters
 */

/**
 * RingPolar represents a position in EarthRing polar coordinates
 * @typedef {Object} RingPolar
 * @property {number} theta - Angle around ring in radians (0 at Kongo Hub, wraps at ±π)
 * @property {number} r - Radial offset from ring centerline in meters
 * @property {number} z - Vertical offset from equatorial plane in meters
 */

/**
 * RingArc represents a position in EarthRing arc-length coordinates
 * @typedef {Object} RingArc
 * @property {number} s - Arc length along ring in meters (0 at Kongo Hub, wraps at circumference)
 * @property {number} r - Radial offset from ring centerline in meters
 * @property {number} z - Vertical offset from equatorial plane in meters
 */

/**
 * Convert RingPolar coordinates to ER0 coordinates
 * Formula: R = R_ring + r, x = R * cos(theta), y = R * sin(theta), z_world = z
 * 
 * @param {RingPolar} polar - RingPolar coordinates
 * @returns {ER0Point} ER0 coordinates
 */
export function ringPolarToER0(polar) {
  const R = RING_ORBITAL_RADIUS + polar.r;
  return {
    x: R * Math.cos(polar.theta),
    y: R * Math.sin(polar.theta),
    z: polar.z,
  };
}

/**
 * Convert ER0 coordinates to RingPolar coordinates
 * 
 * @param {ER0Point} er0 - ER0 coordinates
 * @returns {RingPolar} RingPolar coordinates
 */
export function er0ToRingPolar(er0) {
  // Calculate theta from X and Y
  const theta = Math.atan2(er0.y, er0.x);
  
  // Calculate radial distance from Earth's center in the equatorial plane
  const R = Math.sqrt(er0.x * er0.x + er0.y * er0.y);
  
  // Calculate radial offset from ring centerline
  const r = R - RING_ORBITAL_RADIUS;
  
  // Z is the vertical offset from equatorial plane
  const z = er0.z;
  
  return {
    theta: theta,
    r: r,
    z: z,
  };
}

/**
 * Convert RingArc coordinates to RingPolar coordinates
 * Formula: theta = (s / RingCircumference) * 2π, then normalize to [-π, π)
 * 
 * @param {RingArc} arc - RingArc coordinates
 * @returns {RingPolar} RingPolar coordinates
 */
export function ringArcToRingPolar(arc) {
  // Convert arc length to theta: theta = (s / C) * 2Ï€
  let theta = (arc.s / RING_CIRCUMFERENCE) * 2 * Math.PI;
  // Normalize theta to [-π, π)
  theta = wrapTheta(theta);
  return {
    theta: theta,
    r: arc.r,
    z: arc.z,
  };
}

/**
 * Convert RingPolar coordinates to RingArc coordinates
 * Formula: s = (theta / 2π) * RingCircumference, wrapped to [0, RingCircumference)
 * 
 * @param {RingPolar} polar - RingPolar coordinates
 * @returns {RingArc} RingArc coordinates
 */
export function ringPolarToRingArc(polar) {
  // Convert to arc length: s = (theta / 2π) * RingCircumference
  // Preserve sign of theta to handle negative positions correctly
  // Negative theta maps to negative arc length, which wraps correctly
  let s = (polar.theta / (2 * Math.PI)) * RING_CIRCUMFERENCE;
  // Wrap s to [0, RingCircumference) - this handles negative values correctly
  s = wrapArcLength(s);
  return {
    s: s,
    r: polar.r,
    z: polar.z,
  };
}

/**
 * Wrap theta to the range [-π, π)
 * 
 * @param {number} theta - Angle in radians
 * @returns {number} Wrapped angle in [-Ï€, Ï€)
 */
export function wrapTheta(theta) {
  return ((theta + Math.PI) % (2 * Math.PI)) - Math.PI;
}

/**
 * Wrap arc length s to the range [0, RingCircumference)
 * 
 * @param {number} s - Arc length in meters
 * @returns {number} Wrapped arc length in [0, RingCircumference)
 */
export function wrapArcLength(s) {
  return ((s % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
}

/**
 * Convert legacy X position (0 to 264,000,000) to RingPolar
 * Legacy X=0 corresponds to Kongo Hub (theta=0)
 * Legacy X increases eastward, so theta = (X / RingCircumference) * 2π
 * Legacy Y (width position) maps to R (radial offset)
 * Legacy Z (floor/level) maps to Z (vertical offset)
 * 
 * @param {number} legacyX - Legacy X position in meters
 * @param {number} legacyY - Legacy Y position (width) in meters
 * @param {number} legacyZ - Legacy Z position (floor/level)
 * @returns {RingPolar} RingPolar coordinates
 */
export function legacyPositionToRingPolar(legacyX, legacyY, legacyZ) {
  // Convert to theta directly from legacy X, preserving sign information
  // theta = (X / C) * 2π, then normalize to [-π, π)
  // This handles negative positions correctly (e.g., -1000 maps to negative theta)
  let theta = (legacyX / RING_CIRCUMFERENCE) * 2 * Math.PI;
  theta = wrapTheta(theta);
  
  return {
    theta: theta,
    r: legacyY, // Legacy Y (width position) maps to R (radial offset)
    z: legacyZ, // Legacy Z (floor/level) maps to Z (vertical offset)
  };
}

/**
 * Convert RingPolar to legacy position
 * Legacy X = (theta / 2π) * RingCircumference, wrapped to [0, RingCircumference)
 * Legacy Y = R (radial offset)
 * Legacy Z = Z (vertical offset)
 * 
 * @param {RingPolar} polar - RingPolar coordinates
 * @returns {Object} Legacy position {x, y, z}
 */
export function ringPolarToLegacyPosition(polar) {
  // Convert to RingArc first, then extract arc length as legacy X
  const arc = ringPolarToRingArc(polar);
  
  return {
    x: arc.s, // Legacy X is the arc length (wrapped to [0, RING_CIRCUMFERENCE))
    y: polar.r, // Legacy Y is the radial offset (R)
    z: polar.z, // Legacy Z is the vertical offset (Z)
  };
}

/**
 * Validate RingPolar coordinates
 * 
 * @param {RingPolar} polar - RingPolar coordinates to validate
 * @returns {Object} Validation result {valid: boolean, errors: string[]}
 */
export function validateRingPolar(polar) {
  const errors = [];
  
  if (typeof polar.theta !== 'number' || isNaN(polar.theta) || !isFinite(polar.theta)) {
    errors.push('Invalid theta: must be a finite number');
  }
  if (typeof polar.r !== 'number' || isNaN(polar.r) || !isFinite(polar.r)) {
    errors.push('Invalid r: must be a finite number');
  }
  if (typeof polar.z !== 'number' || isNaN(polar.z) || !isFinite(polar.z)) {
    errors.push('Invalid z: must be a finite number');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Validate RingArc coordinates
 * 
 * @param {RingArc} arc - RingArc coordinates to validate
 * @returns {Object} Validation result {valid: boolean, errors: string[]}
 */
export function validateRingArc(arc) {
  const errors = [];
  
  if (typeof arc.s !== 'number' || isNaN(arc.s) || !isFinite(arc.s)) {
    errors.push('Invalid s: must be a finite number');
  }
  if (typeof arc.r !== 'number' || isNaN(arc.r) || !isFinite(arc.r)) {
    errors.push('Invalid r: must be a finite number');
  }
  if (typeof arc.z !== 'number' || isNaN(arc.z) || !isFinite(arc.z)) {
    errors.push('Invalid z: must be a finite number');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Convert RingArc arc length (s) to chunk index
 * Chunk index = s / CHUNK_LENGTH, wrapped to [0, CHUNK_COUNT)
 * 
 * @param {RingArc} arc - RingArc coordinates
 * @returns {number} Chunk index (0 to CHUNK_COUNT - 1)
 */
export function ringArcToChunkIndex(arc) {
  const wrappedS = wrapArcLength(arc.s);
  // Since wrappedS is in [0, RING_CIRCUMFERENCE) and CHUNK_COUNT = RING_CIRCUMFERENCE / CHUNK_LENGTH,
  // chunkIndex will always be in [0, CHUNK_COUNT), so no additional wrapping needed
  return Math.floor(wrappedS / CHUNK_LENGTH);
}

/**
 * Convert RingPolar to chunk index via RingArc
 * 
 * @param {RingPolar} polar - RingPolar coordinates
 * @returns {number} Chunk index (0 to CHUNK_COUNT - 1)
 */
export function ringPolarToChunkIndex(polar) {
  const arc = ringPolarToRingArc(polar);
  return ringArcToChunkIndex(arc);
}

/**
 * Convert chunk index to RingArc coordinates
 * Returns the center arc length of the chunk
 * 
 * @param {number} chunkIndex - Chunk index (0 to CHUNK_COUNT - 1)
 * @returns {RingArc} RingArc coordinates at chunk center
 */
export function chunkIndexToRingArc(chunkIndex) {
  // Wrap chunk index to valid range
  const wrappedIndex = ((chunkIndex % CHUNK_COUNT) + CHUNK_COUNT) % CHUNK_COUNT;
  // Center of chunk: s = (chunkIndex + 0.5) * CHUNK_LENGTH
  const s = (wrappedIndex + 0.5) * CHUNK_LENGTH;
  return {
    s: wrapArcLength(s),
    r: 0, // Default to centerline
    z: 0, // Default to equatorial plane
  };
}

/**
 * Convert chunk index to RingPolar coordinates via RingArc
 * 
 * @param {number} chunkIndex - Chunk index (0 to CHUNK_COUNT - 1)
 * @returns {RingPolar} RingPolar coordinates at chunk center
 */
export function chunkIndexToRingPolar(chunkIndex) {
  const arc = chunkIndexToRingArc(chunkIndex);
  return ringArcToRingPolar(arc);
}

/**
 * Validate ER0 coordinates
 * 
 * @param {ER0Point} er0 - ER0 coordinates to validate
 * @returns {Object} Validation result {valid: boolean, errors: string[]}
 */
export function validateER0(er0) {
  const errors = [];
  
  if (typeof er0.x !== 'number' || isNaN(er0.x) || !isFinite(er0.x)) {
    errors.push('Invalid X: must be a finite number');
  }
  if (typeof er0.y !== 'number' || isNaN(er0.y) || !isFinite(er0.y)) {
    errors.push('Invalid Y: must be a finite number');
  }
  if (typeof er0.z !== 'number' || isNaN(er0.z) || !isFinite(er0.z)) {
    errors.push('Invalid Z: must be a finite number');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Three.js coordinate point
 * @typedef {Object} ThreeJSPoint
 * @property {number} x - Right (maps from ring position)
 * @property {number} y - Up (maps from floor * floor_height)
 * @property {number} z - Forward (maps from radial offset)
 */

/**
 * Convert RingArc coordinates to Three.js coordinates
 * 
 * Three.js convention: Y-up, Z-forward
 * - X: Right (maps from arc length s)
 * - Y: Up (maps from z * floor_height, where z is vertical offset)
 * - Z: Forward (maps from radial offset r)
 * 
 * @param {RingArc} ringArc - RingArc coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {ThreeJSPoint} Three.js coordinate point
 */
export function ringArcToThreeJS(ringArc, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    x: ringArc.s,
    y: ringArc.z * floorHeight, // z is vertical offset, convert to height
    z: ringArc.r, // r is radial offset
  };
}

/**
 * Convert Three.js coordinates to RingArc coordinates
 * 
 * @param {ThreeJSPoint} threeJSPoint - Three.js coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {RingArc} RingArc coordinate point
 */
export function threeJSToRingArc(threeJSPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    s: threeJSPoint.x,
    r: threeJSPoint.z,
    z: threeJSPoint.y / floorHeight, // Convert height back to vertical offset
  };
}

/**
 * Convert RingPolar coordinates to Three.js coordinates
 * 
 * @param {RingPolar} ringPolar - RingPolar coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {ThreeJSPoint} Three.js coordinate point
 */
export function ringPolarToThreeJS(ringPolar, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const arc = ringPolarToRingArc(ringPolar);
  return ringArcToThreeJS(arc, floorHeight);
}

/**
 * Convert Three.js coordinates to RingPolar coordinates
 * 
 * @param {ThreeJSPoint} threeJSPoint - Three.js coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {RingPolar} RingPolar coordinate point
 */
export function threeJSToRingPolar(threeJSPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const arc = threeJSToRingArc(threeJSPoint, floorHeight);
  return ringArcToRingPolar(arc);
}

/**
 * Legacy wrapper: Convert legacy EarthRing coordinates to Three.js coordinates.
 * 
 * IMPORTANT: This function is intentionally a **direct linear mapping**
 * between legacy EarthRing and Three.js coordinates. It does NOT wrap
 * or convert through RingArc/RingPolar so that negative and large X values
 * are preserved. Higher-level helpers (normalizeRelativeToCamera, etc.)
 * handle wrapping where needed.
 * 
 * @deprecated Use ringArcToThreeJS or ringPolarToThreeJS for new code.
 * @param {Object} earthringPoint - Legacy EarthRing position {x, y, z}
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
 * Legacy wrapper: Convert Three.js coordinates to legacy EarthRing coordinates.
 * 
 * This is the inverse of toThreeJS and likewise avoids any wrapping or
 * RingArc/RingPolar conversions so that raw positions (including negatives)
 * are preserved for camera-relative logic.
 * 
 * @deprecated Use threeJSToRingArc or threeJSToRingPolar for new code.
 * @param {ThreeJSPoint} threeJSPoint - Three.js coordinate point
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} Legacy EarthRing position {x, y, z}
 */
export function fromThreeJS(threeJSPoint, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  return {
    x: threeJSPoint.x,
    y: threeJSPoint.z,
    z: Math.round(threeJSPoint.y / floorHeight),
  };
}

/**
 * Legacy wrapper: Wrap ring position to valid range (0 to 264,000,000 meters)
 * 
 * @deprecated Use wrapArcLength instead
 * @param {number} ringPosition - Ring position in meters
 * @returns {number} Wrapped ring position (0 to 264,000,000)
 */
export function wrapRingPosition(ringPosition) {
  return wrapArcLength(ringPosition);
}

/**
 * Legacy wrapper: Convert EarthRing position to chunk index
 * 
 * @deprecated Use ringArcToChunkIndex instead
 * @param {number} ringPosition - Ring position in meters (X coordinate)
 * @returns {number} Chunk index (0 to 263,999)
 */
export function positionToChunkIndex(ringPosition) {
  const wrapped = wrapArcLength(ringPosition);
  const arc = { s: wrapped, r: 0, z: 0 };
  return ringArcToChunkIndex(arc);
}

/**
 * Legacy wrapper: Convert chunk index to ring position range
 * 
 * @deprecated Use chunkIndexToRingArc instead
 * @param {number} chunkIndex - Chunk index (0 to 263,999)
 * @returns {Object} Object with min and max ring positions in meters
 * @property {number} min - Minimum ring position for this chunk
 * @property {number} max - Maximum ring position for this chunk
 */
export function chunkIndexToPositionRange(chunkIndex) {
  const arc = chunkIndexToRingArc(chunkIndex);
  return { min: arc.s, max: arc.s + CHUNK_LENGTH };
}

/**
 * Normalize a ring position relative to a camera position
 * 
 * This ensures coordinates are within [-RING_CIRCUMFERENCE/2, RING_CIRCUMFERENCE/2] of the camera,
 * preventing coordinates from wrapping to the opposite side of the ring.
 * 
 * @param {number} ringPosition - Absolute ring position (arc length) to normalize
 * @param {number} cameraPosition - Camera's absolute ring position (arc length)
 * @returns {number} Normalized position relative to camera (can be negative)
 */
export function normalizeRelativeToCamera(ringPosition, cameraPosition) {
  const dx = ringPosition - cameraPosition;
  const half = RING_CIRCUMFERENCE / 2;
  
  // Normalize dx to [-half, half] range using modulo arithmetic
  // This is equivalent to wrapping dx to [-half, half)
  let adjusted = ((dx + half) % RING_CIRCUMFERENCE) - half;
  if (adjusted >= half) adjusted -= RING_CIRCUMFERENCE;
  
  return cameraPosition + adjusted;
}

/**
 * Convert a normalized (camera-relative) coordinate back to absolute coordinate
 * 
 * This converts a coordinate that was normalized relative to a camera position
 * back to an absolute coordinate [0, RING_CIRCUMFERENCE).
 * 
 * @param {number} normalizedPosition - Normalized position (can be negative)
 * @param {number} cameraPosition - Camera's absolute ring position (arc length)
 * @returns {number} Absolute ring position [0, RING_CIRCUMFERENCE)
 */
export function denormalizeFromCamera(normalizedPosition, cameraPosition) {
  // Wrap camera position to get its absolute position [0, RING_CIRCUMFERENCE)
  const cameraXWrapped = wrapArcLength(cameraPosition);
  
  // The normalized position is: cameraPosition + adjusted, where adjusted is in [-half, half]
  // So the offset from camera is: normalizedPosition - cameraPosition
  const dx = normalizedPosition - cameraPosition;
  
  // Convert to absolute: cameraXWrapped + dx
  // This can be negative if the normalized position is negative and cameraXWrapped is small
  const absoluteX = cameraXWrapped + dx;
  
  // Wrap to valid range [0, RING_CIRCUMFERENCE)
  return wrapArcLength(absoluteX);
}

