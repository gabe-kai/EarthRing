import * as THREE from 'three';
import { fetchZonesByArea } from '../api/zone-service.js';
import { toThreeJS, wrapRingPosition } from '../utils/coordinates.js';
import { isAuthenticated } from '../auth/auth-service.js';

const DEFAULT_ZONE_RANGE = 5000; // meters along ring
const DEFAULT_WIDTH_RANGE = 3000; // meters across width

const ZONE_COLORS = {
  residential: 0x4caf50,
  commercial: 0x2196f3,
  industrial: 0xffeb3b,
  'mixed-use': 0xffffff, // actual color driven by gradient
  park: 0xb2ff59,
};

const MIXED_USE_GRADIENT = [0xffeb3b, 0x4caf50, 0x2196f3];
const DEFAULT_ZONE_COLOR = 0xffffff;

export class ZoneManager {
  constructor(sceneManager, gameStateManager, cameraController) {
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getScene();
    this.gameState = gameStateManager;
    this.cameraController = cameraController;

    this.zoneMeshes = new Map();
    this.pendingFetch = false;
    this.lastFetchTime = 0;
    this.fetchThrottleMs = 4000;
    this.heightOffset = 0.5;

    this.setupListeners();
  }

  setupListeners() {
    this.gameState.on('zoneAdded', ({ zone }) => this.renderZone(zone));
    this.gameState.on('zoneUpdated', ({ zone }) => this.renderZone(zone));
    this.gameState.on('zoneRemoved', ({ zoneID }) => this.removeZone(zoneID));
    this.gameState.on('zonesCleared', () => this.clearAllZones());
  }

  async loadZonesAroundCamera(range = DEFAULT_ZONE_RANGE) {
    if (this.pendingFetch || !this.cameraController) {
      return;
    }

    if (!isAuthenticated()) {
      return;
    }

    const now = performance.now();
    if (now - this.lastFetchTime < this.fetchThrottleMs) {
      return;
    }

    const cameraPos = this.cameraController.getEarthRingPosition();
    const floor = Math.round(cameraPos.z || 0);

    let minX = cameraPos.x - range;
    let maxX = cameraPos.x + range;
    const minY = cameraPos.y - DEFAULT_WIDTH_RANGE;
    const maxY = cameraPos.y + DEFAULT_WIDTH_RANGE;

    // Keep positions within ring bounds (best effort - wrapping zones not yet supported)
    const RING_CIRCUMFERENCE = 264000000;
    minX = Math.max(0, Math.min(RING_CIRCUMFERENCE, minX));
    maxX = Math.max(0, Math.min(RING_CIRCUMFERENCE, maxX));

    this.pendingFetch = true;
    try {
      const zones = await fetchZonesByArea({
        floor,
        minX,
        minY,
        maxX,
        maxY,
      });
      this.gameState.setZones(zones || []);
      this.lastFetchTime = performance.now();
    } catch (error) {
      console.error('Failed to load zones:', error);
    } finally {
      this.pendingFetch = false;
    }
  }

  renderZone(zone) {
    if (!zone || !zone.geometry) {
      return;
    }

    // Remove existing mesh before re-rendering
    this.removeZone(zone.id);

    const polygons = parseGeometry(zone.geometry);
    if (polygons.length === 0) {
      return;
    }

    const color = this.getBaseColor(zone.zone_type);
    const group = new THREE.Group();
    group.userData.zoneId = zone.id;

    polygons.forEach(rings => {
      if (!rings.length) {
        return;
      }

      const outerRing = rings[0];
      const lineGeometry = new THREE.BufferGeometry();
      const points = outerRing.map(([x, y]) => {
        const wrappedX = wrapRingPosition(x);
        const threePos = toThreeJS({ x: wrappedX, y, z: zone.floor });
        return new THREE.Vector3(threePos.x, threePos.y + this.heightOffset, threePos.z);
      });
      lineGeometry.setFromPoints(points);

      const colorArray = this.getLineColors(zone.zone_type, points.length);
      const lineMaterial = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        vertexColors: !!colorArray,
      });
      if (colorArray) {
        lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colorArray, 3));
      }

      const line = new THREE.LineLoop(lineGeometry, lineMaterial);
      group.add(line);

      const fillMesh = this.createZoneFillMesh(rings, zone);
      if (fillMesh) {
        group.add(fillMesh);
      }
    });

    this.scene.add(group);
    this.zoneMeshes.set(zone.id, group);
  }

  removeZone(zoneID) {
    const mesh = this.zoneMeshes.get(zoneID);
    if (!mesh) {
      return;
    }
    mesh.traverse(child => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.scene.remove(mesh);
    this.zoneMeshes.delete(zoneID);
  }

  clearAllZones() {
    Array.from(this.zoneMeshes.keys()).forEach(zoneID => this.removeZone(zoneID));
    this.zoneMeshes.clear();
  }
}

function parseGeometry(geometry) {
  if (!geometry) {
    return [];
  }

  let parsed = geometry;
  if (typeof geometry === 'string') {
    try {
      parsed = JSON.parse(geometry);
    } catch (error) {
      console.error('Failed to parse zone geometry JSON:', error);
      return [];
    }
  }

  if (parsed.type === 'Polygon') {
    return [parsed.coordinates];
  }

  if (parsed.type === 'MultiPolygon') {
    return parsed.coordinates;
  }

  return [];
}

ZoneManager.prototype.getBaseColor = function (zoneType) {
  const hex = ZONE_COLORS[zoneType?.toLowerCase()] ?? DEFAULT_ZONE_COLOR;
  return new THREE.Color(hex);
};

ZoneManager.prototype.getLineColors = function (zoneType, pointCount) {
  if (zoneType?.toLowerCase() !== 'mixed-use' || pointCount < 2) {
    return null;
  }
  const gradient = MIXED_USE_GRADIENT.map(hex => new THREE.Color(hex));
  const colors = [];
  for (let i = 0; i < pointCount; i++) {
    const t = i / (pointCount - 1);
    const segment = t * (gradient.length - 1);
    const idx = Math.floor(segment);
    const frac = segment - idx;
    const c1 = gradient[idx];
    const c2 = gradient[Math.min(idx + 1, gradient.length - 1)];
    const blended = c1.clone().lerp(c2, frac);
    colors.push(blended.r, blended.g, blended.b);
  }
  return colors;
};

ZoneManager.prototype.createZoneFillMesh = function (rings, zone) {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 3) {
    return null;
  }

  const baseHeight = toThreeJS({ x: 0, y: 0, z: zone.floor }).y + this.heightOffset - 0.02;
  const shape = new THREE.Shape();
  const outerVectors = outer.map(([x, y]) => {
    const threePos = toThreeJS({
      x: wrapRingPosition(x),
      y,
      z: zone.floor,
    });
    return new THREE.Vector2(threePos.x, threePos.z);
  });

  if (!outerVectors.length) {
    return null;
  }

  shape.moveTo(outerVectors[0].x, outerVectors[0].y);
  for (let i = 1; i < outerVectors.length; i++) {
    shape.lineTo(outerVectors[i].x, outerVectors[i].y);
  }

  holes.forEach(holeCoords => {
    if (!holeCoords.length) {
      return;
    }
    const path = new THREE.Path();
    holeCoords.forEach(([x, y], idx) => {
      const threePos = toThreeJS({
        x: wrapRingPosition(x),
        y,
        z: zone.floor,
      });
      if (idx === 0) {
        path.moveTo(threePos.x, threePos.z);
      } else {
        path.lineTo(threePos.x, threePos.z);
      }
    });
    shape.holes.push(path);
  });

  const geometry = new THREE.ShapeGeometry(shape);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const xVal = positions.getX(i);
    const zVal = positions.getY(i);
    positions.setXYZ(i, xVal, baseHeight, zVal);
  }

  const fillColor = this.getBaseColor(zone.zone_type).clone().lerp(new THREE.Color(0xffffff), 0.4);
  const material = new THREE.MeshBasicMaterial({
    color: fillColor,
    transparent: true,
    opacity: zone.zone_type?.toLowerCase() === 'park' ? 0.35 : 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return new THREE.Mesh(geometry, material);
};

