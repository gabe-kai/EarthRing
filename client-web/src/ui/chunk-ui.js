/**
 * Chunk Management UI Component
 * Provides UI for testing chunk API endpoints
 */

import { getChunkMetadata, deleteChunk } from '../api/chunk-service.js';
import { positionToChunkIndex, chunkIndexToPositionRange } from '../utils/coordinates.js';
import { isAuthenticated } from '../auth/auth-service.js';

let chunkPanel = null;

/**
 * Show chunk management panel
 */
export function showChunkPanel() {
  if (chunkPanel) {
    return; // Already shown
  }

  if (!isAuthenticated()) {
    alert('Please log in first');
    return;
  }

  chunkPanel = document.createElement('div');
  chunkPanel.id = 'chunk-panel';
  chunkPanel.innerHTML = `
    <div class="chunk-panel-content">
      <div class="chunk-panel-header">
        <h2>Chunk Metadata</h2>
        <button id="chunk-panel-close" class="close-button">×</button>
      </div>
      
      <div class="chunk-panel-body">
        <div class="chunk-section">
          <h3>Get Chunk Metadata</h3>
          <p class="help-text">Format: floor_chunk_index (e.g., 0_12345)</p>
          <form id="chunk-form" class="chunk-form">
            <div class="form-group">
              <label>Floor</label>
              <input type="number" id="chunk-floor" value="0" min="-2" max="15" step="1" required />
            </div>
            <div class="form-group">
              <label>Chunk Index (0-263999)</label>
              <input type="number" id="chunk-index" value="12345" min="0" max="263999" step="1" required />
            </div>
            <div class="form-actions">
              <button type="submit" class="action-button">Get Metadata</button>
              <button type="button" id="delete-chunk-btn" class="delete-button">Delete Chunk</button>
            </div>
          </form>
          <div id="chunk-result" class="result-display"></div>
        </div>
        
        <div class="chunk-section">
          <h3>Position to Chunk</h3>
          <p class="help-text">Convert ring position (meters) to chunk index</p>
          <form id="position-to-chunk-form" class="chunk-form">
            <div class="form-group">
              <label>Ring Position (meters, 0-264000000)</label>
              <input type="number" id="position-input" value="12345000" min="0" max="264000000" step="1000" required />
            </div>
            <button type="submit" class="action-button">Get Chunk Index</button>
          </form>
          <div id="position-to-chunk-result" class="result-display"></div>
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
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #chunk-panel {
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
    
    .chunk-panel-content {
      padding: 1.5rem;
    }
    
    .chunk-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #333;
    }
    
    .chunk-panel-header h2 {
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
    
    .chunk-section {
      margin-bottom: 2rem;
    }
    
    .chunk-section h3 {
      color: #ccc;
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }
    
    .help-text {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    
    .chunk-form {
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
    }
    
    .action-button:hover {
      background: #00cc00;
    }
    
    .action-button:disabled {
      background: #444;
      color: #888;
      cursor: not-allowed;
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
  document.body.appendChild(chunkPanel);

  // Set up event listeners
  setupChunkPanelListeners();
}

/**
 * Hide chunk management panel
 */
export function hideChunkPanel() {
  if (chunkPanel) {
    chunkPanel.remove();
    chunkPanel = null;
  }
}

/**
 * Handle chunk metadata request
 */
async function handleChunkRequest() {
  const resultDisplay = document.getElementById('chunk-result');
  const submitButton = document.querySelector('#chunk-form button[type="submit"]');
  
  const floor = document.getElementById('chunk-floor').value;
  const chunkIndex = document.getElementById('chunk-index').value;
  const chunkID = `${floor}_${chunkIndex}`;
  
  resultDisplay.textContent = 'Loading...';
  resultDisplay.className = 'result-display show';
  submitButton.disabled = true;
  
  try {
    // Debug: Check if token exists
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
 * Handle chunk deletion
 */
async function handleChunkDelete() {
  const resultDisplay = document.getElementById('chunk-result');
  const deleteButton = document.getElementById('delete-chunk-btn');
  
  const floor = document.getElementById('chunk-floor').value;
  const chunkIndex = document.getElementById('chunk-index').value;
  const chunkID = `${floor}_${chunkIndex}`;
  
  // Confirm deletion
  const confirmed = confirm(`Are you sure you want to delete chunk ${chunkID}?\n\nThis will remove it from the database and force regeneration on next request.`);
  if (!confirmed) {
    return;
  }
  
  resultDisplay.textContent = 'Deleting chunk...';
  resultDisplay.className = 'result-display show';
  deleteButton.disabled = true;
  
  try {
    console.log(`[Chunk UI] Deleting chunk ${chunkID}...`);
    const result = await deleteChunk(chunkID);
    console.log(`[Chunk UI] ✓ Successfully deleted chunk ${chunkID}:`, result);
    resultDisplay.textContent = JSON.stringify(result, null, 2);
    resultDisplay.className = 'result-display show success';
    
    // Also show a brief success message
    const successMsg = `✓ Chunk ${chunkID} deleted successfully!\n\nIt will be regenerated by the procedural service on next request.`;
    console.log(successMsg);
  } catch (error) {
    console.error(`[Chunk UI] ✗ Failed to delete chunk ${chunkID}:`, error);
    resultDisplay.textContent = `Error: ${error.message}`;
    resultDisplay.className = 'result-display show error';
  } finally {
    deleteButton.disabled = false;
  }
}

/**
 * Handle position to chunk index conversion
 */
function handlePositionToChunk() {
  const resultDisplay = document.getElementById('position-to-chunk-result');
  const submitButton = document.querySelector('#position-to-chunk-form button[type="submit"]');
  
  const positionInput = document.getElementById('position-input');
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
      chunkID: `0_${chunkIndex}`, // Default to floor 0 for display
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

/**
 * Set up event listeners for chunk panel
 */
function setupChunkPanelListeners() {
  // Close button
  document.getElementById('chunk-panel-close').addEventListener('click', () => {
    hideChunkPanel();
  });

  // Chunk form
  document.getElementById('chunk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleChunkRequest();
  });

  // Delete chunk button
  document.getElementById('delete-chunk-btn').addEventListener('click', async () => {
    await handleChunkDelete();
  });

  // Position to chunk form
  document.getElementById('position-to-chunk-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handlePositionToChunk();
  });

  // Quick example buttons
  document.querySelectorAll('.example-button').forEach(button => {
    button.addEventListener('click', async () => {
      const chunkID = button.dataset.chunk;
      const [floor, chunkIndex] = chunkID.split('_');
      document.getElementById('chunk-floor').value = floor;
      document.getElementById('chunk-index').value = chunkIndex;
      await handleChunkRequest();
    });
  });
}

