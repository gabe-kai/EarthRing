/**
 * Rendering Utilities
 * Helper functions for Three.js rendering that use coordinate conversion
 */

import * as THREE from 'three';
import { toThreeJS, fromThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition } from './coordinates.js';
import { 
  legacyPositionToRingPolar, 
  ringPolarToRingArc,
  ringPolarToLegacyPosition,
  ringArcToRingPolar,
  er0ToRingPolar,
  ringPolarToER0
} from './coordinates-new.js';

/**
 * Set Three.js object position from EarthRing coordinates
 * 
 * @param {THREE.Object3D} object - Three.js object to position
 * @param {Object} earthringPosition - EarthRing position {x, y, z}
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setObjectPositionFromEarthRing(object, earthringPosition, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const threeJSPosition = toThreeJS(earthringPosition, floorHeight);
  object.position.set(threeJSPosition.x, threeJSPosition.y, threeJSPosition.z);
}

/**
 * Get EarthRing position from Three.js object position
 * 
 * @param {THREE.Object3D} object - Three.js object
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} EarthRing position {x, y, z}
 */
export function getEarthRingPositionFromObject(object, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const threeJSPosition = {
    x: object.position.x,
    y: object.position.y,
    z: object.position.z,
  };
  return fromThreeJS(threeJSPosition, floorHeight);
}

/**
 * Set Three.js camera position from EarthRing coordinates (legacy)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {Object} earthringPosition - EarthRing position {x, y, z} (legacy coordinates)
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setCameraPositionFromEarthRing(camera, earthringPosition, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const threeJSPosition = toThreeJS(earthringPosition, floorHeight);
  camera.position.set(threeJSPosition.x, threeJSPosition.y, threeJSPosition.z);
}

/**
 * Set Three.js camera position from RingArc coordinates (new coordinate system)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {Object} ringArc - RingArc position {s, r, z}
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setCameraPositionFromRingArc(camera, ringArc, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const polar = ringArcToRingPolar(ringArc);
  const legacyPos = ringPolarToLegacyPosition(polar);
  setCameraPositionFromEarthRing(camera, legacyPos, floorHeight);
}

/**
 * Set Three.js camera position from RingPolar coordinates (new coordinate system)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {Object} ringPolar - RingPolar position {theta, r, z}
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setCameraPositionFromRingPolar(camera, ringPolar, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const legacyPos = ringPolarToLegacyPosition(ringPolar);
  setCameraPositionFromEarthRing(camera, legacyPos, floorHeight);
}

/**
 * Get EarthRing position from Three.js camera position (legacy coordinates)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} EarthRing position {x, y, z} (legacy coordinates)
 */
export function getEarthRingPositionFromCamera(camera, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const threeJSPosition = {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
  };
  const earthRingPos = fromThreeJS(threeJSPosition, floorHeight);
  // Wrap the X coordinate (ring position) to valid range [0, 264000000)
  earthRingPos.x = wrapRingPosition(earthRingPos.x);
  return earthRingPos;
}

/**
 * Get RingArc position from Three.js camera position (new coordinate system)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} RingArc position {s, r, z}
 */
export function getRingArcPositionFromCamera(camera, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const legacyPos = getEarthRingPositionFromCamera(camera, floorHeight);
  const polar = legacyPositionToRingPolar(legacyPos.x, legacyPos.y, legacyPos.z);
  return ringPolarToRingArc(polar);
}

/**
 * Get RingPolar position from Three.js camera position (new coordinate system)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} RingPolar position {theta, r, z}
 */
export function getRingPolarPositionFromCamera(camera, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const legacyPos = getEarthRingPositionFromCamera(camera, floorHeight);
  return legacyPositionToRingPolar(legacyPos.x, legacyPos.y, legacyPos.z);
}

/**
 * Set Three.js object position from ER0 coordinates (new coordinate system)
 * 
 * @param {THREE.Object3D} object - Three.js object to position
 * @param {Object} er0 - ER0 position {x, y, z} (Earth-Centered, Earth-Fixed)
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setObjectPositionFromER0(object, er0, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  // Convert ER0 → RingPolar → Legacy → Three.js
  const polar = er0ToRingPolar(er0);
  const legacyPos = ringPolarToLegacyPosition(polar);
  setObjectPositionFromEarthRing(object, legacyPos, floorHeight);
}

/**
 * Get ER0 position from Three.js object position (new coordinate system)
 * 
 * @param {THREE.Object3D} object - Three.js object
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} ER0 position {x, y, z} (Earth-Centered, Earth-Fixed)
 */
export function getER0PositionFromObject(object, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  // Convert Three.js → Legacy → RingPolar → ER0
  const legacyPos = getEarthRingPositionFromObject(object, floorHeight);
  const polar = legacyPositionToRingPolar(legacyPos.x, legacyPos.y, legacyPos.z);
  return ringPolarToER0(polar);
}

/**
 * Set Three.js camera position from ER0 coordinates (new coordinate system)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {Object} er0 - ER0 position {x, y, z} (Earth-Centered, Earth-Fixed)
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setCameraPositionFromER0(camera, er0, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  // Convert ER0 → RingPolar → Legacy → Three.js
  const polar = er0ToRingPolar(er0);
  const legacyPos = ringPolarToLegacyPosition(polar);
  setCameraPositionFromEarthRing(camera, legacyPos, floorHeight);
}

/**
 * Get ER0 position from Three.js camera position (new coordinate system)
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} ER0 position {x, y, z} (Earth-Centered, Earth-Fixed)
 */
export function getER0PositionFromCamera(camera, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  // Convert Three.js → Legacy → RingPolar → ER0
  const legacyPos = getEarthRingPositionFromCamera(camera, floorHeight);
  const polar = legacyPositionToRingPolar(legacyPos.x, legacyPos.y, legacyPos.z);
  return ringPolarToER0(polar);
}

/**
 * Create a Three.js mesh at an EarthRing position
 * 
 * @param {THREE.BufferGeometry} geometry - Three.js geometry
 * @param {THREE.Material} material - Three.js material
 * @param {Object} earthringPosition - EarthRing position {x, y, z}
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {THREE.Mesh} Three.js mesh positioned at the EarthRing coordinates
 */
export function createMeshAtEarthRingPosition(geometry, material, earthringPosition, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const mesh = new THREE.Mesh(geometry, material);
  setObjectPositionFromEarthRing(mesh, earthringPosition, floorHeight);
  return mesh;
}

/**
 * Create a Three.js mesh at an ER0 position (new coordinate system)
 * 
 * @param {THREE.BufferGeometry} geometry - Three.js geometry
 * @param {THREE.Material} material - Three.js material
 * @param {Object} er0 - ER0 position {x, y, z} (Earth-Centered, Earth-Fixed)
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {THREE.Mesh} Three.js mesh positioned at the ER0 coordinates
 */
export function createMeshAtER0Position(geometry, material, er0, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const mesh = new THREE.Mesh(geometry, material);
  setObjectPositionFromER0(mesh, er0, floorHeight);
  return mesh;
}

