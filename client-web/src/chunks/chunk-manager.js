/**
 * Chunk Manager
 * Handles chunk loading, caching, and basic visualization
 */

import { wsClient } from '../network/websocket-client.js';
import { positionToChunkIndex } from '../utils/coordinates.js';
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
   * @param {number} lodLevel - Level of detail (0-3)
   * @returns {Promise} Promise that resolves when request is sent
   */
  async requestChunks(chunkIDs, lodLevel = 0) {
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
    
    // Validate LOD level
    if (lodLevel < 0 || lodLevel > 3) {
      throw new Error('LOD level must be between 0 and 3');
    }
    
    try {
      // Send chunk request via WebSocket
      await wsClient.request('chunk_request', {
        chunks: chunkIDs,
        lod_level: lodLevel,
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
   * @param {number} lodLevel - Level of detail (0-3)
   * @returns {Promise} Promise that resolves when request is sent
   */
  async requestChunksAtPosition(ringPosition, floor, radius = 1, lodLevel = 0) {
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
    
    data.chunks.forEach(chunkData => {
      if (!chunkData.id) {
        console.error('Chunk data missing ID:', chunkData);
        return;
      }
      
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
    
    // For Phase 1, chunks are empty (no geometry yet)
    // Create a placeholder visualization
    const placeholder = this.createChunkPlaceholder(chunkID, chunkData);
    
    if (placeholder) {
      this.scene.add(placeholder);
      this.chunkMeshes.set(chunkID, placeholder);
    }
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

