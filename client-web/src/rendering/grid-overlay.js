import * as THREE from 'three';
import { DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates.js';

const DEFAULTS = {
  radius: 250,
  majorSpacing: 5,
  minorSpacing: 1,
  fadeStart: 0.8,
  elevation: 0.002,
  textureSize: 512,
};

const MOD = (value, modulus) => ((value % modulus) + modulus) % modulus;

export class GridOverlay {
  constructor(sceneManager, cameraController, options = {}) {
    this.sceneManager = sceneManager;
    this.cameraController = cameraController;
    this.settings = { ...DEFAULTS, ...options };
    this.lastTextureOffset = { x: NaN, y: NaN };
    this.textureNeedsUpdate = true;

    this.initTexture();
    this.buildGridMesh();
    this.sceneManager.getScene().add(this.group);
    this.updatePosition(true);
  }

  initTexture() {
    const size = this.settings.textureSize;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;
  }

  buildGridMesh() {
    const geometry = new THREE.CircleGeometry(this.settings.radius, 128);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 1,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = this.settings.elevation;
    this.mesh.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.name = 'GridOverlay';
    this.group.renderOrder = 1;
    this.group.frustumCulled = false;
    this.group.add(this.mesh);
    this.visible = true;
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
  }

  update() {
    this.updatePosition();
  }

  updatePosition(forceTextureUpdate = false) {
    if (!this.cameraController || !this.mesh) return;

    const camera = this.sceneManager.getCamera();
    const anchorThree =
      this.cameraController.getTargetThreePosition?.() ?? camera.position;
    const anchorEarth =
      this.cameraController.getTargetEarthRingPosition?.() ??
      this.cameraController.getEarthRingPosition();
    const currentFloor =
      this.cameraController.getCurrentFloor?.() ?? Math.round(anchorEarth.z);
    const floorHeight = currentFloor * DEFAULT_FLOOR_HEIGHT;

    this.group.position.set(anchorThree.x, floorHeight, anchorThree.z);

    const offsetX = anchorEarth.x;
    const offsetY = anchorEarth.y;
    const smallestSpacing = Math.min(this.settings.majorSpacing, this.settings.minorSpacing);

    const movedEnough =
      Math.abs(offsetX - this.lastTextureOffset.x) >= smallestSpacing ||
      Math.abs(offsetY - this.lastTextureOffset.y) >= smallestSpacing;

    if (forceTextureUpdate || this.textureNeedsUpdate || movedEnough) {
      this.lastTextureOffset = { x: offsetX, y: offsetY };
      this.drawGridTexture(offsetX, offsetY);
      this.textureNeedsUpdate = false;
    }
  }

  drawGridTexture(worldX, worldY) {
    const size = this.settings.textureSize;
    const ctx = this.ctx;
    const center = size / 2;
    const radiusPx = size / 2;
    const ppm = radiusPx / this.settings.radius;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radiusPx, 0, Math.PI * 2);
    ctx.clip();

    const drawLines = (spacing, color, width, orientation) => {
      const cameraCoord = orientation === 'horizontal' ? worldY : worldX;
      const remainder = MOD(cameraCoord, spacing);
      const steps = Math.ceil((this.settings.radius + spacing) / spacing) + 2;

      ctx.strokeStyle = color;
      ctx.lineWidth = width;

      for (let k = -steps; k <= steps; k++) {
        const localPos = k * spacing - remainder;
        if (localPos < -this.settings.radius - spacing || localPos > this.settings.radius + spacing) {
          continue;
        }
        const pixelPos = center + localPos * ppm;
        ctx.beginPath();
        if (orientation === 'horizontal') {
          ctx.moveTo(center - radiusPx, pixelPos);
          ctx.lineTo(center + radiusPx, pixelPos);
        } else {
          ctx.moveTo(pixelPos, center - radiusPx);
          ctx.lineTo(pixelPos, center + radiusPx);
        }
        ctx.stroke();
      }
    };

    drawLines(this.settings.minorSpacing, 'rgba(40,40,40,0.6)', 1, 'horizontal');
    drawLines(this.settings.minorSpacing, 'rgba(40,40,40,0.6)', 1, 'vertical');

    drawLines(this.settings.majorSpacing, 'rgba(255,45,45,0.9)', 1.6, 'horizontal');
    drawLines(this.settings.majorSpacing, 'rgba(45,123,255,0.9)', 1.6, 'vertical');

    ctx.restore();

    // Apply fade-out gradient only to the grid (not zones)
    ctx.save();
    const gradient = ctx.createRadialGradient(
      center,
      center,
      radiusPx * this.settings.fadeStart,
      center,
      center,
      radiusPx
    );
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    this.texture.needsUpdate = true;
  }

  getPosition() {
    return { ...this.group.position };
  }


  dispose() {
    if (this.mesh?.material?.map) {
      this.mesh.material.map.dispose();
    }
    this.sceneManager.getScene().remove(this.group);
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.group.clear();
  }
}

