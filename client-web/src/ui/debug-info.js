/**
 * Debug Info Panel
 * Displays performance, camera, grid, and rendering information
 */

import * as THREE from 'three';
import { legacyPositionToRingPolar, ringPolarToRingArc } from '../utils/coordinates-new.js';

export class DebugInfoPanel {
  constructor(sceneManager, cameraController, gridOverlay, gameStateManager, chunkManager, zoneManager) {
    this.sceneManager = sceneManager;
    this.cameraController = cameraController;
    this.gridOverlay = gridOverlay;
    this.gameStateManager = gameStateManager;
    this.chunkManager = chunkManager;
    this.zoneManager = zoneManager;
    this.panel = null;
    this.isVisible = false; // Start minimized
    this.isHidden = true; // Start hidden
    this.stats = {
      fps: 0,
      frameTime: 0,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
    };
    this.frameCount = 0;
    this.lastTime = performance.now();
    
    this.createPanel();
  }

  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'debug-info-panel';
    this.panel.innerHTML = `
      <div class="debug-panel-content">
        <div class="debug-header">
          <h3>Debug Info</h3>
          <div style="display: flex; gap: 4px;">
            <button id="debug-toggle" class="debug-toggle">−</button>
            <button id="debug-close" class="debug-close">×</button>
          </div>
        </div>
        <div class="debug-sections">
          ${this.createSection('Performance', 'performance', [
            'FPS: <span id="debug-fps">0</span>',
            'Frame Time: <span id="debug-frame-time">0</span> ms',
            'Draw Calls: <span id="debug-draw-calls">0</span>',
            'Triangles: <span id="debug-triangles">0</span>',
            'Geometries: <span id="debug-geometries">0</span>',
            'Textures: <span id="debug-textures">0</span>',
          ])}
          ${this.createSection('Camera', 'camera', [
            'Position (ER): <span id="debug-cam-pos">-</span>',
            'Position (3JS): <span id="debug-cam-pos-3js">-</span>',
            'Target: <span id="debug-cam-target">-</span>',
          ])}
          ${this.createSection('Cursor', 'cursor', [
            'Raw (m): <span id="debug-cursor-raw">-</span>',
            'Converted (km): <span id="debug-cursor-km">-</span>',
            'Screen: <span id="debug-cursor-screen">-</span>',
          ])}
          ${this.createSection('Rendering', 'rendering', [
            'Scene Objects: <span id="debug-scene-objects">0</span>',
            'Chunks Loaded: <span id="debug-chunks">0</span>',
            'Zones Loaded: <span id="debug-zones">0</span>',
            'Renderer Size: <span id="debug-renderer-size">-</span>',
          ])}
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #debug-info-panel {
        position: fixed;
        top: 80px;
        right: 10px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid #333;
        border-radius: 6px;
        padding: 0;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: #00ff00;
        z-index: 9998;
        max-width: 400px;
        max-height: calc(90vh - 70px);
        overflow-y: auto;
      }
      .debug-panel-content {
        padding: 0;
      }
      .debug-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(0, 100, 0, 0.3);
        border-bottom: 1px solid #333;
        cursor: pointer;
      }
      .debug-header h3 {
        margin: 0;
        font-size: 14px;
        color: #00ff00;
      }
      .debug-toggle {
        background: transparent;
        border: 1px solid #00ff00;
        color: #00ff00;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0;
      }
      .debug-toggle:hover {
        background: rgba(0, 255, 0, 0.2);
      }
      .debug-close {
        background: transparent;
        border: 1px solid #ff4444;
        color: #ff4444;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0;
      }
      .debug-close:hover {
        background: rgba(255, 68, 68, 0.2);
      }
      #debug-info-panel.hidden {
        display: none;
      }
      .debug-sections {
        padding: 0;
      }
      .debug-section {
        border-bottom: 1px solid #333;
      }
      .debug-section:last-child {
        border-bottom: none;
      }
      .debug-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: rgba(0, 50, 0, 0.2);
        cursor: pointer;
        user-select: none;
      }
      .debug-section-header:hover {
        background: rgba(0, 100, 0, 0.2);
      }
      .debug-section-header h4 {
        margin: 0;
        font-size: 13px;
        color: #00ff00;
      }
      .debug-section-toggle {
        color: #00ff00;
        font-size: 14px;
      }
      .debug-section-content {
        padding: 8px 12px;
        display: block;
      }
      .debug-section-content.collapsed {
        display: none;
      }
      .debug-section-content .debug-line {
        margin: 4px 0;
        color: #aaffaa;
      }
      .debug-section-content .debug-line span {
        color: #00ff00;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(this.panel);

    // Set up event listeners
    this.setupEventListeners();
    
    // Initialize as minimized and hidden
    const sections = this.panel.querySelector('.debug-sections');
    const toggleBtn = this.panel.querySelector('#debug-toggle');
    if (sections) {
      sections.style.display = 'none';
    }
    if (toggleBtn) {
      toggleBtn.textContent = '+';
    }
    // Start hidden
    this.hidePanel();
  }

  createSection(title, id, lines) {
    return `
      <div class="debug-section" data-section="${id}">
        <div class="debug-section-header" data-toggle="${id}">
          <h4>${title}</h4>
          <span class="debug-section-toggle" data-icon="${id}">−</span>
        </div>
        <div class="debug-section-content" id="debug-${id}-content">
          ${lines.map(line => `<div class="debug-line">${line}</div>`).join('')}
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    // Toggle entire panel
    const toggleBtn = this.panel.querySelector('#debug-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePanel();
    });

    // Close panel
    const closeBtn = this.panel.querySelector('#debug-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hidePanel();
    });

    // Toggle individual sections
    const sectionHeaders = this.panel.querySelectorAll('.debug-section-header');
    sectionHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const sectionId = header.getAttribute('data-toggle');
        this.toggleSection(sectionId);
      });
    });
  }

  togglePanel() {
    this.isVisible = !this.isVisible;
    const sections = this.panel.querySelector('.debug-sections');
    const toggleBtn = this.panel.querySelector('#debug-toggle');
    
    if (this.isVisible) {
      sections.style.display = 'block';
      toggleBtn.textContent = '−';
    } else {
      sections.style.display = 'none';
      toggleBtn.textContent = '+';
    }
  }

  hidePanel() {
    this.isHidden = true;
    if (this.panel) {
      this.panel.classList.add('hidden');
    }
  }

  showPanel() {
    this.isHidden = false;
    if (this.panel) {
      this.panel.classList.remove('hidden');
      // Make sure it's also expanded when shown
      if (!this.isVisible) {
        this.togglePanel();
      }
    }
  }

  toggleSection(sectionId) {
    const content = this.panel.querySelector(`#debug-${sectionId}-content`);
    const icon = this.panel.querySelector(`[data-icon="${sectionId}"]`);
    
    if (content.classList.contains('collapsed')) {
      content.classList.remove('collapsed');
      icon.textContent = '−';
    } else {
      content.classList.add('collapsed');
      icon.textContent = '+';
    }
  }

  update() {
    if (!this.panel || !this.isVisible || this.isHidden) return;

    const now = performance.now();
    const deltaTime = now - this.lastTime;
    this.frameCount++;
    
    // Update FPS every second
    if (deltaTime >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / deltaTime);
      this.stats.frameTime = (deltaTime / this.frameCount).toFixed(2);
      this.frameCount = 0;
      this.lastTime = now;
      
      // Update performance stats
      this.updatePerformance();
    }

    // Update camera info every frame
    this.updateCamera();
    
    // Update cursor info every frame
    this.updateCursor();
    
    // Update rendering info every frame
    this.updateRendering();
  }

  updatePerformance() {
    const fpsEl = this.panel.querySelector('#debug-fps');
    const frameTimeEl = this.panel.querySelector('#debug-frame-time');
    
    if (fpsEl) fpsEl.textContent = this.stats.fps;
    if (frameTimeEl) frameTimeEl.textContent = this.stats.frameTime;
    
    // Get renderer info if available
    const renderer = this.sceneManager?.getRenderer();
    if (renderer && renderer.info) {
      const info = renderer.info;
      const drawCallsEl = this.panel.querySelector('#debug-draw-calls');
      const trianglesEl = this.panel.querySelector('#debug-triangles');
      const geometriesEl = this.panel.querySelector('#debug-geometries');
      const texturesEl = this.panel.querySelector('#debug-textures');
      
      if (drawCallsEl) drawCallsEl.textContent = info.render.calls || 0;
      if (trianglesEl) trianglesEl.textContent = (info.render.triangles || 0).toLocaleString();
      if (geometriesEl) geometriesEl.textContent = info.memory.geometries || 0;
      if (texturesEl) texturesEl.textContent = info.memory.textures || 0;
    }
  }

  updateCamera() {
    if (!this.cameraController) return;
    
    const erPos = this.cameraController.getEarthRingPosition();
    const camera = this.sceneManager?.getCamera();
    
    const posEl = this.panel.querySelector('#debug-cam-pos');
    const pos3JSEl = this.panel.querySelector('#debug-cam-pos-3js');
    const targetEl = this.panel.querySelector('#debug-cam-target');
    
    // Convert legacy coordinates to new RingArc coordinates
    if (posEl) {
      try {
        // Convert legacy (x, y, z) to RingPolar, then to RingArc
        const polar = legacyPositionToRingPolar(erPos.x, erPos.y, erPos.z);
        const arc = ringPolarToRingArc(polar);
        
        // Display as RingArc: s (arc length in km), θ (theta in degrees), r (radial offset in m), z (vertical offset in m)
        const sKm = arc.s / 1000; // Convert to km
        const thetaDeg = polar.theta * 180 / Math.PI;
        posEl.textContent = `s:${sKm.toFixed(1)}km θ:${thetaDeg.toFixed(1)}° r:${arc.r.toFixed(1)}m z:${arc.z.toFixed(1)}m`;
      } catch (error) {
        // Fallback to legacy format if conversion fails
        posEl.textContent = `X:${erPos.x.toFixed(1)} Y:${erPos.y.toFixed(1)} Z:${erPos.z.toFixed(1)}`;
      }
    }
    
    if (pos3JSEl && camera) {
      pos3JSEl.textContent = `X:${camera.position.x.toFixed(1)} Y:${camera.position.y.toFixed(1)} Z:${camera.position.z.toFixed(1)}`;
    }
    
    if (targetEl && this.cameraController.getControls) {
      const controls = this.cameraController.getControls();
      if (controls && controls.target) {
        targetEl.textContent = `X:${controls.target.x.toFixed(1)} Y:${controls.target.y.toFixed(1)} Z:${controls.target.z.toFixed(1)}`;
      }
    }
  }

  updateCursor() {
    if (!this.cameraController || !this.sceneManager) return;
    
    const camera = this.sceneManager.getCamera();
    const renderer = this.sceneManager.getRenderer();
    
    if (!camera || !renderer) return;
    
    // Get mouse position from global tracker
    const mousePos = window.earthring?.mousePosition;
    
    const rawEl = this.panel.querySelector('#debug-cursor-raw');
    const kmEl = this.panel.querySelector('#debug-cursor-km');
    const screenEl = this.panel.querySelector('#debug-cursor-screen');
    
    // Always show screen coordinates if available
    if (screenEl && mousePos && mousePos.x !== undefined && mousePos.y !== undefined) {
      screenEl.textContent = `X:${mousePos.x} Y:${mousePos.y}`;
    } else if (screenEl) {
      screenEl.textContent = '-';
    }
    
    if (mousePos && mousePos.x !== undefined && mousePos.y !== undefined) {
      // Create raycaster from mouse position
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      
      // Get renderer canvas bounds
      const rect = renderer.domElement.getBoundingClientRect();
      
      // Convert screen coordinates to normalized device coordinates
      mouse.x = ((mousePos.x - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((mousePos.y - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      
      // Get current floor from camera
      const erPos = this.cameraController.getEarthRingPosition();
      const floor = Math.round(erPos.z);
      const floorHeight = floor * 20.0; // DEFAULT_FLOOR_HEIGHT
      
      // Create a plane at the current floor (Y-up in Three.js)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorHeight);
      const intersectionPoint = new THREE.Vector3();
      const hasIntersection = raycaster.ray.intersectPlane(plane, intersectionPoint);
      
      if (hasIntersection) {
        // Convert Three.js position to EarthRing coordinates
        // X in Three.js maps to X in EarthRing
        // Z in Three.js maps to Y in EarthRing (width)
        const erX = intersectionPoint.x; // meters
        const erY = intersectionPoint.z; // meters
        
        // Display raw coordinates in meters
        if (rawEl) {
          rawEl.textContent = `X:${erX.toFixed(1)}m Y:${erY.toFixed(1)}m`;
        }
        
        // Display converted coordinates in km
        if (kmEl) {
          const erXKm = erX / 1000;
          const erYKm = erY / 1000;
          kmEl.textContent = `X:${erXKm.toFixed(3)}km Y:${erYKm.toFixed(3)}km`;
        }
      } else {
        if (rawEl) rawEl.textContent = '-';
        if (kmEl) kmEl.textContent = '-';
      }
    } else {
      if (rawEl) rawEl.textContent = '-';
      if (kmEl) kmEl.textContent = '-';
    }
  }

  /**
   * Get formatted performance data as string
   */
  getPerformanceData() {
    const renderer = this.sceneManager?.getRenderer();
    let drawCalls = 0;
    let triangles = 0;
    let geometries = 0;
    let textures = 0;
    
    if (renderer && renderer.info) {
      const info = renderer.info;
      drawCalls = info.render.calls || 0;
      triangles = info.render.triangles || 0;
      geometries = info.memory.geometries || 0;
      textures = info.memory.textures || 0;
    }
    
    return `FPS: ${this.stats.fps}
Frame Time: ${this.stats.frameTime} ms
Draw Calls: ${drawCalls}
Triangles: ${triangles.toLocaleString()}
Geometries: ${geometries}
Textures: ${textures}`;
  }

  /**
   * Get formatted camera data as string
   */
  getCameraData() {
    if (!this.cameraController) return 'Camera data unavailable';
    
    const erPos = this.cameraController.getEarthRingPosition();
    const camera = this.sceneManager?.getCamera();
    
    let erPosStr = '';
    try {
      const polar = legacyPositionToRingPolar(erPos.x, erPos.y, erPos.z);
      const arc = ringPolarToRingArc(polar);
      const sKm = arc.s / 1000;
      const thetaDeg = polar.theta * 180 / Math.PI;
      erPosStr = `s:${sKm.toFixed(1)}km θ:${thetaDeg.toFixed(1)}° r:${arc.r.toFixed(1)}m z:${arc.z.toFixed(1)}m`;
    } catch (error) {
      erPosStr = `X:${erPos.x.toFixed(1)} Y:${erPos.y.toFixed(1)} Z:${erPos.z.toFixed(1)}`;
    }
    
    let pos3JSStr = 'N/A';
    if (camera) {
      pos3JSStr = `X:${camera.position.x.toFixed(1)} Y:${camera.position.y.toFixed(1)} Z:${camera.position.z.toFixed(1)}`;
    }
    
    let targetStr = 'N/A';
    if (this.cameraController.getControls) {
      const controls = this.cameraController.getControls();
      if (controls && controls.target) {
        targetStr = `X:${controls.target.x.toFixed(1)} Y:${controls.target.y.toFixed(1)} Z:${controls.target.z.toFixed(1)}`;
      }
    }
    
    return `Position (ER): ${erPosStr}
Position (3JS): ${pos3JSStr}
Target: ${targetStr}`;
  }

  /**
   * Get formatted cursor data as string
   */
  getCursorData() {
    if (!this.cameraController || !this.sceneManager) return 'Cursor data unavailable';
    
    const camera = this.sceneManager.getCamera();
    const renderer = this.sceneManager.getRenderer();
    if (!camera || !renderer) return 'Cursor data unavailable';
    
    const mousePos = window.earthring?.mousePosition;
    if (!mousePos) return 'No cursor position';
    
    const rawEl = this.panel?.querySelector('#debug-cursor-raw');
    const kmEl = this.panel?.querySelector('#debug-cursor-km');
    const screenEl = this.panel?.querySelector('#debug-cursor-screen');
    
    const raw = rawEl?.textContent || 'N/A';
    const km = kmEl?.textContent || 'N/A';
    const screen = screenEl?.textContent || 'N/A';
    
    return `Raw (m): ${raw}
Converted (km): ${km}
Screen: ${screen}`;
  }

  /**
   * Get formatted rendering data as string
   */
  getRenderingData() {
    const scene = this.sceneManager?.getScene();
    const renderer = this.sceneManager?.getRenderer();
    
    let sceneObjects = 0;
    if (scene) {
      scene.traverse(() => sceneObjects++);
    }
    
    const chunksLoaded = this.chunkManager?.loadedChunks?.size || 0;
    const zonesLoaded = this.zoneManager?.zoneMeshes?.size || 0;
    
    let rendererSize = 'N/A';
    if (renderer) {
      rendererSize = `${renderer.domElement.width}x${renderer.domElement.height}`;
    }
    
    return `Scene Objects: ${sceneObjects}
Chunks Loaded: ${chunksLoaded}
Zones Loaded: ${zonesLoaded}
Renderer Size: ${rendererSize}`;
  }


  updateRendering() {
    const scene = this.sceneManager?.getScene();
    const renderer = this.sceneManager?.getRenderer();
    
    const objectsEl = this.panel.querySelector('#debug-scene-objects');
    const chunksEl = this.panel.querySelector('#debug-chunks');
    const zonesEl = this.panel.querySelector('#debug-zones');
    const sizeEl = this.panel.querySelector('#debug-renderer-size');
    
    if (objectsEl && scene) {
      let count = 0;
      scene.traverse(() => count++);
      objectsEl.textContent = count;
    }
    
    if (chunksEl) {
      if (this.gameStateManager) {
        chunksEl.textContent = this.gameStateManager.getAllChunks().length;
      } else {
        chunksEl.textContent = '-';
      }
    }
    
    if (zonesEl) {
      if (this.gameStateManager) {
        zonesEl.textContent = this.gameStateManager.getAllZones().length;
      } else {
        zonesEl.textContent = '-';
      }
    }
    
    if (sizeEl && renderer) {
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;
      sizeEl.textContent = `${width}×${height}`;
    }
  }

  dispose() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }
}

