/**
 * Minimap Component
 * Shows player position, facing direction, and station info at bottom-left
 */

import * as THREE from 'three';
import { getRingArcPositionFromCamera } from '../utils/rendering.js';
import { legacyPositionToRingPolar, ringPolarToRingArc, chunkIndexToRingArc, CHUNK_LENGTH, CHUNK_COUNT } from '../utils/coordinates-new.js';
import { findNearestStation, PILLAR_HUB_POSITIONS } from '../utils/stations.js';
import { RING_CIRCUMFERENCE } from '../utils/coordinates-new.js';

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
    this.updateInterval = null;
    this.lastPosition = null;
    this.lastDirection = null;
    this.zoomLevel = 'full'; // 'full' or 'local'
    
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
      }

      .minimap-title {
        padding: 6px 10px;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid rgba(76, 175, 80, 0.3);
        color: #4caf50;
        font-weight: bold;
        font-size: 11px;
        text-align: center;
      }

      .minimap-canvas-container {
        flex: 1;
        position: relative;
        overflow: hidden;
      }

      #minimap-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }

      .minimap-controls {
        display: flex;
        justify-content: center;
        gap: 4px;
        padding: 4px;
        background: rgba(0, 0, 0, 0.3);
        border-top: 1px solid rgba(76, 175, 80, 0.3);
      }

      .minimap-zoom-btn {
        background: transparent;
        border: 1px solid #4caf50;
        color: #4caf50;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .minimap-zoom-btn:hover {
        background: rgba(76, 175, 80, 0.2);
      }

      .minimap-zoom-btn:active {
        background: rgba(76, 175, 80, 0.4);
      }
    `;
    document.head.appendChild(style);

    this.container.innerHTML = `
      <div class="minimap-title" id="minimap-title">Ring: 0 km, Floor 0</div>
      <div class="minimap-canvas-container">
        <canvas id="minimap-canvas"></canvas>
      </div>
      <div class="minimap-controls">
        <button class="minimap-zoom-btn" id="minimap-zoom-out" title="Zoom out (Full ring view)">−</button>
        <button class="minimap-zoom-btn" id="minimap-zoom-in" title="Zoom in (Local area view)">+</button>
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
  }

  resizeCanvas() {
    if (!this.canvas || !this.container) return;
    
    const containerRect = this.container.querySelector('.minimap-canvas-container').getBoundingClientRect();
    if (containerRect.width > 0 && containerRect.height > 0) {
      this.canvas.width = containerRect.width;
      this.canvas.height = containerRect.height;
    }
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
        if (isOnStation) {
          const stationName = nearestStation.index === 0 ? 'Kongo Hub' : `Hub ${nearestStation.index}`;
          titleEl.textContent = `${stationName}: ${(arc.s / 1000).toFixed(1)} km, Floor ${floor}`;
        } else {
          titleEl.textContent = `Ring: ${(arc.s / 1000).toFixed(1)} km, Floor ${floor}`;
        }
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

  drawLocalView(arc, directionAngle, erPos) {
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

    // Clear canvas with semi-transparent background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.fillRect(0, 0, width, height);

    // Draw grid (every 500m)
    this.ctx.strokeStyle = 'rgba(76, 175, 80, 0.3)';
    this.ctx.lineWidth = 1;
    for (let i = -viewSize; i <= viewSize; i += 500) {
      // Vertical lines
      const x = centerX + (i * scale);
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
      
      // Horizontal lines
      const y = centerY + (i * scale);
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }

    // Player position is at center (no visual marker, just the arrow)

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

    // Draw north indicator
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

    // Draw chunk platforms (ensure full minimap coverage)
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

      if (!chunkData && this.chunkManager?.chunkMeshes?.has(chunkID)) {
        const mesh = this.chunkManager.chunkMeshes.get(chunkID);
        chunkData = mesh?.userData?.chunkData || null;
      }

      chunksToRender.push({ chunkIndex: wrappedIndex, chunkData });
    }

    chunksToRender.forEach(({ chunkIndex, chunkData }) => {
      try {
        const chunkArc = chunkIndexToRingArc(chunkIndex);
        const chunkCenterS = chunkArc.s;

        const directDist = Math.abs(chunkCenterS - playerArcS);
        const wrappedDist = RING_CIRCUMFERENCE - directDist;
        const distance = Math.min(directDist, wrappedDist);

        if (distance > viewRadius + CHUNK_LENGTH) {
          return;
        }

        let arcDiff = chunkCenterS - playerArcS;
        if (arcDiff > RING_CIRCUMFERENCE / 2) {
          arcDiff -= RING_CIRCUMFERENCE;
        } else if (arcDiff < -RING_CIRCUMFERENCE / 2) {
          arcDiff += RING_CIRCUMFERENCE;
        }

        // Calculate relative position: chunk position minus player position
        // For top-down minimap: X is east/west, Y is north/south
        // Note: Chunks are positioned relative to camera position, but we're using camera target
        // This might cause a slight offset, but should be fine for minimap purposes
        const localX = arcDiff; // East/west offset in meters
        const localY = chunkArc.r - arc.r; // North/south offset relative to player (chunk r - player r)

        // Map to screen coordinates
        // Screen: +X = right (east), +Y = down (south)
        // North (positive localY) should appear up (negative screen Y)
        // If chunks appear to move in reverse, the sign might be wrong
        const screenX = centerX + (localX * scale);
        const screenY = centerY + (localY * scale); // Test: flip sign to fix reverse movement

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

        // Calculate actual platform bounds from geometry if available
        // Otherwise use width centered at chunkArc.r (which defaults to 0)
        let platformMinR = chunkArc.r - widthMeters / 2;
        let platformMaxR = chunkArc.r + widthMeters / 2;
        
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
            // Vertices are relative to chunk center, so add chunkArc.r
            platformMinR = chunkArc.r + minY;
            platformMaxR = chunkArc.r + maxY;
          }
        }

        const chunkLengthScreen = CHUNK_LENGTH * scale;
        const platformWidthMeters = platformMaxR - platformMinR;
        const chunkWidthScreen = Math.max(8, platformWidthMeters * scale);

        // Calculate platform center in screen coordinates
        // Platform center is at the midpoint of min/max R bounds
        const platformCenterR = (platformMinR + platformMaxR) / 2;
        const platformCenterLocalY = platformCenterR - arc.r;
        const platformCenterScreenY = centerY + (platformCenterLocalY * scale);

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
        
        // Always draw platforms that are within the arc distance, regardless of screen bounds
        // The platform might extend far beyond the screen but should still be visible
        // Only skip if it's completely outside with a very generous margin
        if (!intersectsX || !intersectsY) {
          // Additional check: if platform is very large and player is near its center, always show it
          // (Reuse platformCenterR calculated above to avoid duplicate calculation)
          const distanceFromPlatformCenter = Math.abs(arc.r - platformCenterR);
          const platformHalfWidth = platformWidthMeters / 2;
          
          // If player is within 2x the platform half-width, always show it (even if mostly off-screen)
          if (distanceFromPlatformCenter < platformHalfWidth * 2) {
            // Force draw - platform is large and player is near it
          } else {
            return; // Platform is completely outside view and player is far from it
          }
        }

        // Draw platform rectangle centered at platform center
        this.ctx.fillStyle = 'rgba(76, 175, 80, 0.5)';
        this.ctx.strokeStyle = '#4caf50';
        this.ctx.lineWidth = 2; // Increased line width for better visibility
        this.ctx.fillRect(platformMinX, platformMinY, chunkLengthScreen, chunkWidthScreen);
        this.ctx.strokeRect(platformMinX, platformMinY, chunkLengthScreen, chunkWidthScreen);
      } catch (error) {
        // Ignore chunk draw errors
      }
    });
  }

  startUpdates() {
    // Update every 200ms for smoother performance
    // Draw immediately on first update
    this.update();
    
    this.updateInterval = setInterval(() => {
      this.update();
    }, 200);
  }

  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
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
  }
}

