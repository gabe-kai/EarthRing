/**
 * Structure Management UI
 * Basic hooks for structure placement integrated into bottom toolbar
 */

import { isAuthenticated } from '../auth/auth-service.js';
import { addTab, setTabContent, switchTab } from './bottom-toolbar.js';

let structuresTabInitialized = false;

export function initializeStructuresTab() {
  // Check if tab actually exists in DOM (survives refresh check)
  const existingTab = document.querySelector('[data-tab-id="structures"]');
  if (existingTab && structuresTabInitialized) {
    // Tab exists and is initialized
    return;
  }

  // Reset flag if tab doesn't exist (page was refreshed)
  if (!existingTab) {
    structuresTabInitialized = false;
  }

  if (!isAuthenticated()) {
    return;
  }

  const structureManager = window.earthring?.structureManager;
  if (!structureManager) {
    console.warn('Structure manager is not initialized');
    return;
  }

  // Create Structures tab
  addTab('Structures', 'structures');

  // Create toolbar content
  createStructuresToolbarContent();

  // Listen for tab changes
  window.addEventListener('toolbar:tab-changed', (event) => {
    if (event.detail.tabId === 'structures') {
      createStructuresToolbarContent();
    }
  });

  structuresTabInitialized = true;
}

function createStructuresToolbarContent() {
  const content = document.createElement('div');
  content.className = 'zones-toolbar-content';

  // Structure placement section
  const placementSection = document.createElement('div');
  placementSection.className = 'toolbar-section';

  const placementLabel = document.createElement('span');
  placementLabel.className = 'toolbar-section-label';
  placementLabel.textContent = 'Structures';
  placementSection.appendChild(placementLabel);

  const createButton = (icon, label, id, onClick) => {
    const button = document.createElement('button');
    button.className = 'toolbar-button';
    button.id = id;

    const iconEl = document.createElement('div');
    iconEl.className = 'toolbar-button-icon';
    iconEl.textContent = icon;
    button.appendChild(iconEl);

    const labelEl = document.createElement('div');
    labelEl.className = 'toolbar-button-label';
    labelEl.textContent = label;
    button.appendChild(labelEl);

    button.addEventListener('click', onClick);

    return button;
  };

  // Basic placement hooks - these just set debug state for now
  const buildingButton = createButton('🏢', 'Building', 'structure-place-building', () => {
    window.earthring = window.earthring || {};
    window.earthring.pendingStructurePlacement = {
      type: 'building',
      timestamp: Date.now(),
    };
    console.log('[Structures] Building placement mode enabled');
  });

  const decorationButton = createButton('🌳', 'Decoration', 'structure-place-decoration', () => {
    window.earthring = window.earthring || {};
    window.earthring.pendingStructurePlacement = {
      type: 'decoration',
      timestamp: Date.now(),
    };
    console.log('[Structures] Decoration placement mode enabled');
  });

  placementSection.appendChild(buildingButton);
  placementSection.appendChild(decorationButton);

  content.appendChild(placementSection);

  setTabContent('structures', content);
}


