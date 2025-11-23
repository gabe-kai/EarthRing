import { fetchZonesByArea } from '../api/zone-service.js';
import { isAuthenticated } from '../auth/auth-service.js';
import * as THREE from 'three';
import { toThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition, normalizeRelativeToCamera } from '../utils/coordinates.js';

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
  dezone: { fill: 'rgba(255,0,0,0.3)', stroke: 'rgba(255,0,0,0.8)' }, // Red for dezone (subtraction zones)
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
    this.highlightedZones = new Set(); // Set of highlighted zone IDs
    this.lastError = { message: null, timestamp: 0 };
    // Track last camera position for re-rendering wrapped zones
    this.lastCameraX = null;
    this.WRAP_RE_RENDER_THRESHOLD = 5000; // Re-render if camera moved more than 5km
    // Per-type visibility: Map<zoneType, boolean>
    this.zoneTypeVisibility = new Map([
      ['residential', true],
      ['commercial', true],
      ['industrial', true],
      ['mixed-use', true],
      ['mixed_use', true],
      ['park', true],
      ['restricted', true],
      ['dezone', true],
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
    
    // Validate range to prevent invalid bounding boxes
    const RING_CIRCUMFERENCE = 264000000;
    if (range <= 0 || range > RING_CIRCUMFERENCE / 2) {
      console.warn(`Invalid zone range: ${range}, clamping to valid range`);
      range = Math.min(Math.max(range, 100), RING_CIRCUMFERENCE / 2 - 1000);
    }

    const cameraPos = this.cameraController.getEarthRingPosition();
    const floor = 0; // Force floor 0 fetch until multi-floor zones are supported client-side

    // Wrap camera X to valid range before calculating bounds
    const cameraXWrapped = wrapRingPosition(cameraPos.x);
    
    // Calculate bounds relative to wrapped camera position
    let minX = cameraXWrapped - range;
    let maxX = cameraXWrapped + range;
    
    // Handle wrap-around: ensure minX < maxX after wrapping
    // If wrapping causes minX > maxX, clamp to valid range
    if (minX < 0) {
      minX = wrapRingPosition(minX);
    }
    if (maxX >= RING_CIRCUMFERENCE) {
      maxX = wrapRingPosition(maxX);
    }
    
    // Ensure minX < maxX (if wrapping caused inversion, clamp to valid range)
    if (minX >= maxX) {
      // This happens when the range wraps around the ring boundary
      // Clamp to valid range: [0, RING_CIRCUMFERENCE)
      minX = Math.max(0, cameraXWrapped - range);
      maxX = Math.min(RING_CIRCUMFERENCE, cameraXWrapped + range);
      // Ensure they're still valid
      if (minX >= maxX) {
        // Fallback: use a smaller range centered on camera
        const safeRange = Math.min(range, RING_CIRCUMFERENCE / 2 - 1);
        minX = Math.max(0, cameraXWrapped - safeRange);
        maxX = Math.min(RING_CIRCUMFERENCE, cameraXWrapped + safeRange);
      }
    }
    
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
      
      // Merge fetched zones with existing zones instead of replacing
      // This preserves zones that were manually added (e.g., newly created zones)
      // but are outside the current fetch bounds
      const existingZones = this.gameState.getAllZones();
      const fetchedZoneIDs = new Set((zones || []).map(z => z.id));
      
      // Add/update fetched zones
      (zones || []).forEach(zone => {
        this.gameState.upsertZone(zone);
      });
      
      // Only remove zones that are far from camera (outside fetch range)
      // Keep zones that are manually added (e.g., newly created) even if outside fetch
      const cameraXWrapped = wrapRingPosition(cameraPos.x);
      
      existingZones.forEach(existingZone => {
        if (fetchedZoneIDs.has(existingZone.id)) {
          return; // Zone is in fetch results, keep it
        }
        
        // Check if zone is far from camera (should be removed)
        // Only remove if zone is clearly outside the fetch range
        const zoneGeometry = existingZone.geometry ? 
          (typeof existingZone.geometry === 'string' ? JSON.parse(existingZone.geometry) : existingZone.geometry) : null;
        
        if (zoneGeometry && zoneGeometry.coordinates && zoneGeometry.coordinates[0]) {
          const firstCoord = zoneGeometry.coordinates[0][0];
          const zoneX = firstCoord[0];
          const zoneXWrapped = wrapRingPosition(zoneX);
          
          // Calculate distance accounting for wrap-around
          const directDistance = Math.abs(zoneXWrapped - cameraXWrapped);
          const wrappedDistance = RING_CIRCUMFERENCE - directDistance;
          const distance = Math.min(directDistance, wrappedDistance);
          
          // Only remove if zone is clearly outside fetch range (with buffer)
          if (distance > range * 2) {
            // Zone is far from camera, safe to remove
            this.gameState.removeZone(existingZone.id);
          }
          // Otherwise, keep it (might be near camera but outside fetch bounds due to wrapping)
        }
      });
      this.lastFetchTime = performance.now();
      // Clear error state on success
      this.lastError = null;
    } catch (error) {
      // Only log authentication errors once, and stop making requests
      if (error.message.includes('Not authenticated') || error.message.includes('Session expired')) {
        this.logErrorOnce(error);
        // Stop making requests when not authenticated
        return;
      }
      // Don't retry on invalid bounding box or rate limit errors - these indicate a problem with our request
      if (error.message.includes('invalid bounding box') || error.message.includes('Too many requests')) {
        this.logErrorOnce(error);
        // Reset lastFetchTime to prevent immediate retry
        this.lastFetchTime = performance.now();
        return;
      }
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
    // Use unwrapped camera position for normalizeRelativeToCamera - it handles wrapping internally
    // The function expects the actual camera position (which may be negative or outside [0, RING_CIRCUMFERENCE))
    const cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
    const cameraX = cameraPos.x; // Use unwrapped camera position

    // DEBUG: Log rendering
    if (window.DEBUG_ZONE_COORDS) {
      const parsedGeometry = zone.geometry ? (typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry) : null;
      console.log('[ZoneManager] renderZone:', {
        zoneId: zone.id,
        cameraPos: { ...cameraPos },
        cameraX,
        cameraXWrapped: wrapRingPosition(cameraPos.x),
        zoneGeometry: parsedGeometry,
        firstCoordinate: parsedGeometry?.coordinates?.[0]?.[0],
      });
    }

    // Normalize zone type (handle both mixed-use and mixed_use)
    let zoneType = (zone.zone_type?.toLowerCase() || 'default');
    if (zoneType === 'mixed_use') {
      zoneType = 'mixed-use';
    }
    const typeVisible = this.zoneTypeVisibility.get(zoneType) ?? true;

    const zoneGroup = new THREE.Group();
    zoneGroup.renderOrder = 5; // Render above grid
    zoneGroup.userData.zoneID = zone.id; // Use zoneID for consistency with editor
    zoneGroup.userData.zoneId = zone.id; // Keep both for compatibility
    zoneGroup.userData.zoneType = zoneType;
    zoneGroup.userData.zone = zone; // Store full zone object for easy access
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
      // NOTE: Zone coordinates from DB are absolute [0, RING_CIRCUMFERENCE)
      // We wrap them relative to camera for rendering
      let wrapDebugCount = 0;
      const wrapZoneX = (x) => {
        const wrapped = normalizeRelativeToCamera(x, cameraX);
        
        // DEBUG: Log wrapping for first few points
        if (window.DEBUG_ZONE_COORDS && wrapDebugCount++ < 3) {
          console.log('[ZoneManager] wrapZoneX:', {
            absoluteX: x,
            cameraX,
            wrapped,
          });
        }
        
        return wrapped;
      };

      // Create shape from outer ring
      // NOTE: ShapeGeometry creates shapes in the XY plane (Z=0)
      // We use worldPos.x and worldPos.z to create the shape, then rotate -90° around X
      // The issue: when EarthRing Y is negative, worldPos.z is negative, and after rotation
      // the shape faces the wrong direction. Solution: negate worldPos.z for negative Y coordinates
      const shape = new THREE.Shape();
      
      // Check if Y coordinates are negative (Y- side of ring)
      const hasNegativeY = outerRing.some(([_x, y]) => y < 0);
      
      outerRing.forEach(([x, y], idx) => {
        const wrappedX = wrapZoneX(x);
        const worldPos = toThreeJS({ x: wrappedX, y: y, z: floor });
        // Use worldPos.x for shape X
        // For shape Y, use worldPos.z (EarthRing Y)
        // The outline uses worldPos.z directly and shows correctly on Y+,
        // but the fill (ShapeGeometry) needs to be negated to face the correct direction after rotation
        // Based on testing: always negate worldPos.z for the fill shape
        const shapeY = -worldPos.z;
        if (idx === 0) {
          shape.moveTo(worldPos.x, shapeY);
        } else {
          shape.lineTo(worldPos.x, shapeY);
        }
      });
      
      // DEBUG: Log shape creation details
      if (window.DEBUG_ZONE_COORDS) {
        const firstCoord = outerRing[0];
        const lastCoord = outerRing[outerRing.length - 1];
        const firstWorldPos = toThreeJS({ x: wrapZoneX(firstCoord[0]), y: firstCoord[1], z: floor });
        const lastWorldPos = toThreeJS({ x: wrapZoneX(lastCoord[0]), y: lastCoord[1], z: floor });
        console.log('[ZoneManager] Creating shape:', {
          ringLength: outerRing.length,
          negatedY: hasNegativeY,
          firstCoord: { x: firstCoord[0], y: firstCoord[1] },
          lastCoord: { x: lastCoord[0], y: lastCoord[1] },
          firstShapePos: { x: firstWorldPos.x, y: hasNegativeY ? -firstWorldPos.z : firstWorldPos.z },
          lastShapePos: { x: lastWorldPos.x, y: hasNegativeY ? -lastWorldPos.z : lastWorldPos.z },
          hasNegativeY,
        });
      }

      // Add holes
      // CRITICAL: Holes must use the SAME coordinate transformation as outer ring
      // Outer ring uses -worldPos.z, so holes must also use -worldPos.z
      holes.forEach(hole => {
        if (!hole || hole.length < 3) return;
        const holePath = new THREE.Path();
        hole.forEach(([x, y], idx) => {
          const wrappedX = wrapZoneX(x);
          const worldPos = toThreeJS({ x: wrappedX, y: y, z: floor });
          // Use same coordinate transformation as outer ring: -worldPos.z
          const shapeY = -worldPos.z;
          if (idx === 0) {
            holePath.moveTo(worldPos.x, shapeY);
          } else {
            holePath.lineTo(worldPos.x, shapeY);
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
    this.highlightedZones.clear();
  }

  /**
   * Check if zones need to be re-rendered due to camera movement (for wrapping)
   * @returns {boolean} True if zones should be re-rendered
   */
  shouldReRenderZones() {
    if (!this.cameraController) {
      return false;
    }
    
    const cameraPos = this.cameraController.getEarthRingPosition();
    const currentCameraX = cameraPos.x || 0;
    
    if (this.lastCameraX === null) {
      this.lastCameraX = currentCameraX;
      return false;
    }
    
    // Calculate distance moved (accounting for wrapping)
    const directDistance = Math.abs(currentCameraX - this.lastCameraX);
    const wrappedDistance = RING_CIRCUMFERENCE - directDistance;
    const distanceMoved = Math.min(directDistance, wrappedDistance);
    
    if (distanceMoved > this.WRAP_RE_RENDER_THRESHOLD) {
      this.lastCameraX = currentCameraX;
      return true;
    }
    
    return false;
  }

  /**
   * Re-render all loaded zones (useful when camera moves significantly for wrapping)
   * This updates zone positions based on camera movement for proper wrapping
   */
  reRenderAllZones() {
    const zones = Array.from(this.zoneMeshes.keys()).map(zoneID => {
      const mesh = this.zoneMeshes.get(zoneID);
      return mesh?.userData?.zone;
    }).filter(zone => zone != null);
    
    // Clear all meshes
    this.clearAllZones();
    
    // Re-render all zones with updated camera position
    zones.forEach(zone => {
      if (zone && zone.geometry) {
        this.renderZone(zone);
      }
    });
  }
  
  /**
   * Highlight or unhighlight a zone
   */
  highlightZone(zoneID, highlight) {
    const mesh = this.zoneMeshes.get(zoneID);
    if (!mesh) return;
    
    if (highlight) {
      this.highlightedZones.add(zoneID);
      // Add highlight effect (brighter outline, glow, etc.)
      mesh.traverse((child) => {
        if (child.isLineLoop || child.isLine) {
          // Make outline brighter and thicker
          if (child.material) {
            child.material.color.multiplyScalar(1.5);
            child.material.opacity = 1.0;
            child.material.linewidth = 4;
          }
        }
      });
    } else {
      this.highlightedZones.delete(zoneID);
      // Restore original appearance
      const zone = mesh.userData.zone;
      if (zone) {
        // Re-render zone to restore original appearance
        this.renderZone(zone);
      }
    }
  }
  
  /**
   * Get zone from mesh
   */
  getZoneFromMesh(mesh) {
    let current = mesh;
    while (current) {
      if (current.userData && current.userData.zone) {
        return current.userData.zone;
      }
      current = current.parent;
    }
    return null;
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

