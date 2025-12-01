import { fetchZonesByArea } from '../api/zone-service.js';
import { isAuthenticated } from '../auth/auth-service.js';
import { wsClient } from '../network/websocket-client.js';
import * as THREE from 'three';
import { toThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition, normalizeRelativeToCamera, fromThreeJS } from '../utils/coordinates-new.js';
import { 
  legacyPositionToRingPolar, 
  ringPolarToRingArc,
  ringPolarToLegacyPosition,
  RING_CIRCUMFERENCE as NEW_RING_CIRCUMFERENCE
} from '../utils/coordinates-new.js';

const DEFAULT_ZONE_RANGE = 5000; // meters along ring
const DEFAULT_WIDTH_RANGE = 3000; // meters across width

const ZONE_STYLES = {
  residential: { fill: 'rgba(111,207,151,0.35)', stroke: 'rgba(111,207,151,0.95)' }, // Light green
  commercial: { fill: 'rgba(86,204,242,0.35)', stroke: 'rgba(86,204,242,0.95)' }, // Cyan/light blue
  industrial: { fill: 'rgba(242,201,76,0.4)', stroke: 'rgba(242,201,76,0.95)' }, // Golden yellow
  'mixed-use': { fill: 'rgba(255,214,102,0.4)', stroke: 'rgba(255,159,67,0.95)' }, // Warm yellow-orange
  mixed_use: { fill: 'rgba(255,214,102,0.4)', stroke: 'rgba(255,159,67,0.95)' }, // Warm yellow-orange
  park: { fill: 'rgba(39,174,96,0.3)', stroke: 'rgba(46,204,113,0.95)' }, // Forest green
  agricultural: { fill: 'rgba(160,82,45,0.4)', stroke: 'rgba(139,69,19,0.95)' }, // Sienna brown (earth/soil tone)
  restricted: { fill: 'rgba(231,76,60,0.4)', stroke: 'rgba(192,57,43,0.95)' }, // Red (warning)
  dezone: { fill: 'rgba(139,69,19,0.3)', stroke: 'rgba(139,69,19,0.8)' }, // Dark brown (subtraction zones)
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
    this.WRAP_RE_RENDER_THRESHOLD = 2000; // Re-render if camera moved more than 2km (lowered from 5km for better visibility)
    // Cache for full-ring zones: Map<zoneID, { geometry, lastCameraX }>
    // Full-ring zones don't need geometry rebuilds, just position updates
    this.fullRingZoneCache = new Map();
    // Track which zones belong to which chunks (for cleanup when chunks are removed)
    // Map<chunkID, Set<zoneID>>
    this.chunkZones = new Map();
    // Per-type visibility: Map<zoneType, boolean>
    this.zoneTypeVisibility = new Map([
      ['residential', true],
      ['commercial', true],
      ['industrial', true],
      ['mixed-use', true],
      ['mixed_use', true],
      ['park', true],
      ['agricultural', true],
      ['restricted', true],
      ['dezone', true],
    ]);

    // Streaming subscription state
    this.useStreaming = true; // Enable server-driven streaming by default

    this.setupListeners();
    this.setupWebSocketHandlers();
  }

  /**
   * Set up WebSocket message handlers for zone streaming
   */
  setupWebSocketHandlers() {
    // Zones are now bound to chunks - they come with chunk data, not separately via stream_delta
    // This ensures zones appear and disappear with their chunks
    // We still listen for stream_delta but only process zones that come WITH chunks
    // (zones from standalone stream_delta are ignored - they should come from chunks)
  }

  /**
   * Handle zones received from server-driven streaming
   * @param {Array} zones - Array of zone objects from server
   */
  handleStreamedZones(zones, chunkID = null) {
    // Track zones for chunk cleanup
    if (chunkID) {
      if (!this.chunkZones.has(chunkID)) {
        this.chunkZones.set(chunkID, new Set());
      }
    }

    // Add zones to game state (which will trigger rendering via listeners)
    // IMPORTANT: Always upsert zones to ensure they persist, even if camera moves
    const renderedCount = { count: 0 };
    const skippedCount = { count: 0 };
    
    zones.forEach(zone => {
      // Ensure zone has required fields
      if (zone.id && zone.geometry) {
        // Track zone for chunk cleanup
        if (chunkID) {
          this.chunkZones.get(chunkID).add(zone.id);
        }
        
        // Check if zone already exists in game state to determine if this is an update or new zone
        const existingZone = this.gameState.getZone(zone.id);
        const isUpdate = existingZone !== undefined;
        
        // Check if zone mesh already exists - if it does, we need to force re-render
        // This handles the case where zones were cleaned up but the mesh wasn't properly removed
        const existingMesh = this.zoneMeshes.get(zone.id);
        if (existingMesh) {
          // Mesh exists but might not be in scene - ensure it's removed first
          // Only remove from scene/meshes, not from game state (we're about to upsert)
          this.scene.remove(existingMesh);
          this.zoneMeshes.delete(zone.id);
          this.fullRingZoneCache.delete(zone.id);
          // Dispose of geometry and materials
          existingMesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          });
        }
        
        // Upsert to game state - this ensures zones persist even if REST API is called later
        // The gameState.upsertZone will trigger zoneAdded/zoneUpdated events,
        // which will call renderZone via the listener - don't call it directly to avoid double rendering
        const activeFloor = this.gameState.getActiveFloor();
        const zoneFloor = zone.floor ?? 0;
        this.gameState.upsertZone(zone);
        // Count zones that match the active floor (rendering happens via event listener)
        if (zoneFloor === activeFloor) {
          renderedCount.count++;
        } else {
          skippedCount.count++;
        }
      }
    });
    
    // Log zone handling for boundary chunks
    const chunkParts = chunkID?.split('_');
    const chunkIndex = chunkParts?.length >= 2 ? parseInt(chunkParts[1], 10) : null;
    const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
    
    if (isBoundary || renderedCount.count === 0) {
      if (renderedCount.count === 0 && zones.length > 0) {
        console.warn(`[Zones] Chunk ${chunkID}: 0 zones rendered (all ${skippedCount.count} skipped - wrong floor)`);
      } else if (renderedCount.count > 0 && isBoundary) {
        console.log(`[Zones] Chunk ${chunkID}: ${renderedCount.count} zone(s) rendered, ${skippedCount.count} skipped`);
      }
    }
  }
  
  /**
   * Clean up zones when a chunk is removed
   * @param {string} chunkID - Chunk ID
   */
  cleanupZonesForChunk(chunkID) {
    const zoneIDs = this.chunkZones.get(chunkID);
    if (!zoneIDs || zoneIDs.size === 0) {
      // Check if there are any zones with this chunk_index in metadata
      // Sometimes zones might not be tracked if they were loaded via REST API
      const allZones = this.gameState.getAllZones();
      const chunkParts = chunkID.split('_');
      const chunkFloor = chunkParts.length >= 2 ? parseInt(chunkParts[0], 10) : null;
      const chunkIndex = chunkParts.length >= 2 ? parseInt(chunkParts[1], 10) : null;
      
      // Find zones that belong to this chunk by checking metadata
      let removedViaMetadata = 0;
      allZones.forEach(zone => {
        if (zone.floor !== chunkFloor) return;
        
        let metadata = zone.metadata;
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch (e) {
            metadata = null;
          }
        }
        
        if (metadata && metadata.chunk_index === chunkIndex && (metadata.default_zone === true || metadata.default_zone === 'true')) {
          // This is a chunk-based zone, remove it
          this.removeZone(zone.id);
          this.gameState.removeZone(zone.id);
          removedViaMetadata++;
        }
      });
      
      // Only log if we actually removed zones or if we're near boundaries
      if (removedViaMetadata > 0) {
        const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
        if (isBoundary) {
          console.log(`[Zones] Cleanup chunk ${chunkID}: removed ${removedViaMetadata} zone(s) via metadata`);
        }
      }
      return;
    }
    
    // Extract chunk index from chunkID for comparison
    const chunkParts = chunkID.split('_');
    const chunkIndex = chunkParts.length >= 2 ? parseInt(chunkParts[1], 10) : null;
    
    // Check if we're near boundaries (where zones disappear)
    const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
    
    // Remove zones from game state and scene
    zoneIDs.forEach(zoneID => {
      // Always remove tracked zones (they're guaranteed to be chunk-based)
      this.removeZone(zoneID);
      this.gameState.removeZone(zoneID);
    });
    
    // Only log cleanup near boundaries where zones disappear
    if (isBoundary && zoneIDs.size > 0) {
      const cameraPos = this.cameraController?.getEarthRingPosition?.();
      const cameraS = cameraPos ? cameraPos.x : 0;
      console.log(`[Zones] Cleanup chunk ${chunkID} (idx=${chunkIndex}): removed ${zoneIDs.size} zone(s) at camera s=${cameraS.toFixed(1)}`);
    }
    
    // Remove chunk from tracking
    this.chunkZones.delete(chunkID);
  }

  setupListeners() {
    this.gameState.on('zoneAdded', ({ zone }) => this.renderZone(zone));
    this.gameState.on('zoneUpdated', ({ zone }) => this.renderZone(zone));
    this.gameState.on('zoneRemoved', ({ zoneID }) => this.removeZone(zoneID));
    this.gameState.on('zonesCleared', () => this.clearAllZones());
    // Clean up zones when chunks are removed
    this.gameState.on('chunkRemoved', ({ chunkID }) => this.cleanupZonesForChunk(chunkID));
    // Reload zones when active floor changes
    this.gameState.on('activeFloorChanged', ({ newFloor }) => {
      // Remove all zone meshes that don't match the new floor
      const zonesToRemove = [];
      this.zoneMeshes.forEach((mesh, zoneID) => {
        const zone = mesh.userData.zone;
        const zoneFloor = zone?.floor ?? 0;
        if (zoneFloor !== newFloor) {
          zonesToRemove.push(zoneID);
        }
      });
      zonesToRemove.forEach(zoneID => this.removeZone(zoneID));
      
      // Also remove zones from game state that don't match
      const allZones = this.gameState.getAllZones();
      allZones.forEach(zone => {
        const zoneFloor = zone.floor ?? 0;
        if (zoneFloor !== newFloor) {
          this.gameState.removeZone(zone.id);
        }
      });
      
      // Clear fetch throttle to force immediate reload
      this.lastFetchTime = 0;
      // Update visibility for remaining zones
      this.updateAllZoneVisibility();
      // Load zones for the new floor
      this.loadZonesAroundCamera();
    });
  }

  async loadZonesAroundCamera(range = DEFAULT_ZONE_RANGE) {
    if (!this.cameraController || this.pendingFetch || !isAuthenticated()) {
      return;
    }

    // Zones are now bound to chunks - they're loaded from chunk data, not via separate zone queries
    // Don't use REST API for zones anymore - zones come from chunks
    // This ensures zones are always bound to chunks and appear/disappear with them
    if (this.useStreaming && wsClient.isConnected()) {
      // Silently skip - zones come from chunks via streaming
      return;
    }

    const now = performance.now();
    if (now - this.lastFetchTime < this.fetchThrottleMs) {
      return;
    }
    
    // Validate range to prevent invalid bounding boxes
    if (range <= 0 || range > NEW_RING_CIRCUMFERENCE / 2) {
      console.warn(`Invalid zone range: ${range}, clamping to valid range`);
      range = Math.min(Math.max(range, 100), NEW_RING_CIRCUMFERENCE / 2 - 1000);
    }

    const cameraPos = this.cameraController.getEarthRingPosition();
    // Get active floor from game state (independent of camera elevation)
    const floor = this.gameState.getActiveFloor();

    // Convert camera position to RingArc coordinates
    const cameraXWrapped = wrapRingPosition(cameraPos.x);
    const cameraPolar = legacyPositionToRingPolar(cameraXWrapped, cameraPos.y || 0, 0);
    const cameraArc = ringPolarToRingArc(cameraPolar);
    
    // Calculate bounds in RingArc coordinates (arc length)
    const minS = cameraArc.s - range;
    const maxS = cameraArc.s + range;
    
    // Convert back to legacy coordinates for REST API (backward compatibility)
    // Note: For streaming, the server will use RingArc coordinates from the pose
    const minPolar = { theta: (minS / NEW_RING_CIRCUMFERENCE) * 2 * Math.PI, r: cameraPolar.r, z: cameraPolar.z };
    const maxPolar = { theta: (maxS / NEW_RING_CIRCUMFERENCE) * 2 * Math.PI, r: cameraPolar.r, z: cameraPolar.z };
    const minLegacy = ringPolarToLegacyPosition(minPolar);
    const maxLegacy = ringPolarToLegacyPosition(maxPolar);
    
    // Wrap legacy coordinates for API call
    let minX = wrapRingPosition(minLegacy.x);
    let maxX = wrapRingPosition(maxLegacy.x);
    
    // Handle wrap-around: ensure minX < maxX after wrapping
    // If wrapping causes minX > maxX, clamp to valid range
    if (minX < 0) {
      minX = wrapRingPosition(minX);
    }
    if (maxX >= NEW_RING_CIRCUMFERENCE) {
      maxX = wrapRingPosition(maxX);
    }
    
    // Ensure minX < maxX (if wrapping caused inversion, clamp to valid range)
    if (minX >= maxX) {
      // This happens when the range wraps around the ring boundary
      // Clamp to valid range: [0, NEW_RING_CIRCUMFERENCE)
      minX = Math.max(0, cameraXWrapped - range);
      maxX = Math.min(NEW_RING_CIRCUMFERENCE, cameraXWrapped + range);
      // Ensure they're still valid
      if (minX >= maxX) {
        // Fallback: use a smaller range centered on camera
        const safeRange = Math.min(range, NEW_RING_CIRCUMFERENCE / 2 - 1);
        minX = Math.max(0, cameraXWrapped - safeRange);
        maxX = Math.min(NEW_RING_CIRCUMFERENCE, cameraXWrapped + safeRange);
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
      
      // Only remove zones that are clearly far from camera and outside fetch range
      // Keep zones that are manually added (e.g., newly created) even if outside fetch
      // Never remove system zones or zones that span a large portion of the ring
      // IMPORTANT: Be conservative - only remove zones that are definitely not visible
      const cameraXWrapped = wrapRingPosition(cameraPos.x);
      
      existingZones.forEach(existingZone => {
        if (fetchedZoneIDs.has(existingZone.id)) {
          return; // Zone is in fetch results, keep it
        }
        
        // Never remove system zones (e.g., default maglev zones)
        if (existingZone.is_system_zone) {
          if (window.DEBUG_ZONE_COORDS) {
            console.log('[ZoneManager] Keeping system zone outside fetch range:', existingZone.id);
          }
          return;
        }
        
        // Check if zone is far from camera (should be removed)
        // Only remove if zone is clearly outside the fetch range
        const zoneGeometry = existingZone.geometry ? 
          (typeof existingZone.geometry === 'string' ? JSON.parse(existingZone.geometry) : existingZone.geometry) : null;
        
        if (zoneGeometry && zoneGeometry.coordinates && zoneGeometry.coordinates[0]) {
          // Calculate bounding box of zone (check all coordinates, not just first)
          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          const coords = zoneGeometry.coordinates[0];
          coords.forEach(coord => {
            const x = coord[0];
            const y = coord[1];
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          });
          
          // Check if zone spans a large portion of the ring (e.g., full ring zones)
          const directSpan = maxX - minX;
          const wrappedSpan = NEW_RING_CIRCUMFERENCE - directSpan;
          const effectiveSpan = Math.min(directSpan, wrappedSpan);
          
          // If zone spans more than half the ring, never remove it (it's always "near" the camera)
          if (effectiveSpan > NEW_RING_CIRCUMFERENCE / 2) {
            if (window.DEBUG_ZONE_COORDS) {
              console.log('[ZoneManager] Keeping large-span zone outside fetch range:', {
                zoneId: existingZone.id,
                effectiveSpan,
              });
            }
            return; // Keep large zones (e.g., full ring zones)
          }
          
          // Check if zone bounding box overlaps with fetch area
          // Calculate distance from camera to zone bounding box (accounting for wrap-around)
          // Use the closest point of the zone bounding box to the camera
          const zoneCenterX = (minX + maxX) / 2;
          const zoneCenterXWrapped = wrapRingPosition(zoneCenterX);
          
          // Calculate distance from camera to zone center
          const directDistance = Math.abs(zoneCenterXWrapped - cameraXWrapped);
          const wrappedDistance = NEW_RING_CIRCUMFERENCE - directDistance;
          const centerDistance = Math.min(directDistance, wrappedDistance);
          
          // Also check if zone extends into the fetch range
          // Zone extends into fetch range if its bounding box overlaps with [cameraX - range, cameraX + range]
          const zoneHalfSpan = effectiveSpan / 2;
          const zoneMinDistance = Math.max(0, centerDistance - zoneHalfSpan);
          
          // Only remove if zone is clearly outside fetch range
          // Use a larger buffer (range * 3) to be more conservative and prevent zones from disappearing
          // Also check Y coordinates to ensure zone isn't visible in width direction
          const yDistance = Math.max(
            Math.abs(minY - cameraPos.y),
            Math.abs(maxY - cameraPos.y)
          );
          const isOutsideYRange = yDistance > DEFAULT_WIDTH_RANGE * 1.5;
          
          if (zoneMinDistance > range * 3 && isOutsideYRange) {
            if (window.DEBUG_ZONE_COORDS) {
              console.warn('[ZoneManager] Removing zone far from camera:', {
                zoneId: existingZone.id,
                centerDistance,
                zoneMinDistance,
                range,
                yDistance,
                isSystem: existingZone.is_system_zone,
                effectiveSpan,
              });
            }
            // Zone is far from camera in both X and Y, safe to remove
            this.gameState.removeZone(existingZone.id);
          }
          // Otherwise, keep it (might be near camera but outside fetch bounds due to wrapping)
        }
      });
      this.lastFetchTime = performance.now();
      // Clear error state on success
      this.lastError = { message: null, timestamp: 0 };
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

    // Only render zones that match the active floor
    const activeFloor = this.gameState.getActiveFloor();
    const zoneFloor = zone.floor ?? 0;
    if (zoneFloor !== activeFloor) {
      // Zone is for a different floor - remove it if it exists
      this.removeZone(zone.id);
      this.fullRingZoneCache.delete(zone.id);
      // Also remove from game state
      this.gameState.removeZone(zone.id);
      return;
    }

    // Get camera position for wrapping - use same logic as chunks to preserve negative values
    // Get raw Three.js camera position and convert to EarthRing coordinates
    // This preserves negative X values and large positive values without wrapping
    const camera = this.sceneManager?.getCamera ? this.sceneManager.getCamera() : null;
    let cameraX = 0;
    let cameraPos = { x: 0, y: 0, z: 0 }; // Initialize for debug logging
    if (camera) {
      // Three.js X coordinate directly maps to arc length s in RingArc coordinates
      // Convert to EarthRing coordinates preserving raw position (including negatives)
      const cameraThreeJSPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      const cameraEarthRingPos = fromThreeJS(cameraThreeJSPos);
      cameraX = cameraEarthRingPos.x || 0;
      cameraPos = cameraEarthRingPos; // Set for debug logging
    } else {
      // Fallback: try camera controller but note it wraps the value
      cameraPos = this.cameraController?.getEarthRingPosition() ?? { x: 0, y: 0, z: 0 };
      cameraX = cameraPos.x;
    }

    // Check if this is a full-ring zone (spans more than half the ring)
    // For full-ring zones, we can optimize by caching geometry and only updating position
    const zoneGeometry = zone.geometry ? 
      (typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry) : null;
    
    let isFullRingZone = false;
    if (zoneGeometry && zoneGeometry.coordinates && zoneGeometry.coordinates[0]) {
      const coords = zoneGeometry.coordinates[0];
      let minX = Infinity, maxX = -Infinity;
      coords.forEach(coord => {
        const x = coord[0];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      });
      const directSpan = maxX - minX;
      const wrappedSpan = NEW_RING_CIRCUMFERENCE - directSpan;
      const effectiveSpan = Math.min(directSpan, wrappedSpan);
      
      // Treat as full-ring only if the EFFECTIVE span (shortest arc on the ring)
      // exceeds half the ring circumference. This avoids misclassifying small
      // cross-boundary zones (e.g., [-60, +60] around 0) as full-ring zones.
      isFullRingZone = effectiveSpan > NEW_RING_CIRCUMFERENCE / 2;
      
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneManager] Zone span analysis:', {
          zoneId: zone.id,
          minX,
          maxX,
          directSpan,
          wrappedSpan,
          effectiveSpan,
          isFullRingZone,
        });
      }
    }

    // For full-ring zones, check if we can reuse existing mesh
    if (isFullRingZone) {
      const existingMesh = this.zoneMeshes.get(zone.id);
      const cached = this.fullRingZoneCache.get(zone.id);
      
      if (existingMesh && cached) {
        // Mesh exists and is cached - check if we need to update position
        const cameraXWrapped = wrapRingPosition(cameraX);
        const lastCameraXWrapped = wrapRingPosition(cached.lastCameraX);
        const cameraDelta = Math.abs(cameraXWrapped - lastCameraXWrapped);
        const wrappedDelta = Math.min(cameraDelta, NEW_RING_CIRCUMFERENCE - cameraDelta);
        
        // Use the same threshold as shouldReRenderZones (2km) for consistency
        const RE_RENDER_THRESHOLD = 2000;
        
        // Only skip rebuild if camera hasn't moved significantly (for wrapping)
        if (wrappedDelta < RE_RENDER_THRESHOLD) {
          // Camera hasn't moved enough to require re-wrapping
          // Just ensure visibility is correct and return
          const zoneType = (zone.zone_type?.toLowerCase() || 'default');
          const typeVisible = this.zoneTypeVisibility.get(zoneType === 'mixed_use' ? 'mixed-use' : zoneType) ?? true;
          existingMesh.visible = this.zonesVisible && typeVisible;
          if (window.DEBUG_ZONE_COORDS) {
            console.log('[ZoneManager] Skipping rebuild for full-ring zone:', zone.id, 'camera delta:', wrappedDelta);
          }
          return;
        }
        
        // Camera moved significantly - need to update wrapping
        // Rebuild the mesh to ensure proper wrapping
        if (window.DEBUG_ZONE_COORDS) {
          console.log('[ZoneManager] Rebuilding full-ring zone due to camera movement:', zone.id, 'camera delta:', wrappedDelta);
        }
        // Update cached camera position
        cached.lastCameraX = cameraX;
        // Fall through to rebuild mesh with new camera position
      }
    }

    // Normal path: remove existing mesh and rebuild
    // Check if mesh exists and is in scene - if not, ensure it's properly cleaned up
    const existingMesh = this.zoneMeshes.get(zone.id);
    if (existingMesh) {
      // Mesh exists - check if it's actually in the scene
      if (existingMesh.parent === null || !this.scene.children.includes(existingMesh)) {
        // Mesh is orphaned - clean it up properly
        this.zoneMeshes.delete(zone.id);
        this.fullRingZoneCache.delete(zone.id);
        // Dispose of geometry and materials
        existingMesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      } else {
        // Mesh is in scene - remove it for re-rendering (but keep in game state)
        this.scene.remove(existingMesh);
        this.zoneMeshes.delete(zone.id);
        this.fullRingZoneCache.delete(zone.id);
        // Dispose of geometry and materials
        existingMesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }
    }

    const polygons = parseGeometry(zone.geometry);
    if (polygons.length === 0) {
      return;
    }

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
      
      // Create fill mesh
      const fillGeometry = new THREE.ShapeGeometry(shape);
      let fillMaterial;
      
      // Special handling for mixed-use: rainbow gradient using shader
      if (zoneType === 'mixed-use' || zoneType === 'mixed_use') {
        // Rainbow gradient shader material
        const vertexShader = `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `;
        
        const fragmentShader = `
          uniform float opacity;
          varying vec2 vUv;
          
          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }
          
          void main() {
            // Create rainbow gradient based on UV coordinates
            float hue = (vUv.x + vUv.y) * 0.5; // Mix X and Y for diagonal gradient
            vec3 color = hsv2rgb(vec3(hue, 0.8, 0.9));
            gl_FragColor = vec4(color, opacity);
          }
        `;
        
        fillMaterial = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          transparent: true,
          opacity: fillOpacity,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
          uniforms: {
            opacity: { value: fillOpacity }
          }
        });
      } else {
        // Standard solid color material for other zone types
        const fillRgbMatch = style.fill.match(/rgba?\(([\d.]+),([\d.]+),([\d.]+)/);
        const fillColor = fillRgbMatch
          ? new THREE.Color(
              parseFloat(fillRgbMatch[1]) / 255,
              parseFloat(fillRgbMatch[2]) / 255,
              parseFloat(fillRgbMatch[3]) / 255
            )
          : new THREE.Color(style.fill);
        
        fillMaterial = new THREE.MeshBasicMaterial({
          color: fillColor,
          transparent: true,
          opacity: fillOpacity,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        });
      }
      
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
    
    // Cache full-ring zones for optimization
    if (isFullRingZone) {
      this.fullRingZoneCache.set(zone.id, {
        lastCameraX: cameraX,
        geometry: zone.geometry, // Store original geometry for comparison
      });
      if (window.DEBUG_ZONE_COORDS) {
        console.log('[ZoneManager] Cached full-ring zone:', zone.id);
      }
    }
  }

  removeZone(zoneID) {
    const mesh = this.zoneMeshes.get(zoneID);
    if (!mesh) {
      if (window.DEBUG_ZONE_COORDS) {
        console.warn('[ZoneManager] removeZone called for missing mesh:', zoneID);
      }
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
    // Clear cache when zone is removed
    this.fullRingZoneCache.delete(zoneID);
    if (window.DEBUG_ZONE_COORDS) {
      console.warn('[ZoneManager] Removed zone mesh:', zoneID);
    }
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
    const activeFloor = this.gameState.getActiveFloor();
    this.zoneMeshes.forEach((mesh) => {
      const zone = mesh.userData.zone;
      const zoneFloor = zone?.floor ?? 0;
      // Hide zones that don't match the active floor
      if (zoneFloor !== activeFloor) {
        mesh.visible = false;
        return;
      }
      
      const zoneType = mesh.userData.zoneType || 'default';
      const typeVisible = this.zoneTypeVisibility.get(zoneType) ?? true;
      mesh.visible = this.zonesVisible && typeVisible;
    });
  }

  clearAllZones() {
    Array.from(this.zoneMeshes.keys()).forEach(zoneID => this.removeZone(zoneID));
    this.zoneMeshes.clear();
    this.highlightedZones.clear();
    this.fullRingZoneCache.clear();
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
    const wrappedDistance = NEW_RING_CIRCUMFERENCE - directDistance;
    const distanceMoved = Math.min(directDistance, wrappedDistance);
    
    // Lower threshold to 2km (from 5km) to ensure zones re-render more frequently
    // This prevents zones from appearing/disappearing as wrapping changes
    const RE_RENDER_THRESHOLD = 2000; // 2km instead of 5km
    
    if (distanceMoved > RE_RENDER_THRESHOLD) {
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
    if (
      this.lastError &&
      this.lastError.message === message &&
      now - this.lastError.timestamp < 5000
    ) {
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

