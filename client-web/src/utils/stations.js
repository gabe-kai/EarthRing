/**
 * Station Utilities
 * Helper functions for station locations and navigation
 * 
 * Updated to use RingArc coordinate system (arc length s in meters)
 * Hub 0 (Pillar of Kongo) is at s = 0 (theta = 0° in RingPolar)
 */

import { RING_CIRCUMFERENCE, wrapArcLength } from './coordinates-new.js';

// Pillar/Elevator Hub positions (12 stations at regular intervals)
// Positions in RingArc coordinates (arc length s in meters)
// Hub 0 is Pillar of Kongo at s = 0 (theta = 0°)
export const PILLAR_HUB_POSITIONS = [
  0,           // Hub 0: Pillar of Kongo (s = 0, theta = 0°)
  22000000,    // Hub 1: Pillar of Kilima (s = 22,000,000, theta = 30°)
  44000000,    // Hub 2: Pillar of Laccadé (s = 44,000,000, theta = 60°)
  66000000,    // Hub 3: Pillar of Nusantara (s = 66,000,000, theta = 90°)
  88000000,    // Hub 4: Pillar of Makassar (s = 88,000,000, theta = 120°)
  110000000,   // Hub 5: Pillar of Arafura (s = 110,000,000, theta = 150°)
  132000000,   // Hub 6: Pillar of Kirana (s = 132,000,000, theta = 180°)
  154000000,   // Hub 7: Pillar of Polynesya (s = 154,000,000, theta = 210°)
  176000000,   // Hub 8: Pillar of Andenor (s = 176,000,000, theta = 240°)
  198000000,   // Hub 9: Pillar of Quito Prime (s = 198,000,000, theta = 270°)
  220000000,   // Hub 10: Pillar of Solamazon (s = 220,000,000, theta = 300°)
  242000000,   // Hub 11: Pillar of Atlantica (s = 242,000,000, theta = 330°)
];

// Pillar/Elevator Hub names (12 stations at regular intervals)
// Names correspond to PILLAR_HUB_POSITIONS by index
export const PILLAR_HUB_NAMES = [
  'Pillar of Kongo',      // Hub 0 (theta = 0°)
  'Pillar of Kilima',     // Hub 1 (theta = 30°)
  'Pillar of Laccadé',    // Hub 2 (theta = 60°)
  'Pillar of Nusantara',  // Hub 3 (theta = 90°)
  'Pillar of Makassar',    // Hub 4 (theta = 120°)
  'Pillar of Arafura',    // Hub 5 (theta = 150°)
  'Pillar of Kirana',     // Hub 6 (theta = 180°)
  'Pillar of Polynesya',  // Hub 7 (theta = 210°)
  'Pillar of Andenor',    // Hub 8 (theta = 240°)
  'Pillar of Quito Prime', // Hub 9 (theta = 270°)
  'Pillar of Solamazon',  // Hub 10 (theta = 300°)
  'Pillar of Atlantica',  // Hub 11 (theta = 330°)
];

/**
 * Find the nearest station hub to a given arc length position
 * @param {number} arcLength - Arc length position in meters (RingArc coordinate s)
 * @returns {Object} Nearest station info {index, position, distance}
 */
export function findNearestStation(arcLength) {
  // Wrap arc length to valid range
  const wrappedPos = wrapArcLength(arcLength);
  
  let nearestIndex = 0;
  let nearestDistance = Math.abs(wrappedPos - PILLAR_HUB_POSITIONS[0]);
  
  PILLAR_HUB_POSITIONS.forEach((stationPos, index) => {
    // Calculate distance accounting for ring wrapping
    // Since stationPos is already in valid range [0, RING_CIRCUMFERENCE), no need to wrap it
    const distance1 = Math.abs(wrappedPos - stationPos);
    const distance2 = RING_CIRCUMFERENCE - distance1; // Wrapped distance
    const distance = Math.min(distance1, distance2);
    
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  
  return {
    index: nearestIndex,
    position: PILLAR_HUB_POSITIONS[nearestIndex],
    distance: nearestDistance,
  };
}

/**
 * Get station position by index
 * @param {number} index - Station index (0-11)
 * @returns {number} Station position in meters, or null if invalid
 */
export function getStationPosition(index) {
  if (index >= 0 && index < PILLAR_HUB_POSITIONS.length) {
    return PILLAR_HUB_POSITIONS[index];
  }
  return null;
}

/**
 * Get all station positions
 * @returns {Array<number>} Array of station positions in meters
 */
export function getAllStationPositions() {
  return [...PILLAR_HUB_POSITIONS];
}

/**
 * Get station name by index
 * @param {number} index - Station index (0-11)
 * @returns {string} Station name, or null if invalid
 */
export function getStationName(index) {
  if (index >= 0 && index < PILLAR_HUB_NAMES.length) {
    return PILLAR_HUB_NAMES[index];
  }
  return null;
}

/**
 * Get all station names
 * @returns {Array<string>} Array of station names
 */
export function getAllStationNames() {
  return [...PILLAR_HUB_NAMES];
}
