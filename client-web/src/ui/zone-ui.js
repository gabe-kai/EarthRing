/**
 * Zone Management UI
 * Tool-based zone editor integrated into bottom toolbar
 */

import { isAuthenticated } from '../auth/auth-service.js';
import { TOOLS } from '../zones/zone-editor.js';
import { updateInfoBox } from './info-box.js';
import { deleteZone, updateZone } from '../api/zone-service.js';
import { getPlayerProfile } from '../api/player-service.js';
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
    { id: 'dezone', icon: '⊖', label: 'Dezone' },
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
    { id: TOOLS.POLYGON, icon: '⬟', label: 'Polygon' },
    { id: TOOLS.PAINTBRUSH, icon: '🖌', label: 'Paintbrush', disabled: true },
  ];
  
  tools.forEach(({ id, icon, label, disabled }) => {
    const button = createToolbarButton(icon, label, `tool-${id}`);
    
    if (disabled) {
      button.classList.add('disabled');
      button.title = 'Paintbrush tool is disabled until later';
      // Prevent clicks but allow hover for tooltip
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      });
    } else {
      button.addEventListener('click', () => {
        selectTool(id);
      });
    }
    
    toolSection.appendChild(button);
  });
  
  // Settings section (paintbrush controls)
  const settingsSection = document.createElement('div');
  settingsSection.className = 'toolbar-section';
  
  // Paintbrush radius (always visible)
  const paintbrushRadiusLabel = document.createElement('label');
  paintbrushRadiusLabel.id = 'paintbrush-radius-label';
  paintbrushRadiusLabel.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; color: #888; font-size: 0.85rem;';
  paintbrushRadiusLabel.innerHTML = `
    Brush Size: <input type="number" id="paintbrush-radius-input" value="10" min="10" max="500" step="5" 
           style="width: 80px; padding: 0.25rem; background: #121212; border: 1px solid #333; border-radius: 4px; color: #eee;" />
    <span style="color: #666; font-size: 0.75rem;">[ <span style="color: #888;">[</span> / <span style="color: #888;">]</span> ]</span>
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
      dezone: 'Dezone',
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
  
  // Paintbrush radius control is always visible now
  
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
      [TOOLS.POLYGON]: 'Polygon',
      [TOOLS.PAINTBRUSH]: 'Paintbrush',
      [TOOLS.NONE]: 'None',
    };
    toolDisplay.textContent = toolLabels[tool] || 'None';
  }
}

function setupZonesToolbarListeners() {
  // Paintbrush radius input
  const paintbrushRadiusInput = document.getElementById('paintbrush-radius-input');
  if (paintbrushRadiusInput) {
    // Initialize input with current radius
    if (zoneEditor) {
      paintbrushRadiusInput.value = zoneEditor.paintbrushRadius;
    }
    
    paintbrushRadiusInput.addEventListener('change', (e) => {
      const radius = parseFloat(e.target.value);
      if (zoneEditor) {
        zoneEditor.setPaintbrushRadius(radius);
        // Update UI to reflect actual clamped value
        const actualRadius = zoneEditor.paintbrushRadius;
        if (actualRadius !== radius) {
          e.target.value = actualRadius;
        }
      }
    });
  }
  
  // Keyboard shortcuts for brush size: [ and ]
  // Use a single event listener that's only added once
  if (!window._brushSizeShortcutsAdded) {
    window._brushSizeShortcutsAdded = true;
    document.addEventListener('keydown', (e) => {
      // Only handle if not typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      if (e.key === '[' || e.key === ']') {
        const editor = window.earthring?.zoneEditor;
        if (!editor) return;
        
        e.preventDefault();
        const input = document.getElementById('paintbrush-radius-input');
        const currentRadius = editor.paintbrushRadius;
        let newRadius;
        
        if (e.key === '[') {
          newRadius = Math.max(10, currentRadius - 5); // Decrease by 5m, minimum 10m
        } else {
          newRadius = Math.min(500, currentRadius + 5); // Increase by 5m, maximum 500m
        }
        
        editor.setPaintbrushRadius(newRadius);
        // Update input field and trigger change event to sync UI
        if (input) {
          input.value = editor.paintbrushRadius; // Use actual clamped value
          // Trigger change event to ensure any listeners are notified
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Update brush preview immediately if paintbrush tool is active and we have a current position
        if (editor.currentTool === 'paintbrush' && editor.currentPoint) {
          editor.updatePaintbrushPreview(editor.currentPoint);
        }
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
      
      // Paintbrush radius control is always visible now
      
      // Update tool display
      const toolDisplay = document.getElementById('current-tool-display');
      if (toolDisplay) {
        const toolLabels = {
          [TOOLS.SELECT]: 'Select',
          [TOOLS.RECTANGLE]: 'Rectangle',
          [TOOLS.CIRCLE]: 'Circle',
          [TOOLS.DEZONE]: 'Dezone',
          [TOOLS.POLYGON]: 'Polygon',
          [TOOLS.PAINTBRUSH]: 'Paintbrush',
          [TOOLS.NONE]: 'None',
        };
        toolDisplay.textContent = toolLabels[tool] || 'None';
      }
    });

    // Clear info box when zone is deselected
    zoneEditor.onZoneDeselectedCallbacks.push(() => {
      updateInfoBox({}, { title: 'Info' });
    });

    zoneEditor.onZoneSelectedCallbacks.push(async (zone) => {
      // Format zone type for display
      const zoneTypeDisplay = zone.zone_type
        ? zone.zone_type.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ')
        : 'Unknown';
      
      // Format area for display
      let areaDisplay = 'N/A';
      if (zone.area !== undefined && zone.area !== null) {
        areaDisplay = `${zone.area.toFixed(2)} m²`;
      }
      
      // Fetch owner username for tooltip
      let ownerUsername = null;
      if (zone.owner_id) {
        try {
          const ownerProfile = await getPlayerProfile(zone.owner_id);
          ownerUsername = ownerProfile.username || null;
        } catch (error) {
          console.warn('Failed to fetch owner username:', error);
        }
      }
      
      // Build tooltip text
      const tooltipParts = [];
      tooltipParts.push(`Zone ID: ${zone.id}`);
      if (ownerUsername) {
        tooltipParts.push(`Owner: ${ownerUsername}`);
      } else if (zone.owner_id) {
        tooltipParts.push(`Owner ID: ${zone.owner_id}`);
      }
      const tooltip = tooltipParts.join('\n');
      
      // Build zone info object for info box (excluding Type, Created, Owner ID)
      const zoneInfo = {
        'Name': zone.name || `Zone ${zone.id}`,
        'Floor': (zone.floor ?? 0).toString(),
        'Area': areaDisplay,
      };
      
      // Define name save handler
      const saveName = async (newName) => {
        if (newName === (zone.name || `Zone ${zone.id}`)) {
          return; // No change
        }
        
        try {
          await updateZone(zone.id, { name: newName });
          // Update zone in zone manager
          const zoneManager = window.earthring?.zoneManager;
          if (zoneManager) {
            const zoneMesh = zoneManager.zoneMeshes.get(zone.id);
            if (zoneMesh && zoneMesh.userData) {
              zoneMesh.userData.zone = { ...zone, name: newName };
            }
          }
          // Update zone in editor
          if (zoneEditor.selectedZone) {
            zoneEditor.selectedZone.name = newName;
          }
          // Update the displayed name in the info box
          const nameField = document.querySelector('[data-field="Name"]');
          if (nameField) {
            nameField.textContent = newName;
          }
        } catch (error) {
          console.error('Failed to update zone name:', error);
          alert(`Failed to update zone name: ${error.message}`);
          // Restore original value
          const nameField = document.querySelector('[data-field="Name"]');
          if (nameField) {
            nameField.textContent = zone.name || `Zone ${zone.id}`;
          }
        }
      };
      
      // Define delete action (only for non-system zones)
      const deleteAction = async () => {
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
          // Handle zone deletion
          const zoneManager = window.earthring?.zoneManager;
          const gameStateManager = window.earthring?.gameStateManager;
          if (gameStateManager) {
            gameStateManager.removeZone(zone.id);
          }
          if (zoneManager) {
            zoneManager.removeZone(zone.id);
          }
          zoneEditor.deselectZone();
          // Clear info box
          updateInfoBox({});
        } catch (error) {
          console.error('Failed to delete zone:', error);
          alert(`Failed to delete zone: ${error.message}`);
        }
      };
      
      // Build actions object - only include delete for non-system zones
      const actions = {};
      if (!(zone.is_system_zone === true)) {
        actions['Delete Zone'] = deleteAction;
      }
      
      // Update info box with zone information
      updateInfoBox(zoneInfo, {
        title: `${zoneTypeDisplay} Zone Details`,
        tooltip: tooltip,
        actions: actions,
        editableFields: {
          'Name': { onSave: saveName }
        }
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
  // Clear info box when panel closes
  updateInfoBox({});
  // Deselect tool when panel closes
  if (zoneEditor) {
    zoneEditor.setTool(TOOLS.NONE);
  }
}
