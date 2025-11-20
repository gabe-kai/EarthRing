/**
 * Zone Management UI
 * Basic scaffolding for listing and creating zones via the API.
 */

import { isAuthenticated, getCurrentUser } from '../auth/auth-service.js';
import { createZone, fetchZonesByOwner, deleteZone } from '../api/zone-service.js';

let zonePanel = null;

export function showZonePanel() {
  if (zonePanel) {
    return;
  }

  if (!isAuthenticated()) {
    alert('Please log in to manage zones.');
    return;
  }

  const currentUser = getCurrentUser();

  zonePanel = document.createElement('div');
  zonePanel.id = 'zone-panel';
  zonePanel.innerHTML = `
    <div class="zone-panel-content">
      <div class="zone-panel-header">
        <h2>Zone Editor (Scaffolding)</h2>
        <button id="zone-panel-close" class="close-button">×</button>
      </div>

      <div class="zone-panel-body">
        <section class="zone-section">
          <h3>Overlay Controls</h3>
          <p class="help-text">Load nearby zones and render them in the viewport.</p>
          <button id="zone-refresh-camera" class="action-button">Load Zones Near Camera</button>
          <div id="zone-status" class="result-display"></div>
        </section>

        <section class="zone-section">
          <h3>Create Rectangle Zone</h3>
          <form id="zone-create-form" class="zone-form">
            <div class="form-grid">
              <label>Zone Name
                <input type="text" id="zone-name" value="New Zone" required />
              </label>
              <label>Zone Type
                <select id="zone-type">
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="industrial">Industrial</option>
                  <option value="mixed-use">Mixed Use</option>
                  <option value="park">Park</option>
                </select>
              </label>
              <label>Floor
                <input type="number" id="zone-floor" value="0" min="0" max="15" step="1" required />
              </label>
              <label>Center X (m)
                <input type="number" id="zone-center-x" value="1000" step="100" required />
              </label>
              <label>Center Y (m)
                <input type="number" id="zone-center-y" value="0" step="10" required />
              </label>
              <label>Length (m)
                <input type="number" id="zone-length" value="500" min="50" step="50" required />
              </label>
              <label>Width (m)
                <input type="number" id="zone-width" value="200" min="50" step="10" required />
              </label>
            </div>
            <button type="submit" class="action-button">Create Zone</button>
          </form>
          <div id="zone-create-result" class="result-display"></div>
        </section>

        <section class="zone-section">
          <h3>My Zones</h3>
          <form id="zone-owner-form" class="zone-form inline">
            <label>Owner ID
              <input type="number" id="zone-owner-id" value="${currentUser?.id || ''}" min="1" required />
            </label>
            <button type="submit" class="action-button">Fetch Zones</button>
          </form>
          <div id="zone-list" class="zone-list"></div>
          <div id="zone-owner-result" class="result-display"></div>
        </section>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #zone-panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #111;
      border: 2px solid #4caf50;
      border-radius: 12px;
      padding: 0;
      width: 95%;
      max-width: 720px;
      max-height: 90vh;
      overflow-y: auto;
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
    }
    .zone-panel-content {
      padding: 1.5rem;
    }
    .zone-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      border-bottom: 1px solid #333;
      padding-bottom: 1rem;
    }
    .zone-panel-header h2 {
      color: #4caf50;
      margin: 0;
    }
    .close-button {
      background: #f44336;
      color: white;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.25rem;
      line-height: 1;
    }
    .zone-panel-body {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .zone-section h3 {
      margin: 0 0 0.5rem 0;
      color: #fff;
    }
    .zone-section {
      background: #1c1c1c;
      border: 1px solid #222;
      border-radius: 10px;
      padding: 1rem;
    }
    .help-text {
      color: #888;
      margin-bottom: 0.75rem;
    }
    .action-button {
      padding: 0.65rem 1.25rem;
      background: #4caf50;
      color: #000;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }
    .zone-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .zone-form.inline {
      flex-direction: row;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .zone-form label {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      color: #ccc;
      font-size: 0.9rem;
    }
    .zone-form input,
    .zone-form select {
      padding: 0.5rem;
      border-radius: 6px;
      border: 1px solid #333;
      background: #121212;
      color: #eee;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
    }
    .result-display {
      margin-top: 0.75rem;
      padding: 0.75rem;
      border-radius: 6px;
      background: #141414;
      border: 1px solid #333;
      color: #ccc;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
      display: none;
    }
    .result-display.show {
      display: block;
    }
    .result-display.success {
      border-color: #4caf50;
      color: #b9f6ca;
    }
    .result-display.error {
      border-color: #f44336;
      color: #ff8a80;
    }
    .zone-list {
      margin-top: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .zone-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 6px;
    }
    .zone-item-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      color: #ccc;
      font-size: 0.9rem;
    }
    .zone-item-info strong {
      color: #fff;
    }
    .zone-type, .zone-floor {
      font-size: 0.85rem;
      color: #888;
    }
    .delete-button {
      padding: 0.5rem 1rem;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .delete-button:hover {
      background: #d32f2f;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(zonePanel);

  setupZonePanelListeners();
}

export function hideZonePanel() {
  if (zonePanel) {
    zonePanel.remove();
    zonePanel = null;
  }
}

function setupZonePanelListeners() {
  const zoneList = document.getElementById('zone-list');
  
  document.getElementById('zone-panel-close').addEventListener('click', hideZonePanel);

  document.getElementById('zone-refresh-camera').addEventListener('click', async () => {
    const status = document.getElementById('zone-status');
    status.textContent = 'Requesting zones near camera...';
    status.className = 'result-display show';
    try {
      const zoneManager = window.earthring?.zoneManager;
      if (!zoneManager) {
        throw new Error('Zone manager is unavailable');
      }
      await zoneManager.loadZonesAroundCamera();
      status.textContent = 'Zones refreshed around camera. Check the viewport for overlays.';
      status.className = 'result-display show success';
    } catch (error) {
      status.textContent = `Error: ${error.message}`;
      status.className = 'result-display show error';
    }
  });

  document.getElementById('zone-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = document.getElementById('zone-create-result');

    try {
      const name = document.getElementById('zone-name').value.trim();
      const zoneType = document.getElementById('zone-type').value;
      const floor = parseInt(document.getElementById('zone-floor').value, 10);
      const centerX = parseFloat(document.getElementById('zone-center-x').value);
      const centerY = parseFloat(document.getElementById('zone-center-y').value);
      const length = parseFloat(document.getElementById('zone-length').value);
      const width = parseFloat(document.getElementById('zone-width').value);

      const geometry = rectangleGeoJSON(centerX, centerY, length, width);

      const zone = await createZone({
        name,
        zone_type: zoneType,
        floor,
        geometry,
        properties: { created_by: 'client-ui' },
      });

      result.textContent = JSON.stringify(zone, null, 2);
      result.className = 'result-display show success';

      const zoneManager = window.earthring?.zoneManager;
      if (zoneManager) {
        window.earthring.gameStateManager?.upsertZone(zone);
        zoneManager.renderZone(zone);
      }
    } catch (error) {
      result.textContent = `Error: ${error.message}`;
      result.className = 'result-display show error';
    }
  });

  document.getElementById('zone-owner-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = document.getElementById('zone-owner-result');
    const ownerID = parseInt(document.getElementById('zone-owner-id').value, 10);

    result.textContent = 'Loading zones...';
    result.className = 'result-display show';
    zoneList.innerHTML = '';

    try {
      const zones = await fetchZonesByOwner(ownerID);
      if (!zones || zones.length === 0) {
        result.textContent = 'No zones found for this owner.';
        result.className = 'result-display show';
      } else {
        result.textContent = `Found ${zones.length} zone(s)`;
        result.className = 'result-display show success';
        
        // Display zones with delete buttons
        zones.forEach(zone => {
          const zoneItem = document.createElement('div');
          zoneItem.className = 'zone-item';
          zoneItem.innerHTML = `
            <div class="zone-item-info">
              <strong>${zone.name || `Zone ${zone.id}`}</strong>
              <span class="zone-type">${zone.zone_type || 'default'}</span>
              <span class="zone-floor">Floor ${zone.floor ?? 0}</span>
            </div>
            <button class="delete-button" data-zone-id="${zone.id}">Delete</button>
          `;
          zoneList.appendChild(zoneItem);
        });
      }
    } catch (error) {
      result.textContent = `Error: ${error.message}`;
      result.className = 'result-display show error';
    }
  });

  // Handle delete button clicks (use event delegation)
  if (zoneList) {
    zoneList.addEventListener('click', async (event) => {
    if (event.target.classList.contains('delete-button')) {
      const zoneID = parseInt(event.target.getAttribute('data-zone-id'), 10);
      if (!confirm(`Are you sure you want to delete zone ${zoneID}?`)) {
        return;
      }

      try {
        await deleteZone(zoneID);
        // Remove zone from UI
        event.target.closest('.zone-item').remove();
        // Remove zone from game state and scene
        const zoneManager = window.earthring?.zoneManager;
        const gameStateManager = window.earthring?.gameStateManager;
        if (gameStateManager) {
          gameStateManager.removeZone(zoneID);
        }
        if (zoneManager) {
          zoneManager.removeZone(zoneID);
        }
        // Update result message
        const result = document.getElementById('zone-owner-result');
        result.textContent = `Zone ${zoneID} deleted successfully.`;
        result.className = 'result-display show success';
      } catch (error) {
        const result = document.getElementById('zone-owner-result');
        result.textContent = `Error deleting zone: ${error.message}`;
        result.className = 'result-display show error';
      }
    }
    });
  }
}

function rectangleGeoJSON(centerX, centerY, length, width) {
  const halfLength = length / 2;
  const halfWidth = width / 2;

  const coordinates = [
    [
      [centerX - halfLength, centerY - halfWidth],
      [centerX + halfLength, centerY - halfWidth],
      [centerX + halfLength, centerY + halfWidth],
      [centerX - halfLength, centerY + halfWidth],
      [centerX - halfLength, centerY - halfWidth],
    ],
  ];

  return {
    type: 'Polygon',
    coordinates,
  };
}

