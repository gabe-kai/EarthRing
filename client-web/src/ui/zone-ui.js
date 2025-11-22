/**
 * Zone Management UI
 * Tool-based zone editor integrated into bottom toolbar
 */

import { isAuthenticated } from '../auth/auth-service.js';
import { TOOLS } from '../zones/zone-editor.js';
import { showZoneInfoWindow, hideZoneInfoWindow } from './zone-info-window.js';
import { addTab, setTabContent, switchTab } from './bottom-toolbar.js';

let zoneEditor = null;
let zonesTabInitialized = false;

export function initializeZonesTab() {
  // Check if tab actually exists in DOM (survives refresh check)
  const existingTab = document.querySelector('[data-tab-id="zones"]');
  if (existingTab && zonesTabInitialized) {
    // Tab exists and is initialized
    return;
  }
  
  // Reset flag if tab doesn't exist (page was refreshed)
  if (!existingTab) {
    zonesTabInitialized = false;
  }

  if (!isAuthenticated()) {
    return;
  }

  // Get zone editor instance
  zoneEditor = window.earthring?.zoneEditor;
  if (!zoneEditor) {
    console.warn('Zone editor is not initialized');
    return;
  }

  // Create Zones tab
  addTab('Zones', 'zones');
  
  // Create toolbar content
  createZonesToolbarContent();
  
  // Listen for tab changes
  window.addEventListener('toolbar:tab-changed', (event) => {
    if (event.detail.tabId === 'zones') {
      createZonesToolbarContent();
    }
  });

  zonesTabInitialized = true;
}

function createZonesToolbarContent() {
  const content = document.createElement('div');
  content.className = 'zones-toolbar-content';
  
  // Zone type selection section
  const zoneTypeSection = document.createElement('div');
  zoneTypeSection.className = 'toolbar-section';
  const zoneTypeLabel = document.createElement('span');
  zoneTypeLabel.className = 'toolbar-section-label';
  zoneTypeLabel.textContent = 'Zone Type';
  zoneTypeSection.appendChild(zoneTypeLabel);
  
  const zoneTypes = [
    { id: 'residential', icon: '🏠', label: 'Residential' },
    { id: 'commercial', icon: '🏪', label: 'Commercial' },
    { id: 'industrial', icon: '🏭', label: 'Industrial' },
    { id: 'mixed-use', icon: '🏢', label: 'Mixed-Use' },
    { id: 'park', icon: '🌳', label: 'Park' },
    { id: 'restricted', icon: '🚫', label: 'Restricted' },
  ];
  
  zoneTypes.forEach(({ id, icon, label }) => {
    const button = createToolbarButton(icon, label, `zone-type-${id}`);
    button.addEventListener('click', () => {
      selectZoneType(id);
    });
    zoneTypeSection.appendChild(button);
  });
  
  // Tool selection section
  const toolSection = document.createElement('div');
  toolSection.className = 'toolbar-section';
  const toolLabel = document.createElement('span');
  toolLabel.className = 'toolbar-section-label';
  toolLabel.textContent = 'Tools';
  toolSection.appendChild(toolLabel);
  
  const tools = [
    { id: TOOLS.SELECT, icon: '👆', label: 'Select' },
    { id: TOOLS.RECTANGLE, icon: '▭', label: 'Rectangle' },
    { id: TOOLS.CIRCLE, icon: '○', label: 'Circle' },
    { id: TOOLS.TORUS, icon: '⊚', label: 'Torus' },
    { id: TOOLS.POLYGON, icon: '⬟', label: 'Polygon' },
    { id: TOOLS.PAINTBRUSH, icon: '🖌', label: 'Paintbrush' },
  ];
  
  tools.forEach(({ id, icon, label }) => {
    const button = createToolbarButton(icon, label, `tool-${id}`);
    button.addEventListener('click', () => {
      selectTool(id);
    });
    toolSection.appendChild(button);
  });
  
  // Settings section (floor, paintbrush radius)
  const settingsSection = document.createElement('div');
  settingsSection.className = 'toolbar-section';
  
  // Floor selector
  const floorLabel = document.createElement('label');
  floorLabel.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; color: #888; font-size: 0.85rem;';
  floorLabel.innerHTML = `
    Floor: <input type="number" id="zone-floor-input" value="0" min="0" max="15" step="1" 
           style="width: 60px; padding: 0.25rem; background: #121212; border: 1px solid #333; border-radius: 4px; color: #eee;" />
  `;
  settingsSection.appendChild(floorLabel);
  
  // Paintbrush radius (hidden by default)
  const paintbrushRadiusLabel = document.createElement('label');
  paintbrushRadiusLabel.id = 'paintbrush-radius-label';
  paintbrushRadiusLabel.style.cssText = 'display: none; align-items: center; gap: 0.5rem; color: #888; font-size: 0.85rem; margin-left: 1rem;';
  paintbrushRadiusLabel.innerHTML = `
    Radius: <input type="number" id="paintbrush-radius-input" value="50" min="10" max="500" step="10" 
           style="width: 80px; padding: 0.25rem; background: #121212; border: 1px solid #333; border-radius: 4px; color: #eee;" />
  `;
  settingsSection.appendChild(paintbrushRadiusLabel);
  
  // Info section
  const infoSection = document.createElement('div');
  infoSection.className = 'toolbar-info';
  infoSection.id = 'zones-toolbar-info';
  infoSection.innerHTML = `
    <span>Tool: <span class="toolbar-info-value" id="current-tool-display">None</span></span>
    <span>Type: <span class="toolbar-info-value" id="current-type-display">Residential</span></span>
  `;
  
  content.appendChild(zoneTypeSection);
  content.appendChild(toolSection);
  content.appendChild(settingsSection);
  content.appendChild(infoSection);
  
  setTabContent('zones', content);
  
  // Set up event listeners
  setupZonesToolbarListeners();
  
  // Set default zone type
  selectZoneType('residential');
}

function createToolbarButton(icon, label, id) {
  const button = document.createElement('div');
  button.className = 'toolbar-button';
  button.id = id;
  button.innerHTML = `
    <span class="toolbar-button-icon">${icon}</span>
    <span class="toolbar-button-label">${label}</span>
  `;
  return button;
}

function selectZoneType(zoneType) {
  // Update button states
  const buttons = document.querySelectorAll('[id^="zone-type-"]');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.id === `zone-type-${zoneType}`) {
      btn.classList.add('active');
    }
  });
  
  // Update editor
  if (zoneEditor) {
    zoneEditor.setZoneType(zoneType);
  }
  
  // Update info display
  const typeDisplay = document.getElementById('current-type-display');
  if (typeDisplay) {
    const labels = {
      residential: 'Residential',
      commercial: 'Commercial',
      industrial: 'Industrial',
      'mixed-use': 'Mixed-Use',
      park: 'Park',
      restricted: 'Restricted',
    };
    typeDisplay.textContent = labels[zoneType] || zoneType;
  }
}

function selectTool(tool) {
  // Update button states
  const buttons = document.querySelectorAll('[id^="tool-"]');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.id === `tool-${tool}`) {
      btn.classList.add('active');
    }
  });
  
  // Show/hide paintbrush radius control
  const paintbrushRadiusLabel = document.getElementById('paintbrush-radius-label');
  if (paintbrushRadiusLabel) {
    paintbrushRadiusLabel.style.display = tool === TOOLS.PAINTBRUSH ? 'flex' : 'none';
  }
  
  // Set tool in editor
  if (zoneEditor) {
    zoneEditor.setTool(tool);
  }
  
  // Update info display
  const toolDisplay = document.getElementById('current-tool-display');
  if (toolDisplay) {
    const toolLabels = {
      [TOOLS.SELECT]: 'Select',
      [TOOLS.RECTANGLE]: 'Rectangle',
      [TOOLS.CIRCLE]: 'Circle',
      [TOOLS.TORUS]: 'Torus',
      [TOOLS.POLYGON]: 'Polygon',
      [TOOLS.PAINTBRUSH]: 'Paintbrush',
      [TOOLS.NONE]: 'None',
    };
    toolDisplay.textContent = toolLabels[tool] || 'None';
  }
}

function setupZonesToolbarListeners() {
  // Floor input
  const floorInput = document.getElementById('zone-floor-input');
  if (floorInput) {
    floorInput.addEventListener('change', (e) => {
      const floor = parseInt(e.target.value, 10);
      if (zoneEditor) {
        zoneEditor.setFloor(floor);
      }
    });
  }
  
  // Paintbrush radius input
  const paintbrushRadiusInput = document.getElementById('paintbrush-radius-input');
  if (paintbrushRadiusInput) {
    paintbrushRadiusInput.addEventListener('change', (e) => {
      const radius = parseFloat(e.target.value);
      if (zoneEditor) {
        zoneEditor.setPaintbrushRadius(radius);
      }
    });
  }
  
  // Zone editor callbacks
  if (zoneEditor) {
    zoneEditor.onToolChangeCallbacks.push((tool) => {
      // Update UI when tool changes programmatically
      const buttons = document.querySelectorAll('[id^="tool-"]');
      buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.id === `tool-${tool}`) {
          btn.classList.add('active');
        }
      });
      
      // Update paintbrush radius visibility
      const paintbrushRadiusLabel = document.getElementById('paintbrush-radius-label');
      if (paintbrushRadiusLabel) {
        paintbrushRadiusLabel.style.display = tool === TOOLS.PAINTBRUSH ? 'flex' : 'none';
      }
      
      // Update tool display
      const toolDisplay = document.getElementById('current-tool-display');
      if (toolDisplay) {
        const toolLabels = {
          [TOOLS.SELECT]: 'Select',
          [TOOLS.RECTANGLE]: 'Rectangle',
          [TOOLS.CIRCLE]: 'Circle',
          [TOOLS.TORUS]: 'Torus',
          [TOOLS.POLYGON]: 'Polygon',
          [TOOLS.PAINTBRUSH]: 'Paintbrush',
          [TOOLS.NONE]: 'None',
        };
        toolDisplay.textContent = toolLabels[tool] || 'None';
      }
    });

    zoneEditor.onZoneSelectedCallbacks.push((zone) => {
      showZoneInfoWindow(zone, (zoneID) => {
        // Handle zone deletion
        const zoneManager = window.earthring?.zoneManager;
        const gameStateManager = window.earthring?.gameStateManager;
        if (gameStateManager) {
          gameStateManager.removeZone(zoneID);
        }
        if (zoneManager) {
          zoneManager.removeZone(zoneID);
        }
        zoneEditor.deselectZone();
      });
    });

    zoneEditor.onZoneCreatedCallbacks.push((zone) => {
      console.log('Zone created:', zone);
    });
  }
}

export function showZonePanel() {
  // Switch to zones tab if toolbar exists
  switchTab('zones');
  
  // Initialize if not already done
  if (!zonesTabInitialized) {
    initializeZonesTab();
  }
}

export function hideZonePanel() {
  hideZoneInfoWindow();
  // Deselect tool when panel closes
  if (zoneEditor) {
    zoneEditor.setTool(TOOLS.NONE);
  }
}
