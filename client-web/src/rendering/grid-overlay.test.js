import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GridOverlay } from './grid-overlay.js';

function createMockInterfaces({ cameraY = 5 } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, cameraY, 0);

  const sceneManager = {
    getScene: () => scene,
    getCamera: () => camera,
  };

  const cameraController = {
    getTargetThreePosition: () => new THREE.Vector3(0, 0, 0),
    getTargetEarthRingPosition: () => ({ x: 0, y: 0, z: 0 }),
    getEarthRingPosition: () => ({ x: 0, y: 0, z: 0 }),
    getCurrentFloor: () => 0,
  };

  return { scene, camera, sceneManager, cameraController };
}

describe('GridOverlay', () => {
  let overlay;
  let mocks;

  beforeEach(() => {
    mocks = createMockInterfaces();
    overlay = new GridOverlay(mocks.sceneManager, mocks.cameraController);
  });

  it('adds itself to the scene and builds base groups', () => {
    const gridInScene = mocks.scene.children.find((child) => child.name === 'GridOverlay');
    expect(gridInScene).toBeDefined();

    expect(overlay.majorLinesGroup.children.length).toBeGreaterThan(0);
    expect(overlay.minorLinesGroup.children.length).toBeGreaterThan(0);
  });

  it('toggles visibility', () => {
    overlay.setVisible(false);
    expect(overlay.visible).toBe(false);
    expect(overlay.group.visible).toBe(false);

    overlay.setVisible(true);
    expect(overlay.visible).toBe(true);
    expect(overlay.group.visible).toBe(true);
  });

  it('generates minor lines when camera is below LOD threshold', () => {
    mocks.camera.position.setY(0);
    overlay.updateGridLines(0, 0);

    expect(overlay.minorLinesGroup.children.length).toBeGreaterThan(0);
  });

  it('hides minor lines when camera is above LOD threshold', () => {
    mocks.camera.position.setY(overlay.settings.minorLineMaxHeight + 50);
    overlay.updateGridLines(0, 0);

    expect(overlay.minorLinesGroup.children.length).toBe(0);
  });
});

