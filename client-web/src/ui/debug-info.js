/**
 * Debug Info Panel
 * Displays performance, camera, grid, and rendering information
 */

export class DebugInfoPanel {
  constructor(sceneManager, cameraController, gridOverlay, gameStateManager, chunkManager, zoneManager) {
    this.sceneManager = sceneManager;
    this.cameraController = cameraController;
    this.gridOverlay = gridOverlay;
    this.gameStateManager = gameStateManager;
    this.chunkManager = chunkManager;
    this.zoneManager = zoneManager;
    this.panel = null;
    this.isVisible = true;
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
          <button id="debug-toggle" class="debug-toggle">−</button>
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
            'Floor: <span id="debug-cam-floor">-</span>',
            'Target: <span id="debug-cam-target">-</span>',
          ])}
          ${this.createSection('Grid', 'grid', [
            'Position: <span id="debug-grid-pos">-</span>',
            'Radius: <span id="debug-grid-radius">-</span>',
            'Major Spacing: <span id="debug-grid-major">-</span>',
            'Minor Spacing: <span id="debug-grid-minor">-</span>',
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
        top: 10px;
        left: 10px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid #333;
        border-radius: 6px;
        padding: 0;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: #00ff00;
        z-index: 10000;
        max-width: 400px;
        max-height: 90vh;
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
    if (!this.panel || !this.isVisible) return;

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
    
    // Update grid info every frame
    this.updateGrid();
    
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
    const floorEl = this.panel.querySelector('#debug-cam-floor');
    const targetEl = this.panel.querySelector('#debug-cam-target');
    
    if (posEl) {
      posEl.textContent = `X:${erPos.x.toFixed(1)} Y:${erPos.y.toFixed(1)} Z:${erPos.z.toFixed(1)}`;
    }
    
    if (pos3JSEl && camera) {
      pos3JSEl.textContent = `X:${camera.position.x.toFixed(1)} Y:${camera.position.y.toFixed(1)} Z:${camera.position.z.toFixed(1)}`;
    }
    
    if (floorEl) {
      floorEl.textContent = Math.round(erPos.z);
    }
    
    if (targetEl && this.cameraController.getControls) {
      const controls = this.cameraController.getControls();
      if (controls && controls.target) {
        targetEl.textContent = `X:${controls.target.x.toFixed(1)} Y:${controls.target.y.toFixed(1)} Z:${controls.target.z.toFixed(1)}`;
      }
    }
  }

  updateGrid() {
    if (!this.gridOverlay) return;
    
    const posEl = this.panel.querySelector('#debug-grid-pos');
    const radiusEl = this.panel.querySelector('#debug-grid-radius');
    const majorEl = this.panel.querySelector('#debug-grid-major');
    const minorEl = this.panel.querySelector('#debug-grid-minor');
    
    if (posEl) {
      if (this.gridOverlay.getPosition) {
        const pos = this.gridOverlay.getPosition();
        posEl.textContent = `X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(3)} Z:${pos.z.toFixed(1)}`;
      } else if (this.gridOverlay.group) {
        const pos = this.gridOverlay.group.position;
        posEl.textContent = `X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(3)} Z:${pos.z.toFixed(1)}`;
      } else {
        posEl.textContent = '-';
      }
    }
    
    if (radiusEl) {
      radiusEl.textContent = `${this.gridOverlay.settings.radius || 250}m`;
    }
    
    if (majorEl) {
      majorEl.textContent = `${this.gridOverlay.settings.majorSpacing}m`;
    }
    
    if (minorEl) {
      minorEl.textContent = `${this.gridOverlay.settings.minorSpacing}m`;
    }
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

