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

const getPositionCounts = (group) =>
  group.children.map((child) => child.geometry?.attributes?.position?.count ?? 0);

const THICK_LINE_TOLERANCE = 1.5;

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

  it('always renders a bold centerline at Y=0 across the circumference', () => {
    overlay.updateGridLines(0, 0);
    expect(overlay.axisLinesGroup.children.length).toBe(1);
    const centerLine = overlay.axisLinesGroup.children[0];
    expect(centerLine.geometry.attributes.position.count).toBeGreaterThan(2);
    const positions = centerLine.geometry.attributes.position.array;
    for (let i = 2; i < positions.length; i += 3) {
      expect(Math.abs(positions[i])).toBeLessThan(THICK_LINE_TOLERANCE);
    }
  });

  it('keeps the centerline anchored to world Y=0 when the camera shifts sideways', () => {
    overlay.updateGridLines(0, 40);
    expect(overlay.axisLinesGroup.children.length).toBe(1);
    const centerLine = overlay.axisLinesGroup.children[0];
    const positions = centerLine.geometry.attributes.position.array;
    for (let i = 2; i < positions.length; i += 3) {
      expect(Math.abs(positions[i] + 40)).toBeLessThan(THICK_LINE_TOLERANCE);
    }
  });

  it('thickens grid lines at multiples of 20 on both axes', () => {
    overlay.updateGridLines(0, 0);
    const majorCounts = getPositionCounts(overlay.majorLinesGroup);
    expect(majorCounts.some((count) => count >= 6)).toBe(true);
  });
});

