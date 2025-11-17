/**
 * Game State Manager
 * Manages local game state including chunks, player state, and connection state
 */

/**
 * Game State Manager class
 * Centralized state management for the client
 */
export class GameStateManager {
  constructor() {
    // Chunk cache: Map<chunkID, chunkData>
    // chunkID format: "floor_chunk_index" (e.g., "0_12345")
    this.chunks = new Map();
    
    // Player state
    this.playerState = {
      id: null,
      username: null,
      position: { x: 0, y: 0, z: 0 }, // EarthRing coordinates
      authenticated: false,
    };
    
    // Connection state
    this.connectionState = {
      websocket: {
        connected: false,
        connecting: false,
        lastError: null,
      },
      api: {
        baseURL: null,
        authenticated: false,
      },
    };
    
    // Event listeners for state changes
    this.listeners = {
      chunkAdded: [],
      chunkRemoved: [],
      playerStateChanged: [],
      connectionStateChanged: [],
    };
  }
  
  /**
   * Add a chunk to the cache
   * @param {string} chunkID - Chunk ID (format: "floor_chunk_index")
   * @param {Object} chunkData - Chunk data
   */
  addChunk(chunkID, chunkData) {
    this.chunks.set(chunkID, chunkData);
    this.emit('chunkAdded', { chunkID, chunkData });
  }
  
  /**
   * Remove a chunk from the cache
   * @param {string} chunkID - Chunk ID
   */
  removeChunk(chunkID) {
    const removed = this.chunks.delete(chunkID);
    if (removed) {
      this.emit('chunkRemoved', { chunkID });
    }
    return removed;
  }
  
  /**
   * Get a chunk from the cache
   * @param {string} chunkID - Chunk ID
   * @returns {Object|null} Chunk data or null if not found
   */
  getChunk(chunkID) {
    return this.chunks.get(chunkID) || null;
  }
  
  /**
   * Check if a chunk exists in the cache
   * @param {string} chunkID - Chunk ID
   * @returns {boolean}
   */
  hasChunk(chunkID) {
    return this.chunks.has(chunkID);
  }
  
  /**
   * Get all chunks
   * @returns {Map} Map of all chunks
   */
  getAllChunks() {
    return this.chunks;
  }
  
  /**
   * Clear all chunks from cache
   */
  clearChunks() {
    const chunkIDs = Array.from(this.chunks.keys());
    this.chunks.clear();
    chunkIDs.forEach(chunkID => {
      this.emit('chunkRemoved', { chunkID });
    });
  }
  
  /**
   * Update player state
   * @param {Object} updates - Partial player state updates
   */
  updatePlayerState(updates) {
    const oldState = { ...this.playerState };
    this.playerState = { ...this.playerState, ...updates };
    this.emit('playerStateChanged', { oldState, newState: this.playerState });
  }
  
  /**
   * Get player state
   * @returns {Object} Player state
   */
  getPlayerState() {
    return { ...this.playerState };
  }
  
  /**
   * Update connection state
   * @param {string} type - Connection type ('websocket' or 'api')
   * @param {Object} updates - Partial connection state updates
   */
  updateConnectionState(type, updates) {
    const oldState = { ...this.connectionState[type] };
    this.connectionState[type] = { ...this.connectionState[type], ...updates };
    this.emit('connectionStateChanged', { 
      type, 
      oldState, 
      newState: this.connectionState[type] 
    });
  }
  
  /**
   * Get connection state
   * @param {string} type - Connection type ('websocket' or 'api')
   * @returns {Object} Connection state
   */
  getConnectionState(type) {
    return { ...this.connectionState[type] };
  }
  
  /**
   * Register an event listener
   * @param {string} event - Event name ('chunkAdded', 'chunkRemoved', 'playerStateChanged', 'connectionStateChanged')
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }
  
  /**
   * Remove an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function to remove
   */
  off(event, callback) {
    if (this.listeners[event]) {
      const index = this.listeners[event].indexOf(callback);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }
  
  /**
   * Emit an event to all listeners
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }
  
  /**
   * Reset game state (useful for logout or reset)
   */
  reset() {
    this.clearChunks();
    this.playerState = {
      id: null,
      username: null,
      position: { x: 0, y: 0, z: 0 },
      authenticated: false,
    };
    this.connectionState = {
      websocket: {
        connected: false,
        connecting: false,
        lastError: null,
      },
      api: {
        baseURL: null,
        authenticated: false,
      },
    };
  }
}

