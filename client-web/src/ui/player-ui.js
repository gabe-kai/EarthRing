/**
 * Player Management UI Component
 * Provides UI for testing player API endpoints
 */

import { getCurrentPlayerProfile, updatePlayerPosition } from '../api/player-service.js';
import { getCurrentUser } from '../auth/auth-service.js';

let playerPanel = null;

/**
 * Create player panel content (can be embedded in a container)
 * @param {HTMLElement} container - Container to render into (optional, creates new panel if not provided)
 * @returns {HTMLElement} The container element
 */
export function createPlayerPanelContent(container = null) {
  const user = getCurrentUser();
  if (!user) {
    alert('Please log in first');
    return null;
  }

  const isEmbedded = container !== null;
  const contentContainer = container || document.createElement('div');
  
  if (!isEmbedded) {
    contentContainer.id = 'player-panel';
  }
  
  contentContainer.innerHTML = `
    <div class="player-panel-content">
      <div class="player-panel-header">
        <h2>Player Management</h2>
        <button id="player-panel-close" class="close-button">×</button>
      </div>
      
      <div class="player-panel-body">
        <div class="player-section">
          <h3>Player Profile</h3>
          <button id="load-profile-btn" class="action-button">Load My Profile</button>
          <div id="profile-display" class="result-display"></div>
        </div>
        
        <div class="player-section">
          <h3>Update Position</h3>
          <form id="position-form" class="position-form">
            <div class="form-group">
              <label>X Position (0-264000000)</label>
              <input type="number" id="position-x" value="12345" min="0" max="264000000" step="1" required />
            </div>
            <div class="form-group">
              <label>Y Position</label>
              <input type="number" id="position-y" value="0" step="0.1" required />
            </div>
            <div class="form-group">
              <label>Floor (-2 to 15)</label>
              <input type="number" id="position-floor" value="0" min="-2" max="15" step="1" required />
            </div>
            <button type="submit" class="action-button">Update Position</button>
          </form>
          <div id="position-result" class="result-display"></div>
        </div>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #player-panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #1a1a1a;
      border: 2px solid #00ff00;
      border-radius: 12px;
      padding: 0;
      width: 90%;
      max-width: 600px;
      max-height: 90vh;
      overflow-y: auto;
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 8px 32px rgba(0, 255, 0, 0.3);
    }
    
    .player-panel-content {
      padding: 1.5rem;
    }
    
    .player-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #333;
    }
    
    .player-panel-header h2 {
      color: #00ff00;
      margin: 0;
      font-size: 1.5rem;
    }
    
    .close-button {
      background: #ff4444;
      color: white;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.5rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .close-button:hover {
      background: #cc0000;
    }
    
    .player-section {
      margin-bottom: 2rem;
    }
    
    .player-section h3 {
      color: #ccc;
      margin-bottom: 1rem;
      font-size: 1.1rem;
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
    
    .position-form {
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

  // Only add styles if not already added (check if style exists)
  if (!document.getElementById('player-panel-styles')) {
    style.id = 'player-panel-styles';
    document.head.appendChild(style);
  } else if (!isEmbedded) {
    document.head.appendChild(style);
  }

  if (!isEmbedded) {
    document.body.appendChild(contentContainer);
    playerPanel = contentContainer;
  }

  // Set up event listeners
  setupPlayerPanelListeners(user.id, contentContainer);

  return contentContainer;
}

/**
 * Show player management panel (standalone modal)
 */
export function showPlayerPanel() {
  if (playerPanel) {
    return; // Already shown
  }
  createPlayerPanelContent();
}

/**
 * Hide player management panel
 */
export function hidePlayerPanel() {
  if (playerPanel) {
    playerPanel.remove();
    playerPanel = null;
  }
}

/**
 * Set up event listeners for player panel
 */
function setupPlayerPanelListeners(playerID, container = null) {
  const panel = container || playerPanel;
  if (!panel) return;
  
  // Close button (only if standalone panel)
  const closeBtn = panel.querySelector('#player-panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hidePlayerPanel();
    });
  }

  // Load profile button
  const loadBtn = panel.querySelector('#load-profile-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const display = panel.querySelector('#profile-display');
    display.textContent = 'Loading...';
    display.className = 'result-display show';
    
    try {
      // Debug: Check if token exists
      const token = localStorage.getItem('access_token');
      if (!token) {
        throw new Error('No access token found. Please log in again.');
      }
      
      const profile = await getCurrentPlayerProfile();
      display.textContent = JSON.stringify(profile, null, 2);
      display.className = 'result-display show success';
      
      // Log player's current position for reference
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
  const positionForm = panel.querySelector('#position-form');
  if (positionForm) {
    positionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const resultDisplay = panel.querySelector('#position-result');
      const submitButton = e.target.querySelector('button[type="submit"]');
      
      const x = panel.querySelector('#position-x').value;
      const y = panel.querySelector('#position-y').value;
      const floor = panel.querySelector('#position-floor').value;
    
    resultDisplay.textContent = 'Updating position...';
    resultDisplay.className = 'result-display show';
    submitButton.disabled = true;
    
    try {
      const result = await updatePlayerPosition(playerID, { x, y }, floor);
      resultDisplay.textContent = JSON.stringify(result, null, 2);
      resultDisplay.className = 'result-display show success';
      
      // Update camera position to match the new player position
      if (window.earthring && window.earthring.cameraController) {
        const cameraController = window.earthring.cameraController;
        // Smoothly move camera to the new position
        cameraController.moveToPosition({
          x: parseFloat(x),
          y: parseFloat(y),
          z: parseInt(floor),
        }, 2); // 2 second smooth movement
        console.log(`Camera moved to player position: (${x}, ${y}, ${floor})`);
      }
      
      // Reload profile to show updated position
      setTimeout(() => {
        const loadBtn = panel.querySelector('#load-profile-btn');
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

