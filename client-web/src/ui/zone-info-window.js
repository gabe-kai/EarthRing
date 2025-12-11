/**
 * Zone Info Window
 * Displays information about a selected zone with a Dezone button
 */

import { deleteZone } from '../api/zone-service.js';

let infoWindow = null;
let currentZone = null; // Track current zone for structure count updates
let currentGameStateManager = null; // Track gameStateManager for updates
let structureUpdateListeners = []; // Track listeners for cleanup

/**
 * Hide the zone info window
 */
export function hideZoneInfoWindow() {
  // Clean up structure update listeners
  if (currentGameStateManager && structureUpdateListeners.length > 0) {
    structureUpdateListeners.forEach(({ event, callback }) => {
      currentGameStateManager.off(event, callback);
    });
    structureUpdateListeners = [];
  }
  
  if (infoWindow) {
    infoWindow.remove();
    infoWindow = null;
  }
  
  currentZone = null;
  currentGameStateManager = null;
}

export function showZoneInfoWindow(zone, onDelete, gameStateManager = null) {
  // Remove existing window if present
  hideZoneInfoWindow();
  
  // Store current zone and gameStateManager for updates
  currentZone = zone;
  currentGameStateManager = gameStateManager;
  
  // Debug: Log zone data to verify area field
  console.log('[ZoneInfoWindow] Zone data:', {
    id: zone.id,
    zone_type: zone.zone_type,
    floor: zone.floor,
    area: zone.area,
    owner_id: zone.owner_id,
    created_at: zone.created_at,
    hasGeometry: !!zone.geometry,
  });
  
  infoWindow = document.createElement('div');
  infoWindow.id = 'zone-info-window';
  infoWindow.className = 'zone-info-window';
  
  // Format zone type for display
  const zoneTypeDisplay = zone.zone_type
    ? zone.zone_type.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ')
    : 'Unknown';
  
  // Use area from database (calculated by PostGIS ST_Area)
  // Fallback to 'N/A' if area is not available
  let areaDisplay = 'N/A';
  if (zone.area !== undefined && zone.area !== null) {
    // Area is in square meters from PostGIS
    areaDisplay = `${zone.area.toFixed(2)} m²`;
  }
  
  infoWindow.innerHTML = `
    <div class="zone-info-content">
      <div class="zone-info-header">
        <h3>${zone.name || `Zone ${zone.id}`} <span style="color: #888; font-size: 0.85rem; font-weight: normal;">(ID: ${zone.id})</span></h3>
        <button class="zone-info-close" id="zone-info-close">×</button>
      </div>
      <div class="zone-info-body">
        <div class="zone-info-row">
          <span class="zone-info-label">Type:</span>
          <span class="zone-info-value">${zoneTypeDisplay}</span>
        </div>
        <div class="zone-info-row">
          <span class="zone-info-label">Floor:</span>
          <span class="zone-info-value">${zone.floor ?? 0}</span>
        </div>
        <div class="zone-info-row">
          <span class="zone-info-label">Area:</span>
          <span class="zone-info-value">${areaDisplay}</span>
        </div>
        <div class="zone-info-row">
          <span class="zone-info-label">Structures:</span>
          <span class="zone-info-value" id="zone-structure-count">Loading...</span>
        </div>
        ${zone.owner_id ? `
        <div class="zone-info-row">
          <span class="zone-info-label">Owner:</span>
          <span class="zone-info-value">${zone.owner_id}</span>
        </div>
        ` : ''}
        ${zone.created_at ? `
        <div class="zone-info-row">
          <span class="zone-info-label">Created:</span>
          <span class="zone-info-value">${new Date(zone.created_at).toLocaleDateString()}</span>
        </div>
        ` : ''}
      </div>
      ${!(zone.is_system_zone === true) ? `
      <div class="zone-info-actions">
        <button class="zone-info-button dezone-button" id="zone-info-dezone">
          Dezone
        </button>
      </div>
      ` : `
      <div class="zone-info-actions">
        <div class="zone-info-system-note" style="color: #888; font-size: 0.85rem; font-style: italic; text-align: center; padding: 0.5rem;">
          System zones cannot be deleted
        </div>
      </div>
      `}
    </div>
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    .zone-info-window {
      position: fixed;
      bottom: 120px;
      right: 20px;
      background: rgba(17, 17, 17, 0.95);
      border: 2px solid #4caf50;
      border-radius: 12px;
      padding: 0;
      width: 320px;
      max-width: 90vw;
      z-index: 10002;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(10px);
    }
    .zone-info-content {
      padding: 1.25rem;
    }
    .zone-info-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      border-bottom: 1px solid #333;
      padding-bottom: 0.75rem;
    }
    .zone-info-header h3 {
      color: #4caf50;
      margin: 0;
      font-size: 1.1rem;
    }
    .zone-info-close {
      background: #f44336;
      color: white;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .zone-info-close:hover {
      background: #d32f2f;
    }
    .zone-info-body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .zone-info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .zone-info-label {
      color: #888;
      font-size: 0.9rem;
    }
    .zone-info-value {
      color: #fff;
      font-size: 0.9rem;
      font-weight: 500;
    }
    .zone-info-actions {
      display: flex;
      gap: 0.5rem;
    }
    .zone-info-button {
      flex: 1;
      padding: 0.65rem 1rem;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s ease;
    }
    .dezone-button {
      background: #f44336;
      color: white;
    }
    .dezone-button:hover {
      background: #d32f2f;
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(infoWindow);
  
  // Initial structure count
  updateStructureCount();
  
  // Listen for structure additions/updates to update count dynamically
  if (gameStateManager) {
    const onStructureAdded = () => updateStructureCount();
    const onStructureUpdated = () => updateStructureCount();
    
    gameStateManager.on('structureAdded', onStructureAdded);
    gameStateManager.on('structureUpdated', onStructureUpdated);
    
    // Store listeners for cleanup
    structureUpdateListeners = [
      { event: 'structureAdded', callback: onStructureAdded },
      { event: 'structureUpdated', callback: onStructureUpdated }
    ];
    
    // Debug logging (always log when debug mode is on, not just when window opens)
    if (window.earthring?.debug) {
      const structures = gameStateManager.getAllStructures();
      const zoneIdNum = typeof zone.id === 'string' ? parseInt(zone.id, 10) : Number(zone.id);
      
      // Get all structures with zone_id and their IDs
      const structuresWithZoneId = structures.filter(s => s && s.zone_id != null);
      const matchingStructures = structures.filter(s => {
        if (!s || s.zone_id === null || s.zone_id === undefined) {
          return false;
        }
        const sZoneIdNum = typeof s.zone_id === 'string' ? parseInt(s.zone_id, 10) : Number(s.zone_id);
        const sZoneIdStr = String(s.zone_id);
        return sZoneIdNum === zoneIdNum || sZoneIdStr === String(zone.id);
      });
      
      console.log(`[ZoneInfo] Zone ${zone.id} structure count analysis:`, {
        zoneId: zone.id,
        zoneIdType: typeof zone.id,
        zoneIdNum,
        totalStructures: structures.length,
        structuresWithZoneId: structuresWithZoneId.length,
        matchingCount: matchingStructures.length,
        sampleStructureZoneIds: structures.slice(0, 20).map(s => ({
          id: s?.id,
          zone_id: s?.zone_id,
          zone_id_type: typeof s?.zone_id,
          structure_type: s?.structure_type
        })),
        matchingStructureIds: matchingStructures.map(s => s.id),
        allUniqueZoneIds: [...new Set(structuresWithZoneId.map(s => String(s.zone_id)))].slice(0, 10)
      });
    }
  } else {
    const countElement = document.getElementById('zone-structure-count');
    if (countElement) {
      countElement.textContent = 'N/A';
    }
  }
  
  // Set up event listeners
  document.getElementById('zone-info-close').addEventListener('click', () => {
    hideZoneInfoWindow();
  });
  
  // Only add delete button listener if this is not a system zone
  if (!(zone.is_system_zone === true)) {
    const dezoneButton = document.getElementById('zone-info-dezone');
    if (dezoneButton) {
      dezoneButton.addEventListener('click', async () => {
        const { showConfirmationModal } = await import('./game-modal.js');
        const confirmed = await showConfirmationModal({
          title: 'Delete Zone',
          message: `Are you sure you want to delete zone "${zone.name || zone.id}"?`,
          checkboxLabel: 'I understand this zone will be permanently deleted',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          confirmColor: '#ff4444'
        });
        
        if (!confirmed) {
          return;
        }
        
        try {
          await deleteZone(zone.id);
          if (onDelete) {
            onDelete(zone.id);
          }
          hideZoneInfoWindow();
        } catch (error) {
          console.error('Failed to delete zone:', error);
          alert(`Failed to delete zone: ${error.message}`);
        }
      });
    }
  }
}


