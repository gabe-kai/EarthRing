/**
 * Admin Modal Component
 * Modal with tabs for Player and Chunks management
 */

import { positionToChunkIndex, chunkIndexToPositionRange } from '../utils/coordinates.js';
import { getCurrentUser } from '../auth/auth-service.js';
import { getZoneCount, deleteAllZones } from '../api/zone-service.js';
import { deleteAllChunks } from '../api/chunk-service.js';

let adminModal = null;
let activeTab = 'player';

/**
 * Show the admin modal
 */
export function showAdminModal() {
  if (adminModal) {
    return; // Already shown
  }

  adminModal = document.createElement('div');
  adminModal.id = 'admin-modal';
  adminModal.className = 'admin-modal-overlay';
  
  const style = document.createElement('style');
  style.textContent = `
    .admin-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .admin-modal-content {
      background: #1a1a1a;
      border-radius: 12px;
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      border: 1px solid #333;
      overflow: hidden;
    }
    
    .admin-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid #333;
      background: rgba(0, 100, 0, 0.2);
    }
    
    .admin-modal-header h2 {
      margin: 0;
      color: #00ff00;
      font-size: 1.5rem;
      font-weight: 600;
    }
    
    .admin-modal-close {
      background: transparent;
      border: 1px solid #666;
      color: #ccc;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1.5rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    
    .admin-modal-close:hover {
      background: rgba(255, 0, 0, 0.2);
      border-color: #ff4444;
      color: #ff4444;
    }
    
    .admin-modal-tabs {
      display: flex;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid #333;
      background: rgba(0, 0, 0, 0.3);
    }
    
    .admin-modal-tab {
      padding: 0.5rem 1rem;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid #333;
      border-radius: 6px 6px 0 0;
      color: #888;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    
    .admin-modal-tab:hover {
      background: rgba(0, 0, 0, 0.7);
      color: #ccc;
    }
    
    .admin-modal-tab.active {
      background: rgba(76, 175, 80, 0.2);
      border-color: #4caf50;
      color: #4caf50;
      border-bottom-color: transparent;
    }
    
    .admin-modal-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 1.5rem;
    }
    
    .admin-modal-body::-webkit-scrollbar {
      width: 8px;
    }
    
    .admin-modal-body::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.3);
    }
    
    .admin-modal-body::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 0, 0.3);
      border-radius: 4px;
    }
    
    .admin-modal-body::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 255, 0, 0.5);
    }
    
    .admin-tab-content {
      display: none;
    }
    
    .admin-tab-content.active {
      display: block;
    }
    
    /* Shared styles for embedded player/chunk content */
    .player-section, .chunk-section {
      margin-bottom: 2rem;
    }
    
    .player-section h3, .chunk-section h3 {
      color: #ccc;
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }
    
    .help-text {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    
    .action-button {
      padding: 0.75rem 1.5rem;
      background: #00ff00;
      color: #000;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      margin-bottom: 1rem;
    }
    
    .action-button:hover {
      background: #00cc00;
    }
    
    .action-button:disabled {
      background: #444;
      color: #888;
      cursor: not-allowed;
    }
    
    .position-form, .chunk-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .form-group label {
      color: #ccc;
      font-size: 0.9rem;
    }
    
    .form-group input {
      padding: 0.75rem;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 6px;
      color: #fff;
      font-size: 1rem;
    }
    
    .form-group input:focus {
      outline: none;
      border-color: #00ff00;
    }
    
    .form-actions {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    
    .delete-button {
      padding: 0.75rem 1.5rem;
      background: #ff4444;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .delete-button:hover {
      background: #cc0000;
    }
    
    .delete-button:disabled {
      background: #444;
      color: #888;
      cursor: not-allowed;
    }
    
    .quick-examples {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    
    .example-button {
      padding: 0.5rem 1rem;
      background: #2a2a2a;
      color: #00ff00;
      border: 1px solid #00ff00;
      border-radius: 6px;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .example-button:hover {
      background: #00ff00;
      color: #000;
    }
    
    .result-display {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 1rem;
      color: #ccc;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 300px;
      overflow-y: auto;
      display: none;
      margin-top: 1rem;
    }
    
    .result-display.show {
      display: block;
    }
    
    .result-display.success {
      border-color: #00ff00;
      color: #88ff88;
    }
    
    .result-display.error {
      border-color: #ff4444;
      color: #ff8888;
    }
  `;
  document.head.appendChild(style);
  
  adminModal.innerHTML = `
    <div class="admin-modal-content">
      <div class="admin-modal-header">
        <h2>Admin Panel</h2>
        <button class="admin-modal-close" id="admin-modal-close">×</button>
      </div>
      <div class="admin-modal-tabs">
        <button class="admin-modal-tab active" data-tab="player">Player</button>
        <button class="admin-modal-tab" data-tab="zones">Zones</button>
        <button class="admin-modal-tab" data-tab="chunks">Chunks</button>
      </div>
      <div class="admin-modal-body">
        <div class="admin-tab-content active" id="admin-tab-player"></div>
        <div class="admin-tab-content" id="admin-tab-zones"></div>
        <div class="admin-tab-content" id="admin-tab-chunks"></div>
      </div>
    </div>
  `;
  
  document.body.appendChild(adminModal);
  
  // Set up event listeners
  setupAdminModalListeners();
  
  // Load initial tab content
  loadTabContent('player');
}

/**
 * Hide the admin modal
 */
export function hideAdminModal() {
  if (adminModal) {
    adminModal.remove();
    adminModal = null;
    activeTab = 'player';
  }
}

/**
 * Set up event listeners for the admin modal
 */
function setupAdminModalListeners() {
  // Close button
  const closeBtn = adminModal.querySelector('#admin-modal-close');
  closeBtn.addEventListener('click', () => {
    hideAdminModal();
  });
  
  // Close on overlay click
  adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) {
      hideAdminModal();
    }
  });
  
  // Tab switching
  const tabs = adminModal.querySelectorAll('.admin-modal-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && adminModal) {
      hideAdminModal();
    }
  });
}

/**
 * Switch to a different tab
 */
function switchTab(tabId) {
  activeTab = tabId;
  
  // Update tab buttons
  const tabs = adminModal.querySelectorAll('.admin-modal-tab');
  tabs.forEach(tab => {
    if (tab.getAttribute('data-tab') === tabId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update tab content visibility
  const contents = adminModal.querySelectorAll('.admin-tab-content');
  contents.forEach(content => {
    if (content.id === `admin-tab-${tabId}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  
  // Load tab content
  loadTabContent(tabId);
}

/**
 * Load content for a specific tab
 */
function loadTabContent(tabId) {
  const contentContainer = adminModal.querySelector(`#admin-tab-${tabId}`);
  if (!contentContainer) return;
  
  // Clear existing content
  contentContainer.innerHTML = '';
  
  if (tabId === 'player') {
    // Create a wrapper for the player panel content
    // We'll extract the body content from showPlayerPanel
    loadPlayerTabContent(contentContainer);
  } else if (tabId === 'zones') {
    // Load zones tab content
    loadZonesTabContent(contentContainer);
  } else if (tabId === 'chunks') {
    // Create a wrapper for the chunk panel content
    loadChunksTabContent(contentContainer);
  }
}

/**
 * Load player tab content
 */
function loadPlayerTabContent(container) {
  // Clear existing content
  container.innerHTML = '';
  
  // Create wrapper div for player panel content (without header/close button)
  const playerContent = document.createElement('div');
  playerContent.className = 'admin-player-content';
  
  // Get user info
  const user = getCurrentUser();
  
  if (!user || !user.id) {
    container.innerHTML = '<p style="color: #888;">Please log in first.</p>';
    return;
  }
  
  // Create the body content directly (without header)
  playerContent.innerHTML = `
    <div class="player-section">
      <h3>Player Profile</h3>
      <button id="admin-load-profile-btn" class="action-button">Load My Profile</button>
      <div id="admin-profile-display" class="result-display"></div>
    </div>
    
    <div class="player-section">
      <h3>Update Position</h3>
      <form id="admin-position-form" class="position-form">
        <div class="form-group">
          <label>X Position (0-264000000)</label>
          <input type="number" id="admin-position-x" value="12345" min="0" max="264000000" step="1" required />
        </div>
        <div class="form-group">
          <label>Y Position</label>
          <input type="number" id="admin-position-y" value="0" step="0.1" required />
        </div>
        <div class="form-group">
          <label>Floor (-2 to 15)</label>
          <input type="number" id="admin-position-floor" value="0" min="-2" max="15" step="1" required />
        </div>
        <button type="submit" class="action-button">Update Position</button>
      </form>
      <div id="admin-position-result" class="result-display"></div>
    </div>
  `;
  
  container.appendChild(playerContent);
  
  // Set up event listeners for player content
  setupAdminPlayerListeners(container, user.id);
}

/**
 * Load chunks tab content
 */
function loadChunksTabContent(container) {
  // Clear existing content
  container.innerHTML = '';
  
  // Create wrapper div for chunk panel content (without header/close button)
  const chunkContent = document.createElement('div');
  chunkContent.className = 'admin-chunk-content';
  
  // Create chunk panel body content directly
  chunkContent.innerHTML = `
    <div class="chunk-section">
      <h3>Get Chunk Metadata</h3>
      <p class="help-text">Format: floor_chunk_index (e.g., 0_12345)</p>
      <form id="admin-chunk-form" class="chunk-form">
        <div class="form-group">
          <label>Floor</label>
          <input type="number" id="admin-chunk-floor" value="0" min="-2" max="15" step="1" required />
        </div>
        <div class="form-group">
          <label>Chunk Index (0-263999)</label>
          <input type="number" id="admin-chunk-index" value="12345" min="0" max="263999" step="1" required />
        </div>
        <div class="form-actions">
          <button type="submit" class="action-button">Get Metadata</button>
          <button type="button" id="admin-delete-chunk-btn" class="delete-button">Delete Chunk</button>
        </div>
      </form>
      <div id="admin-chunk-result" class="result-display"></div>
    </div>
    
    <div class="chunk-section">
      <h3>Position to Chunk</h3>
      <p class="help-text">Convert ring position (meters) to chunk index</p>
      <form id="admin-position-to-chunk-form" class="chunk-form">
        <div class="form-group">
          <label>Ring Position (meters, 0-264000000)</label>
          <input type="number" id="admin-position-input" value="12345000" min="0" max="264000000" step="1000" required />
        </div>
        <button type="submit" class="action-button">Get Chunk Index</button>
      </form>
      <div id="admin-position-to-chunk-result" class="result-display"></div>
    </div>
    
    <div class="chunk-section">
      <h3>Quick Examples</h3>
      <div class="quick-examples">
        <button class="example-button" data-chunk="0_0">Chunk 0_0</button>
        <button class="example-button" data-chunk="0_12345">Chunk 0_12345</button>
        <button class="example-button" data-chunk="0_100000">Chunk 0_100000</button>
        <button class="example-button" data-chunk="1_50000">Chunk 1_50000</button>
      </div>
    </div>
    
    <div class="chunk-section">
      <h3>Database Reset</h3>
      <p class="help-text">WARNING: This will delete ALL chunks from the database. They will be regenerated on next request.</p>
      <button id="admin-reset-all-chunks-btn" class="delete-button" style="width: 100%;">Reset All Chunks Database</button>
      <div id="admin-reset-chunks-result" class="result-display"></div>
    </div>
  `;
  
  container.appendChild(chunkContent);
  
  // Set up event listeners for chunk content
  setupAdminChunkListeners(container);
}

/**
 * Load zones tab content
 */
function loadZonesTabContent(container) {
  // Clear existing content
  container.innerHTML = '';
  
  // Create wrapper div for zones panel content
  const zonesContent = document.createElement('div');
  zonesContent.className = 'admin-zones-content';
  
  // Create zones panel body content
  zonesContent.innerHTML = `
    <div class="chunk-section">
      <h3>Zone Statistics</h3>
      <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
        <p style="margin: 0; color: #ccc;">Total Zones: <span id="admin-zone-count" style="color: #00ff00; font-weight: 600;">Loading...</span></p>
        <button id="admin-refresh-zone-count-btn" class="action-button" style="margin: 0; padding: 0.5rem 1rem;">Refresh</button>
      </div>
      <div id="admin-zone-count-result" class="result-display"></div>
    </div>
    
    <div class="chunk-section">
      <h3>Database Reset</h3>
      <p class="help-text">WARNING: This will delete ALL zones from the database. This action cannot be undone.</p>
      <button id="admin-reset-all-zones-btn" class="delete-button" style="width: 100%;">Reset All Zones Database</button>
      <div id="admin-reset-zones-result" class="result-display"></div>
    </div>
  `;
  
  container.appendChild(zonesContent);
  
  // Set up event listeners for zones content
  setupAdminZonesListeners(container);
  
  // Load initial zone count
  loadZoneCount(container);
}

/**
 * Set up event listeners for player content in admin modal
 */
function setupAdminPlayerListeners(container, playerID) {
  // Load profile button
  const loadBtn = container.querySelector('#admin-load-profile-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const display = container.querySelector('#admin-profile-display');
      display.textContent = 'Loading...';
      display.className = 'result-display show';
      
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          throw new Error('No access token found. Please log in again.');
        }
        
        const { getCurrentPlayerProfile } = await import('../api/player-service.js');
        const profile = await getCurrentPlayerProfile();
        display.textContent = JSON.stringify(profile, null, 2);
        display.className = 'result-display show success';
        
        if (profile.current_position) {
          const pos = profile.current_position;
          const floor = profile.current_floor || 0;
          console.log(`Player current position: (${pos.x || pos[0]}, ${pos.y || pos[1]}, floor ${floor})`);
        }
      } catch (error) {
        display.textContent = `Error: ${error.message}`;
        display.className = 'result-display show error';
      }
    });
  }

  // Position form
  const positionForm = container.querySelector('#admin-position-form');
  if (positionForm) {
    positionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const resultDisplay = container.querySelector('#admin-position-result');
      const submitButton = e.target.querySelector('button[type="submit"]');
      
      const x = container.querySelector('#admin-position-x').value;
      const y = container.querySelector('#admin-position-y').value;
      const floor = container.querySelector('#admin-position-floor').value;
      
      resultDisplay.textContent = 'Updating position...';
      resultDisplay.className = 'result-display show';
      submitButton.disabled = true;
      
      try {
        const { updatePlayerPosition } = await import('../api/player-service.js');
        const result = await updatePlayerPosition(playerID, { x, y }, floor);
        resultDisplay.textContent = JSON.stringify(result, null, 2);
        resultDisplay.className = 'result-display show success';
        
        // Update camera position
        if (window.earthring && window.earthring.cameraController) {
          const cameraController = window.earthring.cameraController;
          cameraController.moveToPosition({
            x: parseFloat(x),
            y: parseFloat(y),
            z: parseInt(floor),
          }, 2);
          console.log(`Camera moved to player position: (${x}, ${y}, ${floor})`);
        }
        
        // Reload profile
        setTimeout(() => {
          const loadBtn = container.querySelector('#admin-load-profile-btn');
          if (loadBtn) loadBtn.click();
        }, 500);
      } catch (error) {
        resultDisplay.textContent = `Error: ${error.message}`;
        resultDisplay.className = 'result-display show error';
      } finally {
        submitButton.disabled = false;
      }
    });
  }
}

/**
 * Set up event listeners for chunk content in admin modal
 */
function setupAdminChunkListeners(container) {
  // Chunk form
  const chunkForm = container.querySelector('#admin-chunk-form');
  if (chunkForm) {
    chunkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleAdminChunkRequest(container);
    });
  }

  // Delete chunk button
  const deleteBtn = container.querySelector('#admin-delete-chunk-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      await handleAdminChunkDelete(container);
    });
  }

  // Position to chunk form
  const positionForm = container.querySelector('#admin-position-to-chunk-form');
  if (positionForm) {
    positionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAdminPositionToChunk(container);
    });
  }

  // Quick example buttons
  container.querySelectorAll('.example-button').forEach(button => {
    button.addEventListener('click', async () => {
      const chunkID = button.dataset.chunk;
      const [floor, chunkIndex] = chunkID.split('_');
      const floorInput = container.querySelector('#admin-chunk-floor');
      const indexInput = container.querySelector('#admin-chunk-index');
      if (floorInput) floorInput.value = floor;
      if (indexInput) indexInput.value = chunkIndex;
      await handleAdminChunkRequest(container);
    });
  });

  // Reset all chunks button
  const resetAllChunksBtn = container.querySelector('#admin-reset-all-chunks-btn');
  if (resetAllChunksBtn) {
    resetAllChunksBtn.addEventListener('click', async () => {
      await handleAdminResetAllChunks(container);
    });
  }
}

/**
 * Set up event listeners for zones content in admin modal
 */
function setupAdminZonesListeners(container) {
  // Refresh zone count button
  const refreshBtn = container.querySelector('#admin-refresh-zone-count-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadZoneCount(container);
    });
  }

  // Reset all zones button
  const resetAllZonesBtn = container.querySelector('#admin-reset-all-zones-btn');
  if (resetAllZonesBtn) {
    resetAllZonesBtn.addEventListener('click', async () => {
      await handleAdminResetAllZones(container);
    });
  }
}

/**
 * Load and display zone count
 */
async function loadZoneCount(container) {
  const countDisplay = container.querySelector('#admin-zone-count');
  const resultDisplay = container.querySelector('#admin-zone-count-result');
  const refreshBtn = container.querySelector('#admin-refresh-zone-count-btn');
  
  if (countDisplay) {
    countDisplay.textContent = 'Loading...';
  }
  
  if (refreshBtn) {
    refreshBtn.disabled = true;
  }
  
  try {
    const result = await getZoneCount();
    if (countDisplay) {
      countDisplay.textContent = result.count || 0;
    }
    if (resultDisplay) {
      resultDisplay.textContent = '';
      resultDisplay.className = 'result-display';
    }
  } catch (error) {
    if (countDisplay) {
      countDisplay.textContent = 'Error';
    }
    if (resultDisplay) {
      resultDisplay.textContent = `Error: ${error.message}`;
      resultDisplay.className = 'result-display show error';
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Handle reset all zones in admin modal
 */
async function handleAdminResetAllZones(container) {
  const resultDisplay = container.querySelector('#admin-reset-zones-result');
  const resetButton = container.querySelector('#admin-reset-all-zones-btn');
  
  const confirmed = confirm(
    'WARNING: This will delete ALL zones from the database!\n\n' +
    'This action cannot be undone. Are you absolutely sure?'
  );
  
  if (!confirmed) {
    return;
  }
  
  // Double confirmation
  const doubleConfirmed = confirm(
    'Final confirmation: Delete ALL zones?\n\n' +
    'This will permanently remove all zone data from the database.'
  );
  
  if (!doubleConfirmed) {
    return;
  }
  
  resultDisplay.textContent = 'Deleting all zones...';
  resultDisplay.className = 'result-display show';
  resetButton.disabled = true;
  
  try {
    const result = await deleteAllZones();
    resultDisplay.textContent = JSON.stringify(result, null, 2);
    resultDisplay.className = 'result-display show success';
    
    // Clear zones from the client
    if (window.earthring && window.earthring.zoneManager) {
      window.earthring.zoneManager.clearAllZones();
    }
    
    // Refresh zone count
    await loadZoneCount(container);
  } catch (error) {
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    resetButton.disabled = false;
  }
}

/**
 * Handle reset all chunks in admin modal
 */
async function handleAdminResetAllChunks(container) {
  const resultDisplay = container.querySelector('#admin-reset-chunks-result');
  const resetButton = container.querySelector('#admin-reset-all-chunks-btn');
  
  const confirmed = confirm(
    'WARNING: This will delete ALL chunks from the database!\n\n' +
    'All chunks will be regenerated by the procedural service on next request. Are you sure?'
  );
  
  if (!confirmed) {
    return;
  }
  
  // Double confirmation
  const doubleConfirmed = confirm(
    'Final confirmation: Delete ALL chunks?\n\n' +
    'This will remove all chunk data from the database. Chunks will be regenerated on next request.'
  );
  
  if (!doubleConfirmed) {
    return;
  }
  
  resultDisplay.textContent = 'Deleting all chunks...';
  resultDisplay.className = 'result-display show';
  resetButton.disabled = true;
  
  try {
    const result = await deleteAllChunks();
    resultDisplay.textContent = JSON.stringify(result, null, 2);
    resultDisplay.className = 'result-display show success';
  } catch (error) {
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    resetButton.disabled = false;
  }
}

/**
 * Handle chunk metadata request in admin modal
 */
async function handleAdminChunkRequest(container) {
  const resultDisplay = container.querySelector('#admin-chunk-result');
  const submitButton = container.querySelector('#admin-chunk-form button[type="submit"]');
  
  const floor = container.querySelector('#admin-chunk-floor').value;
  const chunkIndex = container.querySelector('#admin-chunk-index').value;
  const chunkID = `${floor}_${chunkIndex}`;
  
  resultDisplay.textContent = 'Loading...';
  resultDisplay.className = 'result-display show';
  submitButton.disabled = true;
  
  try {
    const token = localStorage.getItem('access_token');
    if (!token) {
      throw new Error('No access token found. Please log in again.');
    }
    
    const { getChunkMetadata } = await import('../api/chunk-service.js');
    const metadata = await getChunkMetadata(chunkID);
    resultDisplay.textContent = JSON.stringify(metadata, null, 2);
    resultDisplay.className = 'result-display show success';
  } catch (error) {
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    submitButton.disabled = false;
  }
}

/**
 * Handle chunk deletion in admin modal
 */
async function handleAdminChunkDelete(container) {
  const resultDisplay = container.querySelector('#admin-chunk-result');
  const deleteButton = container.querySelector('#admin-delete-chunk-btn');
  
  const floor = container.querySelector('#admin-chunk-floor').value;
  const chunkIndex = container.querySelector('#admin-chunk-index').value;
  const chunkID = `${floor}_${chunkIndex}`;
  
  const confirmed = confirm(`Are you sure you want to delete chunk ${chunkID}?\n\nThis will remove it from the database and force regeneration on next request.`);
  if (!confirmed) {
    return;
  }
  
  resultDisplay.textContent = 'Deleting chunk...';
  resultDisplay.className = 'result-display show';
  deleteButton.disabled = true;
  
  try {
    const { deleteChunk } = await import('../api/chunk-service.js');
    const result = await deleteChunk(chunkID);
    resultDisplay.textContent = JSON.stringify(result, null, 2);
    resultDisplay.className = 'result-display show success';
  } catch (error) {
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    deleteButton.disabled = false;
  }
}

/**
 * Handle position to chunk index conversion in admin modal
 */
function handleAdminPositionToChunk(container) {
  const resultDisplay = container.querySelector('#admin-position-to-chunk-result');
  const submitButton = container.querySelector('#admin-position-to-chunk-form button[type="submit"]');
  
  const positionInput = container.querySelector('#admin-position-input');
  const ringPosition = parseFloat(positionInput.value);
  
  if (isNaN(ringPosition) || ringPosition < 0 || ringPosition > 264000000) {
    resultDisplay.textContent = 'Error: Invalid position. Must be between 0 and 264,000,000 meters.';
    resultDisplay.className = 'result-display show error';
    return;
  }
  
  submitButton.disabled = true;
  
  try {
    const chunkIndex = positionToChunkIndex(ringPosition);
    const positionRange = chunkIndexToPositionRange(chunkIndex);
    
    const result = {
      ringPosition: ringPosition,
      chunkIndex: chunkIndex,
      positionRange: {
        min: positionRange.min,
        max: positionRange.max,
      },
      chunkID: `0_${chunkIndex}`,
    };
    
    resultDisplay.textContent = JSON.stringify(result, null, 2);
    resultDisplay.className = 'result-display show success';
  } catch (error) {
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    submitButton.disabled = false;
  }
}

