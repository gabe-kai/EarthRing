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
    
    // Zone cache: Map<zoneID, zoneData>
    this.zones = new Map();
    
    // Player state
    this.playerState = {
      id: null,
      username: null,
      position: { x: 0, y: 0, z: 0 }, // EarthRing coordinates
      authenticated: false,
    };
    
    // Active floor (independent of camera elevation)
    // This determines which floor's zones/chunks are loaded and where actions occur
    this.activeFloor = 0;
    
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
      zoneAdded: [],
      zoneUpdated: [],
      zoneRemoved: [],
      zonesCleared: [],
      activeFloorChanged: [],
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
   * Replace the zone cache with the provided list.
   * Emits add/update/remove events based on differences.
   * @param {Array<Object>} zones
   */
  setZones(zones = []) {
    if (!Array.isArray(zones)) {
      return;
    }

    const incomingIDs = new Set();

    zones.forEach(zone => {
      if (!zone || typeof zone.id === 'undefined') {
        return;
      }
      incomingIDs.add(zone.id);
      if (this.zones.has(zone.id)) {
        this.zones.set(zone.id, zone);
        this.emit('zoneUpdated', { zone });
      } else {
        this.zones.set(zone.id, zone);
        this.emit('zoneAdded', { zone });
      }
    });

    // Remove zones that are no longer present
    Array.from(this.zones.keys()).forEach(zoneID => {
      if (!incomingIDs.has(zoneID)) {
        const removedZone = this.zones.get(zoneID);
        this.zones.delete(zoneID);
        this.emit('zoneRemoved', { zoneID, zone: removedZone });
      }
    });
  }

  /**
   * Add or update a single zone in the cache.
   * @param {Object} zone
   */
  upsertZone(zone) {
    if (!zone || typeof zone.id === 'undefined') {
      return;
    }
    const exists = this.zones.has(zone.id);
    this.zones.set(zone.id, zone);
    this.emit(exists ? 'zoneUpdated' : 'zoneAdded', { zone });
  }

  /**
   * Remove a zone by ID.
   * @param {number|string} zoneID
   */
  removeZone(zoneID) {
    if (!this.zones.has(zoneID)) {
      return false;
    }
    const removedZone = this.zones.get(zoneID);
    this.zones.delete(zoneID);
    this.emit('zoneRemoved', { zoneID, zone: removedZone });
    return true;
  }

  /**
   * Clear all zones from cache.
   */
  clearZones() {
    if (this.zones.size === 0) {
      return;
    }
    this.zones.clear();
    this.emit('zonesCleared');
  }

  /**
   * Get a zone by ID.
   * @param {number|string} zoneID
   * @returns {Object|null}
   */
  getZone(zoneID) {
    return this.zones.get(zoneID) || null;
  }

  /**
   * Get all zones as an array.
   * @returns {Array<Object>}
   */
  getAllZones() {
    return Array.from(this.zones.values());
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
   * Get the active floor (independent of camera elevation)
   * @returns {number} Active floor (-2 to 2 for main ring)
   */
  getActiveFloor() {
    return this.activeFloor;
  }
  
  /**
   * Set the active floor and emit change event
   * @param {number} floor - Floor number (-2 to 2 for main ring)
   */
  setActiveFloor(floor) {
    const oldFloor = this.activeFloor;
    // Clamp to valid range
    this.activeFloor = Math.max(-2, Math.min(2, Math.round(floor)));
    if (oldFloor !== this.activeFloor) {
      this.emit('activeFloorChanged', { oldFloor, newFloor: this.activeFloor });
    }
  }
  
  /**
   * Reset game state (useful for logout or reset)
   */
  reset() {
    this.clearChunks();
    this.clearZones();
    this.playerState = {
      id: null,
      username: null,
      position: { x: 0, y: 0, z: 0 },
      authenticated: false,
    };
    this.activeFloor = 0;
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

