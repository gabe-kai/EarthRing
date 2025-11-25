/**
 * Zones Toolbar
 * Left-side vertical toolbar with expandable zone controls
 */

export function createZonesToolbar(zoneManager, gridOverlay, gameStateManager) {
  const toolbar = document.createElement('div');
  toolbar.id = 'zones-toolbar';
  toolbar.className = 'zones-toolbar';

  // State
  let expanded = false;
  const visibilityState = {
    grid: true,
    allZones: true,
    residential: true,
    commercial: true,
    industrial: true,
    'mixed-use': true,
    park: true,
    restricted: true,
  };

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    .zones-toolbar {
      position: fixed;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .zones-toolbar-icon {
      width: 48px;
      height: 48px;
      background: rgba(0, 0, 0, 0.8);
      border: 2px solid #00ff00;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #00ff00;
      font-size: 24px;
      font-weight: bold;
      transition: all 0.2s ease;
      user-select: none;
    }

    .zones-toolbar-icon:hover {
      background: rgba(0, 255, 0, 0.1);
      transform: scale(1.05);
    }

    .zones-toolbar-panel {
      position: absolute;
      left: 60px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid #00ff00;
      border-radius: 8px;
      padding: 12px;
      min-width: 200px;
      max-height: 80vh;
      overflow-y: auto;
      overflow-x: hidden;
      display: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    
    /* Custom scrollbar styling for the panel */
    .zones-toolbar-panel::-webkit-scrollbar {
      width: 8px;
    }
    
    .zones-toolbar-panel::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
    }
    
    .zones-toolbar-panel::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 0, 0.3);
      border-radius: 4px;
    }
    
    .zones-toolbar-panel::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 255, 0, 0.5);
    }

    .zones-toolbar-panel.expanded {
      display: block;
    }

    .zones-toolbar-header {
      color: #00ff00;
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(0, 255, 0, 0.3);
    }

    .zones-toolbar-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(0, 255, 0, 0.1);
    }

    .zones-toolbar-item:last-child {
      border-bottom: none;
    }

    .zones-toolbar-label {
      color: #00ff00;
      font-size: 14px;
      flex: 1;
    }

    .zones-toolbar-toggle {
      background: rgba(0, 255, 0, 0.2);
      border: 1px solid #00ff00;
      border-radius: 4px;
      color: #00ff00;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s ease;
      min-width: 60px;
    }

    .zones-toolbar-toggle:hover {
      background: rgba(0, 255, 0, 0.3);
    }

    .zones-toolbar-toggle.active {
      background: rgba(0, 255, 0, 0.4);
      border-color: #00ff00;
    }

    .zones-toolbar-toggle.inactive {
      background: rgba(255, 0, 0, 0.2);
      border-color: #ff4444;
      color: #ff4444;
    }

    .zones-toolbar-floor-selector {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(0, 255, 0, 0.1);
      margin-top: 8px;
    }

    .zones-toolbar-floor-label {
      color: #00ff00;
      font-size: 14px;
      flex: 1;
    }

    .zones-toolbar-floor-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .zones-toolbar-floor-button {
      background: rgba(0, 255, 0, 0.2);
      border: 1px solid #00ff00;
      border-radius: 4px;
      color: #00ff00;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 18px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .zones-toolbar-floor-button:hover {
      background: rgba(0, 255, 0, 0.3);
    }

    .zones-toolbar-floor-display {
      color: #00ff00;
      font-size: 16px;
      font-weight: bold;
      min-width: 40px;
      text-align: center;
    }
  `;
  document.head.appendChild(style);

  // Icon button
  const icon = document.createElement('div');
  icon.className = 'zones-toolbar-icon';
  icon.textContent = 'Z';
  icon.title = 'Zones & Grid Controls';
  icon.onclick = () => {
    expanded = !expanded;
    panel.classList.toggle('expanded', expanded);
  };
  toolbar.appendChild(icon);

  // Panel
  const panel = document.createElement('div');
  panel.className = 'zones-toolbar-panel';

  const header = document.createElement('div');
  header.className = 'zones-toolbar-header';
  header.textContent = 'Zones & Grid';
  panel.appendChild(header);

  // Create toggle item helper
  const createToggleItem = (label, key, onClick) => {
    const item = document.createElement('div');
    item.className = 'zones-toolbar-item';

    const labelEl = document.createElement('div');
    labelEl.className = 'zones-toolbar-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);

    const toggle = document.createElement('button');
    toggle.className = 'zones-toolbar-toggle';
    toggle.textContent = visibilityState[key] ? 'Hide' : 'Show';
    toggle.classList.add(visibilityState[key] ? 'active' : 'inactive');
    toggle.onclick = () => {
      visibilityState[key] = !visibilityState[key];
      toggle.textContent = visibilityState[key] ? 'Hide' : 'Show';
      toggle.classList.toggle('active', visibilityState[key]);
      toggle.classList.toggle('inactive', !visibilityState[key]);
      onClick(visibilityState[key]);
    };
    item.appendChild(toggle);

    return item;
  };

  // Floor selector
  const floorSelector = document.createElement('div');
  floorSelector.className = 'zones-toolbar-floor-selector';
  
  const floorLabel = document.createElement('div');
  floorLabel.className = 'zones-toolbar-floor-label';
  floorLabel.textContent = 'Active Floor';
  floorSelector.appendChild(floorLabel);
  
  const floorControls = document.createElement('div');
  floorControls.className = 'zones-toolbar-floor-controls';
  
  const floorDown = document.createElement('button');
  floorDown.className = 'zones-toolbar-floor-button';
  floorDown.textContent = '−';
  floorDown.title = 'Go down one floor';
  floorDown.onclick = () => {
    if (gameStateManager) {
      const current = gameStateManager.getActiveFloor();
      gameStateManager.setActiveFloor(current - 1);
      updateFloorDisplay();
    }
  };
  floorControls.appendChild(floorDown);
  
  const floorDisplay = document.createElement('div');
  floorDisplay.className = 'zones-toolbar-floor-display';
  floorDisplay.textContent = gameStateManager ? gameStateManager.getActiveFloor() : '0';
  floorControls.appendChild(floorDisplay);
  
  const floorUp = document.createElement('button');
  floorUp.className = 'zones-toolbar-floor-button';
  floorUp.textContent = '+';
  floorUp.title = 'Go up one floor';
  floorUp.onclick = () => {
    if (gameStateManager) {
      const current = gameStateManager.getActiveFloor();
      gameStateManager.setActiveFloor(current + 1);
      updateFloorDisplay();
    }
  };
  floorControls.appendChild(floorUp);
  
  floorSelector.appendChild(floorControls);
  panel.appendChild(floorSelector);
  
  // Update floor display when active floor changes
  const updateFloorDisplay = () => {
    if (gameStateManager) {
      floorDisplay.textContent = gameStateManager.getActiveFloor();
    }
  };
  
  if (gameStateManager) {
    gameStateManager.on('activeFloorChanged', updateFloorDisplay);
  }

  // Grid toggle
  panel.appendChild(
    createToggleItem('Grid', 'grid', (visible) => {
      if (gridOverlay) {
        gridOverlay.setVisible(visible);
      }
    })
  );

  // All Zones toggle
  panel.appendChild(
    createToggleItem('All Zones', 'allZones', (visible) => {
      if (zoneManager) {
        zoneManager.setVisibility(visible);
      }
    })
  );

  // Zone type toggles
  const zoneTypes = [
    { label: 'Residential', key: 'residential' },
    { label: 'Commercial', key: 'commercial' },
    { label: 'Industrial', key: 'industrial' },
    { label: 'Mixed-Use', key: 'mixed-use' },
    { label: 'Park', key: 'park' },
    { label: 'Restricted', key: 'restricted' },
    { label: 'Dezone', key: 'dezone' },
  ];

  zoneTypes.forEach(({ label, key }) => {
    panel.appendChild(
      createToggleItem(label, key, (visible) => {
        if (zoneManager) {
          zoneManager.setZoneTypeVisibility(key, visible);
        }
      })
    );
  });

  toolbar.appendChild(panel);
  document.body.appendChild(toolbar);

  return toolbar;
}

