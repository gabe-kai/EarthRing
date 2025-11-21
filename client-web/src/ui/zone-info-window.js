/**
 * Zone Info Window
 * Displays information about a selected zone with a Dezone button
 */

import { deleteZone } from '../api/zone-service.js';

let infoWindow = null;

export function showZoneInfoWindow(zone, onDelete) {
  // Remove existing window if present
  hideZoneInfoWindow();
  
  infoWindow = document.createElement('div');
  infoWindow.id = 'zone-info-window';
  infoWindow.className = 'zone-info-window';
  
  // Format zone type for display
  const zoneTypeDisplay = zone.zone_type
    ? zone.zone_type.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ')
    : 'Unknown';
  
  // Calculate area if geometry is available
  let areaDisplay = 'N/A';
  if (zone.geometry && zone.geometry.coordinates && zone.geometry.coordinates[0]) {
    try {
      const coords = zone.geometry.coordinates[0];
      let area = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        area += coords[i][0] * coords[i + 1][1];
        area -= coords[i + 1][0] * coords[i][1];
      }
      area = Math.abs(area / 2);
      areaDisplay = `${area.toFixed(0)} m²`;
    } catch (e) {
      // Ignore calculation errors
    }
  }
  
  infoWindow.innerHTML = `
    <div class="zone-info-content">
      <div class="zone-info-header">
        <h3>${zone.name || `Zone ${zone.id}`}</h3>
        <button class="zone-info-close" id="zone-info-close">×</button>
      </div>
      <div class="zone-info-body">
        <div class="zone-info-row">
          <span class="zone-info-label">Type:</span>
          <span class="zone-info-value">${zoneTypeDisplay}</span>
        </div>
        <div class="zone-info-row">
          <span class="zone-info-label">ID:</span>
          <span class="zone-info-value">${zone.id}</span>
        </div>
        <div class="zone-info-row">
          <span class="zone-info-label">Floor:</span>
          <span class="zone-info-value">${zone.floor ?? 0}</span>
        </div>
        <div class="zone-info-row">
          <span class="zone-info-label">Area:</span>
          <span class="zone-info-value">${areaDisplay}</span>
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
      <div class="zone-info-actions">
        <button class="zone-info-button dezone-button" id="zone-info-dezone">
          Dezone
        </button>
      </div>
    </div>
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    .zone-info-window {
      position: fixed;
      top: 20px;
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
  
  // Set up event listeners
  document.getElementById('zone-info-close').addEventListener('click', () => {
    hideZoneInfoWindow();
  });
  
  document.getElementById('zone-info-dezone').addEventListener('click', async () => {
    if (!confirm(`Are you sure you want to delete zone "${zone.name || zone.id}"?`)) {
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

export function hideZoneInfoWindow() {
  if (infoWindow) {
    infoWindow.remove();
    infoWindow = null;
  }
}

