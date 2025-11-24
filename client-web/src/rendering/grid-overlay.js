import * as THREE from 'three';
import { DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates.js';

const DEFAULTS = {
  radius: 250,
  majorSpacing: 5,
  minorSpacing: 1,
  fadeStart: 0.8,
  elevation: 0.002,
  // LOD settings: hide minor lines when zoomed out
  minorLineMaxHeight: 300, // Hide minor lines when camera > 300m above grid
  // Performance settings: reduce update frequency
  updateThreshold: 2.5, // Only regenerate grid when camera moves >= 2.5m
  updateThrottleMs: 50, // Minimum time between updates (50ms = max 20 updates/sec)
};

const MOD = (value, modulus) => ((value % modulus) + modulus) % modulus;

const MULTIPLE_STEP = 20;
const MULTIPLE_EPSILON = 0.05;
const THICKNESS_STYLES = {
  axis: { repeats: 5, spacing: 0.4 }, // Reduced from 7 to 5 for performance
  multiple: { repeats: 2, spacing: 0.25 }, // Reduced from 3 to 2 for performance
  default: { repeats: 1, spacing: 0 },
};

const isMultipleOf = (value, step, epsilon = MULTIPLE_EPSILON) => {
  if (!isFinite(value) || step === 0) return false;
  const remainder = ((value % step) + step) % step;
  return remainder < epsilon || step - remainder < epsilon;
};

const getThicknessStyle = ({ isAxis = false, isMultiple = false } = {}) => {
  if (isAxis) return THICKNESS_STYLES.axis;
  if (isMultiple) return THICKNESS_STYLES.multiple;
  return THICKNESS_STYLES.default;
};

const pushThickLineVertices = (
  targetVertices,
  targetDistances,
  orientation,
  start,
  end,
  basePos,
  lineDistance,
  style = THICKNESS_STYLES.default
) => {
  const repeats = style.repeats ?? 1;
  const spacing = style.spacing ?? 0;
  const half = (repeats - 1) / 2;

  for (let i = 0; i < repeats; i++) {
    const offset = repeats === 1 ? 0 : (i - half) * spacing;
    if (orientation === 'horizontal') {
      targetVertices.push(start, 0, basePos + offset);
      targetVertices.push(end, 0, basePos + offset);
    } else {
      targetVertices.push(basePos + offset, 0, start);
      targetVertices.push(basePos + offset, 0, end);
    }
    targetDistances.push(lineDistance, lineDistance);
  }
};

export class GridOverlay {
  constructor(sceneManager, cameraController, options = {}) {
    this.sceneManager = sceneManager;
    this.cameraController = cameraController;
    this.settings = { ...DEFAULTS, ...options };
    this.lastUpdatePosition = { x: NaN, y: NaN };
    this.lastUpdateTime = 0; // For throttling
    
    this.buildGridGroup();
    this.sceneManager.getScene().add(this.group);
    this.updatePosition(true);
  }

  buildGridGroup() {
    this.group = new THREE.Group();
    this.group.name = 'GridOverlay';
    this.group.renderOrder = 1;
    this.group.frustumCulled = false;
    
    // Create separate groups for major and minor lines
    this.majorLinesGroup = new THREE.Group();
    this.majorLinesGroup.name = 'MajorGridLines';
    this.minorLinesGroup = new THREE.Group();
    this.minorLinesGroup.name = 'MinorGridLines';
    
    this.axisLinesGroup = new THREE.Group();
    this.axisLinesGroup.name = 'AxisLines';
    
    this.group.add(this.majorLinesGroup);
    this.group.add(this.minorLinesGroup);
    this.group.add(this.axisLinesGroup);
    
    // Track reusable geometries and line segments for performance
    this.reusableGeometries = {
      majorHorizontal: null,
      majorVertical: null,
      minorHorizontal: null,
      minorVertical: null,
      axis: null,
    };
    this.reusableLineSegments = {
      majorHorizontal: null,
      majorVertical: null,
      minorHorizontal: null,
      minorVertical: null,
      axis: null,
    };
    
    // Create shader material for smooth fade effect
    const createFadeMaterial = (baseColor, baseOpacity = 1.0) => {
      return new THREE.ShaderMaterial({
        uniforms: {
          fadeRadius: { value: this.settings.radius * this.settings.fadeStart },
          maxRadius: { value: this.settings.radius },
          color: { value: baseColor.clone ? baseColor.clone() : new THREE.Color(baseColor) },
          baseOpacity: { value: baseOpacity },
        },
        vertexShader: `
          attribute float distanceFromCenter;
          varying float vOpacity;
          uniform float fadeRadius;
          uniform float maxRadius;
          uniform float baseOpacity;
          
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            
            // Calculate opacity based on distance from center
            float dist = distanceFromCenter;
            if (dist > fadeRadius) {
              float fadeFactor = (dist - fadeRadius) / (maxRadius - fadeRadius);
              vOpacity = max(0.0, baseOpacity * (1.0 - fadeFactor));
            } else {
              vOpacity = baseOpacity;
            }
          }
        `,
        fragmentShader: `
          uniform vec3 color;
          varying float vOpacity;
          
          void main() {
            gl_FragColor = vec4(color, vOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
    };
    
    // Materials for grid lines (using shader for fade)
    this.majorHorizontalMaterial = createFadeMaterial(new THREE.Color(0xff2d2d), 0.95);
    
    this.majorVerticalMaterial = createFadeMaterial(new THREE.Color(0x2d7bff), 0.95);
    
    this.minorMaterial = createFadeMaterial(new THREE.Color(0x9c9c9c), 0.5);
    this.axisMaterial = createFadeMaterial(new THREE.Color(0xffffff), 1.0);
    
    this.visible = true;
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
  }

  update() {
    this.updatePosition();
  }

  updatePosition(forceUpdate = false) {
    if (!this.cameraController || !this.group) return;

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

    const worldX = anchorEarth.x;
    const worldY = anchorEarth.y;
    const updateThreshold = this.settings.updateThreshold;

    // Check if camera moved enough to warrant a grid update
    const movedEnough =
      Math.abs(worldX - this.lastUpdatePosition.x) >= updateThreshold ||
      Math.abs(worldY - this.lastUpdatePosition.y) >= updateThreshold;

    // Throttle: don't update more than once per throttle period
    const now = performance.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    const throttleExpired = timeSinceLastUpdate >= this.settings.updateThrottleMs;

    if (forceUpdate || (movedEnough && throttleExpired)) {
      this.lastUpdatePosition = { x: worldX, y: worldY };
      this.lastUpdateTime = now;
      this.updateGridLines(worldX, worldY);
    }
    
    // Update fade based on current settings
    this.updateFade();
  }

  updateGridLines(worldX, worldY) {
    const radius = this.settings.radius;
    
    // Calculate camera height for LOD
    const camera = this.sceneManager.getCamera();
    const heightAboveGrid = Math.abs(camera.position.y - this.group.position.y);
    const showMinorLines = heightAboveGrid < this.settings.minorLineMaxHeight;
    
    // Adaptive minor spacing: increase spacing when camera is further away
    // This reduces line count and improves performance
    let effectiveMinorSpacing = this.settings.minorSpacing;
    if (showMinorLines && heightAboveGrid > 50) {
      // When camera is 50-300m above grid, use 2m spacing instead of 1m
      // This cuts minor line count in half
      effectiveMinorSpacing = 2;
    }
    
    // Generate major grid lines
    this.generateMajorLines(worldX, worldY, radius);
    
    // Generate minor grid lines (if within LOD distance)
    if (showMinorLines) {
      this.generateMinorLines(worldX, worldY, radius, effectiveMinorSpacing);
    } else {
      // Remove minor line segments when LOD hides them
      this.removeLineSegments('minorHorizontal', this.minorLinesGroup);
      this.removeLineSegments('minorVertical', this.minorLinesGroup);
    }

    this.updateAxisLine(worldY, radius);
  }
  
  /**
   * Remove line segments from a group when they're not needed
   */
  removeLineSegments(geometryKey, group) {
    const lineSegments = this.reusableLineSegments[geometryKey];
    if (lineSegments && group.children.includes(lineSegments)) {
      group.remove(lineSegments);
    }
  }

  generateMajorLines(worldX, worldY, radius) {
    const spacing = this.settings.majorSpacing;
    const steps = Math.ceil((radius + spacing) / spacing) + 2;
    
    // Horizontal lines (red)
    const horizontalVertices = [];
    const horizontalDistances = [];
    const horizontalRemainder = MOD(worldY, spacing);
    
    for (let k = -steps; k <= steps; k++) {
      const localY = k * spacing - horizontalRemainder;
      if (localY < -radius - spacing || localY > radius + spacing) {
        continue;
      }
      
      // Calculate start and end X positions for the circle
      const yAbs = Math.abs(localY);
      if (yAbs <= radius) {
        const xOffset = Math.sqrt(radius * radius - localY * localY);
        const distanceFromCenter = Math.abs(localY);
        const worldCoordinate = worldY + localY;
        const thicknessStyle = getThicknessStyle({
          isMultiple: isMultipleOf(worldCoordinate, MULTIPLE_STEP),
        });
        
        pushThickLineVertices(
          horizontalVertices,
          horizontalDistances,
          'horizontal',
          -xOffset,
          xOffset,
          localY,
          distanceFromCenter,
          thicknessStyle
        );
      }
    }
    
    if (horizontalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'majorHorizontal',
        horizontalVertices,
        horizontalDistances,
        this.majorLinesGroup,
        this.majorHorizontalMaterial
      );
    }
    
    // Vertical lines (blue)
    const verticalVertices = [];
    const verticalDistances = [];
    const verticalRemainder = MOD(worldX, spacing);
    
    for (let k = -steps; k <= steps; k++) {
      const localX = k * spacing - verticalRemainder;
      if (localX < -radius - spacing || localX > radius + spacing) {
        continue;
      }
      
      // Calculate start and end Y positions for the circle
      const xAbs = Math.abs(localX);
      if (xAbs <= radius) {
        const yOffset = Math.sqrt(radius * radius - localX * localX);
        const distanceFromCenter = Math.abs(localX);
        const worldCoordinate = worldX + localX;
        const thicknessStyle = getThicknessStyle({
          isMultiple: isMultipleOf(worldCoordinate, MULTIPLE_STEP),
        });
        
        pushThickLineVertices(
          verticalVertices,
          verticalDistances,
          'vertical',
          -yOffset,
          yOffset,
          localX,
          distanceFromCenter,
          thicknessStyle
        );
      }
    }
    
    if (verticalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'majorVertical',
        verticalVertices,
        verticalDistances,
        this.majorLinesGroup,
        this.majorVerticalMaterial
      );
    }
  }

  generateMinorLines(worldX, worldY, radius, spacingOverride = null) {
    const spacing = spacingOverride ?? this.settings.minorSpacing;
    const steps = Math.ceil((radius + spacing) / spacing) + 2;
    
    // Horizontal lines
    const horizontalVertices = [];
    const horizontalDistances = [];
    const horizontalRemainder = MOD(worldY, spacing);
    
    for (let k = -steps; k <= steps; k++) {
      const localY = k * spacing - horizontalRemainder;
      // Skip if this is a major line
      if (Math.abs(MOD(localY, this.settings.majorSpacing)) < 0.01) {
        continue;
      }
      
      if (localY < -radius - spacing || localY > radius + spacing) {
        continue;
      }
      
      const yAbs = Math.abs(localY);
      if (yAbs <= radius) {
        const xOffset = Math.sqrt(radius * radius - localY * localY);
        const distanceFromCenter = Math.abs(localY);
        const worldCoordinate = worldY + localY;
        const thicknessStyle = getThicknessStyle({
          isMultiple: isMultipleOf(worldCoordinate, MULTIPLE_STEP),
        });
        
        pushThickLineVertices(
          horizontalVertices,
          horizontalDistances,
          'horizontal',
          -xOffset,
          xOffset,
          localY,
          distanceFromCenter,
          thicknessStyle
        );
      }
    }
    
    if (horizontalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'minorHorizontal',
        horizontalVertices,
        horizontalDistances,
        this.minorLinesGroup,
        this.minorMaterial
      );
    }
    
    // Vertical lines
    const verticalVertices = [];
    const verticalDistances = [];
    const verticalRemainder = MOD(worldX, spacing);
    
    for (let k = -steps; k <= steps; k++) {
      const localX = k * spacing - verticalRemainder;
      // Skip if this is a major line
      if (Math.abs(MOD(localX, this.settings.majorSpacing)) < 0.01) {
        continue;
      }
      
      if (localX < -radius - spacing || localX > radius + spacing) {
        continue;
      }
      
      const xAbs = Math.abs(localX);
      if (xAbs <= radius) {
        const yOffset = Math.sqrt(radius * radius - localX * localX);
        const distanceFromCenter = Math.abs(localX);
        const worldCoordinate = worldX + localX;
        const thicknessStyle = getThicknessStyle({
          isMultiple: isMultipleOf(worldCoordinate, MULTIPLE_STEP),
        });
        
        pushThickLineVertices(
          verticalVertices,
          verticalDistances,
          'vertical',
          -yOffset,
          yOffset,
          localX,
          distanceFromCenter,
          thicknessStyle
        );
      }
    }
    
    if (verticalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'minorVertical',
        verticalVertices,
        verticalDistances,
        this.minorLinesGroup,
        this.minorMaterial
      );
    }
  }

  updateAxisLine(worldY, radius) {
    this.axisLinesGroup.clear();

    const localY = -worldY;
    if (Math.abs(localY) > radius) {
      return;
    }

    const xExtent = Math.sqrt(Math.max(radius * radius - localY * localY, 0));
    const vertices = [];
    const distances = [];

    pushThickLineVertices(
      vertices,
      distances,
      'horizontal',
      -xExtent,
      xExtent,
      localY,
      Math.abs(worldY),
      THICKNESS_STYLES.axis
    );

    if (!vertices.length) {
      return;
    }

    this.updateOrCreateGeometry(
      'axis',
      vertices,
      distances,
      this.axisLinesGroup,
      this.axisMaterial
    );
  }

  updateCenterLine(radius) {
    this.axisLinesGroup.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
    });
    this.axisLinesGroup.clear();

    const vertices = [];
    const distances = [];
    pushThickLineVertices(
      vertices,
      distances,
      'horizontal',
      -radius,
      radius,
      0,
      0,
      THICKNESS_STYLES.axis
    );

    if (!vertices.length) {
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute(
      'distanceFromCenter',
      new THREE.Float32BufferAttribute(distances, 1)
    );
    const axisLine = new THREE.LineSegments(geometry, this.axisMaterial);
    this.axisLinesGroup.add(axisLine);
  }

  updateFade() {
    // Update shader uniforms for fade effect
    const fadeRadius = this.settings.radius * this.settings.fadeStart;
    this.majorHorizontalMaterial.uniforms.fadeRadius.value = fadeRadius;
    this.majorVerticalMaterial.uniforms.fadeRadius.value = fadeRadius;
    this.minorMaterial.uniforms.fadeRadius.value = fadeRadius;
    
    this.majorHorizontalMaterial.uniforms.maxRadius.value = this.settings.radius;
    this.majorVerticalMaterial.uniforms.maxRadius.value = this.settings.radius;
    this.minorMaterial.uniforms.maxRadius.value = this.settings.radius;
  }

  clearLines() {
    // Remove children from groups but keep geometries and line segments for reuse
    // Only dispose if we're shutting down (handled in dispose())
    // Note: We don't actually clear here since we're reusing line segments
    // The updateOrCreateGeometry function will handle adding/updating
  }
  
  /**
   * Update or create a geometry with new vertex data
   * Reuses existing geometry if available and size matches, otherwise creates new one
   */
  updateOrCreateGeometry(geometryKey, vertices, distances, group, material) {
    let geometry = this.reusableGeometries[geometryKey];
    const vertexCount = vertices.length / 3;
    
    if (geometry && geometry.attributes.position.count === vertexCount) {
      // Reuse existing geometry - just update the attributes
      const positionAttr = geometry.attributes.position;
      const distanceAttr = geometry.attributes.distanceFromCenter;
      
      // Update position attribute
      if (positionAttr.array.length === vertices.length) {
        positionAttr.array.set(vertices);
        positionAttr.needsUpdate = true;
      } else {
        // Size changed, need to recreate attribute
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      }
      
      // Update distance attribute
      if (distanceAttr.array.length === distances.length) {
        distanceAttr.array.set(distances);
        distanceAttr.needsUpdate = true;
      } else {
        // Size changed, need to recreate attribute
        geometry.setAttribute('distanceFromCenter', new THREE.Float32BufferAttribute(distances, 1));
      }
    } else {
      // Create new geometry (or replace if size changed)
      if (geometry) {
        geometry.dispose();
      }
      
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('distanceFromCenter', new THREE.Float32BufferAttribute(distances, 1));
      
      this.reusableGeometries[geometryKey] = geometry;
    }
    
    // Create or update line segments
    let lineSegments = this.reusableLineSegments[geometryKey];
    if (!lineSegments) {
      lineSegments = new THREE.LineSegments(geometry, material);
      group.add(lineSegments);
      this.reusableLineSegments[geometryKey] = lineSegments;
    } else {
      // Update existing line segments with new geometry
      lineSegments.geometry = geometry;
      // Make sure it's in the group (in case it was removed)
      if (!group.children.includes(lineSegments)) {
        group.add(lineSegments);
      }
    }
    
    return lineSegments;
  }

  getPosition() {
    return { ...this.group.position };
  }

  dispose() {
    // Dispose reusable geometries
    Object.values(this.reusableGeometries).forEach(geometry => {
      if (geometry) {
        geometry.dispose();
      }
    });
    this.reusableGeometries = {};
    
    // Clear groups (geometries already disposed above)
    this.clearLines();
    
    // Dispose materials
    this.majorHorizontalMaterial.dispose();
    this.majorVerticalMaterial.dispose();
    this.minorMaterial.dispose();
    this.axisMaterial.dispose();
    
    this.sceneManager.getScene().remove(this.group);
    this.group.clear();
  }
}
