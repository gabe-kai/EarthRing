/**
 * Station Utilities
 * Helper functions for station locations and navigation
 */

// Pillar/Elevator Hub positions (12 stations at regular intervals)
// Positions in meters: 0, 22,000 km, 44,000 km, etc.
export const PILLAR_HUB_POSITIONS = [
  0,           // Hub 0
  22000000,    // Hub 1: 22,000 km
  44000000,    // Hub 2: 44,000 km
  66000000,    // Hub 3: 66,000 km
  88000000,    // Hub 4: 88,000 km
  110000000,   // Hub 5: 110,000 km
  132000000,   // Hub 6: 132,000 km
  154000000,   // Hub 7: 154,000 km
  176000000,   // Hub 8: 176,000 km
  198000000,   // Hub 9: 198,000 km
  220000000,   // Hub 10: 220,000 km
  242000000,   // Hub 11: 242,000 km
];

/**
 * Find the nearest station hub to a given ring position
 * @param {number} ringPosition - Ring position in meters
 * @returns {Object} Nearest station info {index, position, distance}
 */
export function findNearestStation(ringPosition) {
  let nearestIndex = 0;
  let nearestDistance = Math.abs(ringPosition - PILLAR_HUB_POSITIONS[0]);
  
  PILLAR_HUB_POSITIONS.forEach((stationPos, index) => {
    // Calculate distance accounting for ring wrapping
    const distance1 = Math.abs(ringPosition - stationPos);
    const distance2 = Math.abs(ringPosition - (stationPos - 264000000)); // Wrapped backward
    const distance3 = Math.abs(ringPosition - (stationPos + 264000000)); // Wrapped forward
    const distance = Math.min(distance1, distance2, distance3);
    
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

