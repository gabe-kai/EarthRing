/**
 * Zone Info Tags
 * Displays floating "i" info buttons above zones when toolbar is open and zones are visible
 */

import * as THREE from 'three';
import { updateInfoBox } from '../ui/info-box.js';
import { getPlayerProfile } from '../api/player-service.js';
import { updateZone, deleteZone } from '../api/zone-service.js';
import { showConfirmationModal } from '../ui/game-modal.js';
import { normalizeRelativeToCamera, toThreeJS, DEFAULT_FLOOR_HEIGHT, wrapRingPosition, RING_CIRCUMFERENCE, wrapArcLength } from '../utils/coordinates-new.js';

/**
 * Calculate zone center and bounds from geometry
 */
function calculateZoneBounds(geometry) {
  if (!geometry || !geometry.coordinates) {
    return null;
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  // Handle Polygon (single ring or multiple rings)
  const coordinates = geometry.coordinates;
  const outerRing = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates;
  
  outerRing.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    center: { x: centerX, y: centerY },
    bounds: { minX, maxX, minY, maxY },
  };
}


/**
 * Zone Info Tags Manager
 */
export class ZoneInfoTags {
  constructor(sceneManager, cameraController, gameStateManager, zoneManager, zoneEditor) {
    this.sceneManager = sceneManager;
    this.cameraController = cameraController;
    this.gameStateManager = gameStateManager;
    this.zoneManager = zoneManager;
    this.zoneEditor = zoneEditor;
    
    // Container for all info tag HTML elements
    this.container = null;
    this.tags = new Map(); // Map of zone ID -> HTML element
    
    // State
    this.visible = false;
    this.toolbarExpanded = false;
    this.zonesVisible = false;
    
    // PERFORMANCE: Cache zone bounds to avoid recalculating every frame
    this.zoneBoundsCache = new Map(); // Map<zoneId, { center, bounds }>
    this.lastZoneCount = 0; // Track when zones change
    this.lastTagUpdateTime = 0; // Throttle tag updates
    
    this.setupContainer();
    this.setupStyles();
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for zone changes to update tags
    if (this.gameStateManager) {
      this.gameStateManager.on('zoneAdded', () => {
        if (this.visible) {
          this.updateTags();
        }
      });
      this.gameStateManager.on('zoneUpdated', () => {
        if (this.visible) {
          this.updateTags();
        }
      });
      this.gameStateManager.on('zoneRemoved', (zoneId) => {
        const tag = this.tags.get(zoneId);
        if (tag) {
          tag.remove();
          this.tags.delete(zoneId);
        }
      });
      this.gameStateManager.on('activeFloorChanged', () => {
        if (this.visible) {
          this.updateTags();
        }
      });
    }
  }

  setupContainer() {
    this.container = document.createElement('div');
    this.container.id = 'zone-info-tags-container';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
      overflow: hidden;
    `;
    document.body.appendChild(this.container);
  }

  setupStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .zone-info-tag {
        position: absolute;
        width: 32px;
        height: 32px;
        background: rgba(0, 0, 0, 0.8);
        border: 2px solid #00ff00;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: all;
        color: #00ff00;
        font-size: 18px;
        font-weight: bold;
        font-family: monospace;
        transition: all 0.2s ease;
        transform: translate(-50%, -50%);
        user-select: none;
      }
      
      .zone-info-tag:hover {
        background: rgba(0, 255, 0, 0.2);
        border-color: #00ff88;
        transform: translate(-50%, -50%) scale(1.2);
      }
      
      .zone-info-tag.hidden {
        opacity: 0;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Set toolbar expanded state
   */
  setToolbarExpanded(expanded) {
    this.toolbarExpanded = expanded;
    console.log(`[ZoneInfoTags] Toolbar expanded: ${expanded}`);
    this.updateVisibility();
  }

  /**
   * Set zones visible state
   */
  setZonesVisible(visible) {
    this.zonesVisible = visible;
    console.log(`[ZoneInfoTags] Zones visible: ${visible}`);
    this.updateVisibility();
  }

  /**
   * Update overall visibility based on toolbar and zones state
   */
  updateVisibility() {
    const shouldShow = this.toolbarExpanded && this.zonesVisible;
    if (shouldShow === this.visible) return;
    
    this.visible = shouldShow;
    console.log(`[ZoneInfoTags] Visibility changed: ${shouldShow} (toolbar=${this.toolbarExpanded}, zones=${this.zonesVisible})`);
    if (shouldShow) {
      this.updateTags();
    } else {
      this.hideAllTags();
    }
  }

  /**
   * Update all zone info tags
   */
  updateTags() {
    if (!this.visible) {
      if (!this._loggedSkipped) {
        console.log(`[ZoneInfoTags] Skipping tag update: not visible (toolbar=${this.toolbarExpanded}, zones=${this.zonesVisible})`);
        this._loggedSkipped = true;
      }
      return;
    }
    this._loggedSkipped = false;
    
    const activeFloor = this.gameStateManager.getActiveFloor();
    const allZones = this.gameStateManager.getAllZones();
    
    // Only log when zone count changes or first time
    if (allZones.length !== (this._lastZoneCount || 0)) {
      console.log(`[ZoneInfoTags] Zone count changed: ${allZones.length} total zones, activeFloor=${activeFloor}`);
      this._lastZoneCount = allZones.length;
    }
    
    if (allZones.length === 0) {
      if (!this._loggedNoZones) {
        console.log(`[ZoneInfoTags] No zones found in gameState (activeFloor=${activeFloor})`);
        this._loggedNoZones = true;
      }
      return;
    }
    this._loggedNoZones = false;
    
    // Filter zones by active floor and visibility
    let visibleZones = allZones.filter(zone => {
      const zoneFloor = zone.floor ?? 0;
      const hasGeometry = zone.geometry && zone.geometry.type === 'Polygon';
      
      // Check if zone type is visible
      let zoneTypeVisible = true;
      if (this.zoneManager && this.zoneManager.zoneTypeVisibility) {
        const zoneType = zone.zone_type?.toLowerCase() || 'default';
        const normalizedType = zoneType === 'mixed_use' ? 'mixed-use' : zoneType.replace('_', '-');
        zoneTypeVisible = this.zoneManager.zoneTypeVisibility.get(normalizedType) ?? true;
      }
      
      return zoneFloor === activeFloor && hasGeometry && zoneTypeVisible;
    });
    
    // Filter by distance from camera - only show zones within 1000m and limit to nearest 30
    const cameraPos = this.cameraController?.getEarthRingPosition();
    if (cameraPos) {
      const MAX_DISTANCE = 1000; // meters
      const MAX_VISIBLE_TAGS = 30; // maximum number of tags to show
      
      // Calculate distance from camera to each zone center
      // Wrap both camera and zone positions to [0, RING_CIRCUMFERENCE) first
      const cameraXWrapped = wrapArcLength(cameraPos.x);
      const zonesWithDistance = visibleZones.map(zone => {
        // PERFORMANCE: Use cached bounds if available
        let bounds = this.zoneBoundsCache.get(zone.id);
        if (!bounds) {
          bounds = calculateZoneBounds(zone.geometry);
          if (bounds) {
            this.zoneBoundsCache.set(zone.id, bounds);
          }
        }
        if (!bounds) return { zone, distance: Infinity };
        
        // Wrap zone X to [0, RING_CIRCUMFERENCE)
        const zoneXWrapped = wrapArcLength(bounds.center.x);
        
        // Calculate raw delta in wrapped space
        let rawDx = zoneXWrapped - cameraXWrapped;
        
        // Wrap delta to [-halfCirc, halfCirc] to find shortest path around ring
        const halfCirc = RING_CIRCUMFERENCE / 2;
        let dx = rawDx;
        if (dx > halfCirc) {
          dx -= RING_CIRCUMFERENCE;
        } else if (dx < -halfCirc) {
          dx += RING_CIRCUMFERENCE;
        }
        
        const dy = bounds.center.y - cameraPos.y;
        
        // Calculate 2D distance in EarthRing coordinates (X, Y plane)
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Debug: log zones when camera is on X- side (negative EarthRing X) and zones are close
        const shouldLog = cameraPos.x < 0 && Math.abs(dy) < 100 && distance <= MAX_DISTANCE && !this._loggedXMinusSide;
        if (shouldLog) {
          console.log(`[ZoneInfoTags] Zone ${zone.id}: zoneX=${bounds.center.x.toFixed(1)} (wrapped=${zoneXWrapped.toFixed(1)}), cameraX=${cameraPos.x.toFixed(1)} (wrapped=${cameraXWrapped.toFixed(1)}), rawDx=${rawDx.toFixed(1)}, wrappedDx=${dx.toFixed(1)}, dy=${dy.toFixed(1)}, distance=${distance.toFixed(1)}`);
          this._loggedXMinusSide = true;
        }
        
        // Also log when camera moves to X- side and we find nearby zones
        if (cameraPos.x < 0 && Math.abs(dx) < 1000 && Math.abs(dy) < 100 && !this._loggedXMinusCamera) {
          console.log(`[ZoneInfoTags] Camera on X- side: zone ${zone.id} at X=${bounds.center.x.toFixed(1)} (wrapped=${zoneXWrapped.toFixed(1)}), camera at X=${cameraPos.x.toFixed(1)} (wrapped=${cameraXWrapped.toFixed(1)}), dx=${dx.toFixed(1)}, distance=${distance.toFixed(1)}`);
          this._loggedXMinusCamera = true;
        }
        
        return { zone, distance, dx, dy };
      });
      
      // Filter by distance and sort by proximity
      const filteredZones = zonesWithDistance
        .filter(({ distance }) => distance <= MAX_DISTANCE)
        .sort((a, b) => a.distance - b.distance);
      
      // Debug: log distance filtering results (reset when camera moves significantly)
      const lastCameraXWrapped = this._lastCameraXWrapped;
      const lastCameraXRaw = this._lastCameraXRaw;
      const cameraMovedWrapped = lastCameraXWrapped === undefined ? true : Math.abs(cameraXWrapped - lastCameraXWrapped) > 100;
      const cameraMovedRaw = lastCameraXRaw === undefined ? true : Math.abs(cameraPos.x - lastCameraXRaw) > 100;
      const cameraMoved = cameraMovedWrapped || cameraMovedRaw;
      this._lastCameraXWrapped = cameraXWrapped;
      this._lastCameraXRaw = cameraPos.x;
      
      if (cameraMoved) {
        this._loggedXMinusSide = false;
        this._loggedXMinusCamera = false;
        this._loggedDistanceFilter = false;
      }
      
      if (filteredZones.length > 0 && (!this._loggedDistanceFilter || cameraMoved)) {
        const xPlusCount = filteredZones.filter(z => z.dx > 0).length;
        const xMinusCount = filteredZones.filter(z => z.dx < 0).length;
        console.log(`[ZoneInfoTags] Distance filter: ${filteredZones.length} zones within ${MAX_DISTANCE}m (X+: ${xPlusCount}, X-: ${xMinusCount}), cameraX=${cameraPos.x.toFixed(1)}`);
        this._loggedDistanceFilter = true;
      }
      
      visibleZones = filteredZones
        .slice(0, MAX_VISIBLE_TAGS)
        .map(({ zone }) => zone);
    }
    
    // Only log when filtered count changes
    if (visibleZones.length !== (this._lastVisibleCount || 0)) {
      console.log(`[ZoneInfoTags] Filtered to ${visibleZones.length} visible zones (from ${allZones.length} total)`);
      this._lastVisibleCount = visibleZones.length;
    }

    // Remove tags for zones that are no longer visible
    const visibleZoneIds = new Set(visibleZones.map(z => z.id));
    for (const [zoneId, tag] of this.tags.entries()) {
      if (!visibleZoneIds.has(zoneId)) {
        tag.remove();
        this.tags.delete(zoneId);
        // Clean up cached bounds when zone is removed
        this.zoneBoundsCache.delete(zoneId);
      }
    }
    
    // Update zone count tracker
    if (this.gameStateManager) {
      this.lastZoneCount = this.gameStateManager.getAllZones().length;
    }

    // Create or update tags for visible zones
    const beforeCount = this.tags.size;
    let tagsCreated = 0;
    let tagsFailed = 0;
    visibleZones.forEach(zone => {
      try {
        const result = this.updateTag(zone);
        if (result) {
          tagsCreated++;
        } else {
          tagsFailed++;
        }
      } catch (error) {
        console.error(`[ZoneInfoTags] Error creating tag for zone ${zone.id}:`, error);
        tagsFailed++;
      }
    });
    
    // Only log when tag count changes
    if (this.tags.size !== beforeCount) {
      console.log(`[ZoneInfoTags] Tag update: ${this.tags.size} total tags (${tagsCreated} created, ${tagsFailed} failed, had ${beforeCount} before)`);
    }
  }

  /**
   * Update or create a tag for a zone
   */
  updateTag(zone) {
    if (!zone || !zone.geometry) {
      if (!this._loggedGeometryError) {
        console.warn(`[ZoneInfoTags] Zone ${zone?.id || 'unknown'} missing geometry`);
        this._loggedGeometryError = true;
      }
      return false;
    }

    const bounds = calculateZoneBounds(zone.geometry);
    if (!bounds) {
      if (!this._loggedBoundsError) {
        console.warn(`[ZoneInfoTags] Zone ${zone.id} bounds calculation failed`);
        this._loggedBoundsError = true;
      }
      return false;
    }

    // Get camera position for coordinate wrapping
    const camera = this.sceneManager?.getCamera();
    if (!camera) {
      if (!this._loggedCameraError) {
        console.warn(`[ZoneInfoTags] Camera unavailable`);
        this._loggedCameraError = true;
      }
      return false;
    }
    
    // Get camera's EarthRing X (from Three.js X directly, like chunks do)
    const cameraThreeJSX = camera.position.x;
    
    // Wrap camera/zone X and compute shortest delta so tags stay near camera even at ring wrap
    const cameraXWrapped = wrapArcLength(cameraThreeJSX);
    const zoneXWrapped = wrapArcLength(bounds.center.x);
    const halfCirc = RING_CIRCUMFERENCE / 2;
    let dx = zoneXWrapped - cameraXWrapped;
    if (dx > halfCirc) dx -= RING_CIRCUMFERENCE;
    else if (dx < -halfCirc) dx += RING_CIRCUMFERENCE;
    
    // Compute tag's Three.js X position relative to camera's Three.js X
    const tagThreeJSX = cameraThreeJSX + dx;

    // Convert to Three.js coordinates
    // Position tag high above zone center like a flag on a pole (15m above floor)
    const floor = zone.floor ?? 0;
    const floorHeight = floor * DEFAULT_FLOOR_HEIGHT;
    const tagHeightMeters = 15.0; // Height above floor for flagpole effect
    const earthRingPos = {
      x: tagThreeJSX, // Use Three.js X directly (maps 1:1 to EarthRing X)
      y: bounds.center.y,
      z: (floorHeight + tagHeightMeters) / DEFAULT_FLOOR_HEIGHT, // Total height in floor units
    };
    const threeJSPos = toThreeJS(earthRingPos, DEFAULT_FLOOR_HEIGHT);
    if (!threeJSPos) {
      if (!this._loggedThreeJSError) {
        console.warn(`[ZoneInfoTags] toThreeJS conversion failed for zone ${zone.id}`);
        this._loggedThreeJSError = true;
      }
      return false;
    }
    const worldPos = new THREE.Vector3(threeJSPos.x, threeJSPos.y, threeJSPos.z);

    // Get or create tag element
    let tag = this.tags.get(zone.id);
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'zone-info-tag';
      tag.textContent = 'i';
      tag.dataset.zoneId = zone.id;
      
      // Add click handler
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showZoneDetails(zone);
      });
      
      this.container.appendChild(tag);
      this.tags.set(zone.id, tag);
    }

    // Update tag position (will be done in render)
    tag.dataset.worldX = worldPos.x;
    tag.dataset.worldY = worldPos.y;
    tag.dataset.worldZ = worldPos.z;
    tag.classList.remove('hidden');
    
    return true;
  }

  /**
   * Update tag screen positions based on camera
   */
  updateTagPositions() {
    // Fallback: Check actual toolbar DOM state in case callback didn't fire
    const toolbarElement = document.getElementById('zones-toolbar');
    if (toolbarElement) {
      const panel = toolbarElement.querySelector('.zones-toolbar-panel');
      const isActuallyExpanded = panel && panel.classList.contains('expanded');
      if (isActuallyExpanded !== this.toolbarExpanded) {
        console.log(`[ZoneInfoTags] Toolbar state mismatch detected: expected=${this.toolbarExpanded}, actual=${isActuallyExpanded}, correcting...`);
        this.toolbarExpanded = isActuallyExpanded;
        this.updateVisibility();
      }
    }
    
    // PERFORMANCE: Only update tags if zones changed or enough time has passed (throttle)
    const now = performance.now();
    const zonesChanged = this.gameStateManager && this.gameStateManager.getAllZones().length !== this.lastZoneCount;
    if (zonesChanged || (now - this.lastTagUpdateTime) >= 500) {
      this.updateTags();
      this.lastTagUpdateTime = now;
    }
    
    if (!this.visible) return;

    const camera = this.sceneManager.getCamera();
    const renderer = this.sceneManager.getRenderer();
    if (!camera || !renderer) return;

    const vector = new THREE.Vector3();

    for (const [zoneId, tag] of this.tags.entries()) {
      if (tag.classList.contains('hidden')) continue;

      const worldX = parseFloat(tag.dataset.worldX);
      const worldY = parseFloat(tag.dataset.worldY);
      const worldZ = parseFloat(tag.dataset.worldZ);

      vector.set(worldX, worldY, worldZ);
      
      // Project 3D position to screen coordinates
      vector.project(camera);
      
      const widthHalf = window.innerWidth / 2;
      const heightHalf = window.innerHeight / 2;
      
      const x = (vector.x * widthHalf) + widthHalf;
      const y = -(vector.y * heightHalf) + heightHalf;
      
      // Check if position is behind camera or outside viewport
      // After project(), z will be in [-1, 1] for visible objects
      // z > 1 means behind camera, z < -1 means way in front (rare)
      if (vector.z > 1.0 || vector.z < -1.0) {
        tag.classList.add('hidden');
        continue;
      }
      
      // Check if position is outside viewport (with some margin)
      if (x < -50 || x > window.innerWidth + 50 || 
          y < -50 || y > window.innerHeight + 50) {
        tag.classList.add('hidden');
        continue;
      }
      
      tag.style.left = `${x}px`;
      tag.style.top = `${y}px`;
      tag.classList.remove('hidden');
    }
    
    // Log only on first render or when debugging
    if (window.earthring?.debug && this.tags.size > 0) {
      const visibleCount = Array.from(this.tags.values()).filter(t => !t.classList.contains('hidden')).length;
      if (visibleCount > 0 && !this._loggedTagCount) {
        console.log(`[ZoneInfoTags] ${visibleCount}/${this.tags.size} tags visible on screen`);
        this._loggedTagCount = true;
      }
    }
  }

  /**
   * Hide all tags
   */
  hideAllTags() {
    for (const tag of this.tags.values()) {
      tag.classList.add('hidden');
    }
  }

  /**
   * Show zone details in info box (same logic as zone-ui.js)
   */
  async showZoneDetails(zone) {
    // Format zone type for display
    const zoneTypeDisplay = zone.zone_type
      ? zone.zone_type.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ')
      : 'Unknown';
    
    // Format area for display
    // Area comes from PostGIS ST_Area which returns square meters
    let areaDisplay = 'N/A';
    if (zone.area !== undefined && zone.area !== null && !isNaN(zone.area) && zone.area > 0) {
      // Area is in square meters from PostGIS
      areaDisplay = `${zone.area.toFixed(2)} m²`;
    } else {
      // Try to get area from properties if not in main zone object
      if (zone.properties && typeof zone.properties === 'object' && zone.properties.area) {
        const propArea = zone.properties.area;
        if (typeof propArea === 'number' && propArea > 0) {
          areaDisplay = `${propArea.toFixed(2)} m²`;
        }
      }
    }
    
    // Fetch owner username for tooltip
    let ownerUsername = null;
    if (zone.owner_id) {
      try {
        const { getPlayerProfile } = await import('../api/player-service.js');
        const ownerProfile = await getPlayerProfile(zone.owner_id);
        ownerUsername = ownerProfile.username || null;
      } catch (error) {
        console.warn('Failed to fetch owner username:', error);
      }
    }
    
    // Build tooltip text
    const tooltipParts = [];
    tooltipParts.push(`Zone ID: ${zone.id}`);
    if (ownerUsername) {
      tooltipParts.push(`Owner: ${ownerUsername}`);
    } else if (zone.owner_id) {
      tooltipParts.push(`Owner ID: ${zone.owner_id}`);
    }
    const tooltip = tooltipParts.join('\n');
    
    // Count structures in this zone
    let structureCount = 0;
    if (this.gameStateManager) {
      const structures = this.gameStateManager.getAllStructures();
      
      // Normalize zone ID to number for comparison
      const zoneIdNum = typeof zone.id === 'string' ? parseInt(zone.id, 10) : Number(zone.id);
      const zoneIdStr = String(zone.id);
      
      // Count structures that match this zone ID
      // Handle both number and string comparisons, and null/undefined zone_id
      structureCount = structures.filter(s => {
        if (!s || s.zone_id === null || s.zone_id === undefined) {
          return false;
        }
        
        // Normalize structure zone_id to number for comparison
        const sZoneIdNum = typeof s.zone_id === 'string' ? parseInt(s.zone_id, 10) : Number(s.zone_id);
        const sZoneIdStr = String(s.zone_id);
        
        // Compare as both number and string to handle type mismatches
        return sZoneIdNum === zoneIdNum || sZoneIdStr === zoneIdStr;
      }).length;
    }
    
    // Build zone info object for info box
    const zoneInfo = {
      'Name': zone.name || `Zone ${zone.id}`,
      'Zone ID': zone.id.toString(),
      'Floor': (zone.floor ?? 0).toString(),
      'Area': areaDisplay,
      'Structures': structureCount.toString(),
    };
    
    // Define name save handler
    const saveName = async (newName) => {
      if (newName === (zone.name || `Zone ${zone.id}`)) {
        return; // No change
      }
      
      try {
        await updateZone(zone.id, { name: newName });
        // Update zone in zone manager
        if (this.zoneManager) {
          const zoneMesh = this.zoneManager.zoneMeshes.get(zone.id);
          if (zoneMesh && zoneMesh.userData) {
            zoneMesh.userData.zone = { ...zone, name: newName };
          }
        }
        // Update zone in editor
        if (this.zoneEditor && this.zoneEditor.selectedZone) {
          this.zoneEditor.selectedZone.name = newName;
        }
        // Update the displayed name in the info box
        const nameField = document.querySelector('[data-field="Name"]');
        if (nameField) {
          nameField.textContent = newName;
        }
        // Update tag's zone data
        const updatedZone = { ...zone, name: newName };
        this.gameStateManager.updateZone(updatedZone);
      } catch (error) {
        console.error('Failed to update zone name:', error);
        alert(`Failed to update zone name: ${error.message}`);
        // Restore original value
        const nameField = document.querySelector('[data-field="Name"]');
        if (nameField) {
          nameField.textContent = zone.name || `Zone ${zone.id}`;
        }
      }
    };
    
    // Define delete action (only for non-system zones)
    const deleteAction = async () => {
      const { showConfirmationModal } = await import('../ui/game-modal.js');
      const confirmed = await showConfirmationModal({
        title: 'Delete Zone',
        message: `Are you sure you want to delete zone "${zone.name || zone.id}"?`,
        checkboxLabel: 'I understand this zone will be permanently deleted',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: '#ff4444'
      });
      
      if (!confirmed) {
        return;
      }
      
      try {
        await deleteZone(zone.id);
        // Handle zone deletion
        if (this.gameStateManager) {
          this.gameStateManager.removeZone(zone.id);
        }
        if (this.zoneManager) {
          this.zoneManager.removeZone(zone.id);
        }
        if (this.zoneEditor) {
          this.zoneEditor.deselectZone();
        }
        // Remove tag
        const tag = this.tags.get(zone.id);
        if (tag) {
          tag.remove();
          this.tags.delete(zone.id);
        }
        // Clear info box
        updateInfoBox({});
      } catch (error) {
        console.error('Failed to delete zone:', error);
        alert(`Failed to delete zone: ${error.message}`);
      }
    };
    
    // Build actions object - only include delete for non-system zones
    const actions = {};
    if (!(zone.is_system_zone === true)) {
      actions['Delete Zone'] = deleteAction;
    }
    
    // Update info box with zone information
    updateInfoBox(zoneInfo, {
      title: `${zoneTypeDisplay} Zone Details`,
      tooltip: tooltip,
      actions: actions,
      editableFields: {
        'Name': { onSave: saveName }
      }
    });
  }

  /**
   * Cleanup
   */
  dispose() {
    for (const tag of this.tags.values()) {
      tag.remove();
    }
    this.tags.clear();
    if (this.container) {
      this.container.remove();
    }
  }
}

