/**
 * Chunk Manager
 * Handles chunk loading, caching, and basic visualization
 */

import { wsClient } from '../network/websocket-client.js';
import { positionToChunkIndex, toThreeJS, wrapRingPosition, fromThreeJS, normalizeRelativeToCamera, DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates-new.js';
import { 
  legacyPositionToRingPolar, 
  ringPolarToRingArc, 
  ringArcToChunkIndex,
  ringPolarToChunkIndex,
  ringArcToRingPolar,
  threeJSToRingArc,
  RING_CIRCUMFERENCE as NEW_RING_CIRCUMFERENCE,
  CHUNK_LENGTH,
  CHUNK_COUNT
} from '../utils/coordinates-new.js';
import { createMeshAtEarthRingPosition } from '../utils/rendering.js';
import { decompressChunkGeometry, isCompressedGeometry } from '../utils/decompression.js';
import * as THREE from 'three';

/**
 * Chunk Manager class
 * Manages chunk requests, caching, and rendering
 */
export class ChunkManager {
  constructor(sceneManager, gameStateManager, cameraController = null, zoneManager = null, structureManager = null) {
    this.sceneManager = sceneManager;
    this.gameStateManager = gameStateManager;
    this.cameraController = cameraController; // Store reference for position wrapping
    this.zoneManager = zoneManager; // Store reference to zone manager for zone cleanup
    this.structureManager = structureManager; // Store reference to structure manager for structure cleanup
    this.scene = sceneManager.getScene();
    
    // Map of chunk IDs to Three.js meshes
    this.chunkMeshes = new Map();
    
    // Track pending chunk requests to avoid duplicates
    this.pendingChunkRequests = new Set();
    
    // Track last camera position for re-rendering wrapped chunks
    this.lastCameraX = null;
    const WRAP_RE_RENDER_THRESHOLD = 5000; // Re-render if camera moved more than 5km (reduce z-fighting)
    
    // Streaming subscription state
    this.streamingSubscriptionID = null;
    this.useStreaming = true; // Enable server-driven streaming by default
    this.lastSubscriptionPosition = null; // Track last position we subscribed at
    this.lastSubscriptionFloor = null; // Track last floor we subscribed at
    this.subscriptionRadiusMeters = 5000; // Store subscription radius
    this.subscriptionWidthMeters = 5000; // Store subscription width
    
    // Shared platform material for all chunks (with grid overlay support)
    this.sharedPlatformMaterial = null;
    this.createSharedPlatformMaterial();
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
    
    // Listen to game state changes
    this.setupStateListeners();
    
    // Store re-render threshold
    this.WRAP_RE_RENDER_THRESHOLD = WRAP_RE_RENDER_THRESHOLD;
  }

  /**
   * Create shared platform shader material for all chunks with grid overlay support
   */
  createSharedPlatformMaterial() {
    const vertexShader = `
      attribute float chunkLocalX;
      attribute float chunkLocalZ;
      attribute float chunkBaseWorldX;
      
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vChunkLocalX;
      varying float vChunkLocalZ;
      varying float vChunkBaseWorldX;
      
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(normalMatrix * normal);
        
        // Pass chunk-local coordinates for grid calculations
        vChunkLocalX = chunkLocalX;
        vChunkLocalZ = chunkLocalZ;
        vChunkBaseWorldX = chunkBaseWorldX;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 uPlatformColor;
      uniform float uMetalness;
      uniform float uRoughness;
      
      // Grid overlay uniforms
      uniform bool uShowGrid;
      uniform float uGridMajorSpacing;  // 5m
      uniform float uGridMinorSpacing;  // 1m
      uniform vec3 uGridColorMajorH;    // Red for horizontal
      uniform vec3 uGridColorMajorV;    // Blue for vertical
      uniform vec3 uGridColorMinor;     // Gray for minor lines
      uniform float uGridLineWidth;     // Line width in meters
      uniform float uGridFadeRadius;    // Distance where fade starts
      uniform float uGridMaxRadius;     // Max distance for grid visibility
      uniform vec3 uCameraPosition;     // Camera position for fade calculation
      
      // Zone overlay uniforms
      // Reduced limits to fit within WebGL uniform limits (~1024 float components)
      uniform bool uShowZones;
      uniform float uZoneCount;               // Number of active zones
      uniform sampler2D uZoneMetaTex;         // RGBA: color.rgb, opacity.a
      uniform sampler2D uZoneInfoTex;         // RGBA: vertexCount (r), baseIndex (g), minX (b), maxX (a)
      uniform sampler2D uZoneBoundsTex;       // RGBA: minZ (r), maxZ (g), unused (b, a)
      uniform sampler2D uZoneVerticesTex;     // RGBA per vertex: x (r), z (g)
      uniform float uZoneMetaTexSize;         // width of meta/info textures (height=1)
      uniform float uZoneInfoTexSize;
      uniform float uZoneBoundsTexSize;
      uniform float uZoneVerticesTexSize;
      
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vChunkLocalX;
      varying float vChunkLocalZ;
      varying float vChunkBaseWorldX;
      
      // Helper function to handle mod with negative values correctly
      float safeMod(float x, float m) {
        return mod(mod(x, m) + m, m);
      }
      
      // Draw grid lines procedurally
      vec3 drawGrid(vec3 baseColor) {
        if (!uShowGrid) {
          return baseColor;
        }
        
        // Chunk-local grid calculation for precision
        // Each chunk is 1km long (0-1000m), so we work in small coordinate ranges
        // to avoid floating-point precision issues at large world coordinates.
        //
        // Strategy: Calculate grid position using chunk-local coordinates (small numbers)
        // and align with world grid using the chunk's base world X position
        
        float chunkLocalX = vChunkLocalX;  // Chunk-local X: 0-1000m (ring position within chunk)
        float chunkLocalZ = vChunkLocalZ;  // Chunk-local Z: radial offset (width) -200m to +200m
        
        // Calculate how the chunk's base world X aligns with the grid
        // This offset tells us where grid lines fall within this chunk
        float gridOffsetMajorX = safeMod(vChunkBaseWorldX, uGridMajorSpacing);
        float gridOffsetMinorX = safeMod(vChunkBaseWorldX, uGridMinorSpacing);
        float gridOffset20X = safeMod(vChunkBaseWorldX, 20.0);
        
        // Calculate grid position within the chunk by adding local position to offset
        // This gives us the position relative to the nearest grid line (in small number range)
        float majorXMod = safeMod(chunkLocalX + gridOffsetMajorX, uGridMajorSpacing);
        float minorXMod = safeMod(chunkLocalX + gridOffsetMinorX, uGridMinorSpacing);
        float multipleXMod = safeMod(chunkLocalX + gridOffset20X, 20.0);
        
        // For Z-axis (radial offset), grid is uniform - no offset needed
        float majorYMod = safeMod(chunkLocalZ, uGridMajorSpacing);
        float minorYMod = safeMod(chunkLocalZ, uGridMinorSpacing);
        float multipleYMod = safeMod(chunkLocalZ, 20.0);
        
        // Check if we're near a grid line
        // Need to check both near 0 and near spacing value (wrapping)
        float halfLineWidth = uGridLineWidth * 0.5;
        float halfMinorLineWidth = halfLineWidth * 0.5; // Minor lines are half as thick
        
        // Distance from nearest grid line (handles wrapping)
        float distMajorX = min(majorXMod, uGridMajorSpacing - majorXMod);
        float distMajorY = min(majorYMod, uGridMajorSpacing - majorYMod);
        float distMinorX = min(minorXMod, uGridMinorSpacing - minorXMod);
        float distMinorY = min(minorYMod, uGridMinorSpacing - minorYMod);
        
        // Check if on grid lines
        // Horizontal lines (east-west): constant Y (radial offset), varying X (arc length)
        // Vertical lines (north-south): constant X (arc length), varying Y (radial offset)
        bool onMajorH = distMajorY < halfLineWidth;  // Horizontal: constant Y = red
        bool onMajorV = distMajorX < halfLineWidth;  // Vertical: constant X = blue
        bool onMinorH = distMinorY < halfMinorLineWidth && !onMajorH;
        bool onMinorV = distMinorX < halfMinorLineWidth && !onMajorV;
        
        // Special case: Y=0 axis (station spine) - always red, thicker
        bool onAxisY = abs(chunkLocalZ) < halfLineWidth * 2.0;
        
        // Distance from 20m grid lines
        float distMultipleX = min(multipleXMod, 20.0 - multipleXMod);
        float distMultipleY = min(multipleYMod, 20.0 - multipleYMod);
        bool onMultiple20H = distMultipleY < halfLineWidth * 1.5 && !onAxisY;  // Horizontal 20m lines
        bool onMultiple20V = distMultipleX < halfLineWidth * 1.5;  // Vertical 20m lines
        
        vec3 gridColor = baseColor;
        
        // Draw grid lines uniformly (no fade) - priority order matters
        // ALL red lines = horizontal (east-west) = constant Y (radial offset)
        // ALL blue lines = vertical (north-south) = constant X (arc length)
        if (onAxisY) {
          // Station spine (Y=0) - thickest, always red (east-west)
          gridColor = mix(baseColor, uGridColorMajorH, 0.95);
        } else if (onMultiple20H) {
          // 20m horizontal multiples (east-west) - red
          gridColor = mix(baseColor, uGridColorMajorH, 0.9);
        } else if (onMultiple20V) {
          // 20m vertical multiples (north-south) - blue
          gridColor = mix(baseColor, uGridColorMajorV, 0.9);
        } else if (onMajorH) {
          // Major horizontal grid lines (5m, east-west) - red
          gridColor = mix(baseColor, uGridColorMajorH, 0.95);
        } else if (onMajorV) {
          // Major vertical grid lines (5m, north-south) - blue
          gridColor = mix(baseColor, uGridColorMajorV, 0.95);
        } else if (onMinorH || onMinorV) {
          // Minor grid lines (1m) - thinner and more contrasty
          gridColor = mix(baseColor, uGridColorMinor, 0.775);
        }
        
        return gridColor;
      }
      
      void main() {
        // Base platform color with PBR properties
        vec3 color = uPlatformColor;
        
        // Apply grid overlay
        color = drawGrid(color);
        
        // Zone overlay: Render zones using point-in-polygon test
        if (uShowZones && uZoneCount > 0.0) {
          // OPTIMIZATION: Snap fragment position to nearest 1m grid cell centerpoint
          // This samples one point per minor grid cell (1m) instead of per-pixel sampling.
          // Many fragments will map to the same grid cell center, effectively reducing
          // point-in-polygon tests from thousands per chunk to one per 1m grid cell.
          // Note: The GPU still executes the shader per fragment, but all fragments
          // within the same 1m grid cell will use the same sampled position.
          float gridCellSize = uGridMinorSpacing; // 1m grid cells
          vec2 fragPosWorld = vec2(vWorldPosition.x, vWorldPosition.z);
          vec2 fragPos = floor(fragPosWorld / gridCellSize) * gridCellSize + gridCellSize * 0.5;
          
          // Test if fragment is inside any zone polygon
          vec3 zoneColor = vec3(0.0);
          float zoneOpacity = 0.0;
          float metaSize = uZoneMetaTexSize;
          float infoSize = uZoneInfoTexSize;
          float vertSize = uZoneVerticesTexSize;
          if (metaSize > 0.0 && infoSize > 0.0 && vertSize > 0.0) {
            // Limit to checking first 128 zones per fragment for performance
            // Most fragments will only match 0-1 zones anyway
            int maxZonesToCheck = min(int(uZoneCount), 128);
            for (int i = 0; i < 128; i++) {
              if (i >= maxZonesToCheck) break;
              
              // Sample meta (color, opacity)
              float uMeta = (float(i) + 0.5) / metaSize;
              vec4 meta = texture2D(uZoneMetaTex, vec2(uMeta, 0.5));
              vec3 zColor = meta.rgb;
              float zOpacityRaw = meta.a;
              
              // Check if this zone uses gradient (opacity > 1.0 is a flag)
              bool useGradient = zOpacityRaw > 1.0;
              float zOpacity = useGradient ? zOpacityRaw - 1.0 : zOpacityRaw;
              
              // Generate rainbow gradient for mixed-use zones
              if (useGradient) {
                // Create rainbow gradient based on fragment position
                // Use a combination of X and Z to create a diagonal gradient pattern
                float gradientPos = mod(fragPos.x * 0.01 + fragPos.y * 0.01, 1.0);
                // Convert to hue (0-1 maps to 0-360 degrees)
                float hue = gradientPos * 6.0; // 0-6 for full rainbow cycle
                float r = abs(hue - 3.0) - 1.0;
                float g = 2.0 - abs(hue - 2.0);
                float b = 2.0 - abs(hue - 4.0);
                r = clamp(r, 0.0, 1.0);
                g = clamp(g, 0.0, 1.0);
                b = clamp(b, 0.0, 1.0);
                zColor = vec3(r, g, b);
              }

              // Sample info (vertexCount, baseIndex, minX, maxX)
              float uInfo = (float(i) + 0.5) / infoSize;
              vec4 info = texture2D(uZoneInfoTex, vec2(uInfo, 0.5));
              float vCount = info.r;
              float baseIndex = info.g;
              float minX = info.b;
              float maxX = info.a;
              
              if (vCount < 3.0) {
                continue;
              }
              
              // Quick bounding box check - skip expensive point-in-polygon if fragment is outside bounds
              if (fragPos.x < minX || fragPos.x > maxX) {
                continue;
              }
              
              // Sample bounds (minZ, maxZ) - early exit if bounds texture not available
              if (uZoneBoundsTexSize > 0.0) {
                float uBounds = (float(i) + 0.5) / uZoneBoundsTexSize;
                vec4 boundsData = texture2D(uZoneBoundsTex, vec2(uBounds, 0.5));
                float minZ = boundsData.r;
                float maxZ = boundsData.g;
                
                // Quick Z-axis bounding box check
                if (fragPos.y < minZ || fragPos.y > maxZ) {
                  continue;
                }
              }
              
              // Fragment passed bounding box check - do expensive point-in-polygon test
              // Point-in-polygon test using ray casting
              bool inside = false;
              for (int j = 0; j < 128; j++) { // up to MAX_VERTICES_PER_ZONE
                if (float(j) >= vCount) break;
                float idx1 = baseIndex + float(j);
                float idx2 = baseIndex + float(mod(float(j + 1), vCount));
                
                float uV1 = (idx1 + 0.5) / vertSize;
                float uV2 = (idx2 + 0.5) / vertSize;
                vec4 v1s = texture2D(uZoneVerticesTex, vec2(uV1, 0.5));
                vec4 v2s = texture2D(uZoneVerticesTex, vec2(uV2, 0.5));
                vec2 v1 = vec2(v1s.r, v1s.g);
                vec2 v2 = vec2(v2s.r, v2s.g);

                float dy = v2.y - v1.y;
                if (abs(dy) > 0.0001) {
                  float t = (fragPos.y - v1.y) / dy;
                  float intersectX = v1.x + t * (v2.x - v1.x);
                  if (((v1.y > fragPos.y) != (v2.y > fragPos.y)) && (fragPos.x < intersectX)) {
                    inside = !inside;
                  }
                }
              }
              
              if (inside) {
                zoneColor = zColor;
                zoneOpacity = zOpacity;
                break; // take first matching zone
              }
            }
          }
          
          // Apply zone color if fragment is inside a zone
          if (zoneOpacity > 0.0) {
            color = mix(color, zoneColor, zoneOpacity);
          }
        }
        
        // Simple PBR-like lighting (can be enhanced later)
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        float NdotL = max(dot(vWorldNormal, lightDir), 0.0);
        // Brighter lighting: increased ambient from 0.3 to 0.5, diffuse from 0.7 to 0.8
        vec3 diffuse = color * (0.5 + 0.8 * NdotL); // Ambient + diffuse
        
        gl_FragColor = vec4(diffuse, 1.0);
      }
    `;

    // Get current camera position for initial uniform value
    const camera = this.sceneManager?.getCamera();
    const initialCameraPos = camera ? camera.position : new THREE.Vector3(0, 0, 0);

    this.sharedPlatformMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPlatformColor: { value: new THREE.Color(0x999999) }, // Brighter gray (was 0x666666)
        uMetalness: { value: 0.1 },
        uRoughness: { value: 0.8 },
        
        // Grid overlay uniforms
        uShowGrid: { value: true },
        uGridMajorSpacing: { value: 5.0 },
        uGridMinorSpacing: { value: 1.0 },
        uGridColorMajorH: { value: new THREE.Color(0xff2d2d) }, // Red
        uGridColorMajorV: { value: new THREE.Color(0x0088ff) }, // Blue (brighter for better contrast)
        uGridColorMinor: { value: new THREE.Color(0xb2b2b2) },  // Medium-light gray (halfway between old and bright)
        uGridLineWidth: { value: 0.2 }, // 20cm line width (increased for visibility)
        uGridFadeRadius: { value: 200.0 }, // Start fading at 200m
        uGridMaxRadius: { value: 250.0 },  // Fully faded at 250m
        uCameraPosition: { value: initialCameraPos },
        
        // Zone overlay uniforms via data textures
        uShowZones: { value: true },
        uZoneCount: { value: 0.0 },
        uZoneMetaTex: { value: null },
        uZoneInfoTex: { value: null },
        uZoneBoundsTex: { value: null },
        uZoneVerticesTex: { value: null },
        uZoneMetaTexSize: { value: 1.0 },
        uZoneInfoTexSize: { value: 1.0 },
        uZoneBoundsTexSize: { value: 1.0 },
        uZoneVerticesTexSize: { value: 1.0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 1,
      depthWrite: true,
      depthTest: true,
    });
  }

  /**
   * Update camera position uniform for grid fade calculation
   */
  updateCameraPosition() {
    if (!this.sharedPlatformMaterial) return;
    
    const camera = this.sceneManager?.getCamera();
    if (camera && this.sharedPlatformMaterial.uniforms.uCameraPosition) {
      this.sharedPlatformMaterial.uniforms.uCameraPosition.value.copy(camera.position);
    }
  }

  /**
   * Set grid visibility
   * @param {boolean} visible - Whether grid should be visible
   */
  setGridVisible(visible) {
    if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowGrid) {
      this.sharedPlatformMaterial.uniforms.uShowGrid.value = visible;
    }
  }

  /**
   * Set zones visibility
   * @param {boolean} visible - Whether zones should be visible
   */
  setZonesVisible(visible) {
    if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones) {
      this.sharedPlatformMaterial.uniforms.uShowZones.value = visible;
      // Update zone data when visibility changes
      if (visible) {
        this.updateZoneShaderData();
      }
    }
  }

  /**
   * Collect active zones from gameState and update shader uniforms
   * Limits to zones on current floor and within reasonable bounds
   */
  updateZoneShaderData() {
    if (!this.sharedPlatformMaterial || !this.gameStateManager) {
      return;
    }

    const activeFloor = this.gameStateManager.getActiveFloor();
    const allZones = this.gameStateManager.getAllZones();
    const cameraX = this.getCurrentCameraX();
    
    // Filter zones by active floor and zone type visibility
    const activeZones = allZones.filter(zone => {
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

    // Get visible chunk IDs and their approximate X ranges
    const visibleChunkRanges = [];
    this.chunkMeshes.forEach((mesh, chunkID) => {
      const chunkData = this.gameStateManager.getChunk(chunkID);
      if (chunkData && chunkData.geometry) {
        // Get chunk's X range from its geometry
        const vertices = chunkData.geometry.vertices || [];
        if (vertices.length > 0) {
          const xCoords = vertices.map(v => v[0] || 0);
          const minX = Math.min(...xCoords);
          const maxX = Math.max(...xCoords);
          visibleChunkRanges.push({ chunkID, minX, maxX });
        }
      }
    });

    // Filter zones to only those that overlap with visible chunks
    // A zone overlaps if any of its vertices are within a visible chunk's X range
    const zonesInVisibleChunks = activeZones.filter(zone => {
      try {
        const outer = zone.geometry?.coordinates?.[0];
        if (!outer || outer.length === 0) return false;
        
        // Check if any zone vertex is within any visible chunk's range
        for (const [x] of outer) {
          const wrappedX = normalizeRelativeToCamera(x, cameraX);
          for (const range of visibleChunkRanges) {
            const wrappedMinX = normalizeRelativeToCamera(range.minX, cameraX);
            const wrappedMaxX = normalizeRelativeToCamera(range.maxX, cameraX);
            // Handle wrapping: check if wrappedX is between wrappedMinX and wrappedMaxX
            // Account for potential wrapping by checking both direct and wrapped ranges
            if ((wrappedX >= wrappedMinX && wrappedX <= wrappedMaxX) ||
                (wrappedMinX > wrappedMaxX && (wrappedX >= wrappedMinX || wrappedX <= wrappedMaxX))) {
              return true;
            }
          }
        }
        return false;
      } catch (e) {
        return false;
      }
    });

    // Use all zones in visible chunks (up to texture limit of 256)
    const MAX_ZONES = 256; // Full texture capacity
    const zonesToRender = zonesInVisibleChunks.slice(0, MAX_ZONES);

    if (zonesToRender.length === 0 && activeZones.length > 0 && window.earthring?.debug) {
      console.warn(`[ChunkManager] WARNING: ${activeZones.length} active zones found but none selected for rendering`);
    }

    // Convert zones to texture-friendly format
    const zoneData = this.convertZonesToShaderFormat(zonesToRender);
    
    // Update shader uniforms and data textures
    this.updateZoneTextures(zoneData);
  }

  /**
   * Convert zone data to shader-friendly format
   * @param {Array} zones - Array of zone objects
   * @returns {Object} Shader data format
   */
  convertZonesToShaderFormat(zones) {
    const MAX_ZONES = 256;
    const MAX_VERTICES_PER_ZONE = 64;
    const MAX_TOTAL_VERTICES = 8192; // safety cap
    
    const meta = [];   // color rgb, opacity
    const info = [];   // vertexCount, baseIndex, minX, maxX
    const bounds = []; // minZ, maxZ (per zone)
    const verts = [];  // x, z
    let vertexCursor = 0;

    const cameraX = this.getCurrentCameraX();
    const camera = this.sceneManager?.getCamera();
    const cameraThreeJSPos = camera ? camera.position : new THREE.Vector3(cameraX, 0, 0);
    const RING_CIRCUMFERENCE = 264000000;
    const halfCirc = RING_CIRCUMFERENCE / 2;

    for (const zone of zones) {
      if (!zone.geometry || zone.geometry.type !== 'Polygon') continue;
      const coordinates = zone.geometry.coordinates;
      if (!coordinates || !coordinates[0] || coordinates[0].length < 3) continue;

      // Style - lighter, brighter, more transparent colors
      const ZONE_STYLES = {
        residential: { fill: 'rgba(150,230,180,0.25)', stroke: 'rgba(111,207,151,0.95)' },
        commercial: { fill: 'rgba(120,220,255,0.25)', stroke: 'rgba(86,204,242,0.95)' },
        industrial: { fill: 'rgba(255,230,120,0.3)', stroke: 'rgba(242,201,76,0.95)' },
        'mixed-use': { fill: 'rgba(255,214,102,0.3)', stroke: 'rgba(255,159,67,0.95)', gradient: true }, // Special: rainbow gradient
        mixed_use: { fill: 'rgba(255,214,102,0.3)', stroke: 'rgba(255,159,67,0.95)', gradient: true }, // Special: rainbow gradient
        park: { fill: 'rgba(100,220,140,0.2)', stroke: 'rgba(46,204,113,0.95)' },
        agricultural: { fill: 'rgba(200,150,100,0.3)', stroke: 'rgba(139,69,19,0.95)' },
        restricted: { fill: 'rgba(255,120,120,0.3)', stroke: 'rgba(192,57,43,0.95)' },
        dezone: { fill: 'rgba(180,140,100,0.2)', stroke: 'rgba(139,69,19,0.8)' },
        default: { fill: 'rgba(255,255,255,0.15)', stroke: 'rgba(255,255,255,0.9)' },
      };
      const styleKey = zone.zone_type?.toLowerCase() === 'mixed_use' ? 'mixed-use' : zone.zone_type?.toLowerCase();
      const style = ZONE_STYLES[styleKey] || ZONE_STYLES.default || { fill: 'rgba(255,255,255,0.2)' };
      const fillRgbMatch = style.fill.match(/rgba?\(([\d.]+),([\d.]+),([\d.]+)/);
      const fillOpacityMatch = style.fill.match(/[\d.]+\)$/);
      const fillOpacity = fillOpacityMatch ? parseFloat(fillOpacityMatch[0].slice(0, -1)) : 0.35;
      const fillColor = fillRgbMatch
        ? new THREE.Color(
            parseFloat(fillRgbMatch[1]) / 255,
            parseFloat(fillRgbMatch[2]) / 255,
            parseFloat(fillRgbMatch[3]) / 255
          )
        : new THREE.Color(1, 1, 1);

      const outerRing = coordinates[0].slice(0, MAX_VERTICES_PER_ZONE);
      const vertexCount = outerRing.length;
      if (vertexCount < 3) continue;

      if (vertexCursor + vertexCount > MAX_TOTAL_VERTICES) {
        if (window.earthring?.debug) {
          console.warn(`[ChunkManager] Zone vertex cap reached (${MAX_TOTAL_VERTICES}); remaining zones skipped`);
        }
        break;
      }

      // Base index for this zone
      const baseIndex = vertexCursor;

      // Convert vertices and compute bounding box
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      const zoneVertices = [];

      for (let i = 0; i < outerRing.length; i++) {
        const [x, y] = outerRing[i];
        const wrappedX = normalizeRelativeToCamera(x, cameraX);
        let threeJSPos = toThreeJS({ x: wrappedX, y: y, z: zone.floor ?? 0 }, DEFAULT_FLOOR_HEIGHT);
        const deltaX = threeJSPos.x - cameraThreeJSPos.x;
        let wrappedDeltaX = deltaX;
        if (wrappedDeltaX > halfCirc) wrappedDeltaX -= RING_CIRCUMFERENCE;
        else if (wrappedDeltaX < -halfCirc) wrappedDeltaX += RING_CIRCUMFERENCE;
        threeJSPos.x = cameraThreeJSPos.x + wrappedDeltaX;

        // Track bounding box
        minX = Math.min(minX, threeJSPos.x);
        maxX = Math.max(maxX, threeJSPos.x);
        minZ = Math.min(minZ, threeJSPos.z);
        maxZ = Math.max(maxZ, threeJSPos.z);

        zoneVertices.push(threeJSPos.x, threeJSPos.z);
      }

      // Add vertices to array (pad to RGBA per texel)
      for (let i = 0; i < zoneVertices.length; i += 2) {
        verts.push(zoneVertices[i], zoneVertices[i + 1], 0, 0);
        vertexCursor += 1;
      }

      // Meta, info, and bounds
      // For mixed-use zones, store a flag in the alpha channel (opacity > 1.0 means use gradient)
      const useGradient = style.gradient === true;
      const metaOpacity = useGradient ? fillOpacity + 1.0 : fillOpacity; // Flag: opacity > 1.0 = gradient
      meta.push(fillColor.r, fillColor.g, fillColor.b, metaOpacity);
      info.push(vertexCount, baseIndex, minX, maxX);
      bounds.push(minZ, maxZ, 0, 0); // pad to RGBA

      if (meta.length / 4 >= MAX_ZONES) {
        if (window.earthring?.debug) {
          console.warn(`[ChunkManager] Zone count cap reached (${MAX_ZONES}); remaining zones skipped`);
        }
        break;
      }
    }

    return {
      zoneCount: meta.length / 4,
      meta: new Float32Array(meta.length > 0 ? meta : [0, 0, 0, 0]),
      info: new Float32Array(info.length > 0 ? info : [0, 0, 0, 0]),
      bounds: new Float32Array(bounds.length > 0 ? bounds : [0, 0, 0, 0]),
      vertices: new Float32Array(verts.length > 0 ? verts : [0, 0, 0, 0]),
      vertexCount: vertexCursor,
    };
  }

  /**
   * Create or update data textures for zone data and assign to uniforms
   */
  updateZoneTextures(zoneData) {
    if (!this.sharedPlatformMaterial) return;

    const makeTex = (dataArray, width) => {
      const tex = new THREE.DataTexture(
        dataArray,
        width,
        1,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      tex.needsUpdate = true;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.flipY = false;
      return tex;
    };

    const metaLen = zoneData.meta.length / 4;
    const infoLen = zoneData.info.length / 4;
    const boundsLen = zoneData.bounds.length / 4;
    const vertLen = zoneData.vertices.length / 4;

    const metaTex = makeTex(zoneData.meta, Math.max(1, metaLen));
    const infoTex = makeTex(zoneData.info, Math.max(1, infoLen));
    const boundsTex = makeTex(zoneData.bounds, Math.max(1, boundsLen));
    const vertTex = makeTex(zoneData.vertices, Math.max(1, vertLen));

    this.sharedPlatformMaterial.uniforms.uZoneCount.value = zoneData.zoneCount;
    this.sharedPlatformMaterial.uniforms.uZoneMetaTex.value = metaTex;
    this.sharedPlatformMaterial.uniforms.uZoneInfoTex.value = infoTex;
    this.sharedPlatformMaterial.uniforms.uZoneBoundsTex.value = boundsTex;
    this.sharedPlatformMaterial.uniforms.uZoneVerticesTex.value = vertTex;
    this.sharedPlatformMaterial.uniforms.uZoneMetaTexSize.value = Math.max(1, metaLen);
    this.sharedPlatformMaterial.uniforms.uZoneInfoTexSize.value = Math.max(1, infoLen);
    this.sharedPlatformMaterial.uniforms.uZoneBoundsTexSize.value = Math.max(1, boundsLen);
    this.sharedPlatformMaterial.uniforms.uZoneVerticesTexSize.value = Math.max(1, vertLen);
  }

  /**
   * Get the current camera X position in EarthRing coordinates.
   * Returns RAW (unwrapped) position for correct chunk rendering.
   * Falls back to the Three.js camera if the controller isn't available.
   * @returns {number} Raw camera X position (may be negative or > RING_CIRCUMFERENCE)
   */
  getCurrentCameraX() {
    // Always get raw position from Three.js camera directly to avoid wrapping
    // Wrapping breaks chunk rendering when camera is at negative positions
    const camera = this.sceneManager?.getCamera ? this.sceneManager.getCamera() : null;
    if (camera) {
      // Three.js X coordinate directly maps to arc length s in RingArc coordinates
      // Since arc length s maps 1:1 to legacy X coordinate, we can return it directly
      // This preserves both negative values and large positive values without wrapping
      return camera.position.x;
    }
    // Fallback: try camera controller but note it wraps the value
    if (this.cameraController?.getEarthRingPosition) {
      const pos = this.cameraController.getEarthRingPosition();
      if (pos && typeof pos.x === 'number') {
        // This is wrapped, but better than nothing
        console.warn('[Chunks] Using wrapped camera position from controller (may cause rendering issues)');
        return pos.x;
      }
    }
    return 0;
  }

  /**
   * Calculate wrapped ring distance between two X positions.
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  getWrappedRingDistance(a, b) {
    const direct = Math.abs(a - b);
    return Math.min(direct, NEW_RING_CIRCUMFERENCE - direct);
  }
  
  /**
   * Set up WebSocket message handlers for chunk data
   */
  setupWebSocketHandlers() {
    // Handle stream_delta messages (server-driven streaming)
    wsClient.on('stream_delta', (data) => {
      // Skip chunk updates during teleport to prevent flickering
      if (this.cameraController?.isTeleporting) {
        return;
      }
      
      // stream_delta can contain chunks, zones, or both
      if (data.chunks && Array.isArray(data.chunks)) {
        this.handleChunkData({ chunks: data.chunks });
      }
      // Also check for chunk_delta structure (for removed chunks)
      if (data.chunk_delta) {
        const delta = data.chunk_delta;
        const removed = delta.RemovedChunks || [];
        if (removed.length > 0) {
          removed.forEach(chunkID => {
            this.removeChunkMesh(chunkID);
            this.gameStateManager.removeChunk(chunkID);
          });
        }
      }
    });
    
    // Handle stream_pose_ack messages (pose update acknowledgments)
    // Note: This is also handled in updateStreamingPose via request/response,
    // but we keep this handler for any async acknowledgments
    wsClient.on('stream_pose_ack', (data) => {
      // Skip chunk updates during teleport to prevent flickering
      if (this.cameraController?.isTeleporting) {
        return;
      }
      
      // Handle chunk delta if provided (removed chunks need to be cleaned up)
      if (data.chunk_delta) {
        const delta = data.chunk_delta;
        // Go struct fields are capitalized (RemovedChunks)
        const removed = delta.RemovedChunks || [];
        if (removed.length > 0) {
          removed.forEach(chunkID => {
            this.removeChunkMesh(chunkID);
            this.gameStateManager.removeChunk(chunkID);
          });
        }
      }
    });
    
    // Handle stream_ack messages (subscription confirmation)
    wsClient.on('stream_ack', (data) => {
      // Subscription confirmed (no logging needed)
    });
    
    // Handle error messages
    wsClient.on('error', (data) => {
      console.error('Chunk request error:', data);
    });
  }
  
  /**
   * Set up game state listeners
   */
  setupStateListeners() {
    // When a chunk is added to state, render it (if it matches active floor)
    this.gameStateManager.on('chunkAdded', ({ chunkID, chunkData }) => {
      // Extract and handle zones from chunk before rendering
      this.extractZonesFromChunk(chunkID, chunkData);
      
      // Extract and handle structures from chunk before rendering
      this.extractStructuresFromChunk(chunkID, chunkData);
      this.renderChunk(chunkID, chunkData);
      
      // Update zone shader data when zones are added
      // Use setTimeout to ensure zones are in gameState by the time we update
      setTimeout(() => {
        if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones?.value) {
          this.updateZoneShaderData();
        }
      }, 0);
    });
    
    // Listen for zone events to update shader data
    this.gameStateManager.on('zoneAdded', () => {
      if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones?.value) {
        this.updateZoneShaderData();
      }
    });
    
    this.gameStateManager.on('zoneUpdated', () => {
      if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones?.value) {
        this.updateZoneShaderData();
      }
    });
    
    this.gameStateManager.on('zoneRemoved', () => {
      if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones?.value) {
        this.updateZoneShaderData();
      }
    });
    
    // When a chunk is removed from state, remove its mesh and zones
    this.gameStateManager.on('chunkRemoved', ({ chunkID }) => {
      this.removeChunkMesh(chunkID);
      // Clean up zones for this chunk
      if (this.zoneManager) {
        this.zoneManager.cleanupZonesForChunk(chunkID);
      }
      
      // Clean up structures for this chunk
      if (this.structureManager) {
        this.structureManager.cleanupStructuresForChunk(chunkID);
      }
      
      // Update zone shader data after cleanup
      if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones?.value) {
        this.updateZoneShaderData();
      }
    });
    
    // When active floor changes, clear chunks from other floors and reload for new floor
    this.gameStateManager.on('activeFloorChanged', ({ newFloor }) => {
      // Remove all chunk meshes that don't match the new floor
      const chunksToRemove = [];
      this.chunkMeshes.forEach((mesh, chunkID) => {
        const chunkFloor = this.getFloorFromChunkID(chunkID);
        if (chunkFloor !== newFloor) {
          chunksToRemove.push(chunkID);
        }
      });
      chunksToRemove.forEach(chunkID => {
        this.removeChunkMesh(chunkID);
        this.gameStateManager.removeChunk(chunkID);
      });
      
      // Reload chunks for the new floor
      if (this.cameraController) {
        const cameraPos = this.cameraController.getEarthRingPosition();
        this.requestChunksAtPosition(cameraPos.x, newFloor, 4, 'medium')
          .catch(error => {
            console.error('[Chunks] Failed to load chunks for new floor:', error);
          });
      }
      
      // Update zone shader data for new floor
      if (this.sharedPlatformMaterial && this.sharedPlatformMaterial.uniforms.uShowZones?.value) {
        this.updateZoneShaderData();
      }
    });
  }
  
  /**
   * Extract floor number from chunk ID (format: "floor_chunk_index")
   * @param {string} chunkID - Chunk ID
   * @returns {number} Floor number
   */
  getFloorFromChunkID(chunkID) {
    const parts = chunkID.split('_');
    if (parts.length >= 2) {
      const floor = parseInt(parts[0], 10);
      return isNaN(floor) ? 0 : floor;
    }
    return 0;
  }
  
  /**
   * Update streaming subscription pose (sends stream_update_pose)
   * @param {number} ringPosition - Ring position in meters
   * @param {number} floor - Floor number (active floor)
   * @returns {Promise<void>} Promise that resolves when pose is updated
   */
  async updateStreamingPose(ringPosition, floor) {
    if (!wsClient.isConnected()) {
      throw new Error('WebSocket is not connected');
    }

    if (!this.streamingSubscriptionID) {
      throw new Error('No active subscription to update');
    }

    const cameraPos = this.cameraController?.getEarthRingPosition?.() || { x: ringPosition, y: 0, z: floor };
    const elevation = cameraPos.y || 0;
    const widthOffset = cameraPos.y || 0; // Y offset in EarthRing coordinates

    // Convert legacy position to RingArc coordinates
    // Use RAW position (not wrapped) to preserve sign information for negative positions
    // This ensures correct chunk calculation at ring boundaries
    const polar = legacyPositionToRingPolar(ringPosition, widthOffset, 0); // z=0 for pose, floor is separate
    const arc = ringPolarToRingArc(polar);
    
    // Wrap for legacy coordinate (backward compatibility)
    const wrappedRingPosition = ((Math.round(ringPosition) % NEW_RING_CIRCUMFERENCE) + NEW_RING_CIRCUMFERENCE) % NEW_RING_CIRCUMFERENCE;

    try {
      const response = await wsClient.request('stream_update_pose', {
        subscription_id: this.streamingSubscriptionID,
        pose: {
          // Send both legacy and new coordinates for backward compatibility
          ring_position: wrappedRingPosition, // Legacy (for backward compatibility)
          arc_length: arc.s, // New coordinate system (preferred)
          theta: polar.theta, // New coordinate system (alternative)
          r: polar.r, // Radial offset
          z: polar.z, // Vertical offset
          width_offset: widthOffset, // Legacy (for backward compatibility)
          elevation: elevation,
          active_floor: floor,
        },
      });

      // Update stored position
      this.lastSubscriptionPosition = wrappedRingPosition;
      
      // Handle chunk delta if provided
      if (response.chunk_delta) {
        const delta = response.chunk_delta;
        // Go struct fields are capitalized (AddedChunks, RemovedChunks)
        const added = delta.AddedChunks || [];
        const removed = delta.RemovedChunks || [];
        
        // Handle removed chunks immediately
        if (removed.length > 0) {
          removed.forEach(chunkID => {
            this.removeChunkMesh(chunkID);
            this.gameStateManager.removeChunk(chunkID);
          });
        }
        
        // Added chunks will be sent via stream_delta messages asynchronously
      }
    } catch (error) {
      console.error('[Chunks] Failed to update streaming pose:', error);
      throw error;
    }
  }

  /**
   * Subscribe to server-driven streaming for chunks and zones
   * @param {number} ringPosition - Ring position in meters
   * @param {number} floor - Floor number (active floor)
   * @param {number} radiusMeters - Radius in meters to include (default: 5000m = 5km)
   * @param {number} widthMeters - Width slice in meters (default: 5000m)
   * @returns {Promise<string>} Promise that resolves with subscription ID
   */
  async subscribeToStreaming(ringPosition, floor, radiusMeters = 5000, widthMeters = 5000) {
    if (!wsClient.isConnected()) {
      throw new Error('WebSocket is not connected');
    }

    const cameraPos = this.cameraController?.getEarthRingPosition?.() || { x: ringPosition, y: 0, z: floor };
    const elevation = cameraPos.y || 0;
    const widthOffset = cameraPos.y || 0; // Y offset in EarthRing coordinates

    // Convert legacy position to RingArc coordinates
    // Use RAW position (not wrapped) to preserve sign information for negative positions
    // This ensures correct chunk calculation at ring boundaries
    const polar = legacyPositionToRingPolar(ringPosition, widthOffset, 0); // z=0 for pose, floor is separate
    const arc = ringPolarToRingArc(polar);
    
    // Wrap for legacy coordinate (backward compatibility)
    const wrappedRingPosition = ((Math.round(ringPosition) % NEW_RING_CIRCUMFERENCE) + NEW_RING_CIRCUMFERENCE) % NEW_RING_CIRCUMFERENCE;

    try {
      const response = await wsClient.request('stream_subscribe', {
        pose: {
          // Send both legacy and new coordinates for backward compatibility
          ring_position: wrappedRingPosition, // Legacy (for backward compatibility)
          arc_length: arc.s, // New coordinate system (preferred)
          theta: polar.theta, // New coordinate system (alternative)
          r: polar.r, // Radial offset
          z: polar.z, // Vertical offset
          width_offset: widthOffset, // Legacy (for backward compatibility)
          elevation: elevation,
          active_floor: floor,
        },
        radius_meters: radiusMeters,
        width_meters: widthMeters,
        include_chunks: true,
        include_zones: true, // Include zones for ZoneManager to consume
      });

      this.streamingSubscriptionID = response.subscription_id;
      // Store wrapped position for consistent distance calculations
      this.lastSubscriptionPosition = wrappedRingPosition;
      this.subscriptionRadiusMeters = radiusMeters;
      this.subscriptionWidthMeters = widthMeters;
      return response.subscription_id;
    } catch (error) {
      console.error('[Chunks] Failed to subscribe to streaming:', error);
      throw error;
    }
  }

  /**
   * Request chunks based on ring position
   * Uses streaming subscription (server-driven streaming is required)
   * @param {number} ringPosition - Ring position in meters
   * @param {number} floor - Floor number
   * @param {number} radius - Number of chunks to load on each side (default: 1)
   * @param {string|number} lodLevel - Level of detail: "low", "medium", "high" or 0-3 (default: "medium")
   * @returns {Promise} Promise that resolves when request is sent
   */
  async requestChunksAtPosition(ringPosition, floor, radius = 1, lodLevel = 'medium') {
    // If streaming is enabled and we have a subscription, update subscription if camera moved significantly
    if (this.useStreaming && this.streamingSubscriptionID) {
      // Check if camera has moved significantly (more than 1000m, different chunk, or different floor)
      let distanceMoved = 0;
      let chunkChanged = false;
      
      if (this.lastSubscriptionPosition !== null) {
        // Wrap both positions for consistent distance calculation
        const wrappedCurrent = ((Math.round(ringPosition) % NEW_RING_CIRCUMFERENCE) + NEW_RING_CIRCUMFERENCE) % NEW_RING_CIRCUMFERENCE;
        const wrappedLast = ((Math.round(this.lastSubscriptionPosition) % NEW_RING_CIRCUMFERENCE) + NEW_RING_CIRCUMFERENCE) % NEW_RING_CIRCUMFERENCE;
        
        // Calculate wrapped distance (handles both positive and negative movement)
        const directDistance = Math.abs(wrappedCurrent - wrappedLast);
        const wrappedDistance = NEW_RING_CIRCUMFERENCE - directDistance;
        distanceMoved = Math.min(directDistance, wrappedDistance);
        
        // Also check if we've moved to a different chunk (using new coordinate system)
        // Convert legacy positions to RingArc and compute chunk indices
        // Use raw positions (not wrapped) to preserve sign information
        const currentPolar = legacyPositionToRingPolar(ringPosition, 0, floor);
        const currentArc = ringPolarToRingArc(currentPolar);
        const currentChunkIndex = ringArcToChunkIndex(currentArc);
        
        const lastPolar = legacyPositionToRingPolar(this.lastSubscriptionPosition, 0, floor);
        const lastArc = ringPolarToRingArc(lastPolar);
        const lastChunkIndex = ringArcToChunkIndex(lastArc);
        
        chunkChanged = currentChunkIndex !== lastChunkIndex;
      }
      
      // Update subscription if:
      // 1. First time (lastSubscriptionPosition is null)
      // 2. Moved more than 1000m
      // 3. Moved to a different chunk
      // 4. Floor changed
      const shouldUpdate = this.lastSubscriptionPosition === null || 
                           distanceMoved > 1000 || 
                           chunkChanged ||
                           (this.lastSubscriptionFloor !== undefined && this.lastSubscriptionFloor !== floor);
      
      if (shouldUpdate) {
        // Update pose using stream_update_pose instead of re-subscribing
        try {
          await this.updateStreamingPose(ringPosition, floor);
          this.lastSubscriptionFloor = floor;
        } catch (error) {
          console.error('[Chunks] Failed to update streaming pose:', error);
          throw error;
        }
      }
      return;
    }
    
    // If we don't have a subscription, create one
    if (!this.streamingSubscriptionID) {
      await this.subscribeToStreaming(ringPosition, floor, radius * 1000, radius * 1000);
      return;
    }
    
    // If streaming is disabled, throw an error (legacy chunk_request removed)
    throw new Error('Streaming is disabled. Server-driven streaming is required.');
  }
  
  /**
   * Extract zones from chunk data and pass to zone manager
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data
   */
  extractZonesFromChunk(chunkID, chunkData) {
    if (!chunkData || !chunkData.zones || !Array.isArray(chunkData.zones) || chunkData.zones.length === 0) {
      // Log for boundary chunks to debug zone disappearance
      const chunkParts = chunkID.split('_');
      const chunkIndex = chunkParts.length >= 2 ? parseInt(chunkParts[1], 10) : null;
      const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
      if (isBoundary) {
        console.warn(`[Chunks] Chunk ${chunkID} (boundary) has no zones:`, {
          hasZones: !!chunkData?.zones,
          zonesType: typeof chunkData?.zones,
          zonesLength: Array.isArray(chunkData?.zones) ? chunkData.zones.length : 'not array',
          chunkDataKeys: chunkData ? Object.keys(chunkData) : 'no chunkData',
        });
      }
      return;
    }
    
    // Log zone extraction for boundary chunks
    const chunkParts = chunkID.split('_');
    const chunkIndex = chunkParts.length >= 2 ? parseInt(chunkParts[1], 10) : null;
    const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
    if (isBoundary) {
    }
    
    // Convert chunk zones to zone format expected by zone manager
    const zones = chunkData.zones.map((zoneFeature, idx) => {
      // Zone feature format: { type: "Feature", properties: {...}, geometry: {...} }
      // Geometry might be a JSON string (from database json.RawMessage) or an object (from procedural service)
      
      // Extract chunk index for metadata
      const chunkIndex = this.getChunkIndexFromID(chunkID);
      const floor = this.getFloorFromChunkID(chunkID);
      
      // Handle different zone formats
      let zoneID, name, zoneType, zoneFloor, isSystemZone, geometry, properties, metadata;
      
      if (zoneFeature && zoneFeature.type === 'Feature' && zoneFeature.properties) {
        // GeoJSON Feature format
        zoneID = zoneFeature.properties.id || zoneFeature.properties.zone_id;
        name = zoneFeature.properties.name;
        zoneType = zoneFeature.properties.zone_type;
        zoneFloor = zoneFeature.properties.floor !== undefined ? zoneFeature.properties.floor : floor;
        isSystemZone = zoneFeature.properties.is_system_zone || false;
        geometry = zoneFeature.geometry;
        properties = zoneFeature.properties.properties;
        metadata = zoneFeature.properties.metadata;
      } else if (zoneFeature && typeof zoneFeature === 'object') {
        // Might be a direct zone object (from procedural generation or database)
        zoneID = zoneFeature.id || zoneFeature.zone_id;
        name = zoneFeature.name;
        zoneType = zoneFeature.zone_type || zoneFeature.zoneType;
        zoneFloor = zoneFeature.floor !== undefined ? zoneFeature.floor : floor;
        isSystemZone = zoneFeature.is_system_zone || zoneFeature.isSystemZone || false;
        geometry = zoneFeature.geometry;
        properties = zoneFeature.properties;
        metadata = zoneFeature.metadata;
      } else {
        // Invalid format
        console.warn(`[Chunks] Invalid zone format in chunk ${chunkID}:`, typeof zoneFeature, zoneFeature);
        return null;
      }
      
      // Parse geometry if it's a string (from database json.RawMessage)
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch (e) {
          console.warn(`[Chunks] Failed to parse zone geometry string from chunk ${chunkID}:`, e);
          return null;
        }
      }
      
      // Parse metadata if it's a string
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          metadata = {};
        }
      }
      if (!metadata || typeof metadata !== 'object') {
        metadata = {};
      }
      
      // Ensure metadata has chunk_index
      if (metadata.chunk_index === undefined) {
        metadata.chunk_index = chunkIndex;
      }
      
      // Generate ID if missing (for zones from procedural generation that haven't been stored yet)
      if (!zoneID) {
        // Use metadata chunk_index and a hash of the geometry or just use chunk-based ID
        zoneID = `chunk_${chunkID}_zone_${idx}`;
      }
      
      // Validate geometry exists and is an object
      if (!geometry) {
        console.warn(`[Chunks] Zone from chunk ${chunkID} has no geometry:`, {
          zoneFeature: zoneFeature,
          hasGeometry: !!zoneFeature?.geometry,
          geometryType: typeof zoneFeature?.geometry,
        });
        return null;
      }
      
      if (typeof geometry !== 'object') {
        console.warn(`[Chunks] Zone from chunk ${chunkID} has invalid geometry type:`, {
          geometryType: typeof geometry,
          geometry: geometry,
          zoneFeature: zoneFeature,
        });
        return null;
      }
      
      return {
        id: zoneID,
        name: name || `Zone (${chunkID})`,
        zone_type: zoneType || 'restricted',
        floor: zoneFloor || floor || 0,
        is_system_zone: isSystemZone,
        geometry: geometry,
        properties: properties,
        metadata: metadata,
      };
    }).filter(zone => zone !== null); // Filter out null zones
    
    if (zones.length === 0) {
      // Log detailed info about why zones were filtered out (using already-declared chunkParts/chunkIndex/isBoundary)
      if (isBoundary || window.earthring?.debug) {
        console.warn(`[Chunks] No valid zones extracted from chunk ${chunkID} (had ${chunkData.zones.length} raw zones). First zone structure:`, {
          firstZone: chunkData.zones[0],
          firstZoneType: typeof chunkData.zones[0],
          hasType: !!chunkData.zones[0]?.type,
          hasProperties: !!chunkData.zones[0]?.properties,
          hasGeometry: !!chunkData.zones[0]?.geometry,
          geometryType: typeof chunkData.zones[0]?.geometry,
          keys: chunkData.zones[0] ? Object.keys(chunkData.zones[0]) : null,
        });
      }
      return;
    }
    
    // Log successful extraction for boundary chunks (using already-declared isBoundary)
    if (isBoundary) {
    }
    
    // Pass zones to zone manager with chunkID for tracking
    if (this.zoneManager) {
      this.zoneManager.handleStreamedZones(zones, chunkID);
    } else if (window.zoneManager) {
      // Fallback to global reference if not passed in constructor
      window.zoneManager.handleStreamedZones(zones, chunkID);
    } else {
      console.error(`[Chunks] No zone manager available to handle zones from chunk ${chunkID}`);
    }
  }

  /**
   * Extract structures from chunk data and pass to structure manager
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data containing structures array
   */
  extractStructuresFromChunk(chunkID, chunkData) {
    if (!chunkData || !chunkData.structures || !Array.isArray(chunkData.structures) || chunkData.structures.length === 0) {
      return;
    }

    const structures = chunkData.structures.map((structureFeature, idx) => {
      // Structure feature format: { type: "Feature", properties: {...}, geometry: {...} }
      // or direct structure object: { id, structure_type, position, ... }
      
      let structure;
      if (structureFeature.type === 'Feature') {
        // GeoJSON Feature format
        const properties = structureFeature.properties || {};
        const geometry = structureFeature.geometry;
        
        // Parse geometry if it's a string
        let parsedGeometry = geometry;
        if (typeof geometry === 'string') {
          try {
            parsedGeometry = JSON.parse(geometry);
          } catch (e) {
            console.warn(`[Chunks] Failed to parse structure geometry from chunk ${chunkID}:`, e);
            return null;
          }
        }
        
        // Extract position from Point geometry
        if (parsedGeometry.type === 'Point' && Array.isArray(parsedGeometry.coordinates)) {
          // Validate required properties before creating structure
          if (!properties.structure_type) {
            console.warn(`[Chunks] Structure from chunk ${chunkID} missing structure_type in properties:`, properties);
            return null;
          }
          
          structure = {
            id: properties.id || `chunk_${chunkID}_structure_${idx}`,
            structure_type: properties.structure_type,
            floor: properties.floor ?? 0,
            position: {
              x: parsedGeometry.coordinates[0],
              y: parsedGeometry.coordinates[1],
            },
            rotation: properties.rotation ?? 0,
            scale: properties.scale ?? 1.0,
            owner_id: properties.owner_id,
            zone_id: properties.zone_id,
            is_procedural: properties.is_procedural ?? false,
            procedural_seed: properties.procedural_seed,
            properties: properties.properties,
            model_data: properties.model_data,
          };
          
          // Extract doors and garage_doors from model_data if present (for structures loaded from database)
          if (properties.model_data) {
            let modelData = properties.model_data;
            if (typeof modelData === 'string') {
              try {
                modelData = JSON.parse(modelData);
              } catch (e) {
                // Ignore parse errors
              }
            }
            if (modelData && typeof modelData === 'object') {
              // Extract doors and garage_doors to top level for easier access
              if (modelData.doors) {
                structure.doors = modelData.doors;
              }
              if (modelData.garage_doors) {
                structure.garage_doors = modelData.garage_doors;
              }
              // Also extract windows, dimensions, building_subtype if present
              if (modelData.windows) {
                structure.windows = modelData.windows;
              }
              if (modelData.dimensions) {
                structure.dimensions = modelData.dimensions;
              }
              if (modelData.building_subtype) {
                structure.building_subtype = modelData.building_subtype;
              }
            }
          }
        } else {
          console.warn(`[Chunks] Structure from chunk ${chunkID} has invalid geometry type:`, parsedGeometry.type);
          return null;
        }
      } else {
        // Direct structure object format
        structure = structureFeature;
        
        // Ensure position is an object with x, y
        if (structure.position && typeof structure.position === 'string') {
          try {
            const parsed = JSON.parse(structure.position);
            structure.position = parsed;
          } catch (e) {
            console.warn(`[Chunks] Failed to parse structure position from chunk ${chunkID}:`, e);
            return null;
          }
        }
        
        // Extract doors and garage_doors from model_data if present (for structures loaded from database)
        if (structure.model_data) {
          let modelData = structure.model_data;
          if (typeof modelData === 'string') {
            try {
              modelData = JSON.parse(modelData);
            } catch (e) {
              // Ignore parse errors
            }
          }
          if (modelData && typeof modelData === 'object') {
            // Extract doors and garage_doors to top level for easier access
            if (modelData.doors) {
              structure.doors = modelData.doors;
            }
            if (modelData.garage_doors) {
              structure.garage_doors = modelData.garage_doors;
            }
            // Also extract windows, dimensions, building_subtype if present
            if (modelData.windows) {
              structure.windows = modelData.windows;
            }
            if (modelData.dimensions) {
              structure.dimensions = modelData.dimensions;
            }
            if (modelData.building_subtype) {
              structure.building_subtype = modelData.building_subtype;
            }
          }
        }
      }
      
      // Validate required fields
      if (!structure.id) {
        console.warn(`[Chunks] Structure from chunk ${chunkID} missing id:`, structure);
        return null;
      }
      if (!structure.structure_type) {
        console.warn(`[Chunks] Structure from chunk ${chunkID} missing structure_type:`, structure);
        return null;
      }
      if (!structure.position || typeof structure.position !== 'object' || structure.position.x === undefined || structure.position.y === undefined) {
        console.warn(`[Chunks] Structure from chunk ${chunkID} missing or invalid position:`, structure);
        return null;
      }
      
      return structure;
    }).filter(structure => structure !== null);

    if (structures.length === 0) {
      return;
    }

    // Pass structures to structure manager with chunkID for tracking
    if (this.structureManager) {
      this.structureManager.handleStreamedStructures(structures, chunkID);
    } else if (window.structureManager) {
      window.structureManager.handleStreamedStructures(structures, chunkID);
    } else {
      console.error(`[Chunks] No structure manager available to handle structures from chunk ${chunkID}`);
    }
  }

  /**
   * Handle chunk data received from server
   * @param {Object} data - Chunk data from server
   */
  async handleChunkData(data) {
    if (!data.chunks || !Array.isArray(data.chunks)) {
      console.error('[Chunks] Invalid chunk_data format:', data);
      return;
    }

    const chunkIDs = data.chunks.map(c => c.id).join(', ');
    const chunksWithZones = data.chunks.filter(c => c.zones && Array.isArray(c.zones) && c.zones.length > 0).length;
    
    // Track statistics for summary logging
    const stats = {
      total: data.chunks.length,
      compressed: 0,
      uncompressed: 0,
      failed: 0,
      totalCompressedSize: 0,
      totalUncompressedSize: 0,
      totalDecompressTime: 0,
      withGeometry: 0,
      withoutGeometry: 0,
    };
    
    // Process chunks in parallel (decompress if needed)
    const processedChunks = await Promise.all(
      data.chunks.map(async (chunkData) => {
        if (!chunkData.id) {
          console.error('[Chunks] Chunk data missing ID:', chunkData);
          stats.failed++;
          return null;
        }
        
        // Remove from pending requests since we received the data
        this.pendingChunkRequests.delete(chunkData.id);
        
        // Decompress geometry if it's compressed
        let geometry = chunkData.geometry;
        if (geometry && isCompressedGeometry(geometry)) {
          const startTime = performance.now();
          try {
            geometry = await decompressChunkGeometry(geometry);
            const decompressTime = performance.now() - startTime;
            const compressionRatio = chunkData.geometry.uncompressed_size / chunkData.geometry.size;
            
            stats.compressed++;
            stats.totalCompressedSize += chunkData.geometry.size;
            stats.totalUncompressedSize += chunkData.geometry.uncompressed_size;
            stats.totalDecompressTime += decompressTime;
            
            // Only log individual decompression in debug mode
            if (window.earthring?.debug) {
              console.log(`[Chunks] Decompressed ${chunkData.id}: ${chunkData.geometry.size} → ${chunkData.geometry.uncompressed_size} bytes (${compressionRatio.toFixed(2)}:1) in ${decompressTime.toFixed(2)}ms`);
            }
          } catch (error) {
            const decompressTime = performance.now() - startTime;
            stats.failed++;
            console.error(`[Chunks] Failed to decompress ${chunkData.id} (${decompressTime.toFixed(2)}ms):`, error);
            // Return original chunk data (might be uncompressed or in a different format)
            return chunkData;
          }
        } else if (geometry && !isCompressedGeometry(geometry)) {
          stats.uncompressed++;
        }
        
        // Create processed chunk data with decompressed geometry
        const processedChunk = {
          ...chunkData,
          geometry
        };
        
        // Track geometry stats
        if (geometry) {
          stats.withGeometry++;
        } else {
          stats.withoutGeometry++;
        }
        
        return processedChunk;
      })
    );
    
    // Performance stats available via window.earthring.debug if needed
    if (stats.failed > 0) {
      console.warn(`[Chunks] ${stats.failed} chunk(s) failed to process`);
    }
    
    // Store processed chunks in game state (this will trigger renderChunk via event listener)
    // Zones will be extracted in the chunkAdded event handler
    processedChunks.forEach(chunkData => {
      if (chunkData) {
        // Log if chunk has zones (especially for boundary chunks)
        const chunkIndex = parseInt(chunkData.id?.split('_')[1], 10);
        const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
        if (isBoundary && chunkData.zones) {
          const zoneCount = Array.isArray(chunkData.zones) ? chunkData.zones.length : 0;
          if (zoneCount > 0) {
          } else {
            console.warn(`[Chunks] Chunk ${chunkData.id} (boundary) has empty zones array:`, chunkData.zones);
          }
        }
        this.gameStateManager.addChunk(chunkData.id, chunkData);
      }
    });
  }
  
  /**
   * Extract chunk index from chunk ID (format: "floor_chunk_index")
   * @param {string} chunkID - Chunk ID
   * @returns {number} Chunk index
   */
  getChunkIndexFromID(chunkID) {
    const parts = chunkID.split('_');
    if (parts.length >= 2) {
      const chunkIndex = parseInt(parts[1], 10);
      return isNaN(chunkIndex) ? 0 : chunkIndex;
    }
    return 0;
  }
  
  /**
   * Check if chunks need to be re-rendered due to camera movement (for wrapping)
   * @returns {boolean} True if chunks should be re-rendered
   */
  shouldReRenderChunks() {
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
    
    if (distanceMoved > this.WRAP_RE_RENDER_THRESHOLD) {
      this.lastCameraX = currentCameraX;
      return true;
    }
    
    return false;
  }
  
  /**
   * Re-render all loaded chunks (useful when camera moves significantly for wrapping)
   * This updates chunk positions based on camera movement for proper wrapping
   */
  reRenderAllChunks() {
    // Get all loaded chunks from game state and re-render them
    // Force re-render even if data is the same, because wrapping positions change
    const chunks = this.gameStateManager.getAllChunks();
    const camera = this.sceneManager.getCamera();
    const cameraThreeJSPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const cameraEarthRingPosRaw = fromThreeJS(cameraThreeJSPos);
    const cameraX = cameraEarthRingPosRaw.x || 0;
    
    // Track which chunks we're rendering to avoid duplicates
    const renderedChunks = new Set();
    
    for (const [chunkID, chunkData] of chunks) {
      if (!chunkData.geometry || chunkData.geometry.type !== 'ring_floor') {
        continue; // Skip placeholders
      }
      
      // Get chunk's original position
      const chunkIndex = parseInt(chunkID.split('_')[1]) || 0;
      const chunkStartX = chunkIndex * CHUNK_LENGTH; // Each chunk is CHUNK_LENGTH meters
      
      // Calculate wrapped position
      let wrappedX = chunkStartX;
      const forwardDistance = wrappedX - cameraX;
      const backwardDistance = cameraX - wrappedX;
      const forwardDistNormalized = ((forwardDistance % NEW_RING_CIRCUMFERENCE) + NEW_RING_CIRCUMFERENCE) % NEW_RING_CIRCUMFERENCE;
      const backwardDistNormalized = ((backwardDistance % NEW_RING_CIRCUMFERENCE) + NEW_RING_CIRCUMFERENCE) % NEW_RING_CIRCUMFERENCE;
      
      if (backwardDistNormalized < forwardDistNormalized && backwardDistNormalized < NEW_RING_CIRCUMFERENCE / 2) {
        wrappedX -= NEW_RING_CIRCUMFERENCE;
      } else if (forwardDistNormalized > NEW_RING_CIRCUMFERENCE / 2) {
        wrappedX -= NEW_RING_CIRCUMFERENCE;
      }
      
      // Create a unique key for this wrapped position to avoid duplicates
      const wrappedKey = `${Math.round(wrappedX / CHUNK_LENGTH)}_${chunkID.split('_')[0]}`;
      
      // Only render if we haven't already rendered a chunk at this wrapped position
      if (!renderedChunks.has(wrappedKey)) {
        renderedChunks.add(wrappedKey);
        this.renderChunk(chunkID, chunkData, true); // Force re-render for wrapping
      } else {
        // Skip this chunk - we've already rendered one at this position
        // Remove the duplicate to prevent z-fighting
        this.removeChunkMesh(chunkID);
      }
    }
  }
  
  /**
   * Render a chunk in the scene
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data
   * @param {boolean} forceReRender - Force re-render even if data is the same (for wrapping)
   */
  renderChunk(chunkID, chunkData, forceReRender = false) {
    // Update camera position in shared material for grid fade calculation
    this.updateCameraPosition();
    
    const cameraX = this.getCurrentCameraX();
    const newVersionToken = this.getChunkVersionToken(chunkData);

    // Only render chunks that match the active floor
    const activeFloor = this.gameStateManager.getActiveFloor();
    const chunkFloor = this.getFloorFromChunkID(chunkID);
    if (chunkFloor !== activeFloor) {
      // Chunk is for a different floor - remove it if it exists
      this.removeChunkMesh(chunkID);
      return;
    }
    
    // Check if chunk is already rendered and hasn't changed (or camera hasn't moved significantly)
    // Only skip if we're not forcing a re-render (for wrapping)
    if (!forceReRender) {
      const existingMesh = this.chunkMeshes.get(chunkID);
      if (existingMesh) {
        const existingToken = existingMesh.userData?.chunkVersionToken || null;
        const lastCameraXUsed = existingMesh.userData?.lastCameraXUsed;
        const cameraDelta = (typeof lastCameraXUsed === 'number')
          ? this.getWrappedRingDistance(lastCameraXUsed, cameraX)
          : 0;
        const sameData = existingToken && newVersionToken && existingToken === newVersionToken;
        const cameraStable = cameraDelta < this.WRAP_RE_RENDER_THRESHOLD;

        if (sameData && cameraStable) {
          // Chunk is already rendered with the same data and wrapping, skip re-rendering
          // But ensure zones are extracted (they might not have been extracted yet)
          // Only extract once - check if zones already exist for this chunk
          if (this.zoneManager && chunkData.zones && Array.isArray(chunkData.zones) && chunkData.zones.length > 0) {
            const existingZones = this.zoneManager.chunkZones.get(chunkID);
            if (!existingZones || existingZones.size === 0) {
              // Zones haven't been extracted yet - extract them now
              this.extractZonesFromChunk(chunkID, chunkData);
            }
          }
          return;
        }
      }
    }
    
    // Remove existing mesh if present
    this.removeChunkMesh(chunkID);
    
    // Note: Zones are already extracted in chunkAdded listener - don't extract again here
    // to avoid duplicate processing and potential issues at boundaries
    
    // Check if chunk has geometry data
    if (chunkData.geometry && chunkData.geometry.type === 'ring_floor') {
      // Render actual geometry (Phase 2)
      const mesh = this.createRingFloorMesh(chunkID, chunkData, cameraX);
      if (mesh) {
        mesh.userData.chunkVersionToken = newVersionToken || chunkID;
        mesh.userData.lastCameraXUsed = cameraX;
        this.scene.add(mesh);
        this.chunkMeshes.set(chunkID, mesh);
        return;
      } else {
        console.warn(`[Chunks] Failed to create mesh for ${chunkID}, falling back to placeholder`);
      }
    }
    
    // Fallback to placeholder if no geometry or geometry creation failed
    const placeholder = this.createChunkPlaceholder(chunkID, chunkData, cameraX);
    if (placeholder) {
      placeholder.userData.chunkVersionToken = newVersionToken || chunkID;
      placeholder.userData.lastCameraXUsed = cameraX;
      this.scene.add(placeholder);
      this.chunkMeshes.set(chunkID, placeholder);
    }
  }
  
  /**
   * Create a Three.js mesh from ring floor geometry data
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data with geometry
   * @returns {THREE.Mesh|null} Three.js mesh or null
   */
  createRingFloorMesh(chunkID, chunkData, cameraXOverride = null) {
    const geometry = chunkData.geometry;
    
    if (!geometry.vertices || !geometry.faces) {
      console.error(`[Chunks] Invalid geometry data for ${chunkID}:`, geometry);
      return null;
    }
    
    // Create Three.js geometry
    const threeGeometry = new THREE.BufferGeometry();
    
    // Convert vertices to Three.js coordinates
    const positions = [];
    
    // Get camera position to wrap chunks relative to camera in world space
    const camera = this.sceneManager.getCamera();
    const cameraThreeJSPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const cameraEarthRingPos = fromThreeJS(cameraThreeJSPos);
    // Use the actual world-space X position of the camera for wrapping geometry.
    // This keeps chunk meshes positioned near the camera even when the camera
    // has moved to large positive or negative X (e.g., near the far side of the ring).
    const cameraX = cameraEarthRingPos.x || 0;
    
    // Determine chunk index and base position
    const chunkIndex = (chunkData.chunk_index ?? parseInt(chunkID.split('_')[1], 10)) || 0;
    const CHUNK_LENGTH = 1000;
    const chunkBaseX = chunkIndex * CHUNK_LENGTH;
    
    // Calculate an offset (multiple of ring circumference) that moves this chunk closest to the camera.
    const circumferenceOffsetMultiple = Math.round((cameraX - chunkBaseX) / NEW_RING_CIRCUMFERENCE);
    const chunkOffset = circumferenceOffsetMultiple * NEW_RING_CIRCUMFERENCE;
    const chunkOriginX = chunkBaseX + chunkOffset;
    
    // Process vertices
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    // Store chunk-local coordinates for grid calculations (precision-safe)
    const chunkLocalXCoords = [];
    const chunkLocalZCoords = [];
    
    geometry.vertices.forEach(vertex => {
      // Shift vertex by the chunk offset so this chunk sits closest to the camera.
      const earthringX = vertex[0] + chunkOffset;
      // Keep vertex coordinates near origin (relative to chunk origin) to avoid float precision loss
      const localEarthringPos = {
        x: earthringX - chunkOriginX,
        y: vertex[1],
        z: vertex[2],
      };
      
      const earthringPos = localEarthringPos;
      const threeJSPos = toThreeJS(earthringPos);
      
      // Don't add Y offset - chunks should align perfectly when wrapping
      // The polygon offset in the material should handle z-fighting
      
      positions.push(threeJSPos.x, threeJSPos.y, threeJSPos.z);
      
      // Store chunk-local EarthRing coordinates for grid calculations
      // vertex[0] from server is absolute ring position, so we need to subtract chunk base to get local
      // chunkLocalX = position within chunk (0-1000m range)
      // vertex[1] is the Y coordinate (radial offset/width, -200m to +200m range in EarthRing coords)
      // But after toThreeJS conversion, Y becomes Z, so we store vertex[1] as chunkLocalZ
      const chunkLocalX = vertex[0] - chunkBaseX;  // Convert absolute to chunk-local (0-1000m)
      chunkLocalXCoords.push(chunkLocalX);
      chunkLocalZCoords.push(vertex[1]);  // Y in EarthRing = radial offset = Z in Three.js for grid
      
      // Track bounds for debugging
      minX = Math.min(minX, threeJSPos.x);
      maxX = Math.max(maxX, threeJSPos.x);
      minY = Math.min(minY, threeJSPos.y);
      maxY = Math.max(maxY, threeJSPos.y);
      minZ = Math.min(minZ, threeJSPos.z);
      maxZ = Math.max(maxZ, threeJSPos.z);
    });
    
    // Process faces
    const indices = [];
    geometry.faces.forEach(face => {
      // Add triangle indices
      indices.push(face[0], face[1], face[2]);
    });
    
    // Set geometry attributes
    threeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    threeGeometry.setIndex(indices);
    
    // Add chunk-local EarthRing coordinates for grid calculations (precision-safe)
    // These are in the chunk's local coordinate space (0-1000m for X, -200m to +200m for Z)
    // Ensure arrays match vertex count
    if (chunkLocalXCoords.length !== geometry.vertices.length || chunkLocalZCoords.length !== geometry.vertices.length) {
      console.error(`[Chunks] Attribute array length mismatch for ${chunkID}: vertices=${geometry.vertices.length}, localX=${chunkLocalXCoords.length}, localZ=${chunkLocalZCoords.length}`);
    }
    
    threeGeometry.setAttribute('chunkLocalX', new THREE.Float32BufferAttribute(chunkLocalXCoords, 1));
    threeGeometry.setAttribute('chunkLocalZ', new THREE.Float32BufferAttribute(chunkLocalZCoords, 1));
    
    // Store chunk base world X as a custom attribute (same for all vertices in this chunk)
    // This tells us where this chunk starts in world space (before wrapping offset)
    const chunkBaseXArray = new Array(geometry.vertices.length).fill(chunkBaseX);
    threeGeometry.setAttribute('chunkBaseWorldX', new THREE.Float32BufferAttribute(chunkBaseXArray, 1));
    
    // Compute vertex normals automatically (Three.js will handle this correctly)
    threeGeometry.computeVertexNormals();
    
    // Use shared platform material (with grid overlay support)
    // Note: Since we're using a shared material, all chunks will have the same base color
    // If per-chunk colors are needed in the future, we can use vertex colors or material variants
    // For now, we use a single base color for all chunks for simplicity
    
    // Create mesh using shared material
    const mesh = new THREE.Mesh(threeGeometry, this.sharedPlatformMaterial || this.createFallbackMaterial(new THREE.Color(0x666666)));
    mesh.userData.chunkID = chunkID;
    mesh.userData.chunkData = chunkData;
    mesh.position.x = chunkOriginX;
    
    // Disable frustum culling for wrapped chunks to ensure they're always visible
    // This is important because chunks may be wrapped to positions that are technically
    // "behind" the camera but should still be visible due to ring wrapping
    mesh.frustumCulled = false;
    
    // Use renderOrder to ensure consistent rendering order (helps with transparency)
    mesh.renderOrder = chunkIndex % 1000; // Use modulo to keep values reasonable
    
    return mesh;
  }

  /**
   * Build a version token for chunk data to detect changes.
   * @param {Object} chunkData
   * @returns {string|null}
   */
  getChunkVersionToken(chunkData) {
    if (!chunkData) {
      return null;
    }
    const metadata = chunkData.metadata || chunkData.Metadata || {};
    const version = metadata.version ?? metadata.Version ?? '';
    const lastModified = metadata.last_modified ?? metadata.lastModified ?? '';
    const isDirty = metadata.is_dirty ?? metadata.isDirty ?? '';

    const geometry = chunkData.geometry || {};
    const geometryVersion = geometry.version ?? geometry.Version ?? '';
    const geometryUpdated = geometry.updated_at ?? geometry.updatedAt ?? '';
    const geometryHash =
      geometry.hash ??
      geometry.Hash ??
      geometry.checksum ??
      geometry.Checksum ??
      geometry.signature ??
      '';

    let fallbackCounts = '';
    if (!geometryHash && Array.isArray(geometry.vertices) && Array.isArray(geometry.faces)) {
      fallbackCounts = `v${geometry.vertices.length}-f${geometry.faces.length}`;
    }

    const tokenParts = [
      version,
      lastModified,
      isDirty,
      geometryVersion,
      geometryUpdated,
      geometryHash || fallbackCounts,
    ].filter(part => part !== '' && part !== null && typeof part !== 'undefined');

    if (tokenParts.length === 0) {
      return null;
    }

    return tokenParts.join('|');
  }
  
  /**
   * Create a placeholder mesh for a chunk (Phase 1: empty chunks)
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data
   * @returns {THREE.Mesh|null} Placeholder mesh or null
   */
  createChunkPlaceholder(chunkID, chunkData, cameraX = 0) {
    // Parse chunk ID to get floor and chunk index
    const [floor, chunkIndex] = chunkID.split('_').map(Number);
    
    if (isNaN(floor) || isNaN(chunkIndex)) {
      console.error('Invalid chunk ID format:', chunkID);
      return null;
    }
    
    // Calculate chunk position (center of chunk)
    const chunkPosition = {
      x: chunkIndex * 1000 + 500, // Center of 1km chunk
      y: 0, // Center width
      z: floor, // Floor number
    };
    
    // Create a simple box placeholder
    // Size: 1000m (length) x 100m (width) x 1m (height)
    const geometry = new THREE.BoxGeometry(1000, 1, 100);
    const material = new THREE.MeshStandardMaterial({
      color: 0x444444,
      wireframe: false,
      transparent: true,
      opacity: 0.3,
    });
    
    const mesh = createMeshAtEarthRingPosition(geometry, material, chunkPosition);
    mesh.userData.chunkID = chunkID;
    mesh.userData.chunkData = chunkData;
    mesh.userData.lastCameraXUsed = cameraX;
    
    return mesh;
  }
  
  /**
   * Create fallback material if shared material is not available
   * @param {THREE.Color} color - Base color
   * @returns {THREE.Material}
   */
  createFallbackMaterial(color) {
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.1,
      roughness: 0.8,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 1,
      depthWrite: true,
      depthTest: true,
    });
  }

  /**
   * Remove a chunk mesh from the scene
   * @param {string} chunkID - Chunk ID
   */
  removeChunkMesh(chunkID) {
    const mesh = this.chunkMeshes.get(chunkID);
    if (mesh) {
      this.scene.remove(mesh);
      
      // Dispose of geometry and material
      mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(mat => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }
      
      this.chunkMeshes.delete(chunkID);
    }
  }
  
  /**
   * Get all rendered chunk meshes
   * @returns {Map} Map of chunk IDs to meshes
   */
  getChunkMeshes() {
    return this.chunkMeshes;
  }
  
  /**
   * Clear all chunk meshes from scene
   */
  clearAllChunks() {
    const chunkIDs = Array.from(this.chunkMeshes.keys());
    chunkIDs.forEach(chunkID => {
      this.removeChunkMesh(chunkID);
    });
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.clearAllChunks();
    this.chunkMeshes.clear();
  }
}

