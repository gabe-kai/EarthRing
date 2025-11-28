/**
 * Minimap Component
 * Shows player position, facing direction, and station info at bottom-left
 */

import * as THREE from 'three';
import { legacyPositionToRingPolar, ringPolarToRingArc, chunkIndexToRingArc, threeJSToRingArc, CHUNK_LENGTH, CHUNK_COUNT } from '../utils/coordinates-new.js';
import { findNearestStation, PILLAR_HUB_POSITIONS } from '../utils/stations.js';
import { RING_CIRCUMFERENCE } from '../utils/coordinates-new.js';
import { addNotification } from './info-box.js';

const STATION_PROXIMITY_THRESHOLD = 5000; // 5km - consider player "on" station platform

export class Minimap {
  constructor(cameraController, gameStateManager, sceneManager, chunkManager = null) {
    this.cameraController = cameraController;
    this.gameStateManager = gameStateManager;
    this.sceneManager = sceneManager;
    this.chunkManager = chunkManager;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.earthIconCanvas = null;
    this.earthIconCtx = null;
    this.updateInterval = null;
    this.earthIconUpdateInterval = null;
    this.lastPosition = null;
    this.lastDirection = null;
    this.zoomLevel = 'local'; // 'full' or 'local' - default to local (zoomed) view
    
    this.createMinimap();
    this.startUpdates();
  }

  createMinimap() {
    this.container = document.createElement('div');
    this.container.id = 'minimap-container';

    const style = document.createElement('style');
    style.textContent = `
      #minimap-container {
        position: fixed;
        bottom: 100px; /* Above toolbar */
        left: 0;
        width: 250px;
        height: 200px;
        background: rgba(0, 0, 0, 0.7);
        border: 2px solid #4caf50;
        border-bottom: none;
        border-left: none;
        border-top-right-radius: 8px;
        backdrop-filter: blur(10px);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        color: #00ff00;
        overflow: visible; /* Allow top container to extend outside border */
      }

      .minimap-title-wrapper {
        position: absolute;
        bottom: 8px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10; /* Above canvas content */
        pointer-events: none; /* Allow clicks through to canvas */
        padding: 0 8px;
        box-sizing: border-box;
        width: 100%;
      }

      .minimap-title {
        padding: 4px 10px;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(76, 175, 80, 0.3);
        border-radius: 8px;
        color: #4caf50;
        font-weight: bold;
        font-size: 12px;
        text-align: center;
        max-width: calc(100% - 16px);
        box-sizing: border-box;
        line-height: 1.3;
        word-wrap: break-word;
        white-space: normal;
      }

      .minimap-canvas-container {
        flex: 1;
        position: relative;
        overflow: visible; /* Allow top container to extend outside */
        min-height: 0; /* Allow flex shrinking */
        cursor: pointer; /* Indicate minimap is clickable */
      }

      #minimap-canvas {
        width: 100%;
        height: 100%;
        display: block;
        overflow: hidden; /* Canvas itself clips content */
      }


      .minimap-controls {
        position: absolute;
        right: -14px; /* Half button width (12px) + border width (2px) = 14px to center on border edge */
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 4px;
        background: rgba(17, 17, 17, 0.85);
        border: 1px solid #4caf50;
        border-radius: 4px;
        z-index: 10000; /* On top layer like Info box resize handle */
        pointer-events: none; /* Allow clicks through container, but buttons will catch them */
        backdrop-filter: blur(10px);
      }

      .minimap-zoom-btn {
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid #4caf50;
        color: #4caf50;
        width: 18px;
        height: 18px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        line-height: 0.5;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        pointer-events: auto; /* Re-enable clicks on buttons */
      }

      .minimap-zoom-btn:hover {
        background: rgba(76, 175, 80, 0.2);
      }

      .minimap-zoom-btn:active {
        background: rgba(76, 175, 80, 0.4);
      }

      .minimap-datetime-container {
        position: absolute;
        top: -42px; /* Same as top container - aligns with Earth icon container top */
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        align-items: flex-start; /* Align tops with Earth icon container */
        padding: 0 4px;
        z-index: 10000;
        pointer-events: none;
        box-sizing: border-box;
      }

      .minimap-date-display,
      .minimap-time-display {
        padding: 4px 8px;
        background: rgba(17, 17, 17, 0.85);
        border: 1px solid #4caf50;
        border-radius: 4px;
        color: #4caf50;
        font-family: 'Courier New', monospace;
        font-size: 10px;
        font-weight: bold;
        backdrop-filter: blur(10px);
        white-space: nowrap;
        display: flex;
        flex-direction: column;
        align-items: center;
        line-height: 1.2;
        width: 70px; /* Fixed width so both containers are the same size */
        box-sizing: border-box;
      }

      .minimap-date-display {
        margin-right: 4px;
      }

      .minimap-time-display {
        margin-left: 4px;
      }

      .minimap-top-container {
        position: absolute;
        top: -42px; /* Move up by half height (82.5px / 2 ≈ 41px) plus border (2px) to center on border edge = 43px, rounded to 42px */
        left: 50%;
        transform: translateX(-50%);
        width: 33%; /* 33% of minimap container width (250px) = 82.5px */
        aspect-ratio: 1; /* Creates perfect square */
        background: rgba(17, 17, 17, 0.85);
        border: 1px solid #4caf50;
        border-radius: 8px;
        z-index: 10000;
        pointer-events: none;
        backdrop-filter: blur(10px);
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .minimap-earth-icon {
        width: 100%;
        height: 100%;
        display: block;
      }
    `;
    document.head.appendChild(style);

    this.container.innerHTML = `
      <div class="minimap-canvas-container">
        <canvas id="minimap-canvas"></canvas>
        <div class="minimap-title-wrapper">
          <div class="minimap-title" id="minimap-title">Ring - Floor: 0<br>s: 0.0 km; r: 0 m</div>
        </div>
      </div>
      <div class="minimap-controls">
        <button class="minimap-zoom-btn" id="minimap-zoom-in" title="Zoom in (Local area view)">+</button>
        <button class="minimap-zoom-btn" id="minimap-zoom-out" title="Zoom out (Full ring view)">−</button>
      </div>
      <div class="minimap-datetime-container">
        <div class="minimap-date-display" id="minimap-date">0000.00.00</div>
        <div class="minimap-time-display">
          <span id="minimap-time">00:00:00</span>
          <span id="minimap-timezone">GMT+0</span>
        </div>
      </div>
      <div class="minimap-top-container">
        <canvas class="minimap-earth-icon" id="minimap-earth-icon"></canvas>
      </div>
    `;

    // Set up zoom buttons
    const zoomOutBtn = this.container.querySelector('#minimap-zoom-out');
    const zoomInBtn = this.container.querySelector('#minimap-zoom-in');
    
    zoomOutBtn.addEventListener('click', () => {
      this.zoomLevel = 'full';
      this.updateZoomButtons();
    });
    
    zoomInBtn.addEventListener('click', () => {
      this.zoomLevel = 'local';
      this.updateZoomButtons();
    });
    
    this.updateZoomButtons();

    document.body.appendChild(this.container);

    this.canvas = this.container.querySelector('#minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Set canvas size (will be updated on first render)
    this.resizeCanvas();
    
    // Handle window resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });

    // Add click handler to copy coordinates
    this.setupClickHandler();

    // Initialize Earth icon
    this.initEarthIcon();
  }

  resizeCanvas() {
    if (!this.canvas || !this.container) return;
    
    const containerRect = this.container.querySelector('.minimap-canvas-container').getBoundingClientRect();
    if (containerRect.width > 0 && containerRect.height > 0) {
      this.canvas.width = containerRect.width;
      this.canvas.height = containerRect.height;
    }
  }

  setupClickHandler() {
    if (!this.canvas || !this.container) return;

    const canvasContainer = this.container.querySelector('.minimap-canvas-container');

    canvasContainer.addEventListener('click', async (e) => {
      // Don't copy if clicking on zoom control buttons
      if (e.target.closest('.minimap-zoom-btn') || e.target.closest('.minimap-controls')) {
        return;
      }

      // Don't copy if clicking on title (title has pointer-events: none but check anyway)
      if (e.target.closest('.minimap-title-wrapper')) {
        return;
      }

      try {
        // Get current camera target coordinates
        const erPos = this.cameraController.getTargetEarthRingPosition();
        const coordinates = `${erPos.x.toFixed(2)}, ${erPos.y.toFixed(2)}, ${erPos.z.toFixed(2)}`;

        // Copy to clipboard
        await navigator.clipboard.writeText(coordinates);

        // Show notification in Info box
        addNotification(`Coordinates copied to clipboard: ${coordinates}`, 'info');
      } catch (error) {
        console.error('[Minimap] Failed to copy coordinates:', error);
        // Fallback: show error notification
        addNotification('Failed to copy coordinates to clipboard', 'error');
      }
    });
  }

  update() {
    if (!this.cameraController || !this.gameStateManager) return;

    try {
      // Get current position - use camera target (focus point) instead of camera position
      // This prevents the map from gyrating when zoomed out, and the arrow will spin in place
      const erPos = this.cameraController.getTargetEarthRingPosition();
      const polar = legacyPositionToRingPolar(erPos.x, erPos.y, erPos.z);
      const arc = ringPolarToRingArc(polar);
      const floor = this.gameStateManager.getActiveFloor();

      // Update date/time display based on current position
      this.updateDateTime(polar.theta);

      // Get camera direction
      const camera = this.sceneManager?.getCamera();
      if (!camera) return;

      // Calculate facing direction (camera forward vector projected onto ring plane)
      // The ring is in the XY plane, so we need the angle around the Z axis
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(camera.quaternion);
      
      // Project onto XY plane (ring plane) and get angle
      // In Three.js, X is eastward around the ring, Y is radial outward
      // So atan2(y, x) gives us the angle around the ring
      const directionAngle = Math.atan2(forward.y, forward.x);
      
      // Adjust for ring coordinate system (0 at Kongo Hub, increases eastward)
      // The ring wraps, so we need to account for the coordinate system
      
      // Check if on station
      const nearestStation = findNearestStation(arc.s);
      const isOnStation = nearestStation.distance < STATION_PROXIMITY_THRESHOLD;
      
      // Update title
      const titleEl = this.container.querySelector('#minimap-title');
      if (titleEl) {
        const sKm = (arc.s / 1000).toFixed(1);
        const rM = arc.r.toFixed(0);
        let locationName;
        if (isOnStation) {
          locationName = nearestStation.index === 0 ? 'Kongo Hub' : `Hub ${nearestStation.index}`;
        } else {
          locationName = 'Ring';
        }
        // Use compact format to fit in two lines
        titleEl.innerHTML = `${locationName} - F: ${floor}<br>s: ${sKm}km; r: ${rM}m`;
      }

      // Ensure canvas is properly sized
      this.resizeCanvas();
      
      // Always redraw the minimap to keep it visible
      // Only update stored values if position or direction changed significantly
      const positionChanged = !this.lastPosition || 
        Math.abs(this.lastPosition.s - arc.s) > 1000 || // 1km change
        this.lastPosition.floor !== floor;
      const directionChanged = !this.lastDirection || 
        Math.abs(this.lastDirection - directionAngle) > 0.1; // ~6 degrees

      // Always draw, but only update stored values when changed
      if (this.zoomLevel === 'full') {
        this.drawFullRingView(arc, isOnStation, nearestStation);
      } else {
        this.drawLocalView(arc, directionAngle, erPos);
      }
      
      if (positionChanged || directionChanged) {
        this.lastPosition = { s: arc.s, floor };
        this.lastDirection = directionAngle;
      }
    } catch (error) {
      console.error('[Minimap] Update error:', error);
    }
  }

  updateZoomButtons() {
    const zoomOutBtn = this.container?.querySelector('#minimap-zoom-out');
    const zoomInBtn = this.container?.querySelector('#minimap-zoom-in');
    
    if (zoomOutBtn && zoomInBtn) {
      if (this.zoomLevel === 'full') {
        zoomOutBtn.style.background = 'rgba(76, 175, 80, 0.3)';
        zoomInBtn.style.background = 'transparent';
      } else {
        zoomOutBtn.style.background = 'transparent';
        zoomInBtn.style.background = 'rgba(76, 175, 80, 0.3)';
      }
    }
  }

  drawFullRingView(arc, isOnStation, nearestStation) {
    if (!this.ctx || !this.canvas) {
      console.warn('[Minimap] Cannot draw: ctx or canvas missing');
      return;
    }

    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Skip if canvas is not properly sized
    if (width === 0 || height === 0) {
      return;
    }
    
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.4;

    // Clear canvas with semi-transparent background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.fillRect(0, 0, width, height);

    // Draw ring circle
    this.ctx.strokeStyle = '#4caf50';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    // Draw station markers
    PILLAR_HUB_POSITIONS.forEach((stationPos, index) => {
      // Calculate angle on ring (0 to 2π)
      const stationAngle = (stationPos / RING_CIRCUMFERENCE) * Math.PI * 2;
      
      // Position on circle
      const stationX = centerX + Math.cos(stationAngle) * radius;
      const stationY = centerY + Math.sin(stationAngle) * radius;
      
      // Draw station marker
      this.ctx.fillStyle = index === nearestStation.index && isOnStation ? '#00ff00' : '#4caf50';
      this.ctx.beginPath();
      this.ctx.arc(stationX, stationY, 3, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // Draw player position (highlighted)
    const playerAngle = (arc.s / RING_CIRCUMFERENCE) * Math.PI * 2;
    const playerX = centerX + Math.cos(playerAngle) * radius;
    const playerY = centerY + Math.sin(playerAngle) * radius;

    // Draw player dot with glow effect
    this.ctx.shadowBlur = 8;
    this.ctx.shadowColor = '#00ff00';
    this.ctx.fillStyle = '#00ff00';
    this.ctx.beginPath();
    this.ctx.arc(playerX, playerY, 5, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;
  }

  drawLocalView(arc, _directionAngle, _erPos) {
    if (!this.ctx || !this.canvas) {
      console.warn('[Minimap] Cannot draw: ctx or canvas missing');
      return;
    }

    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Skip if canvas is not properly sized
    if (width === 0 || height === 0) {
      return;
    }
    
    const centerX = width / 2;
    const centerY = height / 2;
    const viewSize = 2000; // 2km in meters
    const scale = Math.min(width, height) / viewSize;
    
    // Debug: log scale and canvas size for first update
    if (!this._loggedScale) {
      console.log(`[Minimap] Canvas: ${width}x${height}, center: (${centerX.toFixed(0)}, ${centerY.toFixed(0)}), scale: ${scale.toFixed(6)}, viewSize: ${viewSize}m`);
      this._loggedScale = true;
    }

    // Clear canvas with semi-transparent background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.fillRect(0, 0, width, height);

    // Draw grid (every 500m) - grid moves with player position
    this.ctx.strokeStyle = 'rgba(76, 175, 80, 0.3)';
    this.ctx.lineWidth = 1;
    const gridSpacing = 500; // 500 meters
    
    // Calculate grid offset based on player position
    // This makes the grid appear to move with the player
    const offsetS = ((arc.s % gridSpacing) + gridSpacing) % gridSpacing; // Offset for east/west (s coordinate)
    const offsetR = ((arc.r % gridSpacing) + gridSpacing) % gridSpacing; // Offset for north/south (r coordinate)
    
    // Draw vertical grid lines (east/west, based on s coordinate)
    // Start from -viewSize to ensure coverage, accounting for offset
    const startS = Math.floor(-viewSize / gridSpacing) * gridSpacing - offsetS;
    const endS = Math.ceil(viewSize / gridSpacing) * gridSpacing - offsetS;
    for (let s = startS; s <= endS; s += gridSpacing) {
      const x = centerX + (s * scale);
      if (x >= -50 && x <= width + 50) { // Only draw if within canvas bounds (with margin)
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, height);
        this.ctx.stroke();
      }
    }
    
    // Draw horizontal grid lines (north/south, based on r coordinate)
    // Start from -viewSize to ensure coverage, accounting for offset
    const startR = Math.floor(-viewSize / gridSpacing) * gridSpacing - offsetR;
    const endR = Math.ceil(viewSize / gridSpacing) * gridSpacing - offsetR;
    for (let r = startR; r <= endR; r += gridSpacing) {
      const y = centerY + (r * scale);
      if (y >= -50 && y <= height + 50) { // Only draw if within canvas bounds (with margin)
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(width, y);
        this.ctx.stroke();
      }
    }

    // Player position is at center (no visual marker, just the arrow)

    // Draw chunk platforms (after grid so they're on top and visible)
    const playerArcS = arc.s;
    const viewRadius = viewSize / 2;
    const activeFloor = this.gameStateManager.getActiveFloor();
    const chunksNeeded = Math.ceil(viewSize / CHUNK_LENGTH) + 2;
    const halfChunks = Math.ceil(chunksNeeded / 2);
    const playerChunkIndex = Math.floor(playerArcS / CHUNK_LENGTH);

    const chunksToRender = [];

    for (let offset = -halfChunks; offset <= halfChunks; offset++) {
      const absoluteIndex = playerChunkIndex + offset;
      const wrappedIndex = ((absoluteIndex % CHUNK_COUNT) + CHUNK_COUNT) % CHUNK_COUNT;
      const chunkID = `${activeFloor}_${wrappedIndex}`;

      let chunkData = this.gameStateManager.getChunk(chunkID);
      let mesh = null;

      if (!chunkData && this.chunkManager?.chunkMeshes?.has(chunkID)) {
        mesh = this.chunkManager.chunkMeshes.get(chunkID);
        chunkData = mesh?.userData?.chunkData || null;
      } else if (this.chunkManager?.chunkMeshes?.has(chunkID)) {
        mesh = this.chunkManager.chunkMeshes.get(chunkID);
      }

      // Ensure mesh is set (use existing value or get from chunkManager)
      if (!mesh) {
        mesh = this.chunkManager?.chunkMeshes?.get(chunkID) || null;
      }
      chunksToRender.push({ chunkIndex: wrappedIndex, chunkData, mesh });
    }

    // Debug logging removed to reduce spam

    // Always draw a marker for the player's current chunk position (for debugging)
    // Make it smaller and less obtrusive
    this.ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
    this.ctx.fillRect(centerX - 3, centerY - 3, 6, 6);
    
    // Debug logging removed to reduce spam
    
    // Draw a small player position marker
    this.ctx.fillStyle = 'rgba(255, 255, 0, 0.5)'; // Yellow
    this.ctx.fillRect(centerX - 3, centerY - 3, 6, 6);

    chunksToRender.forEach(({ chunkIndex, chunkData, mesh }) => {
      try {
        const chunkArc = chunkIndexToRingArc(chunkIndex);
        const chunkCenterS = chunkArc.s;

        const directDist = Math.abs(chunkCenterS - playerArcS);
        const wrappedDist = RING_CIRCUMFERENCE - directDist;
        const distance = Math.min(directDist, wrappedDist);

        if (distance > viewRadius + CHUNK_LENGTH) {
          return; // Chunk is too far away
        }

        // Always draw chunks that are within view distance, even if we don't have data
        // This ensures we see something on the minimap

        let arcDiff = chunkCenterS - playerArcS;
        if (arcDiff > RING_CIRCUMFERENCE / 2) {
          arcDiff -= RING_CIRCUMFERENCE;
        } else if (arcDiff < -RING_CIRCUMFERENCE / 2) {
          arcDiff += RING_CIRCUMFERENCE;
        }

        // Get actual chunk radial position from data if available
        // chunkIndexToRingArc always returns r=0, but chunks might have different r positions
        let chunkR = chunkArc.r; // Default to 0 (centerline)
        
        // Try to get actual r from chunk data or mesh
        if (chunkData?.geometry?.vertices && chunkData.geometry.vertices.length > 0) {
          // Calculate average r from vertices
          let sumR = 0;
          let count = 0;
          chunkData.geometry.vertices.forEach(vertex => {
            // Vertex format: [x, y, z] where y is radial offset
            const vertexY = vertex[1] || 0;
            sumR += vertexY;
            count++;
          });
          if (count > 0) {
            chunkR = sumR / count; // Average radial position
          }
        } else if (mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
          // Try to get r from mesh
          try {
            mesh.updateMatrixWorld();
            const worldMatrix = mesh.matrixWorld;
            const positions = mesh.geometry.attributes.position;
            const sampleCount = Math.min(10, positions.count);
            let sumR = 0;
            let count = 0;
            const sampleStep = Math.max(1, Math.floor(positions.count / sampleCount));
            for (let i = 0; i < positions.count; i += sampleStep) {
              const x = positions.getX(i);
              const y = positions.getY(i);
              const z = positions.getZ(i);
              const worldPos = new THREE.Vector3(x, y, z);
              worldPos.applyMatrix4(worldMatrix);
              const ringArc = threeJSToRingArc({ x: worldPos.x, y: worldPos.y, z: worldPos.z });
              sumR += ringArc.r;
              count++;
            }
            if (count > 0) {
              chunkR = sumR / count;
            }
          } catch (error) {
            // Fall back to default
          }
        }

        // Calculate relative position: chunk position minus player position
        // For top-down minimap: X is east/west, Y is north/south
        const localX = arcDiff; // East/west offset in meters
        const localY = chunkR - arc.r; // North/south offset relative to player (chunk r - player r)

        // Map to screen coordinates
        // Screen: +X = right (east), +Y = down (south)
        // North (positive localY/r) should appear up (negative screen Y)
        // So we need to negate localY to convert from world coordinates to screen coordinates
        const screenX = centerX + (localX * scale);
        const screenY = centerY + (localY * scale); // FIXED: Don't negate - positive r (north) should appear down (positive screen Y) initially, but we want it up
        // Actually, let's think: if player moves north (r increases), localY becomes more positive
        // On screen, north should be up (negative Y), so we DO need to negate
        // But the user says it's moving in reverse, so let's try without negation
        // const screenY = centerY - (localY * scale); // Original - was causing reverse movement
        
        // Debug logging removed to reduce spam

        // Don't filter by screen position here - let the platform bounds check handle it
        // This early filter was too aggressive and caused platforms to disappear
        // if (screenX < -CHUNK_LENGTH * scale || screenX > width + CHUNK_LENGTH * scale ||
        //     screenY < -CHUNK_LENGTH * scale || screenY > height + CHUNK_LENGTH * scale) {
        //   return;
        // }

        // Platform width is total width in meters (extends from -width/2 to +width/2 from centerline)
        // Vertices in geometry have Y coordinates from -width/2 to +width/2
        // In EarthRing: X=ring, Y=radial (width), Z=floor
        // In Three.js: X=ring, Y=floor*height, Z=radial (width)
        const widthMeters = chunkData?.geometry?.width ??
          chunkData?.metadata?.width ??
          chunkData?.Geometry?.width ??
          chunkData?.Metadata?.width ??
          400;

        // Use the actual chunkR we calculated above, not chunkArc.r (which is always 0)
        // Calculate actual platform bounds from geometry if available
        // Otherwise use width centered at chunkR
        let platformMinR = chunkR - widthMeters / 2;
        let platformMaxR = chunkR + widthMeters / 2;
        
        // If we have geometry vertices, calculate actual bounds
        if (chunkData?.geometry?.vertices && chunkData.geometry.vertices.length > 0) {
          let minY = Infinity;
          let maxY = -Infinity;
          chunkData.geometry.vertices.forEach(vertex => {
            // Vertex format: [x, y, z] where y is radial offset (width)
            const vertexY = vertex[1] || 0;
            minY = Math.min(minY, vertexY);
            maxY = Math.max(maxY, vertexY);
          });
          if (minY !== Infinity && maxY !== -Infinity) {
            // Vertices are relative to chunk center, so add chunkR
            platformMinR = chunkR + minY;
            platformMaxR = chunkR + maxY;
          }
        } else if (mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
          // If we have a mesh but no chunkData, try to calculate bounds from mesh geometry
          try {
            const positions = mesh.geometry.attributes.position;
            const vertexCount = positions.count;
            if (vertexCount > 0) {
              mesh.updateMatrixWorld();
              const worldMatrix = mesh.matrixWorld;
              let minR = Infinity;
              let maxR = -Infinity;
              
              // Sample vertices to find radial bounds
              const sampleStep = Math.max(1, Math.floor(vertexCount / 50));
              for (let i = 0; i < vertexCount; i += sampleStep) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const z = positions.getZ(i);
                
                const worldPos = new THREE.Vector3(x, y, z);
                worldPos.applyMatrix4(worldMatrix);
                
                const ringArc = threeJSToRingArc({ x: worldPos.x, y: worldPos.y, z: worldPos.z });
                minR = Math.min(minR, ringArc.r);
                maxR = Math.max(maxR, ringArc.r);
              }
              
              if (minR !== Infinity && maxR !== -Infinity) {
                platformMinR = minR;
                platformMaxR = maxR;
              }
            }
          } catch (error) {
            // Fall back to default width
            if (window.earthring?.debug) {
              console.warn(`[Minimap] Failed to calculate bounds from mesh for chunk ${chunkIndex}:`, error);
            }
          }
        }

        const chunkLengthScreen = CHUNK_LENGTH * scale;
        const platformWidthMeters = platformMaxR - platformMinR;
        const chunkWidthScreen = Math.max(8, platformWidthMeters * scale);

        // Calculate platform center in screen coordinates
        // Platform center is at the midpoint of min/max R bounds
        const platformCenterR = (platformMinR + platformMaxR) / 2;
        const platformCenterLocalY = platformCenterR - arc.r;
        const platformCenterScreenY = centerY + (platformCenterLocalY * scale); // FIXED: Don't negate to match screenY calculation above

        // Calculate platform bounds in screen coordinates
        const platformMinY = platformCenterScreenY - chunkWidthScreen / 2;
        const platformMaxY = platformCenterScreenY + chunkWidthScreen / 2;
        const platformMinX = screenX - chunkLengthScreen / 2;
        const platformMaxX = screenX + chunkLengthScreen / 2;

        // Check if platform intersects the view
        // Platform should be drawn if ANY part of it overlaps the canvas (with small margin)
        // Simplified check: platform intersects if it's not completely outside
        const margin = 200; // Very generous margin - platforms can be huge (25km)
        const intersectsX = platformMaxX >= -margin && platformMinX <= width + margin;
        const intersectsY = platformMaxY >= -margin && platformMinY <= height + margin;
        
        // Debug: Log when platform is being culled near the boundary
        if (window.earthring?.debug && Math.abs(arc.r) > 1800 && Math.abs(arc.r) < 2000) {
          console.log(`Minimap platform cull: chunk=${chunkIndex}, playerR=${arc.r.toFixed(0)}, platformR=[${platformMinR.toFixed(0)}, ${platformMaxR.toFixed(0)}], widthMeters=${widthMeters.toFixed(0)}, screenY=[${platformMinY.toFixed(0)}, ${platformMaxY.toFixed(0)}], canvas=[0, ${height}], intersectsX=${intersectsX}, intersectsY=${intersectsY}`);
        }
        
        // Always draw platforms that are within the arc distance
        // Since we're in local view (2km view), if the chunk is within distance, draw it
        // Be very permissive - draw if chunk is anywhere near the view
        
        // ALWAYS draw something for chunks in range, even if we don't have data
        // This ensures we see something for every chunk in range
        if (!chunkData && !mesh) {
          // Draw a simple rectangle at the chunk position
          const simpleRectX = screenX - chunkLengthScreen / 2;
          const simpleRectY = screenY - chunkLengthScreen / 2; // Use square for unknown chunks
          this.ctx.fillStyle = 'rgba(76, 175, 80, 0.6)';
          this.ctx.strokeStyle = '#4caf50';
          this.ctx.lineWidth = 2;
          this.ctx.fillRect(simpleRectX, simpleRectY, chunkLengthScreen, chunkLengthScreen);
          this.ctx.strokeRect(simpleRectX, simpleRectY, chunkLengthScreen, chunkLengthScreen);
          
          // Debug logging removed to reduce spam - uncomment if needed
          // console.log(`[Minimap] Drawing fallback rectangle for chunk ${chunkIndex} at screen (${screenX.toFixed(0)}, ${screenY.toFixed(0)}), size=${chunkLengthScreen.toFixed(0)}`);
          return; // Skip the detailed drawing below
        }
        
        // We have data or mesh, so draw the platform
        // Debug logging removed to reduce spam - uncomment if needed
        // console.log(`[Minimap] Chunk ${chunkIndex} has data/mesh, screen (${screenX.toFixed(0)}, ${screenY.toFixed(0)})`);
        
        // Always draw platforms that are within arc distance - don't filter by screen bounds
        // The view is 2km, so if chunk is within that distance, draw it
        // Don't filter by screen position - let it draw even if partially off-screen

        // Draw platform - use Three.js geometry if available, otherwise rectangle
        // Use bright, visible colors - make platforms stand out
        // Save context state
        this.ctx.save();
        this.ctx.globalAlpha = 1.0; // Ensure full opacity
        this.ctx.fillStyle = 'rgba(76, 175, 80, 0.9)'; // Very opaque for visibility
        this.ctx.strokeStyle = '#00ff00'; // Bright green
        this.ctx.lineWidth = 2; // Visible lines
        
        // Try to get Three.js mesh and project its geometry to 2D
        // Use mesh geometry for curved platform edges
        let drewFromMesh = false;
        
        if (mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
          try {
            const positions = mesh.geometry.attributes.position;
            const vertexCount = positions.count;
            
            if (vertexCount > 0) {
              // Get positions in world space
              mesh.updateMatrixWorld();
              const worldMatrix = mesh.matrixWorld;
              
              // Sample edge vertices (platform outline)
              // For a ring floor, vertices form a perimeter - we want the outer edge
              // Sample vertices and then sort them by angle around the center to ensure correct order
              const rawPoints = [];
              const targetSampleCount = 40; // Sample more points for smoother curves
              const sampleStep = Math.max(1, Math.floor(vertexCount / targetSampleCount));
              
              // Sample vertices from the mesh
              for (let i = 0; i < vertexCount; i += sampleStep) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const z = positions.getZ(i);
                
                // Transform to world space
                const worldPos = new THREE.Vector3(x, y, z);
                worldPos.applyMatrix4(worldMatrix);
                
                // Convert world position to RingArc coordinates
                const ringArc = threeJSToRingArc({ x: worldPos.x, y: worldPos.y, z: worldPos.z });
                
                // Convert to local coordinates relative to player
                let localS = ringArc.s - playerArcS;
                if (localS > RING_CIRCUMFERENCE / 2) {
                  localS -= RING_CIRCUMFERENCE;
                } else if (localS < -RING_CIRCUMFERENCE / 2) {
                  localS += RING_CIRCUMFERENCE;
                }
                
                const localR = ringArc.r - arc.r;
                
                // Project to minimap screen coordinates
                const screenX = centerX + (localS * scale);
                const screenY = centerY + (localR * scale);
                
                rawPoints.push({ x: screenX, y: screenY, localS, localR });
              }
              
              // Calculate center of the points for sorting
              let points = [];
              if (rawPoints.length > 0) {
                const centerX_points = rawPoints.reduce((sum, p) => sum + p.x, 0) / rawPoints.length;
                const centerY_points = rawPoints.reduce((sum, p) => sum + p.y, 0) / rawPoints.length;
                
                // Sort points by angle around the center to ensure correct polygon order
                // This prevents self-intersecting polygons and moire patterns
                points = rawPoints.sort((a, b) => {
                  const angleA = Math.atan2(a.y - centerY_points, a.x - centerX_points);
                  const angleB = Math.atan2(b.y - centerY_points, b.x - centerX_points);
                  return angleA - angleB;
                });
              }
              
              // Draw polygon if we have enough points (points is now sorted)
              if (points.length >= 3) {
                // Ensure we're using the right fill/stroke styles
                this.ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
                this.ctx.strokeStyle = '#00ff00';
                this.ctx.lineWidth = 2;
                this.ctx.globalAlpha = 1.0;
                
                // Draw the polygon - no clipping, let canvas handle it naturally
                this.ctx.beginPath();
                this.ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                  this.ctx.lineTo(points[i].x, points[i].y);
                }
                this.ctx.closePath();
                
                // Use 'evenodd' fill rule - this works regardless of winding order
                // and handles complex polygons better
                this.ctx.fill('evenodd');
                this.ctx.stroke();
                
                drewFromMesh = true;
              }
            }
          } catch (error) {
            // Fall through to rectangle
            if (window.earthring?.debug) {
              console.warn(`[Minimap] Failed to project mesh geometry for chunk ${chunkIndex}:`, error);
            }
          }
        }
        
        // Fallback to rectangle if mesh projection didn't work or no mesh available
        if (!drewFromMesh) {
          // Draw platform as rectangle - always draw even if we don't have detailed geometry
          // This ensures platforms are visible even when chunkData or mesh is missing
          // Use absolute values to ensure positive dimensions
          const rectX = Math.min(platformMinX, platformMaxX);
          const rectY = Math.min(platformMinY, platformMaxY);
          const rectW = Math.abs(platformMaxX - platformMinX);
          const rectH = Math.abs(platformMaxY - platformMinY);
          
          // Ensure minimum size so platforms are visible
          const minSize = 20; // Make it bigger so it's definitely visible
          const finalW = Math.max(rectW, minSize);
          const finalH = Math.max(rectH, minSize);
          
          // Ensure full opacity and visibility
          this.ctx.globalAlpha = 1.0;
          this.ctx.fillStyle = 'rgba(76, 175, 80, 0.9)'; // Very opaque
          this.ctx.strokeStyle = '#00ff00'; // Bright green
          this.ctx.lineWidth = 2;
          this.ctx.fillRect(rectX, rectY, finalW, finalH);
          this.ctx.strokeRect(rectX, rectY, finalW, finalH);
        }
        
        // Restore context state
        this.ctx.restore();
      } catch (error) {
        // Log chunk draw errors so we can see what's failing
        console.error(`[Minimap] Error drawing chunk ${chunkIndex}:`, error);
        this.ctx.restore(); // Make sure to restore even on error
      }
    });

    // Draw direction arrow and north indicator LAST so they appear on top of everything
    // Draw direction arrow (north is up)
    // Coordinate mapping (see coordinates-new.js -> toThreeJS):
    //   Three.js +X  : eastward along the ring
    //   Three.js +Z  : radial outward from the ring (north on minimap)
    //   Three.js +Y  : vertical (floors)
    // For a top-down minimap we care about the X/Z plane only.
    const camera = this.sceneManager?.getCamera();
    if (camera) {
      // Get camera's forward direction in world space
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      
      // Project onto XZ plane (ring plane); ignore vertical component (Y)
      // This ensures the arrow is always flat in the minimap, regardless of camera pitch
      const forwardX = forward.x;
      const forwardZ = forward.z;
      const forwardLength = Math.sqrt(forwardX * forwardX + forwardZ * forwardZ);
      
      if (forwardLength > 0.01) { // Only draw if there's a meaningful horizontal direction
        // Normalize direction in XZ plane (horizontal only)
        // In Three.js: X=east, Y=vertical, Z=radial (north/south)
        // For top-down minimap, we use XZ plane (ignore Y/vertical)
        const dirX = forwardX / forwardLength; // East/West
        const dirZ = forwardZ / forwardLength; // North/South (radial)
        
        // Draw arrow centered at (centerX, centerY) pointing in facing direction
        const arrowLength = 12;
        const arrowWidth = 8;
        
        // Simple mapping: Three.js XZ -> Screen XY
        // Three.js: +X = east, +Z = north (radial outward)
        // Screen: +X = right (east), +Y = down (south)
        // When turning right (toward north), dirZ increases, arrow should point up
        // If it's pointing the wrong way, flip the sign
        const screenDirX = dirX;
        const screenDirY = dirZ; // Flipped: was -dirZ
        
        // Arrow tip
        const tipX = centerX + screenDirX * arrowLength;
        const tipY = centerY + screenDirY * arrowLength;
        
        // Perpendicular vector (90° counter-clockwise in screen space)
        // Perpendicular to (screenDirX, screenDirY) is (-screenDirY, screenDirX)
        const perpX = -screenDirY;
        const perpY = screenDirX;
        
        // Arrow base points
        const baseBackX = centerX - screenDirX * (arrowLength * 0.3);
        const baseBackY = centerY - screenDirY * (arrowLength * 0.3);
        
        const baseLeftX = baseBackX + perpX * (arrowWidth / 2);
        const baseLeftY = baseBackY + perpY * (arrowWidth / 2);
        const baseRightX = baseBackX - perpX * (arrowWidth / 2);
        const baseRightY = baseBackY - perpY * (arrowWidth / 2);
        
        // Draw arrow as filled triangle (always flat, same size)
        this.ctx.fillStyle = '#00ff00';
        this.ctx.beginPath();
        this.ctx.moveTo(tipX, tipY);
        this.ctx.lineTo(baseLeftX, baseLeftY);
        this.ctx.lineTo(baseRightX, baseRightY);
        this.ctx.closePath();
        this.ctx.fill();
      }
    }

    // Draw north indicator (on top of everything)
    this.ctx.fillStyle = '#4caf50';
    this.ctx.font = '10px Courier New';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('N', centerX, 15);
    
    // Draw north arrow
    this.ctx.strokeStyle = '#4caf50';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, 5);
    this.ctx.lineTo(centerX, 20);
    this.ctx.moveTo(centerX, 5);
    this.ctx.lineTo(centerX - 3, 10);
    this.ctx.moveTo(centerX, 5);
    this.ctx.lineTo(centerX + 3, 10);
    this.ctx.stroke();
  }

  updateDateTime(theta) {
    // Convert theta (radians) to longitude (degrees)
    // Theta 0 = 0° longitude (Prime Meridian)
    // Theta increases eastward
    const longitudeDegrees = (theta * 180) / Math.PI;

    // Calculate timezone offset in hours
    // Using 20° per hour to match user requirement: theta -60° = GMT-3 (Brazil)
    // This means: offsetHours = longitudeDegrees / 20
    const offsetHours = Math.round(longitudeDegrees / 20);

    // Get current UTC time components
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();
    const utcHours = now.getUTCHours() + offsetHours;

    // Normalize hours (handle overflow/underflow)
    // This will also handle day/month/year rollover automatically
    const localTime = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHours, utcMinutes, utcSeconds));

    // Format date as YYYY.MM.DD
    const year = localTime.getUTCFullYear();
    const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localTime.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}.${month}.${day}`;

    // Format time as HH:mm:ss (24-hour format)
    const hours = String(localTime.getUTCHours()).padStart(2, '0');
    const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}:${seconds}`;

    // Format timezone as GMT±X
    const tzSign = offsetHours >= 0 ? '+' : '';
    const tzStr = `GMT${tzSign}${offsetHours}`;

    // Update date display
    const dateEl = this.container?.querySelector('#minimap-date');
    if (dateEl) {
      dateEl.textContent = dateStr;
    }

    // Update time display
    const timeEl = this.container?.querySelector('#minimap-time');
    if (timeEl) {
      timeEl.textContent = timeStr;
    }

    // Update timezone display
    const timezoneEl = this.container?.querySelector('#minimap-timezone');
    if (timezoneEl) {
      timezoneEl.textContent = tzStr;
    }
  }

  initEarthIcon() {
    const container = this.container?.querySelector('.minimap-top-container');
    if (!container) return;

    this.earthIconCanvas = container.querySelector('#minimap-earth-icon');
    if (!this.earthIconCanvas) return;

    // Set canvas size to match container
    const resizeEarthIcon = () => {
      if (!this.earthIconCanvas || !container) return;
      const rect = container.getBoundingClientRect();
      // Use actual size or fallback to 82.5px (33% of 250px minimap width)
      const size = Math.max(rect.width, rect.height, 82.5);
      this.earthIconCanvas.width = size;
      this.earthIconCanvas.height = size;
      this.updateEarthIcon();
    };

    // Initial resize - use setTimeout to ensure container is rendered
    setTimeout(resizeEarthIcon, 0);

    // Resize on window resize
    window.addEventListener('resize', resizeEarthIcon);

    // Get context
    this.earthIconCtx = this.earthIconCanvas.getContext('2d');
    
    // Initial render
    this.updateEarthIcon();
  }

  updateEarthIcon() {
    if (!this.earthIconCanvas || !this.earthIconCtx) return;

    const ctx = this.earthIconCtx;
    const width = this.earthIconCanvas.width;
    const height = this.earthIconCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate planet size (leave room for ring)
    const planetRadius = Math.min(width, height) * 0.35;
    const ringOuterRadius = Math.min(width, height) * 0.45;
    const ringInnerRadius = Math.min(width, height) * 0.38;

    // Calculate current UTC time and sun position
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcTime = utcHours + utcMinutes / 60;
    
    // Sun position: at noon UTC, sun is directly over 0° longitude (Prime Meridian)
    // Earth rotates 15° per hour (360° / 24 hours)
    // At UTC time T, the sun is directly over longitude = 15° * (12 - T)
    const sunLongitude = (12 - utcTime) * 15; // degrees
    const sunAngle = (sunLongitude * Math.PI) / 180; // radians
    
    // Draw ring (outer ring first, then inner)
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, ringOuterRadius, ringOuterRadius * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.strokeStyle = '#66ff66';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, ringInnerRadius, ringInnerRadius * 0.15, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Earth sphere with day/night terminator
    // Create gradient for Earth (blue-green)
    const earthGradient = ctx.createRadialGradient(
      centerX - planetRadius * 0.3,
      centerY - planetRadius * 0.3,
      0,
      centerX,
      centerY,
      planetRadius
    );
    earthGradient.addColorStop(0, '#66ff66');
    earthGradient.addColorStop(1, '#4caf50');

    // Draw day side (light)
    ctx.fillStyle = earthGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
    ctx.fill();

    // Draw night side (dark overlay)
    // The terminator line is perpendicular to the sun direction
    // Day side: sunAngle to sunAngle + 180°
    // Night side: sunAngle + 180° to sunAngle + 360°
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
    ctx.clip();

    // Create dark overlay for night side
    const nightGradient = ctx.createLinearGradient(
      centerX + Math.cos(sunAngle) * planetRadius,
      centerY + Math.sin(sunAngle) * planetRadius,
      centerX - Math.cos(sunAngle) * planetRadius,
      centerY - Math.sin(sunAngle) * planetRadius
    );
    nightGradient.addColorStop(0, 'rgba(0, 20, 40, 0.0)'); // Transparent at day side
    nightGradient.addColorStop(0.5, 'rgba(0, 20, 40, 0.6)'); // Transition at terminator
    nightGradient.addColorStop(1, 'rgba(0, 10, 20, 0.9)'); // Dark at night side

    ctx.fillStyle = nightGradient;
    ctx.fillRect(centerX - planetRadius, centerY - planetRadius, planetRadius * 2, planetRadius * 2);
    ctx.restore();

    // Draw terminator line (optional, subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(
      centerX - Math.sin(sunAngle) * planetRadius,
      centerY + Math.cos(sunAngle) * planetRadius
    );
    ctx.lineTo(
      centerX + Math.sin(sunAngle) * planetRadius,
      centerY - Math.cos(sunAngle) * planetRadius
    );
    ctx.stroke();

    // Draw marker for Gulf of Guinea (0° longitude, near equator)
    // Gulf of Guinea is at approximately 0°N, 0°E
    const markerAngle = 0; // 0° longitude = right side of Earth (Prime Meridian)
    const markerRadius = planetRadius * 0.85; // Slightly inside edge
    const markerX = centerX + Math.cos(markerAngle) * markerRadius;
    const markerY = centerY + Math.sin(markerAngle) * markerRadius;

    // Draw marker (small green dot)
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(markerX, markerY, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Add small glow
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  startUpdates() {
    // Update every 200ms for smoother performance
    // Draw immediately on first update
    this.update();
    
    this.updateInterval = setInterval(() => {
      this.update();
    }, 200);

    // Update Earth icon every second (day/night changes slowly)
    if (this.earthIconCanvas) {
      this.updateEarthIcon();
      this.earthIconUpdateInterval = setInterval(() => {
        this.updateEarthIcon();
      }, 1000);
    }
  }

  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.earthIconUpdateInterval) {
      clearInterval(this.earthIconUpdateInterval);
      this.earthIconUpdateInterval = null;
    }
  }

  dispose() {
    this.stopUpdates();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.earthIconCanvas = null;
    this.earthIconCtx = null;
  }
}

