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

// Kongo Hub ER0 coordinates
export const KONGO_HUB_ER0 = {
  x: KONGO_HUB_RADIUS,
  y: 0,
  z: 0,
};

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
  // Convert arc length to theta: theta = (s / C) * 2π
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
  // Normalize theta to [0, 2π) for arc length calculation
  let theta = polar.theta;
  if (theta < 0) {
    theta += 2 * Math.PI;
  }
  // Convert to arc length: s = (theta / 2π) * RingCircumference
  let s = (theta / (2 * Math.PI)) * RING_CIRCUMFERENCE;
  // Wrap s to [0, RingCircumference)
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
 * @returns {number} Wrapped angle in [-π, π)
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
  // Wrap legacy X to [0, RingCircumference)
  const wrappedX = ((legacyX % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
  
  // Convert to theta: theta = (X / C) * 2π, then shift to [-π, π)
  let theta = (wrappedX / RING_CIRCUMFERENCE) * 2 * Math.PI;
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
  // Normalize theta to [0, 2π)
  let theta = polar.theta;
  if (theta < 0) {
    theta += 2 * Math.PI;
  }
  
  // Convert to legacy X
  let x = (theta / (2 * Math.PI)) * RING_CIRCUMFERENCE;
  x = ((x % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
  
  return {
    x: x,
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

