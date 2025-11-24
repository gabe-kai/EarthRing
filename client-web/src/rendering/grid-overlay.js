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
  axis: { width: 0.8 }, // Line width in world units (meters)
  multiple: { width: 0.3 }, // Line width in world units (meters)
  default: { width: 0.1 }, // Thin line width
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

/**
 * Generate quad vertices for a thick line segment
 * Creates a rectangle/quad instead of a thin line for better visual thickness
 */
const pushThickLineVertices = (
  targetVertices,
  targetDistances,
  targetIndices,
  indexOffset,
  orientation,
  start,
  end,
  basePos,
  lineDistance,
  style = THICKNESS_STYLES.default
) => {
  const lineWidth = style.width ?? 0.1;
  const halfWidth = lineWidth / 2;
  
  let v0, v1, v2, v3; // Four corners of the quad
  
  if (orientation === 'horizontal') {
    // Horizontal line: quad extends in Z direction (width)
    v0 = [start, 0, basePos - halfWidth];  // Bottom-left
    v1 = [end, 0, basePos - halfWidth];    // Bottom-right
    v2 = [end, 0, basePos + halfWidth];    // Top-right
    v3 = [start, 0, basePos + halfWidth];  // Top-left
  } else {
    // Vertical line: quad extends in X direction (width)
    v0 = [basePos - halfWidth, 0, start];  // Bottom-left
    v1 = [basePos + halfWidth, 0, start];  // Bottom-right
    v2 = [basePos + halfWidth, 0, end];    // Top-right
    v3 = [basePos - halfWidth, 0, end];    // Top-left
  }
  
  // Add vertices
  const baseIndex = indexOffset;
  targetVertices.push(...v0, ...v1, ...v2, ...v3);
  targetDistances.push(lineDistance, lineDistance, lineDistance, lineDistance);
  
  // Add indices for two triangles forming the quad
  // Triangle 1: v0, v1, v2
  targetIndices.push(baseIndex, baseIndex + 1, baseIndex + 2);
  // Triangle 2: v0, v2, v3
  targetIndices.push(baseIndex, baseIndex + 2, baseIndex + 3);
  
  return 4; // Return number of vertices added
};

export class GridOverlay {
  constructor(sceneManager, cameraController, options = {}) {
    this.sceneManager = sceneManager;
    this.cameraController = cameraController;
    this.settings = { ...DEFAULTS, ...options };
    this.lastUpdatePosition = { x: NaN, y: NaN };
    this.lastUpdateTime = 0; // For throttling
    this.lastFadeValues = { fadeRadius: null, maxRadius: null }; // Cache for conditional updates

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
    
    // Track reusable geometries and meshes for performance
    this.reusableGeometries = {
      majorHorizontal: null,
      majorVertical: null,
      minorHorizontal: null,
      minorVertical: null,
      axis: null,
    };
    this.reusableMeshes = {
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
        side: THREE.DoubleSide, // Render both sides of quads
      });
    };
    
    // Materials for grid lines (using shader for fade)
    this.majorHorizontalMaterial = createFadeMaterial(new THREE.Color(0xff2d2d), 0.95);
    
    this.majorVerticalMaterial = createFadeMaterial(new THREE.Color(0x2d7bff), 0.95);
    
    this.minorMaterial = createFadeMaterial(new THREE.Color(0x9c9c9c), 0.5);
    this.axisMaterial = createFadeMaterial(new THREE.Color(0xff2d2d), 0.95); // Red to match horizontal lines
    
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
      // Only update grid group position when regenerating grid lines
      // This keeps the grid stable in world space instead of following the camera
      this.group.position.set(anchorThree.x, floorHeight, anchorThree.z);
      
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
   * Remove mesh from a group when it's not needed
   */
  removeLineSegments(geometryKey, group) {
    const mesh = this.reusableMeshes[geometryKey];
    if (mesh && group.children.includes(mesh)) {
      group.remove(mesh);
    }
  }

  generateMajorLines(worldX, worldY, radius) {
    const spacing = this.settings.majorSpacing;
    const steps = Math.ceil((radius + spacing) / spacing) + 2;
    
    // Horizontal lines (red)
    const horizontalVertices = [];
    const horizontalDistances = [];
    const horizontalIndices = [];
    let horizontalIndexOffset = 0;
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
        
        const verticesAdded = pushThickLineVertices(
          horizontalVertices,
          horizontalDistances,
          horizontalIndices,
          horizontalIndexOffset,
          'horizontal',
          -xOffset,
          xOffset,
          localY,
          distanceFromCenter,
          thicknessStyle
        );
        horizontalIndexOffset += verticesAdded;
      }
    }
    
    if (horizontalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'majorHorizontal',
        horizontalVertices,
        horizontalDistances,
        horizontalIndices,
        this.majorLinesGroup,
        this.majorHorizontalMaterial
      );
      if (typeof window !== 'undefined' && window.earthring?.debug) {
        console.log(`[GridOverlay] Created majorHorizontal: ${horizontalVertices.length / 3} vertices, ${horizontalIndices.length / 3} triangles`);
      }
    }
    
    // Vertical lines (blue)
    const verticalVertices = [];
    const verticalDistances = [];
    const verticalIndices = [];
    let verticalIndexOffset = 0;
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
        
        const verticesAdded = pushThickLineVertices(
          verticalVertices,
          verticalDistances,
          verticalIndices,
          verticalIndexOffset,
          'vertical',
          -yOffset,
          yOffset,
          localX,
          distanceFromCenter,
          thicknessStyle
        );
        verticalIndexOffset += verticesAdded;
      }
    }
    
    if (verticalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'majorVertical',
        verticalVertices,
        verticalDistances,
        verticalIndices,
        this.majorLinesGroup,
        this.majorVerticalMaterial
      );
      if (typeof window !== 'undefined' && window.earthring?.debug) {
        console.log(`[GridOverlay] Created majorVertical: ${verticalVertices.length / 3} vertices, ${verticalIndices.length / 3} triangles`);
      }
    }
  }

  generateMinorLines(worldX, worldY, radius, spacingOverride = null) {
    const spacing = spacingOverride ?? this.settings.minorSpacing;
    const steps = Math.ceil((radius + spacing) / spacing) + 2;
    
    // Horizontal lines
    const horizontalVertices = [];
    const horizontalDistances = [];
    const horizontalIndices = [];
    let horizontalIndexOffset = 0;
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
        
        const verticesAdded = pushThickLineVertices(
          horizontalVertices,
          horizontalDistances,
          horizontalIndices,
          horizontalIndexOffset,
          'horizontal',
          -xOffset,
          xOffset,
          localY,
          distanceFromCenter,
          thicknessStyle
        );
        horizontalIndexOffset += verticesAdded;
      }
    }
    
    if (horizontalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'minorHorizontal',
        horizontalVertices,
        horizontalDistances,
        horizontalIndices,
        this.minorLinesGroup,
        this.minorMaterial
      );
    }
    
    // Vertical lines
    const verticalVertices = [];
    const verticalDistances = [];
    const verticalIndices = [];
    let verticalIndexOffset = 0;
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
        
        const verticesAdded = pushThickLineVertices(
          verticalVertices,
          verticalDistances,
          verticalIndices,
          verticalIndexOffset,
          'vertical',
          -yOffset,
          yOffset,
          localX,
          distanceFromCenter,
          thicknessStyle
        );
        verticalIndexOffset += verticesAdded;
      }
    }
    
    if (verticalVertices.length > 0) {
      this.updateOrCreateGeometry(
        'minorVertical',
        verticalVertices,
        verticalDistances,
        verticalIndices,
        this.minorLinesGroup,
        this.minorMaterial
      );
    }
  }

  updateAxisLine(worldY, radius) {
    this.axisLinesGroup.clear();

    // The axis line is always at world Y=0
    // Calculate local Y offset: worldCoordinate = worldY + localY, so for worldCoordinate = 0, localY = -worldY
    const localY = -worldY;
    
    // Check if world Y=0 is within the visible radius
    const yAbs = Math.abs(localY);
    if (yAbs > radius) {
      // World Y=0 is outside the visible grid area, don't render the axis line
      return;
    }
    
    const xExtent = Math.sqrt(Math.max(radius * radius - localY * localY, 0));
    const vertices = [];
    const distances = [];
    const indices = [];
    const indexOffset = 0;

    pushThickLineVertices(
      vertices,
      distances,
      indices,
      indexOffset,
      'horizontal',
      -xExtent,
      xExtent,
      localY,
      yAbs, // Distance from center for fade calculation
      THICKNESS_STYLES.axis
    );

    if (!vertices.length) {
      return;
    }

    this.updateOrCreateGeometry(
      'axis',
      vertices,
      distances,
      indices,
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
    const indices = [];
    const indexOffset = 0;
    
    pushThickLineVertices(
      vertices,
      distances,
      indices,
      indexOffset,
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

    this.updateOrCreateGeometry(
      'axis',
      vertices,
      distances,
      indices,
      this.axisLinesGroup,
      this.axisMaterial
    );
  }

  updateFade() {
    // Update shader uniforms for fade effect (only if values changed)
    const fadeRadius = this.settings.radius * this.settings.fadeStart;
    const maxRadius = this.settings.radius;
    
    // Only update if values actually changed
    if (
      this.lastFadeValues.fadeRadius !== fadeRadius ||
      this.lastFadeValues.maxRadius !== maxRadius
    ) {
      this.majorHorizontalMaterial.uniforms.fadeRadius.value = fadeRadius;
      this.majorVerticalMaterial.uniforms.fadeRadius.value = fadeRadius;
      this.minorMaterial.uniforms.fadeRadius.value = fadeRadius;
      
      this.majorHorizontalMaterial.uniforms.maxRadius.value = maxRadius;
      this.majorVerticalMaterial.uniforms.maxRadius.value = maxRadius;
      this.minorMaterial.uniforms.maxRadius.value = maxRadius;
      
      this.lastFadeValues.fadeRadius = fadeRadius;
      this.lastFadeValues.maxRadius = maxRadius;
    }
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
   * All grid lines use Mesh with quads and shader materials for optimal performance
   */
  updateOrCreateGeometry(geometryKey, vertices, distances, indices, group, material) {
    let geometry = this.reusableGeometries[geometryKey];
    const vertexCount = vertices.length / 3;
    const indexCount = indices.length;
    
    if (geometry && geometry.attributes.position.count === vertexCount && 
        geometry.index && geometry.index.count === indexCount) {
      // Reuse existing geometry - just update the attributes
      const positionAttr = geometry.attributes.position;
      const distanceAttr = geometry.attributes.distanceFromCenter;
      const indexAttr = geometry.index;
      
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
      
      // Update index attribute
      if (indexAttr.array.length === indices.length) {
        indexAttr.array.set(indices);
        indexAttr.needsUpdate = true;
      } else {
        // Size changed, need to recreate index
        geometry.setIndex(indices);
      }
      
      // Recompute normals when geometry is updated
      geometry.computeVertexNormals();
    } else {
      // Create new geometry (or replace if size changed)
      if (geometry) {
        geometry.dispose();
      }
      
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('distanceFromCenter', new THREE.Float32BufferAttribute(distances, 1));
      geometry.setIndex(indices);
      
      // Compute normals for proper quad rendering
      geometry.computeVertexNormals();
      
      this.reusableGeometries[geometryKey] = geometry;
    }
    
    // Create or update mesh (all grid lines use Mesh with quads)
    let mesh = this.reusableMeshes[geometryKey];
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      this.reusableMeshes[geometryKey] = mesh;
    } else {
      // Update existing mesh with new geometry
      mesh.geometry = geometry;
      // Make sure it's in the group (in case it was removed)
      if (!group.children.includes(mesh)) {
        group.add(mesh);
      }
    }
    
    return mesh;
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
