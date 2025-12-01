/**
 * Admin Modal Component
 * Modal with tabs for Player and Chunks management
 */

import { positionToChunkIndex, chunkIndexToPositionRange, DEFAULT_FLOOR_HEIGHT } from '../utils/coordinates-new.js';
import { getCurrentUser } from '../auth/auth-service.js';
import { getZoneCount, deleteAllZones, getZonesByFloor, getZone } from '../api/zone-service.js';
import { deleteAllChunks, getChunkMetadata, deleteChunk } from '../api/chunk-service.js';
import { getCurrentPlayerProfile, updatePlayerPosition } from '../api/player-service.js';
import { legacyPositionToRingPolar, ringPolarToRingArc, ringPolarToLegacyPosition, ringArcToRingPolar } from '../utils/coordinates-new.js';

let adminModal = null;

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

    .admin-floor-section {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid #444;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .admin-floor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
    }

    .admin-floor-title {
      color: #00ff00;
      font-weight: 600;
      font-size: 1rem;
    }

    .admin-floor-count {
      color: #00ff00;
      font-weight: 600;
      margin-left: 0.5rem;
    }

    .admin-floor-toggle {
      color: #888;
      font-size: 1.2rem;
      transition: transform 0.2s;
    }

    .admin-floor-section.expanded .admin-floor-toggle {
      transform: rotate(90deg);
    }

    .admin-zone-list {
      display: none;
      margin-top: 0.75rem;
      max-height: 300px;
      overflow-y: auto;
    }

    .admin-floor-section.expanded .admin-zone-list {
      display: block;
    }

    .admin-zone-item {
      padding: 0.5rem;
      margin-bottom: 0.25rem;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid #333;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .admin-zone-item:hover {
      background: rgba(0, 255, 0, 0.1);
      border-color: #00ff00;
    }

    .admin-zone-item.selected {
      background: rgba(0, 255, 0, 0.2);
      border-color: #00ff00;
    }

    .admin-zone-item-name {
      color: #00ff00;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .admin-zone-item-meta {
      color: #888;
      font-size: 0.85rem;
    }

    .admin-zone-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .admin-zone-action-btn {
      padding: 0.5rem 1rem;
      background: rgba(0, 255, 0, 0.2);
      border: 1px solid #00ff00;
      border-radius: 4px;
      color: #00ff00;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .admin-zone-action-btn:hover {
      background: rgba(0, 255, 0, 0.3);
    }

    .admin-zone-category {
      margin-top: 0.5rem;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid #333;
      border-radius: 4px;
      overflow: hidden;
    }

    .admin-zone-category-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      user-select: none;
      background: rgba(0, 0, 0, 0.3);
      border-bottom: 1px solid #333;
      transition: background 0.2s;
    }

    .admin-zone-category-header:hover {
      background: rgba(0, 0, 0, 0.5);
    }

    .admin-zone-category-title {
      color: #4caf50;
      font-weight: 600;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .admin-zone-category-count {
      color: #888;
      font-size: 0.85rem;
      margin-left: 0.5rem;
    }

    .admin-zone-category-toggle {
      color: #888;
      font-size: 1rem;
      transition: transform 0.2s;
    }

    .admin-zone-category.expanded .admin-zone-category-toggle {
      transform: rotate(90deg);
    }

    .admin-zone-category-list {
      display: none;
      padding: 0.25rem;
    }

    .admin-zone-category.expanded .admin-zone-category-list {
      display: block;
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
      <p class="help-text">RingArc coordinates: s (arc length), r (radial offset), z (vertical offset)</p>
      <form id="admin-position-form" class="position-form">
        <div class="form-group">
          <label>Arc Length (s) in km (0-264000)</label>
          <input type="number" id="admin-position-s" value="0.012" min="0" max="264000" step="0.001" required />
        </div>
        <div class="form-group">
          <label>Radial Offset (r) in meters</label>
          <input type="number" id="admin-position-r" value="0" step="0.1" required />
        </div>
        <div class="form-group">
          <label>Vertical Offset (z) in meters</label>
          <input type="number" id="admin-position-z" value="0" step="0.1" required />
        </div>
        <div class="form-group">
          <label>Theta (θ) in degrees (alternative to arc length)</label>
          <input type="number" id="admin-position-theta" value="0" min="-180" max="180" step="0.1" />
          <small style="color: #888;">Leave empty to use arc length, or enter to calculate arc length</small>
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
      <h3>Zone Statistics by Floor</h3>
      <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
        <button id="admin-refresh-zones-btn" class="action-button" style="margin: 0; padding: 0.5rem 1rem;">Refresh All</button>
      </div>
      <div id="admin-zones-by-floor" style="display: flex; flex-direction: column; gap: 0.5rem;">
        <!-- Floor sections will be dynamically generated -->
      </div>
      <div id="admin-zone-count-result" class="result-display"></div>
    </div>
    
    <div class="chunk-section">
      <h3>Selected Zone Details</h3>
      <div id="admin-selected-zone-details" style="min-height: 100px; padding: 1rem; background: rgba(0, 0, 0, 0.3); border: 1px solid #444; border-radius: 6px; color: #ccc;">
        <p style="margin: 0; color: #888;">No zone selected</p>
      </div>
    </div>
    
    <div class="chunk-section">
      <h3>Database Reset</h3>
      <p class="help-text">WARNING: This will delete ALL zones from the database. This action cannot be undone.</p>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <button id="admin-reset-all-zones-cascade-btn" class="delete-button" style="width: 100%;">
          Clean Reset (TRUNCATE CASCADE)
        </button>
        <p class="help-text" style="margin: 0; font-size: 0.85rem; color: #aaa;">
          Deletes all zones, resets sequence numbering, and cascades to related tables (structures, roads, npcs).
        </p>
        <button id="admin-reset-all-zones-preserve-btn" class="delete-button" style="width: 100%;">
          Preserve Related Records (DELETE)
        </button>
        <p class="help-text" style="margin: 0; font-size: 0.85rem; color: #aaa;">
          Deletes all zones but preserves related records. Clears zone references in structures, roads, and npcs.
        </p>
      </div>
      <div id="admin-reset-zones-result" class="result-display"></div>
    </div>
  `;
  
  container.appendChild(zonesContent);
  
  // Set up event listeners for zones content
  setupAdminZonesListeners(container);
  
  // Load initial zones by floor
  loadZonesByFloor(container);
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
        
        const profile = await getCurrentPlayerProfile();
        
        // Convert and display position in new coordinate system
        let positionInfo = '';
        if (profile.current_position) {
          const pos = profile.current_position;
          const x = pos.x || pos[0] || 0;
          const y = pos.y || pos[1] || 0;
          const floor = profile.current_floor || 0;
          // In legacy system, z is the floor number, but legacyPositionToRingPolar expects z in meters
          // So we convert floor to meters: z = floor * DEFAULT_FLOOR_HEIGHT
          const zMeters = floor * DEFAULT_FLOOR_HEIGHT;
          
          try {
            // Convert legacy to RingArc
            const polar = legacyPositionToRingPolar(x, y, zMeters);
            const arc = ringPolarToRingArc(polar);
            const sKm = arc.s / 1000;
            const thetaDeg = polar.theta * 180 / Math.PI;
            
            positionInfo = `\n\nCurrent Position (RingArc):\n  s: ${sKm.toFixed(3)} km\n  θ: ${thetaDeg.toFixed(2)}°\n  r: ${arc.r.toFixed(2)} m\n  z: ${arc.z.toFixed(2)} m\n\nLegacy (for reference):\n  X: ${x.toFixed(1)} m\n  Y: ${y.toFixed(1)} m\n  Floor: ${floor}`;
            
            // Populate form fields with current position
            const sInput = container.querySelector('#admin-position-s');
            const rInput = container.querySelector('#admin-position-r');
            const zInput = container.querySelector('#admin-position-z');
            const thetaInput = container.querySelector('#admin-position-theta');
            
            if (sInput) sInput.value = sKm.toFixed(3);
            if (rInput) rInput.value = arc.r.toFixed(2);
            // z in RingArc is vertical offset in meters, but we display it as-is
            if (zInput) zInput.value = arc.z.toFixed(2);
            if (thetaInput) thetaInput.value = thetaDeg.toFixed(2);
          } catch (error) {
            positionInfo = `\n\nCurrent Position (Legacy):\n  X: ${x.toFixed(1)} m\n  Y: ${y.toFixed(1)} m\n  Floor: ${floor}`;
            console.error('Error converting position:', error);
          }
        }
        
        display.textContent = JSON.stringify(profile, null, 2) + positionInfo;
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
      
      // Get RingArc coordinates from form
      const sInput = container.querySelector('#admin-position-s');
      const rInput = container.querySelector('#admin-position-r');
      const zInput = container.querySelector('#admin-position-z');
      const thetaInput = container.querySelector('#admin-position-theta');
      
      let arc;
      try {
        // If theta is provided, use it; otherwise use arc length
        if (thetaInput.value && thetaInput.value !== '') {
          const theta = parseFloat(thetaInput.value) * Math.PI / 180; // Convert degrees to radians
          const polar = { theta, r: parseFloat(rInput.value), z: parseFloat(zInput.value) };
          arc = ringPolarToRingArc(polar);
        } else {
          const s = parseFloat(sInput.value) * 1000; // Convert km to meters
          arc = {
            s: s,
            r: parseFloat(rInput.value),
            z: parseFloat(zInput.value)
          };
        }
        
        // Convert RingArc to legacy coordinates for API
        const polar = ringArcToRingPolar(arc);
        const legacy = ringPolarToLegacyPosition(polar);
        
        // API still expects legacy format: {x, y} and floor (z)
        // In legacy system, z is the floor number, not vertical offset
        const x = legacy.x;
        const y = legacy.y;
        // Convert z offset (meters) to floor number
        const floor = Math.round(arc.z / DEFAULT_FLOOR_HEIGHT);
        
        resultDisplay.textContent = `Updating position...\nRingArc: s=${(arc.s/1000).toFixed(3)}km, r=${arc.r.toFixed(2)}m, z=${arc.z.toFixed(2)}m\nLegacy: X=${x.toFixed(1)}m, Y=${y.toFixed(1)}m, Floor=${floor}`;
        resultDisplay.className = 'result-display show';
        submitButton.disabled = true;
        
        const result = await updatePlayerPosition(playerID, { x, y }, floor);
        resultDisplay.textContent = `Position updated successfully!\n\n${JSON.stringify(result, null, 2)}\n\nRingArc: s=${(arc.s/1000).toFixed(3)}km, θ=${(polar.theta * 180 / Math.PI).toFixed(2)}°, r=${arc.r.toFixed(2)}m, z=${arc.z.toFixed(2)}m`;
        resultDisplay.className = 'result-display show success';
        
        // Update camera position (using legacy format for now)
        if (window.earthring && window.earthring.cameraController) {
          const cameraController = window.earthring.cameraController;
          cameraController.moveToPosition({
            x: x,
            y: y,
            z: floor,
          }, 2);
          console.log(`Camera moved to player position: RingArc(s=${(arc.s/1000).toFixed(3)}km, r=${arc.r.toFixed(2)}m, z=${arc.z.toFixed(2)}m) Legacy(X=${x.toFixed(1)}, Y=${y.toFixed(1)}, Floor=${floor})`);
        }
        
        // Reload profile
        setTimeout(() => {
          const loadBtn = container.querySelector('#admin-load-profile-btn');
          if (loadBtn) loadBtn.click();
        }, 500);
      } catch (error) {
        resultDisplay.textContent = `Error: ${error.message}`;
        resultDisplay.className = 'result-display show error';
        console.error('Position update error:', error);
      } finally {
        submitButton.disabled = false;
      }
    });
    
    // Auto-calculate arc length from theta when theta changes
    const thetaInput = container.querySelector('#admin-position-theta');
    const sInput = container.querySelector('#admin-position-s');
    const rInput = container.querySelector('#admin-position-r');
    const zInput = container.querySelector('#admin-position-z');
    if (thetaInput && sInput) {
      thetaInput.addEventListener('input', () => {
        if (thetaInput.value && thetaInput.value !== '') {
          const thetaDeg = parseFloat(thetaInput.value);
          if (Number.isNaN(thetaDeg)) {
            return;
          }
          // Convert degrees to radians (can be negative)
          const theta = thetaDeg * Math.PI / 180;
          // Build a RingPolar value using current r/z (or 0 if empty)
          const polar = {
            theta,
            r: rInput && rInput.value !== '' ? parseFloat(rInput.value) : 0,
            z: zInput && zInput.value !== '' ? parseFloat(zInput.value) : 0,
          };
          // Use shared helper to convert to RingArc and wrap s into [0, C)
          const arc = ringPolarToRingArc(polar);
          // Display s in km (always non-negative, wrapped arc length)
          sInput.value = (arc.s / 1000).toFixed(3);
        }
      });
    }
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
  // Refresh zones button
  const refreshBtn = container.querySelector('#admin-refresh-zones-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadZonesByFloor(container);
    });
  }

  // Clean Reset (TRUNCATE CASCADE) button
  const cascadeBtn = container.querySelector('#admin-reset-all-zones-cascade-btn');
  if (cascadeBtn) {
    cascadeBtn.addEventListener('click', async () => {
      await handleAdminResetAllZones(container, true);
    });
  }

  // Preserve Related Records (DELETE) button
  const preserveBtn = container.querySelector('#admin-reset-all-zones-preserve-btn');
  if (preserveBtn) {
    preserveBtn.addEventListener('click', async () => {
      await handleAdminResetAllZones(container, false);
    });
  }
}

/**
 * Calculate zone center and bounds from geometry
 */
function calculateZoneBounds(geometry) {
  if (!geometry || !geometry.coordinates) {
    return null;
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  // Handle Polygon (single ring or multiple rings)
  const coordinates = geometry.coordinates;
  const outerRing = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates;
  
  outerRing.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  const height = maxY - minY;
  const size = Math.max(width, height);

  return {
    center: { x: centerX, y: centerY },
    bounds: { minX, maxX, minY, maxY },
    width,
    height,
    size,
  };
}

/**
 * Navigate camera to zone (directly above, looking down, zoomed to fit)
 */
function navigateToZone(zone) {
  if (!zone || !zone.geometry) {
    console.error('Invalid zone for navigation');
    return;
  }

  const cameraController = window.earthring?.cameraController;
  const sceneManager = window.earthring?.sceneManager;
  if (!cameraController || !sceneManager) {
    console.error('Camera controller or scene manager not available');
    return;
  }

  const bounds = calculateZoneBounds(zone.geometry);
  if (!bounds) {
    console.error('Could not calculate zone bounds');
    return;
  }

  // Set active floor to zone's floor
  const gameStateManager = window.earthring?.gameStateManager;
  if (gameStateManager && zone.floor !== undefined) {
    gameStateManager.setActiveFloor(zone.floor);
  }

  // Calculate camera position: directly above center, looking straight down
  // We need to position the camera high enough to see the entire zone
  const padding = 1.5; // 50% padding around zone
  const camera = sceneManager.getCamera();
  const fov = camera.fov * (Math.PI / 180);
  
  // Calculate distance needed to fit zone in view
  // For top-down view, we need to account for the larger dimension
  const maxDimension = Math.max(bounds.width, bounds.height);
  const distance = (maxDimension / 2) / Math.tan(fov / 2) * padding;
  
  // Position camera above center, at calculated height
  // The camera controller uses EarthRing coordinates where Z is floor
  // We need to set the camera's Y position (Three.js up) to be high enough
  const targetPosition = {
    x: bounds.center.x,
    y: bounds.center.y,
    z: zone.floor ?? 0,
  };

  // Move camera to position
  cameraController.moveToPosition(targetPosition, 2);

  // After movement, adjust camera to look straight down and set zoom
  setTimeout(() => {
    const camera = sceneManager.getCamera();
    const controls = cameraController.controls;
    
    if (camera && controls) {
      // Calculate target position in Three.js space
      // EarthRing: X=ring, Y=width, Z=floor
      // Three.js: X=ring, Y=up, Z=width
      const floorHeight = (zone.floor ?? 0) * DEFAULT_FLOOR_HEIGHT;
      
      // Set controls target to center of zone (on the floor)
      controls.target.set(bounds.center.x, floorHeight, bounds.center.y);
      
      // Calculate camera position: directly above target, at calculated distance
      // For top-down view, we want the camera to be directly above the target
      const cameraHeight = distance + floorHeight;
      camera.position.set(bounds.center.x, cameraHeight, bounds.center.y);
      
      // Update controls to apply the new position and target
      controls.update();
      
      console.log(`Navigated to zone ${zone.id} at floor ${zone.floor ?? 0}, distance: ${distance.toFixed(0)}m`);
    }
  }, 2100); // Wait for moveToPosition to complete (2s + 100ms buffer)
}

/**
 * Load and display zones by floor
 */
async function loadZonesByFloor(container) {
  const zonesByFloorContainer = container.querySelector('#admin-zones-by-floor');
  const resultDisplay = container.querySelector('#admin-zone-count-result');
  const refreshBtn = container.querySelector('#admin-refresh-zones-btn');
  
  if (!zonesByFloorContainer) {
    return;
  }
  
  if (refreshBtn) {
    refreshBtn.disabled = true;
  }
  
  zonesByFloorContainer.innerHTML = '<p style="color: #888;">Loading zones...</p>';
  
  try {
    // Load zones for each floor (-2 to +2)
    const floors = [-2, -1, 0, 1, 2];
    const zonesByFloor = {};
    
    // Load zones for each floor in parallel
    await Promise.all(floors.map(async (floor) => {
      try {
        const zones = await getZonesByFloor(floor);
        zonesByFloor[floor] = zones || [];
      } catch (error) {
        console.error(`Error loading zones for floor ${floor}:`, error);
        zonesByFloor[floor] = [];
      }
    }));
    
    // Clear container
    zonesByFloorContainer.innerHTML = '';
    
    // Create floor sections
    floors.forEach(floor => {
      const zones = zonesByFloor[floor] || [];
      const floorSection = createFloorSection(floor, zones, container);
      zonesByFloorContainer.appendChild(floorSection);
    });
    
    if (resultDisplay) {
      resultDisplay.textContent = '';
      resultDisplay.className = 'result-display';
    }
  } catch (error) {
    zonesByFloorContainer.innerHTML = `<p style="color: #ff4444;">Error: ${error.message}</p>`;
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
 * Create a floor section with zone list
 */
function createFloorSection(floor, zones, container) {
  const section = document.createElement('div');
  section.className = 'admin-floor-section';
  section.dataset.floor = floor;
  
  const header = document.createElement('div');
  header.className = 'admin-floor-header';
  header.onclick = () => {
    section.classList.toggle('expanded');
  };
  
  const title = document.createElement('span');
  title.className = 'admin-floor-title';
  title.textContent = `Floor ${floor >= 0 ? '+' : ''}${floor}`;
  
  const count = document.createElement('span');
  count.className = 'admin-floor-count';
  count.textContent = `(${zones.length})`;
  
  const toggle = document.createElement('span');
  toggle.className = 'admin-floor-toggle';
  toggle.textContent = '▶';
  
  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(toggle);
  
  const zoneList = document.createElement('div');
  zoneList.className = 'admin-zone-list';
  
  if (zones.length === 0) {
    zoneList.innerHTML = '<p style="color: #888; padding: 0.5rem; margin: 0;">No zones on this floor</p>';
  } else {
    // Group zones by category
    const categorizedZones = categorizeZones(zones);
    
    // Create category sections
    Object.keys(categorizedZones).forEach(categoryName => {
      const categoryZones = categorizedZones[categoryName];
      if (categoryZones.length > 0) {
        const categorySection = createZoneCategory(categoryName, categoryZones, container);
        zoneList.appendChild(categorySection);
      }
    });
  }
  
  section.appendChild(header);
  section.appendChild(zoneList);
  
  return section;
}

/**
 * Categorize zones by type
 */
function categorizeZones(zones) {
  const categories = {
    'Default Zones': [],
    'Residential': [],
    'Commercial': [],
    'Industrial': [],
    'Mixed-Use': [],
    'Park': [],
    'Agricultural': [],
    'Restricted': [],
    'Other': [],
  };
  
  zones.forEach(zone => {
    // System zones go into "Default Zones"
    if (zone.is_system_zone === true) {
      categories['Default Zones'].push(zone);
      return;
    }
    
    // Categorize by zone_type
    const zoneType = zone.zone_type || 'unknown';
    const categoryName = formatZoneTypeCategory(zoneType);
    
    if (categories[categoryName]) {
      categories[categoryName].push(zone);
    } else {
      categories['Other'].push(zone);
    }
  });
  
  // Remove empty categories
  Object.keys(categories).forEach(key => {
    if (categories[key].length === 0) {
      delete categories[key];
    }
  });
  
  return categories;
}

/**
 * Format zone type to category name
 */
function formatZoneTypeCategory(zoneType) {
  const typeMap = {
    'residential': 'Residential',
    'commercial': 'Commercial',
    'industrial': 'Industrial',
    'mixed-use': 'Mixed-Use',
    'park': 'Park',
    'agricultural': 'Agricultural',
    'restricted': 'Restricted',
  };
  
  const normalized = zoneType.toLowerCase().replace(/_/g, '-');
  return typeMap[normalized] || 'Other';
}

/**
 * Create a collapsible zone category section
 */
function createZoneCategory(categoryName, zones, container) {
  const category = document.createElement('div');
  category.className = 'admin-zone-category';
  category.dataset.category = categoryName;
  
  // Default to expanded for Default Zones, collapsed for others
  if (categoryName === 'Default Zones') {
    category.classList.add('expanded');
  }
  
  const header = document.createElement('div');
  header.className = 'admin-zone-category-header';
  header.onclick = () => {
    category.classList.toggle('expanded');
  };
  
  const title = document.createElement('span');
  title.className = 'admin-zone-category-title';
  
  // Add icon based on category
  const icon = getCategoryIcon(categoryName);
  title.innerHTML = `${icon} ${categoryName}`;
  
  const count = document.createElement('span');
  count.className = 'admin-zone-category-count';
  count.textContent = `(${zones.length})`;
  
  const toggle = document.createElement('span');
  toggle.className = 'admin-zone-category-toggle';
  toggle.textContent = '▶';
  
  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(toggle);
  
  const categoryList = document.createElement('div');
  categoryList.className = 'admin-zone-category-list';
  
  zones.forEach(zone => {
    const zoneItem = createZoneItem(zone, container);
    categoryList.appendChild(zoneItem);
  });
  
  category.appendChild(header);
  category.appendChild(categoryList);
  
  return category;
}

/**
 * Get icon for category
 */
function getCategoryIcon(categoryName) {
  const icons = {
    'Default Zones': '⚙️',
    'Residential': '🏠',
    'Commercial': '🏪',
    'Industrial': '🏭',
    'Mixed-Use': '🏢',
    'Park': '🌳',
    'Agricultural': '🌾',
    'Restricted': '🚫',
    'Other': '📦',
  };
  return icons[categoryName] || '📦';
}

/**
 * Create a zone list item
 */
function createZoneItem(zone, container) {
  const item = document.createElement('div');
  item.className = 'admin-zone-item';
  item.dataset.zoneId = zone.id;
  
  const name = document.createElement('div');
  name.className = 'admin-zone-item-name';
  name.textContent = zone.name || `Zone ${zone.id}`;
  
  const meta = document.createElement('div');
  meta.className = 'admin-zone-item-meta';
  const zoneType = zone.zone_type || 'unknown';
  const owner = zone.owner_id ? `Owner: ${zone.owner_id}` : 'System Zone';
  const area = zone.area ? `${(zone.area / 1000000).toFixed(2)} km²` : 'N/A';
  meta.textContent = `${zoneType} • ${owner} • ${area}`;
  
  item.appendChild(name);
  item.appendChild(meta);
  
  item.onclick = async () => {
    // Remove selected class from all items
    container.querySelectorAll('.admin-zone-item').forEach(el => {
      el.classList.remove('selected');
    });
    
    // Add selected class to this item
    item.classList.add('selected');
    
    // Load and display zone details
    await showZoneDetails(zone, container);
  };
  
  return item;
}

/**
 * Show zone details and actions
 */
async function showZoneDetails(zone, container) {
  const detailsContainer = container.querySelector('#admin-selected-zone-details');
  if (!detailsContainer) {
    return;
  }
  
  try {
    // Fetch full zone data if we don't have it
    let fullZone = zone;
    if (!zone.geometry || !zone.properties) {
      fullZone = await getZone(zone.id);
    }
    
    // Calculate bounds for navigation
    const bounds = calculateZoneBounds(fullZone.geometry);
    
    detailsContainer.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <h4 style="color: #00ff00; margin: 0 0 0.5rem 0;">${fullZone.name || `Zone ${fullZone.id}`}</h4>
        <div style="color: #ccc; font-size: 0.9rem; margin-bottom: 0.5rem;">
          <div><strong>ID:</strong> ${fullZone.id}</div>
          <div><strong>Type:</strong> ${fullZone.zone_type || 'N/A'}</div>
          <div><strong>Floor:</strong> ${fullZone.floor ?? 0}</div>
          <div><strong>Owner:</strong> ${fullZone.owner_id ? fullZone.owner_id : 'System'}</div>
          <div><strong>System Zone:</strong> ${fullZone.is_system_zone ? 'Yes' : 'No'}</div>
          <div><strong>Area:</strong> ${fullZone.area ? `${(fullZone.area / 1000000).toFixed(2)} km²` : 'N/A'}</div>
          ${bounds ? `<div><strong>Center:</strong> X: ${bounds.center.x.toFixed(0)}m, Y: ${bounds.center.y.toFixed(0)}m</div>` : ''}
          ${bounds ? `<div><strong>Size:</strong> ${bounds.width.toFixed(0)}m × ${bounds.height.toFixed(0)}m</div>` : ''}
        </div>
        ${fullZone.properties ? `<div style="color: #888; font-size: 0.85rem; margin-top: 0.5rem;"><strong>Properties:</strong><pre style="margin: 0.5rem 0 0 0; font-size: 0.8rem;">${JSON.stringify(fullZone.properties, null, 2)}</pre></div>` : ''}
        ${fullZone.metadata ? `<div style="color: #888; font-size: 0.85rem; margin-top: 0.5rem;"><strong>Metadata:</strong><pre style="margin: 0.5rem 0 0 0; font-size: 0.8rem;">${JSON.stringify(fullZone.metadata, null, 2)}</pre></div>` : ''}
      </div>
      <div class="admin-zone-actions">
        <button class="admin-zone-action-btn" onclick="window.__adminNavigateToZone(${JSON.stringify(fullZone).replace(/"/g, '&quot;')})">
          Navigate to Zone
        </button>
      </div>
    `;
    
    // Store zone in window for navigation function
    window.__adminNavigateToZone = (zoneData) => {
      navigateToZone(zoneData);
    };
    
  } catch (error) {
    detailsContainer.innerHTML = `<p style="color: #ff4444;">Error loading zone details: ${error.message}</p>`;
  }
}

/**
 * Handle reset all zones in admin modal
 * @param {boolean} cascade - If true, uses TRUNCATE CASCADE (clean reset). If false, uses DELETE (preserve related records).
 */
async function handleAdminResetAllZones(container, cascade = false) {
  const resultDisplay = container.querySelector('#admin-reset-zones-result');
  const cascadeButton = container.querySelector('#admin-reset-all-zones-cascade-btn');
  const preserveButton = container.querySelector('#admin-reset-all-zones-preserve-btn');
  
  const mode = cascade ? 'Clean Reset (TRUNCATE CASCADE)' : 'Preserve Related Records (DELETE)';
  const description = cascade 
    ? 'This will delete ALL zones, reset sequence numbering, and cascade to related tables (structures, roads, npcs).'
    : 'This will delete ALL zones but preserve related records. Zone references in structures, roads, and npcs will be cleared.';
  
  const { showConfirmationModal } = await import('./game-modal.js');
  const confirmed = await showConfirmationModal({
    title: `WARNING: ${mode}`,
    message: `${description}\n\nThis action cannot be undone.`,
    checkboxLabel: 'I understand this will permanently delete all zones',
    confirmText: 'Delete All Zones',
    cancelText: 'Cancel',
    confirmColor: '#ff4444'
  });
  
  if (!confirmed) {
    return;
  }
  
  // Double confirmation
  const doubleConfirmed = await showConfirmationModal({
    title: `Final Confirmation: ${mode}`,
    message: 'This will permanently remove all zone data from the database.',
    checkboxLabel: 'I confirm I want to delete all zones',
    confirmText: 'Yes, Delete All',
    cancelText: 'Cancel',
    confirmColor: '#ff4444'
  });
  
  if (!doubleConfirmed) {
    return;
  }
  
  resultDisplay.textContent = `Deleting all zones (${mode})...`;
  resultDisplay.className = 'result-display show';
  if (cascadeButton) cascadeButton.disabled = true;
  if (preserveButton) preserveButton.disabled = true;
  
  try {
    const result = await deleteAllZones(cascade);
    resultDisplay.textContent = JSON.stringify(result, null, 2);
    resultDisplay.className = 'result-display show success';
    
    // Clear zones from the client
    if (window.earthring && window.earthring.zoneManager) {
      window.earthring.zoneManager.clearAllZones();
    }
    
    // Refresh zones by floor
    await loadZonesByFloor(container);
  } catch (error) {
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    if (cascadeButton) cascadeButton.disabled = false;
    if (preserveButton) preserveButton.disabled = false;
  }
}

/**
 * Handle reset all chunks in admin modal
 */
async function handleAdminResetAllChunks(container) {
  const resultDisplay = container.querySelector('#admin-reset-chunks-result');
  const resetButton = container.querySelector('#admin-reset-all-chunks-btn');
  
  const { showConfirmationModal } = await import('./game-modal.js');
  const confirmed = await showConfirmationModal({
    title: 'WARNING: Delete All Chunks',
    message: 'This will delete ALL chunks from the database!\n\nAll chunks will be regenerated by the procedural service on next request.',
    checkboxLabel: 'I understand this will delete all chunk data',
    confirmText: 'Delete All Chunks',
    cancelText: 'Cancel',
    confirmColor: '#ff4444'
  });
  
  if (!confirmed) {
    return;
  }
  
  // Double confirmation
  const doubleConfirmed = await showConfirmationModal({
    title: 'Final Confirmation: Delete All Chunks',
    message: 'This will remove all chunk data from the database. Chunks will be regenerated on next request.',
    checkboxLabel: 'I confirm I want to delete all chunks',
    confirmText: 'Yes, Delete All',
    cancelText: 'Cancel',
    confirmColor: '#ff4444'
  });
  
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
  
  const { showConfirmationModal } = await import('./game-modal.js');
  const confirmed = await showConfirmationModal({
    title: 'Delete Chunk',
    message: `Are you sure you want to delete chunk ${chunkID}?\n\nThis will remove it from the database and force regeneration on next request.`,
    checkboxLabel: 'I understand this chunk will be deleted',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmColor: '#ff4444'
  });
  
  if (!confirmed) {
    return;
  }
  
  resultDisplay.textContent = 'Deleting chunk...';
  resultDisplay.className = 'result-display show';
  deleteButton.disabled = true;
  
  try {
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

