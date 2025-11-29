/**
 * Chunk Manager
 * Handles chunk loading, caching, and basic visualization
 */

import { wsClient } from '../network/websocket-client.js';
import { positionToChunkIndex, toThreeJS, wrapRingPosition, fromThreeJS } from '../utils/coordinates-new.js';
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
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
    
    // Listen to game state changes
    this.setupStateListeners();
    
    // Store re-render threshold
    this.WRAP_RE_RENDER_THRESHOLD = WRAP_RE_RENDER_THRESHOLD;
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
      // stream_delta can contain chunks, zones, or both
      if (data.chunks && Array.isArray(data.chunks)) {
        console.log(`[Chunks] stream_delta received: ${data.chunks.length} chunks`);
        this.handleChunkData({ chunks: data.chunks });
      }
      // Also check for chunk_delta structure (for removed chunks)
      if (data.chunk_delta) {
        const delta = data.chunk_delta;
        const removed = delta.RemovedChunks || [];
        if (removed.length > 0) {
          console.log(`[Chunks] stream_delta: Removing ${removed.length} chunks:`, removed);
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
      if (window.earthring?.debug) {
        console.log('[Chunks] Pose update acknowledged (async):', data);
      }
      // Handle chunk delta if provided (removed chunks need to be cleaned up)
      if (data.chunk_delta) {
        const delta = data.chunk_delta;
        // Go struct fields are capitalized (RemovedChunks)
        const removed = delta.RemovedChunks || [];
        if (removed.length > 0) {
          console.log(`[Chunks] Removing ${removed.length} chunks from async pose update:`, removed);
          removed.forEach(chunkID => {
            this.removeChunkMesh(chunkID);
            this.gameStateManager.removeChunk(chunkID);
          });
        }
      }
    });
    
    // Handle stream_ack messages (subscription confirmation)
    wsClient.on('stream_ack', (data) => {
      if (window.earthring?.debug) {
        console.log('[Chunks] Streaming subscription confirmed:', data);
      }
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

    console.log(`[Chunks] updateStreamingPose: subscription_id=${this.streamingSubscriptionID}, arc_length=${arc.s.toFixed(0)}, theta=${polar.theta.toFixed(4)}, floor=${floor}`);

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

      console.log(`[Chunks] stream_update_pose response:`, response);

      // Update stored position
      this.lastSubscriptionPosition = wrappedRingPosition;
      
      // Handle chunk delta if provided
      if (response.chunk_delta) {
        const delta = response.chunk_delta;
        // Go struct fields are capitalized (AddedChunks, RemovedChunks)
        const added = delta.AddedChunks || [];
        const removed = delta.RemovedChunks || [];
        // Log chunk delta changes (especially near boundaries)
        const cameraX = this.getCurrentCameraX();
        const isNearBoundary = cameraX > 263990000 || cameraX < 10000;
        if (added.length > 0 || removed.length > 0 || isNearBoundary) {
          console.log(`[Chunks] Chunk delta at cameraX=${cameraX.toFixed(1)}: added=${added.length}, removed=${removed.length}`);
          if (isNearBoundary && (added.length > 0 || removed.length > 0)) {
            console.log(`[Chunks] Near boundary - added chunks: ${added.slice(0, 5).join(', ')}${added.length > 5 ? '...' : ''}`);
            console.log(`[Chunks] Near boundary - removed chunks: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? '...' : ''}`);
          }
        }
        
        // Handle removed chunks immediately
        if (removed.length > 0) {
          const cameraX = this.getCurrentCameraX();
          // Log only if we're removing many chunks (potential issue) or near boundaries
          const chunkIndices = removed.map(id => {
            const parts = id.split('_');
            return parts.length >= 2 ? parseInt(parts[1], 10) : null;
          }).filter(idx => idx !== null);
          const isBoundary = chunkIndices.some(idx => idx < 10 || idx > 263990);
          
          if (removed.length > 5 || isBoundary) {
            console.warn(`[Chunks] Removing ${removed.length} chunks from pose update at cameraX=${cameraX.toFixed(0)}:`, removed.slice(0, 10));
          }
          
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

    console.log(`[Chunks] subscribeToStreaming: raw=${ringPosition.toFixed(0)}, wrapped=${wrappedRingPosition.toFixed(0)}, arc_length=${arc.s.toFixed(0)}, theta=${polar.theta.toFixed(6)}, r=${polar.r.toFixed(2)}, z=${polar.z.toFixed(2)}, floor=${floor}, radius=${radiusMeters}m`);
    console.log(`[Chunks] subscribeToStreaming: conversion chain: raw=${ringPosition.toFixed(0)} → theta=${polar.theta.toFixed(6)} → arc=${arc.s.toFixed(0)}`);

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

      console.log(`[Chunks] stream_subscribe response:`, response);

      this.streamingSubscriptionID = response.subscription_id;
      // Store wrapped position for consistent distance calculations
      this.lastSubscriptionPosition = wrappedRingPosition;
      this.subscriptionRadiusMeters = radiusMeters;
      this.subscriptionWidthMeters = widthMeters;
      console.log(`[Chunks] Subscription stored: ID=${this.streamingSubscriptionID}, position=${this.lastSubscriptionPosition.toFixed(0)}`);
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
    // DEBUG: Always log this call to track what's happening
    console.log(`[Chunks] requestChunksAtPosition called: position=${ringPosition.toFixed(0)}, floor=${floor}, streaming=${this.useStreaming}, hasSubscription=${!!this.streamingSubscriptionID}`);
    
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
        
        console.log(`[Chunks] Distance calc: raw=${ringPosition.toFixed(0)}, wrapped=${wrappedCurrent.toFixed(0)}, last=${this.lastSubscriptionPosition.toFixed(0)}, lastWrapped=${wrappedLast.toFixed(0)}, distance=${distanceMoved.toFixed(0)}m, chunkChanged=${chunkChanged} (${lastChunkIndex}→${currentChunkIndex})`);
      } else {
        console.log(`[Chunks] First subscription update (no last position)`);
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
      
      console.log(`[Chunks] Should update subscription: ${shouldUpdate} (lastPos=${this.lastSubscriptionPosition}, distance=${distanceMoved.toFixed(0)}m, chunkChanged=${chunkChanged}, floorChanged=${this.lastSubscriptionFloor !== floor})`);
      
      if (shouldUpdate) {
        console.log(`[Chunks] Updating streaming pose (moved ${distanceMoved.toFixed(0)}m, chunk changed: ${chunkChanged}, from ${this.lastSubscriptionPosition?.toFixed(0)} to ${ringPosition.toFixed(0)})`);
        // Update pose using stream_update_pose instead of re-subscribing
        try {
          await this.updateStreamingPose(ringPosition, floor);
          this.lastSubscriptionFloor = floor;
          console.log(`[Chunks] Pose updated successfully`);
        } catch (error) {
          console.error('[Chunks] Failed to update streaming pose:', error);
          throw error;
        }
      } else {
        console.log(`[Chunks] Pose NOT updated (distance: ${distanceMoved.toFixed(0)}m, chunk changed: ${chunkChanged})`);
      }
      return;
    }
    
    // If we don't have a subscription, create one
    if (!this.streamingSubscriptionID) {
      console.log('[Chunks] No streaming subscription found, creating one...');
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
      console.log(`[Chunks] Extracting ${chunkData.zones.length} zone(s) from boundary chunk ${chunkID}`);
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
      console.log(`[Chunks] Extracted ${zones.length} valid zone(s) from chunk ${chunkID}, passing to zone manager`);
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
    console.log(`[Chunks] Received ${data.chunks.length} chunk(s) from server: [${chunkIDs}] (${chunksWithZones} with zones)`);
    
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
    // Zones will be extracted in the chunkAdded event handler
    processedChunks.forEach(chunkData => {
      if (chunkData) {
        // Log if chunk has zones (especially for boundary chunks)
        const chunkIndex = parseInt(chunkData.id?.split('_')[1], 10);
        const isBoundary = chunkIndex !== null && (chunkIndex < 10 || chunkIndex > 263990);
        if (isBoundary && chunkData.zones) {
          const zoneCount = Array.isArray(chunkData.zones) ? chunkData.zones.length : 0;
          if (zoneCount > 0) {
            console.log(`[Chunks] Chunk ${chunkData.id} (boundary) has ${zoneCount} zone(s) before adding to state`);
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
    const placeholder = this.createChunkPlaceholder(chunkID, chunkData, cameraX);
    if (placeholder) {
      placeholder.userData.chunkVersionToken = newVersionToken || chunkID;
      placeholder.userData.lastCameraXUsed = cameraX;
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
    
    // DEBUG: Only log near boundaries where issues occur
    const isBoundary = chunkIndex < 10 || chunkIndex > 263990;
    if (isBoundary || window.earthring?.debug) {
      console.log(`[Chunks] Rendering ${chunkID}: cameraX=${cameraX.toFixed(0)}, chunkIndex=${chunkIndex}, cameraXOverride=${cameraXOverride}`);
    }
    const CHUNK_LENGTH = 1000;
    const chunkBaseX = chunkIndex * CHUNK_LENGTH;
    
    // Calculate an offset (multiple of ring circumference) that moves this chunk closest to the camera.
    const circumferenceOffsetMultiple = Math.round((cameraX - chunkBaseX) / NEW_RING_CIRCUMFERENCE);
    const chunkOffset = circumferenceOffsetMultiple * NEW_RING_CIRCUMFERENCE;
    const chunkOriginX = chunkBaseX + chunkOffset;
    
    // DEBUG: Only log near boundaries
    if (isBoundary || window.earthring?.debug) {
      console.log(`[Chunks] Chunk ${chunkID} positioning: chunkIndex=${chunkIndex}, chunkBaseX=${chunkBaseX.toFixed(0)}, cameraX=${cameraX.toFixed(0)}, offsetMultiple=${circumferenceOffsetMultiple}, chunkOffset=${chunkOffset.toFixed(0)}, chunkOriginX=${chunkOriginX.toFixed(0)}`);
    }
    
    // Process vertices
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
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
    mesh.position.x = chunkOriginX;
    
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

