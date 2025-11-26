/**
 * Station Utilities
 * Helper functions for station locations and navigation
 * 
 * Updated to use RingArc coordinate system (arc length s in meters)
 * Hub 0 (Kongo Hub) is at s = 0 (theta = 0 in RingPolar)
 */

import { RING_CIRCUMFERENCE, wrapArcLength } from './coordinates-new.js';

// Pillar/Elevator Hub positions (12 stations at regular intervals)
// Positions in RingArc coordinates (arc length s in meters)
// Hub 0 is Kongo Hub at s = 0 (theta = 0)
export const PILLAR_HUB_POSITIONS = [
  0,           // Hub 0: Kongo Hub (s = 0, theta = 0)
  22000000,    // Hub 1: 22,000 km (s = 22,000,000)
  44000000,    // Hub 2: 44,000 km (s = 44,000,000)
  66000000,    // Hub 3: 66,000 km (s = 66,000,000)
  88000000,    // Hub 4: 88,000 km (s = 88,000,000)
  110000000,   // Hub 5: 110,000 km (s = 110,000,000)
  132000000,   // Hub 6: 132,000 km (s = 132,000,000)
  154000000,   // Hub 7: 154,000 km (s = 154,000,000)
  176000000,   // Hub 8: 176,000 km (s = 176,000,000)
  198000000,   // Hub 9: 198,000 km (s = 198,000,000)
  220000000,   // Hub 10: 220,000 km (s = 220,000,000)
  242000000,   // Hub 11: 242,000 km (s = 242,000,000)
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
    const wrappedStation = wrapArcLength(stationPos);
    const distance1 = Math.abs(wrappedPos - wrappedStation);
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

