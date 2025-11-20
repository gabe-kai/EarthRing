import { fetchZonesByArea } from '../api/zone-service.js';
import { isAuthenticated } from '../auth/auth-service.js';
import * as THREE from 'three';
import { toThreeJS, DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates.js';

const DEFAULT_ZONE_RANGE = 5000; // meters along ring
const DEFAULT_WIDTH_RANGE = 3000; // meters across width
const RING_CIRCUMFERENCE = 264000000;

const ZONE_STYLES = {
  residential: { fill: 'rgba(111,207,151,0.35)', stroke: 'rgba(111,207,151,0.95)' },
  commercial: { fill: 'rgba(86,204,242,0.35)', stroke: 'rgba(86,204,242,0.95)' },
  industrial: { fill: 'rgba(242,201,76,0.4)', stroke: 'rgba(242,201,76,0.95)' },
  'mixed-use': { fill: 'rgba(255,214,102,0.4)', stroke: 'rgba(255,159,67,0.95)' },
  mixed_use: { fill: 'rgba(255,214,102,0.4)', stroke: 'rgba(255,159,67,0.95)' },
  park: { fill: 'rgba(39,174,96,0.3)', stroke: 'rgba(46,204,113,0.95)' },
  restricted: { fill: 'rgba(231,76,60,0.4)', stroke: 'rgba(192,57,43,0.95)' },
  default: { fill: 'rgba(255,255,255,0.2)', stroke: 'rgba(255,255,255,0.9)' },
};

/**
 * ZoneManager coordinates zone data fetching and renders zones as world-positioned meshes.
 */
export class ZoneManager {
  constructor(gameStateManager, cameraController, sceneManager) {
    this.gameState = gameStateManager;
    this.cameraController = cameraController;
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getScene();

    this.zonesVisible = true;
    this.pendingFetch = false;
    this.lastFetchTime = 0;
    this.fetchThrottleMs = 4000;
    this.zoneMeshes = new Map(); // Map<zoneID, THREE.Group>
    this.lastError = { message: null, timestamp: 0 };
    // Per-type visibility: Map<zoneType, boolean>
    this.zoneTypeVisibility = new Map([
      ['residential', true],
      ['commercial', true],
      ['industrial', true],
      ['mixed-use', true],
      ['mixed_use', true],
      ['park', true],
      ['restricted', true],
    ]);

    this.setupListeners();
  }

  setupListeners() {
    this.gameState.on('zoneAdded', ({ zone }) => this.renderZone(zone));
    this.gameState.on('zoneUpdated', ({ zone }) => this.renderZone(zone));
    this.gameState.on('zoneRemoved', ({ zoneID }) => this.removeZone(zoneID));
    this.gameState.on('zonesCleared', () => this.clearAllZones());
  }

  async loadZonesAroundCamera(range = DEFAULT_ZONE_RANGE) {
    if (!this.cameraController || this.pendingFetch || !isAuthenticated()) {
      return;
    }

    const now = performance.now();
    if (now - this.lastFetchTime < this.fetchThrottleMs) {
      return;
    }

    const cameraPos = this.cameraController.getEarthRingPosition();
    const floor = 0; // Force floor 0 fetch until multi-floor zones are supported client-side

    const minX = cameraPos.x - range;
    const maxX = cameraPos.x + range;
    const minY = cameraPos.y - DEFAULT_WIDTH_RANGE;
    const maxY = cameraPos.y + DEFAULT_WIDTH_RANGE;

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
      this.logErrorOnce(error);
    } finally {
      this.pendingFetch = false;
    }
  }

  renderZone(zone) {
    if (!zone || !zone.geometry) {
      return;
    }

    this.removeZone(zone.id);

    const polygons = parseGeometry(zone.geometry);
    if (polygons.length === 0) {
      return;
    }

    // Get camera position for wrapping
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x;

    // Normalize zone type (handle both mixed-use and mixed_use)
    let zoneType = (zone.zone_type?.toLowerCase() || 'default');
    if (zoneType === 'mixed_use') {
      zoneType = 'mixed-use';
    }
    const typeVisible = this.zoneTypeVisibility.get(zoneType) ?? true;

    const zoneGroup = new THREE.Group();
    zoneGroup.renderOrder = 5; // Render above grid
    zoneGroup.userData.zoneId = zone.id;
    zoneGroup.userData.zoneType = zoneType;
    zoneGroup.visible = this.zonesVisible && typeVisible;

    // Look up style (handle both mixed-use and mixed_use)
    const styleKey = zone.zone_type?.toLowerCase() === 'mixed_use' ? 'mixed-use' : zone.zone_type?.toLowerCase();
    const style = ZONE_STYLES[styleKey] || ZONE_STYLES.default;
    const floor = zone.floor ?? 0;
    const floorHeight = floor * DEFAULT_FLOOR_HEIGHT;

    polygons.forEach(polygonRings => {
      const [outerRing, ...holes] = polygonRings;
      if (!outerRing || outerRing.length < 3) {
        return;
      }

      // Wrap zone coordinates relative to camera (like chunks)
      const wrapZoneX = (x) => {
        const dx = x - cameraX;
        const half = RING_CIRCUMFERENCE / 2;
        let adjusted = dx;
        while (adjusted > half) adjusted -= RING_CIRCUMFERENCE;
        while (adjusted < -half) adjusted += RING_CIRCUMFERENCE;
        return cameraX + adjusted;
      };

      // Create shape from outer ring
      const shape = new THREE.Shape();
      outerRing.forEach(([x, y], idx) => {
        const wrappedX = wrapZoneX(x);
        const worldPos = toThreeJS({ x: wrappedX, y: y, z: floor });
        if (idx === 0) {
          shape.moveTo(worldPos.x, worldPos.z);
        } else {
          shape.lineTo(worldPos.x, worldPos.z);
        }
      });

      // Add holes
      holes.forEach(hole => {
        if (!hole || hole.length < 3) return;
        const holePath = new THREE.Path();
        hole.forEach(([x, y], idx) => {
          const wrappedX = wrapZoneX(x);
          const worldPos = toThreeJS({ x: wrappedX, y: y, z: floor });
          if (idx === 0) {
            holePath.moveTo(worldPos.x, worldPos.z);
          } else {
            holePath.lineTo(worldPos.x, worldPos.z);
          }
        });
        shape.holes.push(holePath);
      });

      // Extract opacity from rgba string (e.g., "rgba(111,207,151,0.35)")
      const fillOpacityMatch = style.fill.match(/[\d.]+\)$/);
      const fillOpacity = fillOpacityMatch ? parseFloat(fillOpacityMatch[0].slice(0, -1)) : 0.35;
      
      // Extract RGB from rgba string
      const fillRgbMatch = style.fill.match(/rgba?\(([\d.]+),([\d.]+),([\d.]+)/);
      const fillColor = fillRgbMatch
        ? new THREE.Color(
            parseFloat(fillRgbMatch[1]) / 255,
            parseFloat(fillRgbMatch[2]) / 255,
            parseFloat(fillRgbMatch[3]) / 255
          )
        : new THREE.Color(style.fill);

      // Create fill mesh
      const fillGeometry = new THREE.ShapeGeometry(shape);
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: fillColor,
        transparent: true,
        opacity: fillOpacity,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
      fillMesh.rotation.x = -Math.PI / 2;
      fillMesh.position.y = floorHeight + 0.001; // Slightly above floor
      zoneGroup.add(fillMesh);

      // Extract opacity and RGB for stroke
      const strokeOpacityMatch = style.stroke.match(/[\d.]+\)$/);
      const strokeOpacity = strokeOpacityMatch ? parseFloat(strokeOpacityMatch[0].slice(0, -1)) : 0.95;
      const strokeRgbMatch = style.stroke.match(/rgba?\(([\d.]+),([\d.]+),([\d.]+)/);
      const outlineColor = strokeRgbMatch
        ? new THREE.Color(
            parseFloat(strokeRgbMatch[1]) / 255,
            parseFloat(strokeRgbMatch[2]) / 255,
            parseFloat(strokeRgbMatch[3]) / 255
          )
        : new THREE.Color(style.stroke);

      // Create outline (with wrapped coordinates)
      const outlinePoints = outerRing.map(([x, y]) => {
        const wrappedX = wrapZoneX(x);
        const worldPos = toThreeJS({ x: wrappedX, y: y, z: floor });
        return new THREE.Vector3(worldPos.x, floorHeight + 0.002, worldPos.z);
      });
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: outlineColor,
        transparent: true,
        opacity: strokeOpacity,
        depthWrite: false,
        depthTest: false,
        linewidth: 2,
      });
      const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
      zoneGroup.add(outline);
    });

    if (zoneGroup.children.length === 0) {
      return;
    }

    this.scene.add(zoneGroup);
    this.zoneMeshes.set(zone.id, zoneGroup);
  }

  removeZone(zoneID) {
    const mesh = this.zoneMeshes.get(zoneID);
    if (!mesh) {
      return;
    }
    mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
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

  showZones() {
    this.setVisibility(true);
  }

  hideZones() {
    this.setVisibility(false);
  }

  toggleZones() {
    this.setVisibility(!this.zonesVisible);
  }

  setVisibility(visible) {
    this.zonesVisible = visible;
    this.updateAllZoneVisibility();
    console.info(`[Zones] ${visible ? 'shown' : 'hidden'} (meshes: ${this.zoneMeshes.size})`);
  }

  setZoneTypeVisibility(zoneType, visible) {
    // Normalize zone type (mixed_use -> mixed-use)
    const normalizedType = zoneType.toLowerCase().replace('_', '-');
    this.zoneTypeVisibility.set(normalizedType, visible);
    this.updateAllZoneVisibility();
    console.info(`[Zones] ${normalizedType} ${visible ? 'shown' : 'hidden'}`);
  }

  updateAllZoneVisibility() {
    this.zoneMeshes.forEach((mesh) => {
      const zoneType = mesh.userData.zoneType || 'default';
      const typeVisible = this.zoneTypeVisibility.get(zoneType) ?? true;
      mesh.visible = this.zonesVisible && typeVisible;
    });
  }

  clearAllZones() {
    Array.from(this.zoneMeshes.keys()).forEach(zoneID => this.removeZone(zoneID));
    this.zoneMeshes.clear();
  }

  getStats() {
    return {
      cached: this.gameState.getAllZones().length,
      rendered: this.zoneMeshes.size,
      visible: this.zonesVisible,
    };
  }

  logZoneState() {
    const stats = this.getStats();
    console.info(
      `[Zones] cached=${stats.cached} rendered=${stats.rendered} visible=${stats.visible}`
    );
    if (stats.cached) {
      console.table(
        this.gameState.getAllZones().map(zone => ({
          id: zone.id,
          type: zone.zone_type,
          floor: zone.floor,
          area: zone.area?.toFixed?.(2) ?? zone.area,
        }))
      );
    }
  }

  logErrorOnce(error) {
    const message = error?.message || String(error);
    const now = performance.now();
    if (this.lastError.message === message && now - this.lastError.timestamp < 5000) {
      return;
    }
    this.lastError = { message, timestamp: now };
    console.error('Failed to load zones:', error);
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

  if (!parsed) {
    return [];
  }

  if (parsed.type === 'Polygon') {
    return [parsed.coordinates || []];
  }

  if (parsed.type === 'MultiPolygon') {
    return parsed.coordinates || [];
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  return [];
}

