/**
 * Rendering Utilities
 * Helper functions for Three.js rendering that use coordinate conversion
 */

import * as THREE from 'three';
import { toThreeJS, fromThreeJS, DEFAULT_FLOOR_HEIGHT } from './coordinates.js';

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
 * Set Three.js camera position from EarthRing coordinates
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {Object} earthringPosition - EarthRing position {x, y, z}
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 */
export function setCameraPositionFromEarthRing(camera, earthringPosition, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const threeJSPosition = toThreeJS(earthringPosition, floorHeight);
  camera.position.set(threeJSPosition.x, threeJSPosition.y, threeJSPosition.z);
}

/**
 * Get EarthRing position from Three.js camera position
 * 
 * @param {THREE.Camera} camera - Three.js camera
 * @param {number} [floorHeight=DEFAULT_FLOOR_HEIGHT] - Height per floor in meters
 * @returns {Object} EarthRing position {x, y, z}
 */
export function getEarthRingPositionFromCamera(camera, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const threeJSPosition = {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
  };
  return fromThreeJS(threeJSPosition, floorHeight);
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

