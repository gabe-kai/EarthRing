/**
 * Game Modal Component
 * In-game themed modals for confirmations and conflict resolution
 */

let activeModal = null;

/**
 * Show a confirmation modal with checkbox
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Main message
 * @param {string} options.checkboxLabel - Label for confirmation checkbox
 * @param {string} options.confirmText - Text for confirm button (default: "OK")
 * @param {string} options.cancelText - Text for cancel button (default: "Cancel")
 * @param {string} options.confirmColor - Color for confirm button (default: "#ff4444" for destructive)
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
export function showConfirmationModal({
  title = 'Confirm Action',
  message,
  checkboxLabel = 'I understand this action cannot be undone',
  confirmText = 'OK',
  cancelText = 'Cancel',
  confirmColor = '#ff4444'
}) {
  return new Promise((resolve) => {
    // Remove existing modal if present
    if (activeModal) {
      activeModal.remove();
    }

    activeModal = document.createElement('div');
    activeModal.className = 'game-modal-overlay';
    
    const style = document.createElement('style');
    style.textContent = `
      .game-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10003;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .game-modal-content {
        background: #1a1a1a;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        border: 2px solid #4caf50;
        overflow: hidden;
      }
      
      .game-modal-header {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid #333;
        background: rgba(0, 100, 0, 0.2);
      }
      
      .game-modal-header h3 {
        margin: 0;
        color: #4caf50;
        font-size: 1.25rem;
        font-weight: 600;
      }
      
      .game-modal-body {
        padding: 1.5rem;
        color: #ccc;
        line-height: 1.6;
      }
      
      .game-modal-message {
        margin-bottom: 1.25rem;
        font-size: 1rem;
      }
      
      .game-modal-checkbox {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
        padding: 0.75rem;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.2s;
      }
      
      .game-modal-checkbox:hover {
        background: rgba(0, 0, 0, 0.5);
      }
      
      .game-modal-checkbox input[type="checkbox"] {
        width: 20px;
        height: 20px;
        cursor: pointer;
        accent-color: #4caf50;
      }
      
      .game-modal-checkbox label {
        color: #ccc;
        cursor: pointer;
        user-select: none;
        font-size: 0.95rem;
      }
      
      .game-modal-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: flex-end;
      }
      
      .game-modal-button {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 6px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 100px;
      }
      
      .game-modal-button-cancel {
        background: #2a2a2a;
        color: #ccc;
        border: 1px solid #444;
      }
      
      .game-modal-button-cancel:hover {
        background: #333;
        border-color: #555;
      }
      
      .game-modal-button-confirm {
        color: #fff;
      }
      
      .game-modal-button-confirm:disabled {
        background: #444;
        color: #888;
        cursor: not-allowed;
        opacity: 0.6;
      }
    `;
    
    document.head.appendChild(style);
    
    const checkboxId = `game-modal-checkbox-${Date.now()}`;
    let checkboxChecked = false;
    
    activeModal.innerHTML = `
      <div class="game-modal-content">
        <div class="game-modal-header">
          <h3>${title}</h3>
        </div>
        <div class="game-modal-body">
          <div class="game-modal-message">${message}</div>
          <div class="game-modal-checkbox" onclick="document.getElementById('${checkboxId}').click()">
            <input type="checkbox" id="${checkboxId}" onchange="window.gameModalCheckboxChanged = this.checked; window.gameModalUpdateButton()">
            <label for="${checkboxId}">${checkboxLabel}</label>
          </div>
          <div class="game-modal-actions">
            <button class="game-modal-button game-modal-button-cancel" id="game-modal-cancel">${cancelText}</button>
            <button class="game-modal-button game-modal-button-confirm" id="game-modal-confirm" style="background: ${confirmColor};" disabled>${confirmText}</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(activeModal);
    
    // Store checkbox state globally for event handlers
    window.gameModalCheckboxChanged = false;
    window.gameModalUpdateButton = () => {
      const confirmBtn = document.getElementById('game-modal-confirm');
      if (confirmBtn) {
        confirmBtn.disabled = !window.gameModalCheckboxChanged;
      }
    };
    
    // Set up event listeners
    document.getElementById('game-modal-confirm').addEventListener('click', () => {
      if (window.gameModalCheckboxChanged) {
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        delete window.gameModalCheckboxChanged;
        delete window.gameModalUpdateButton;
        resolve(true);
      }
    });
    
    document.getElementById('game-modal-cancel').addEventListener('click', () => {
      activeModal.remove();
      activeModal = null;
      document.head.removeChild(style);
      delete window.gameModalCheckboxChanged;
      delete window.gameModalUpdateButton;
      resolve(false);
    });
    
    // Close on overlay click
    activeModal.addEventListener('click', (e) => {
      if (e.target === activeModal) {
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        delete window.gameModalCheckboxChanged;
        delete window.gameModalUpdateButton;
        resolve(false);
      }
    });
    
    // Close on Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        document.removeEventListener('keydown', escapeHandler);
        delete window.gameModalCheckboxChanged;
        delete window.gameModalUpdateButton;
        resolve(false);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  });
}

/**
 * Show a conflict resolution modal for zone overlaps
 * @param {Object} options
 * @param {string} options.newZoneType - Type of the new zone
 * @param {Array<Object>} options.conflicts - Array of conflicting zones with {id, name, zone_type}
 * @returns {Promise<Object|null>} Object with {resolution: "new_wins"|"existing_wins", perZone?: Map<zoneId, resolution>} or null if cancelled
 */
export function showConflictResolutionModal({ newZoneType, conflicts }) {
  return new Promise((resolve) => {
    // Remove existing modal if present
    if (activeModal) {
      activeModal.remove();
    }

    activeModal = document.createElement('div');
    activeModal.className = 'game-modal-overlay';
    
    const style = document.createElement('style');
    style.textContent = `
      .game-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10003;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .game-conflict-modal-content {
        background: #1a1a1a;
        border-radius: 12px;
        width: 90%;
        max-width: 700px;
        max-height: 90vh;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        border: 2px solid #ffa500;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      
      .game-conflict-modal-header {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid #333;
        background: rgba(255, 165, 0, 0.1);
        flex-shrink: 0;
      }
      
      .game-conflict-modal-header h3 {
        margin: 0;
        color: #ffa500;
        font-size: 1.25rem;
        font-weight: 600;
      }
      
      .game-conflict-modal-body {
        padding: 1.5rem;
        color: #ccc;
        line-height: 1.6;
        overflow-y: auto;
        flex: 1;
      }
      
      .game-conflict-message {
        margin-bottom: 1.5rem;
        font-size: 1rem;
        text-align: center;
      }
      
      .game-conflict-bulk-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
      }
      
      .game-conflict-bulk-button {
        flex: 1;
        min-width: 180px;
        padding: 0.875rem 1.25rem;
        border: 2px solid;
        border-radius: 8px;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }
      
      .game-conflict-bulk-button-new {
        background: rgba(76, 175, 80, 0.2);
        border-color: #4caf50;
        color: #4caf50;
      }
      
      .game-conflict-bulk-button-new:hover {
        background: rgba(76, 175, 80, 0.4);
        transform: scale(1.02);
      }
      
      .game-conflict-bulk-button-existing {
        background: rgba(255, 152, 0, 0.2);
        border-color: #ff9800;
        color: #ff9800;
      }
      
      .game-conflict-bulk-button-existing:hover {
        background: rgba(255, 152, 0, 0.4);
        transform: scale(1.02);
      }
      
      .game-conflict-bulk-button.selected {
        transform: scale(1.05);
        box-shadow: 0 0 10px rgba(255, 165, 0, 0.5);
      }
      
      .game-conflict-bulk-button-new.selected {
        background: rgba(76, 175, 80, 0.5);
        box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
      }
      
      .game-conflict-bulk-button-existing.selected {
        background: rgba(255, 152, 0, 0.5);
        box-shadow: 0 0 10px rgba(255, 152, 0, 0.5);
      }
      
      .game-conflict-zones-list {
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid #333;
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1.5rem;
        max-height: 300px;
        overflow-y: auto;
      }
      
      .game-conflict-zones-list::-webkit-scrollbar {
        width: 8px;
      }
      
      .game-conflict-zones-list::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.3);
      }
      
      .game-conflict-zones-list::-webkit-scrollbar-thumb {
        background: rgba(255, 165, 0, 0.3);
        border-radius: 4px;
      }
      
      .game-conflict-zone-group {
        margin-bottom: 1rem;
      }
      
      .game-conflict-zone-group:last-child {
        margin-bottom: 0;
      }
      
      .game-conflict-zone-group-title {
        color: #ffa500;
        font-weight: 600;
        font-size: 0.9rem;
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .game-conflict-zone-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid #444;
        border-radius: 6px;
        transition: all 0.2s;
      }
      
      .game-conflict-zone-item:hover {
        background: rgba(0, 0, 0, 0.5);
        border-color: #666;
      }
      
      .game-conflict-zone-info {
        flex: 1;
        min-width: 0;
      }
      
      .game-conflict-zone-name {
        color: #fff;
        font-weight: 500;
        font-size: 0.95rem;
        margin-bottom: 0.25rem;
      }
      
      .game-conflict-zone-id {
        color: #888;
        font-size: 0.85rem;
      }
      
      .game-conflict-zone-actions {
        display: flex;
        gap: 0.5rem;
        flex-shrink: 0;
      }
      
      .game-conflict-zone-button {
        padding: 0.5rem 1rem;
        border: 1px solid;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      
      .game-conflict-zone-button-new {
        background: rgba(76, 175, 80, 0.2);
        border-color: #4caf50;
        color: #4caf50;
      }
      
      .game-conflict-zone-button-new:hover {
        background: rgba(76, 175, 80, 0.4);
      }
      
      .game-conflict-zone-button-new.selected {
        background: #4caf50;
        color: #000;
      }
      
      .game-conflict-zone-button-existing {
        background: rgba(255, 152, 0, 0.2);
        border-color: #ff9800;
        color: #ff9800;
      }
      
      .game-conflict-zone-button-existing:hover {
        background: rgba(255, 152, 0, 0.4);
      }
      
      .game-conflict-zone-button-existing.selected {
        background: #ff9800;
        color: #000;
      }
      
      .game-conflict-footer-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
        flex-wrap: wrap;
        flex-shrink: 0;
      }
      
      .game-conflict-button {
        padding: 0.875rem 1.5rem;
        border: 2px solid;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 120px;
      }
      
      .game-conflict-button-confirm {
        background: rgba(76, 175, 80, 0.2);
        border-color: #4caf50;
        color: #4caf50;
      }
      
      .game-conflict-button-confirm:hover {
        background: rgba(76, 175, 80, 0.4);
        transform: scale(1.02);
      }
      
      .game-conflict-button-cancel {
        background: #2a2a2a;
        border-color: #444;
        color: #888;
      }
      
      .game-conflict-button-cancel:hover {
        background: #333;
        border-color: #555;
        color: #aaa;
      }
    `;
    
    document.head.appendChild(style);
    
    // Format zone type names for display
    const formatZoneType = (type) => {
      return type.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
    };
    
    const newZoneTypeStr = formatZoneType(newZoneType);
    
    // Group conflicts by zone type
    const conflictsByType = new Map();
    conflicts.forEach(conflict => {
      const type = conflict.zoneType || conflict.zone_type;
      if (!conflictsByType.has(type)) {
        conflictsByType.set(type, []);
      }
      conflictsByType.get(type).push(conflict);
    });
    
    // Track per-zone resolutions (for future per-zone customization)
    const perZoneResolutions = new Map();
    let bulkResolution = null; // null = not set, "new_wins" or "existing_wins"
    
    // Build zone list HTML
    let zonesListHTML = '';
    conflictsByType.forEach((zones, zoneType) => {
      const typeStr = formatZoneType(zoneType);
      zonesListHTML += `
        <div class="game-conflict-zone-group">
          <div class="game-conflict-zone-group-title">${typeStr} (${zones.length})</div>
          ${zones.map(zone => {
            const zoneId = zone.id;
            const zoneName = zone.name || `Zone ${zoneId}`;
            return `
              <div class="game-conflict-zone-item" data-zone-id="${zoneId}">
                <div class="game-conflict-zone-info">
                  <div class="game-conflict-zone-name">${zoneName}</div>
                  <div class="game-conflict-zone-id">ID: ${zoneId}</div>
                </div>
                <div class="game-conflict-zone-actions">
                  <button class="game-conflict-zone-button game-conflict-zone-button-new" data-zone-id="${zoneId}" data-resolution="new_wins">
                    Keep New
                  </button>
                  <button class="game-conflict-zone-button game-conflict-zone-button-existing" data-zone-id="${zoneId}" data-resolution="existing_wins">
                    Keep Existing
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    });
    
    activeModal.innerHTML = `
      <div class="game-conflict-modal-content">
        <div class="game-conflict-modal-header">
          <h3>Overlap Detected!</h3>
        </div>
        <div class="game-conflict-modal-body">
          <div class="game-conflict-message">
            Your new <strong>${newZoneTypeStr}</strong> zone overlaps with <strong>${conflicts.length}</strong> existing zone(s).
          </div>
          
          <div class="game-conflict-bulk-actions">
            <button class="game-conflict-bulk-button game-conflict-bulk-button-new" id="game-conflict-bulk-new">
              Keep New (All ${conflicts.length})
            </button>
            <button class="game-conflict-bulk-button game-conflict-bulk-button-existing" id="game-conflict-bulk-existing">
              Keep Existing (All ${conflicts.length})
            </button>
          </div>
          
          <div class="game-conflict-zones-list">
            ${zonesListHTML}
          </div>
          
          <div class="game-conflict-footer-actions">
            <button class="game-conflict-button game-conflict-button-confirm" id="game-conflict-confirm" disabled>
              Confirm
            </button>
            <button class="game-conflict-button game-conflict-button-cancel" id="game-conflict-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(activeModal);
    
    // Update confirm button state
    const updateConfirmButton = () => {
      const confirmBtn = document.getElementById('game-conflict-confirm');
      const hasBulkResolution = bulkResolution !== null;
      const hasAllPerZoneResolutions = conflicts.every(c => perZoneResolutions.has(c.id));
      confirmBtn.disabled = !hasBulkResolution && !hasAllPerZoneResolutions;
    };
    
    // Handle bulk actions
    const bulkNewBtn = document.getElementById('game-conflict-bulk-new');
    const bulkExistingBtn = document.getElementById('game-conflict-bulk-existing');
    
    bulkNewBtn.addEventListener('click', () => {
      bulkResolution = 'new_wins';
      // Clear per-zone resolutions when bulk is set
      perZoneResolutions.clear();
      // Update UI - select bulk button
      bulkNewBtn.classList.add('selected');
      bulkExistingBtn.classList.remove('selected');
      // Update all zone buttons
      document.querySelectorAll('.game-conflict-zone-button').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.resolution === 'new_wins') {
          btn.classList.add('selected');
        }
      });
      updateConfirmButton();
    });
    
    bulkExistingBtn.addEventListener('click', () => {
      bulkResolution = 'existing_wins';
      // Clear per-zone resolutions when bulk is set
      perZoneResolutions.clear();
      // Update UI - select bulk button
      bulkExistingBtn.classList.add('selected');
      bulkNewBtn.classList.remove('selected');
      // Update all zone buttons
      document.querySelectorAll('.game-conflict-zone-button').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.resolution === 'existing_wins') {
          btn.classList.add('selected');
        }
      });
      updateConfirmButton();
    });
    
    // Handle per-zone actions
    document.querySelectorAll('.game-conflict-zone-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const zoneId = parseInt(btn.dataset.zoneId);
        const resolution = btn.dataset.resolution;
        
        // Clear bulk resolution when individual choice is made
        bulkResolution = null;
        bulkNewBtn.classList.remove('selected');
        bulkExistingBtn.classList.remove('selected');
        
        // Toggle this zone's resolution
        const zoneItem = btn.closest('.game-conflict-zone-item');
        const otherBtn = zoneItem.querySelector(`.game-conflict-zone-button[data-zone-id="${zoneId}"][data-resolution="${resolution === 'new_wins' ? 'existing_wins' : 'new_wins'}"]`);
        
        if (btn.classList.contains('selected')) {
          // Deselect
          btn.classList.remove('selected');
          perZoneResolutions.delete(zoneId);
        } else {
          // Select this, deselect other
          btn.classList.add('selected');
          otherBtn.classList.remove('selected');
          perZoneResolutions.set(zoneId, resolution);
        }
        
        updateConfirmButton();
      });
    });
    
    // Handle confirm
    document.getElementById('game-conflict-confirm').addEventListener('click', () => {
      if (bulkResolution) {
        // Use bulk resolution for all
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        resolve({ resolution: bulkResolution, perZone: null });
      } else if (perZoneResolutions.size === conflicts.length) {
        // All zones have individual resolutions
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        resolve({ resolution: null, perZone: perZoneResolutions });
      }
    });
    
    // Handle cancel
    document.getElementById('game-conflict-cancel').addEventListener('click', () => {
      activeModal.remove();
      activeModal = null;
      document.head.removeChild(style);
      resolve(null);
    });
    
    // Close on overlay click
    activeModal.addEventListener('click', (e) => {
      if (e.target === activeModal) {
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        resolve(null);
      }
    });
    
    // Close on Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        activeModal.remove();
        activeModal = null;
        document.head.removeChild(style);
        document.removeEventListener('keydown', escapeHandler);
        resolve(null);
      }
    };
    document.addEventListener('keydown', escapeHandler);
    
    updateConfirmButton();
  });
}

/**
 * Hide any active modal
 */
export function hideGameModal() {
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}

