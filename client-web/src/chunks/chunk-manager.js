/**
 * Chunk Manager
 * Handles chunk loading, caching, and basic visualization
 */

import { wsClient } from '../network/websocket-client.js';
import { positionToChunkIndex, toThreeJS, wrapRingPosition, fromThreeJS } from '../utils/coordinates.js';
import { createMeshAtEarthRingPosition } from '../utils/rendering.js';
import { decompressChunkGeometry, isCompressedGeometry } from '../utils/decompression.js';
import * as THREE from 'three';

/**
 * Chunk Manager class
 * Manages chunk requests, caching, and rendering
 */
export class ChunkManager {
  constructor(sceneManager, gameStateManager, cameraController = null) {
    this.sceneManager = sceneManager;
    this.gameStateManager = gameStateManager;
    this.cameraController = cameraController; // Store reference for position wrapping
    this.scene = sceneManager.getScene();
    
    // Map of chunk IDs to Three.js meshes
    this.chunkMeshes = new Map();
    
    // Track pending chunk requests to avoid duplicates
    this.pendingChunkRequests = new Set();
    
    // Track last camera position for re-rendering wrapped chunks
    this.lastCameraX = null;
    const WRAP_RE_RENDER_THRESHOLD = 5000; // Re-render if camera moved more than 5km (reduce z-fighting)
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
    
    // Listen to game state changes
    this.setupStateListeners();
    
    // Store re-render threshold
    this.WRAP_RE_RENDER_THRESHOLD = WRAP_RE_RENDER_THRESHOLD;
  }
  
  /**
   * Set up WebSocket message handlers for chunk data
   */
  setupWebSocketHandlers() {
    // Handle chunk_data messages
    wsClient.on('chunk_data', (data) => {
      this.handleChunkData(data);
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
      this.renderChunk(chunkID, chunkData);
    });
    
    // When a chunk is removed from state, remove its mesh
    this.gameStateManager.on('chunkRemoved', ({ chunkID }) => {
      this.removeChunkMesh(chunkID);
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
   * Request chunks via WebSocket
   * @param {Array<string>} chunkIDs - Array of chunk IDs (format: "floor_chunk_index")
   * @param {string|number} lodLevel - Level of detail: "low", "medium", "high" or 0-3 (converted to string)
   * @returns {Promise} Promise that resolves when request is sent
   */
  async requestChunks(chunkIDs, lodLevel = 'medium') {
    if (!wsClient.isConnected()) {
      throw new Error('WebSocket is not connected');
    }
    
    // Validate chunk IDs
    if (!Array.isArray(chunkIDs) || chunkIDs.length === 0) {
      throw new Error('chunkIDs must be a non-empty array');
    }
    
    if (chunkIDs.length > 10) {
      throw new Error('Cannot request more than 10 chunks at once');
    }
    
    // Filter out chunks that are already loaded or pending
    // But allow re-requesting if we need to update their wrapped positions
    const chunksToRequest = chunkIDs.filter(chunkID => {
      // Skip if already pending (don't duplicate requests)
      if (this.pendingChunkRequests.has(chunkID)) {
        return false;
      }
      // Always request chunks, even if loaded - this ensures we get updates
      // and can re-render them with correct wrapping as camera moves
      return true;
    });
    
    // If all chunks are already pending, return early
    if (chunksToRequest.length === 0) {
      return;
    }
    
    // Mark chunks as pending
    chunksToRequest.forEach(chunkID => {
      this.pendingChunkRequests.add(chunkID);
    });
    
    // Convert numeric LOD level to string if needed
    let lodLevelStr = lodLevel;
    if (typeof lodLevel === 'number') {
      const lodMap = { 0: 'low', 1: 'medium', 2: 'high', 3: 'high' };
      lodLevelStr = lodMap[lodLevel] || 'medium';
    }
    
    // Validate LOD level string
    if (lodLevelStr !== 'low' && lodLevelStr !== 'medium' && lodLevelStr !== 'high') {
      lodLevelStr = 'medium'; // Default to medium if invalid
    }
    
    try {
      // Send chunk request via WebSocket
      await wsClient.request('chunk_request', {
        chunks: chunksToRequest,
        lod_level: lodLevelStr,
      });
      
      // Note: We don't remove from pending here - we'll remove when we receive the data
      // This prevents duplicate requests if the response is slow
    } catch (error) {
      // Remove from pending on error so we can retry later
      chunksToRequest.forEach(chunkID => {
        this.pendingChunkRequests.delete(chunkID);
      });
      console.error('Failed to request chunks:', error);
      throw error;
    }
  }
  
  /**
   * Request chunks based on ring position
   * @param {number} ringPosition - Ring position in meters
   * @param {number} floor - Floor number
   * @param {number} radius - Number of chunks to load on each side (default: 1)
   * @param {string|number} lodLevel - Level of detail: "low", "medium", "high" or 0-3 (default: "medium")
   * @returns {Promise} Promise that resolves when request is sent
   */
  async requestChunksAtPosition(ringPosition, floor, radius = 1, lodLevel = 'medium') {
    const centerChunkIndex = positionToChunkIndex(ringPosition);
    const chunkIDs = [];
    const CHUNK_COUNT = 264000;
    
    // Generate chunk IDs for the requested range, handling ring wrapping
    for (let i = -radius; i <= radius; i++) {
      // Calculate chunk index with proper wrapping
      // Add CHUNK_COUNT before modulo to handle negative values correctly
      let chunkIndex = (centerChunkIndex + i) % CHUNK_COUNT;
      if (chunkIndex < 0) {
        chunkIndex += CHUNK_COUNT;
      }
      
      // Ensure we don't add duplicates (can happen if radius is large)
      const chunkID = `${floor}_${chunkIndex}`;
      if (!chunkIDs.includes(chunkID)) {
        chunkIDs.push(chunkID);
      }
    }
    
    // Sort chunk IDs for consistent ordering (helps with debugging)
    chunkIDs.sort();
    
    // Debug logging for chunk requests (especially useful at boundaries)
    if (window.earthring?.debug || centerChunkIndex < radius || centerChunkIndex >= CHUNK_COUNT - radius) {
      console.log(`[Chunks] Requesting ${chunkIDs.length} chunk(s) around position ${ringPosition.toFixed(0)}m (chunk ${centerChunkIndex})`);
    }
    
    return this.requestChunks(chunkIDs, lodLevel);
  }
  
  /**
   * Handle chunk data received from server
   * @param {Object} data - Chunk data from server
   */
  async handleChunkData(data) {
    if (!data.chunks || !Array.isArray(data.chunks)) {
      console.error('Invalid chunk_data format:', data);
      return;
    }
    
    console.log(`[Chunks] Received ${data.chunks.length} chunk(s) from server`);
    
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
    
    // Log summary statistics
    if (stats.compressed > 0) {
      const avgRatio = (stats.totalUncompressedSize / stats.totalCompressedSize).toFixed(2);
      const avgTime = (stats.totalDecompressTime / stats.compressed).toFixed(2);
      console.log(`[Chunks] Decompressed ${stats.compressed} chunk(s): ${(stats.totalCompressedSize / 1024).toFixed(1)}KB → ${(stats.totalUncompressedSize / 1024).toFixed(1)}KB (avg ${avgRatio}:1) in ${avgTime}ms avg`);
    }
    if (stats.uncompressed > 0) {
      console.log(`[Chunks] ${stats.uncompressed} chunk(s) already uncompressed`);
    }
    if (stats.withGeometry > 0 || stats.withoutGeometry > 0) {
      console.log(`[Chunks] Processed: ${stats.withGeometry} with geometry, ${stats.withoutGeometry} without geometry`);
    }
    if (stats.failed > 0) {
      console.warn(`[Chunks] ${stats.failed} chunk(s) failed to process`);
    }
    
    // Store processed chunks in game state (this will trigger renderChunk via event listener)
    processedChunks.forEach(chunkData => {
      if (chunkData) {
        this.gameStateManager.addChunk(chunkData.id, chunkData);
      }
    });
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
    const RING_CIRCUMFERENCE = 264000000;
    const directDistance = Math.abs(currentCameraX - this.lastCameraX);
    const wrappedDistance = RING_CIRCUMFERENCE - directDistance;
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
    const RING_CIRCUMFERENCE = 264000000;
    
    // Track which chunks we're rendering to avoid duplicates
    const renderedChunks = new Set();
    
    for (const [chunkID, chunkData] of chunks) {
      if (!chunkData.geometry || chunkData.geometry.type !== 'ring_floor') {
        continue; // Skip placeholders
      }
      
      // Get chunk's original position
      const chunkIndex = parseInt(chunkID.split('_')[1]) || 0;
      const chunkStartX = chunkIndex * 1000; // Each chunk is 1000m
      
      // Calculate wrapped position
      let wrappedX = chunkStartX;
      const forwardDistance = wrappedX - cameraX;
      const backwardDistance = cameraX - wrappedX;
      const forwardDistNormalized = ((forwardDistance % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
      const backwardDistNormalized = ((backwardDistance % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
      
      if (backwardDistNormalized < forwardDistNormalized && backwardDistNormalized < RING_CIRCUMFERENCE / 2) {
        wrappedX -= RING_CIRCUMFERENCE;
      } else if (forwardDistNormalized > RING_CIRCUMFERENCE / 2) {
        wrappedX -= RING_CIRCUMFERENCE;
      }
      
      // Create a unique key for this wrapped position to avoid duplicates
      const wrappedKey = `${Math.round(wrappedX / 1000)}_${chunkID.split('_')[0]}`;
      
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
    // Only render chunks that match the active floor
    const activeFloor = this.gameStateManager.getActiveFloor();
    const chunkFloor = this.getFloorFromChunkID(chunkID);
    if (chunkFloor !== activeFloor) {
      // Chunk is for a different floor - remove it if it exists
      this.removeChunkMesh(chunkID);
      return;
    }
    
    // Check if chunk is already rendered and hasn't changed
    // Only skip if we're not forcing a re-render (for wrapping)
    if (!forceReRender) {
      const existingMesh = this.chunkMeshes.get(chunkID);
      if (existingMesh) {
        // Check if this is the same chunk data by comparing chunk ID
        // This prevents re-rendering when we receive duplicate chunk data from server
        const existingChunkID = existingMesh.userData.chunkID;
        if (existingChunkID === chunkID) {
          // Chunk is already rendered, skip re-rendering unless forced
          return;
        }
      }
    }
    
    // Remove existing mesh if present
    this.removeChunkMesh(chunkID);
    
    // Check if chunk has geometry data
    if (chunkData.geometry && chunkData.geometry.type === 'ring_floor') {
      // Render actual geometry (Phase 2)
      const mesh = this.createRingFloorMesh(chunkID, chunkData);
      if (mesh) {
        this.scene.add(mesh);
        this.chunkMeshes.set(chunkID, mesh);
        
        // Only log individual chunk rendering in debug mode
        if (window.earthring?.debug) {
          const geometry = chunkData.geometry;
          if (geometry.vertices && geometry.vertices.length > 0) {
            const firstVertex = geometry.vertices[0];
            const earthringPos = { x: firstVertex[0], y: firstVertex[1], z: firstVertex[2] };
            const threeJSPos = toThreeJS(earthringPos);
            console.log(`[Chunks] Rendered ${chunkID} (width: ${geometry.width}m) at EarthRing (${earthringPos.x.toFixed(1)}, ${earthringPos.y.toFixed(1)}, ${earthringPos.z}) → Three.js (${threeJSPos.x.toFixed(1)}, ${threeJSPos.y.toFixed(1)}, ${threeJSPos.z.toFixed(1)})`);
          } else {
            console.log(`[Chunks] Rendered ${chunkID} (width: ${geometry.width}m)`);
          }
        }
        return;
      } else {
        console.warn(`[Chunks] Failed to create mesh for ${chunkID}, falling back to placeholder`);
      }
    } else {
      // Chunk has no geometry - this is expected for chunks that haven't been generated yet
      // Only log if we're debugging
      if (window.earthring?.debug) {
        if (!chunkData.geometry) {
          console.log(`[Chunks] ${chunkID} has no geometry (not yet generated), using placeholder`);
        } else {
          console.log(`[Chunks] ${chunkID} has wrong geometry type (${chunkData.geometry?.type || 'none'}), using placeholder`);
        }
      }
    }
    
    // Fallback to placeholder if no geometry or geometry creation failed
    const placeholder = this.createChunkPlaceholder(chunkID, chunkData);
    if (placeholder) {
      this.scene.add(placeholder);
      this.chunkMeshes.set(chunkID, placeholder);
      // Only log placeholder rendering in debug mode
      if (window.earthring?.debug) {
        console.log(`[Chunks] Rendered placeholder for ${chunkID}`);
      }
    }
  }
  
  /**
   * Create a Three.js mesh from ring floor geometry data
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data with geometry
   * @returns {THREE.Mesh|null} Three.js mesh or null
   */
  createRingFloorMesh(chunkID, chunkData) {
    const geometry = chunkData.geometry;
    
    if (!geometry.vertices || !geometry.faces) {
      console.error(`[Chunks] Invalid geometry data for ${chunkID}:`, geometry);
      return null;
    }
    
    // Only log mesh creation details in debug mode
    if (window.earthring?.debug) {
      console.log(`[Chunks] Creating mesh for ${chunkID}:`, {
        vertexCount: geometry.vertices.length,
        faceCount: geometry.faces.length,
        width: geometry.width,
        length: geometry.length,
      });
    }
    
    // Create Three.js geometry
    const threeGeometry = new THREE.BufferGeometry();
    
    // Convert vertices to Three.js coordinates
    const positions = [];
    
    // Get camera position to wrap chunks relative to camera
    // We need the raw camera position (before wrapping) for correct wrapping calculations
    const camera = this.sceneManager.getCamera();
    const cameraThreeJSPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const cameraEarthRingPosRaw = fromThreeJS(cameraThreeJSPos);
    const RING_CIRCUMFERENCE = 264000000;
    // Use raw camera X (may be negative or very large) for wrapping calculation
    const cameraX = cameraEarthRingPosRaw.x || 0;
    
    // Determine chunk index and base position
    const chunkIndex = (chunkData.chunk_index ?? parseInt(chunkID.split('_')[1], 10)) || 0;
    const CHUNK_LENGTH = 1000;
    const chunkBaseX = chunkIndex * CHUNK_LENGTH;
    
    // Calculate an offset (multiple of ring circumference) that moves this chunk closest to the camera.
    const circumferenceOffsetMultiple = Math.round((cameraX - chunkBaseX) / RING_CIRCUMFERENCE);
    const chunkOffset = circumferenceOffsetMultiple * RING_CIRCUMFERENCE;
    
    // Process vertices
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    geometry.vertices.forEach(vertex => {
      // Shift vertex by the chunk offset so this chunk sits closest to the camera.
      const earthringX = vertex[0] + chunkOffset;
      
      const earthringPos = { x: earthringX, y: vertex[1], z: vertex[2] };
      const threeJSPos = toThreeJS(earthringPos);
      
      // Don't add Y offset - chunks should align perfectly when wrapping
      // The polygon offset in the material should handle z-fighting
      
      positions.push(threeJSPos.x, threeJSPos.y, threeJSPos.z);
      
      // Track bounds for debugging
      minX = Math.min(minX, threeJSPos.x);
      maxX = Math.max(maxX, threeJSPos.x);
      minY = Math.min(minY, threeJSPos.y);
      maxY = Math.max(maxY, threeJSPos.y);
      minZ = Math.min(minZ, threeJSPos.z);
      maxZ = Math.max(maxZ, threeJSPos.z);
    });
    
    // Debug: Log wrapping info for boundary chunks
    if (window.earthring?.debug && (chunkID.includes('26399') || chunkID.includes('_0'))) {
      console.log(`Chunk ${chunkID} wrapping: cameraX=${cameraX.toFixed(0)}, firstVertexX=${geometry.vertices[0][0]}, wrappedX=${wrapRingPosition(geometry.vertices[0][0])}, finalX=${minX > -10000 && minX < 10000 ? minX.toFixed(0) : 'far'}`);
    }
    
    // Debug: Log mesh bounds
    if (window.earthring?.debug) {
      console.log(`Chunk ${chunkID} mesh bounds:`, {
        x: [minX, maxX],
        y: [minY, maxY],
        z: [minZ, maxZ],
      });
    }
    
    // Process faces
    const indices = [];
    geometry.faces.forEach(face => {
      // Add triangle indices
      indices.push(face[0], face[1], face[2]);
    });
    
    // Set geometry attributes
    threeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    threeGeometry.setIndex(indices);
    
    // Compute vertex normals automatically (Three.js will handle this correctly)
    threeGeometry.computeVertexNormals();
    
    // Create material with color based on chunk width (wider chunks = different color)
    // Station flares will appear as wider, lighter-colored chunks
    const baseColor = 0x666666; // Base gray
    const width = geometry.width || 400; // Default to 400m if not provided
    // Wider chunks (near stations) get lighter color for visual distinction
    const colorIntensity = Math.min(1.0, (width / 25000) * 0.5 + 0.5); // Scale from 0.5 to 1.0 based on width
    const color = new THREE.Color(baseColor).multiplyScalar(colorIntensity);
    
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.1,
      roughness: 0.8,
      side: THREE.DoubleSide, // Render both sides of the plane
      polygonOffset: true, // Enable polygon offset to prevent z-fighting
      polygonOffsetFactor: chunkIndex % 10, // Vary offset factor per chunk
      polygonOffsetUnits: 1, // Units for polygon offset
      depthWrite: true,
      depthTest: true,
    });
    
    // Create mesh
    const mesh = new THREE.Mesh(threeGeometry, material);
    mesh.userData.chunkID = chunkID;
    mesh.userData.chunkData = chunkData;
    
    // Disable frustum culling for wrapped chunks to ensure they're always visible
    // This is important because chunks may be wrapped to positions that are technically
    // "behind" the camera but should still be visible due to ring wrapping
    mesh.frustumCulled = false;
    
    // Use renderOrder to ensure consistent rendering order (helps with transparency)
    mesh.renderOrder = chunkIndex % 1000; // Use modulo to keep values reasonable
    
    // Debug: Log mesh position and visibility info
    if (window.earthring?.debug) {
      // Calculate mesh center
      threeGeometry.computeBoundingBox();
      const center = new THREE.Vector3();
      threeGeometry.boundingBox.getCenter(center);
      console.log(`Chunk ${chunkID} mesh created:`, {
        position: mesh.position,
        center: center,
        boundingBox: threeGeometry.boundingBox,
        visible: mesh.visible,
        material: material.color.getHexString(),
      });
    }
    
    return mesh;
  }
  
  /**
   * Create a placeholder mesh for a chunk (Phase 1: empty chunks)
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data
   * @returns {THREE.Mesh|null} Placeholder mesh or null
   */
  createChunkPlaceholder(chunkID, chunkData) {
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
    
    return mesh;
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

