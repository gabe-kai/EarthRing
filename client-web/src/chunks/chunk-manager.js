/**
 * Chunk Manager
 * Handles chunk loading, caching, and basic visualization
 */

import { wsClient } from '../network/websocket-client.js';
import { positionToChunkIndex, toThreeJS } from '../utils/coordinates.js';
import { createMeshAtEarthRingPosition } from '../utils/rendering.js';
import * as THREE from 'three';

/**
 * Chunk Manager class
 * Manages chunk requests, caching, and rendering
 */
export class ChunkManager {
  constructor(sceneManager, gameStateManager) {
    this.sceneManager = sceneManager;
    this.gameStateManager = gameStateManager;
    this.scene = sceneManager.getScene();
    
    // Map of chunk IDs to Three.js meshes
    this.chunkMeshes = new Map();
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
    
    // Listen to game state changes
    this.setupStateListeners();
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
    // When a chunk is added to state, render it
    this.gameStateManager.on('chunkAdded', ({ chunkID, chunkData }) => {
      this.renderChunk(chunkID, chunkData);
    });
    
    // When a chunk is removed from state, remove its mesh
    this.gameStateManager.on('chunkRemoved', ({ chunkID }) => {
      this.removeChunkMesh(chunkID);
    });
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
        chunks: chunkIDs,
        lod_level: lodLevelStr,
      });
    } catch (error) {
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
    
    // Generate chunk IDs for the requested range
    for (let i = -radius; i <= radius; i++) {
      const chunkIndex = (centerChunkIndex + i + 264000) % 264000; // Wrap around
      chunkIDs.push(`${floor}_${chunkIndex}`);
    }
    
    return this.requestChunks(chunkIDs, lodLevel);
  }
  
  /**
   * Handle chunk data received from server
   * @param {Object} data - Chunk data from server
   */
  handleChunkData(data) {
    if (!data.chunks || !Array.isArray(data.chunks)) {
      console.error('Invalid chunk_data format:', data);
      return;
    }
    
    console.log(`Received ${data.chunks.length} chunk(s) from server`);
    
    data.chunks.forEach(chunkData => {
      if (!chunkData.id) {
        console.error('Chunk data missing ID:', chunkData);
        return;
      }
      
      console.log(`Processing chunk ${chunkData.id}:`, {
        hasGeometry: !!chunkData.geometry,
        geometryType: chunkData.geometry?.type,
        structures: chunkData.structures?.length || 0,
        zones: chunkData.zones?.length || 0,
      });
      
      // Store chunk in game state
      this.gameStateManager.addChunk(chunkData.id, chunkData);
    });
  }
  
  /**
   * Render a chunk in the scene
   * @param {string} chunkID - Chunk ID
   * @param {Object} chunkData - Chunk data
   */
  renderChunk(chunkID, chunkData) {
    // Remove existing mesh if present
    this.removeChunkMesh(chunkID);
    
    // Check if chunk has geometry data
    if (chunkData.geometry && chunkData.geometry.type === 'ring_floor') {
      console.log(`Rendering chunk ${chunkID} with ring floor geometry`);
      // Render actual geometry (Phase 2)
      const mesh = this.createRingFloorMesh(chunkID, chunkData);
      if (mesh) {
        this.scene.add(mesh);
        this.chunkMeshes.set(chunkID, mesh);
        console.log(`Successfully rendered chunk ${chunkID} mesh`);
        return;
      } else {
        console.warn(`Failed to create mesh for chunk ${chunkID}, falling back to placeholder`);
      }
    } else {
      console.log(`Chunk ${chunkID} has no geometry or wrong type, using placeholder`);
    }
    
    // Fallback to placeholder if no geometry or geometry creation failed
    const placeholder = this.createChunkPlaceholder(chunkID, chunkData);
    if (placeholder) {
      this.scene.add(placeholder);
      this.chunkMeshes.set(chunkID, placeholder);
      console.log(`Rendered placeholder for chunk ${chunkID}`);
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
      console.error('Invalid geometry data for chunk:', chunkID, geometry);
      return null;
    }
    
    console.log(`Creating ring floor mesh for chunk ${chunkID}:`, {
      vertexCount: geometry.vertices.length,
      faceCount: geometry.faces.length,
      width: geometry.width,
      length: geometry.length,
    });
    
    // Create Three.js geometry
    const threeGeometry = new THREE.BufferGeometry();
    
    // Convert vertices to Three.js coordinates
    const positions = [];
    
    // Process vertices
    geometry.vertices.forEach(vertex => {
      const earthringPos = { x: vertex[0], y: vertex[1], z: vertex[2] };
      const threeJSPos = toThreeJS(earthringPos);
      positions.push(threeJSPos.x, threeJSPos.y, threeJSPos.z);
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
    
    // Compute vertex normals automatically (Three.js will handle this correctly)
    threeGeometry.computeVertexNormals();
    
    // Create material (make it more visible)
    const material = new THREE.MeshStandardMaterial({
      color: 0x888888, // Lighter gray for better visibility
      metalness: 0.1,
      roughness: 0.8,
      side: THREE.DoubleSide, // Render both sides of the plane
    });
    
    // Create mesh
    const mesh = new THREE.Mesh(threeGeometry, material);
    mesh.userData.chunkID = chunkID;
    mesh.userData.chunkData = chunkData;
    
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

