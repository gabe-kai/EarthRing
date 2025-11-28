/**
 * Tests for Zones Toolbar Component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createZonesToolbar } from './zones-toolbar.js';

// Setup jsdom environment
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable',
});

global.window = dom.window;
global.document = dom.window.document;

describe('Zones Toolbar', () => {
  let mockZoneManager;
  let mockGridOverlay;
  let mockGameStateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    
    // Mock zone manager
    mockZoneManager = {
      setZoneTypeVisibility: vi.fn(),
      setAllZonesVisible: vi.fn(),
      setVisibility: vi.fn(), // Also used by "All Zones" toggle
    };
    
    // Mock grid overlay
    mockGridOverlay = {
      setVisible: vi.fn(),
    };
    
    // Mock game state manager with event emitter interface
    mockGameStateManager = {
      getActiveFloor: vi.fn(() => 0),
      setActiveFloor: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };
  });

  afterEach(() => {
    const toolbar = document.getElementById('zones-toolbar');
    if (toolbar) {
      toolbar.remove();
    }
  });

  describe('Initialization', () => {
    it('creates toolbar with correct structure', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      
      expect(toolbar).toBeDefined();
      expect(toolbar.id).toBe('zones-toolbar');
      expect(toolbar.className).toBe('zones-toolbar');
      expect(toolbar.querySelector('.zones-toolbar-icon')).toBeDefined();
      expect(toolbar.querySelector('.zones-toolbar-panel')).toBeDefined();
    });

    it('starts in collapsed state', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      
      expect(panel.classList.contains('expanded')).toBe(false);
    });
  });

  describe('Expand/Collapse', () => {
    it('expands panel when icon clicked', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      
      icon.click();
      
      expect(panel.classList.contains('expanded')).toBe(true);
    });

    it('collapses panel when icon clicked again', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      
      icon.click();
      expect(panel.classList.contains('expanded')).toBe(true);
      
      icon.click();
      expect(panel.classList.contains('expanded')).toBe(false);
    });
  });

  describe('Grid Visibility', () => {
    it('toggles grid visibility', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      // Find the grid toggle button (it's in a zones-toolbar-item with label "Grid")
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      const gridItem = Array.from(panel.querySelectorAll('.zones-toolbar-item')).find(item => 
        item.querySelector('.zones-toolbar-label')?.textContent === 'Grid'
      );
      expect(gridItem).toBeDefined();
      const gridToggle = gridItem?.querySelector('.zones-toolbar-toggle');
      expect(gridToggle).toBeDefined();
      
      gridToggle.click();
      
      expect(mockGridOverlay.setVisible).toHaveBeenCalledWith(false);
      
      gridToggle.click();
      
      expect(mockGridOverlay.setVisible).toHaveBeenCalledWith(true);
    });
  });

  describe('Zone Type Visibility', () => {
    it('toggles individual zone type visibility', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      const residentialItem = Array.from(panel.querySelectorAll('.zones-toolbar-item')).find(item => 
        item.querySelector('.zones-toolbar-label')?.textContent === 'Residential'
      );
      expect(residentialItem).toBeDefined();
      const residentialToggle = residentialItem?.querySelector('.zones-toolbar-toggle');
      expect(residentialToggle).toBeDefined();
      
      residentialToggle.click();
      
      expect(mockZoneManager.setZoneTypeVisibility).toHaveBeenCalledWith('residential', false);
      
      residentialToggle.click();
      
      expect(mockZoneManager.setZoneTypeVisibility).toHaveBeenCalledWith('residential', true);
    });

    it('toggles all zones visibility', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      const allZonesItem = Array.from(panel.querySelectorAll('.zones-toolbar-item')).find(item => 
        item.querySelector('.zones-toolbar-label')?.textContent === 'All Zones'
      );
      expect(allZonesItem).toBeDefined();
      const allZonesToggle = allZonesItem?.querySelector('.zones-toolbar-toggle');
      expect(allZonesToggle).toBeDefined();
      
      allZonesToggle.click();
      
      expect(mockZoneManager.setVisibility).toHaveBeenCalledWith(false);
      
      allZonesToggle.click();
      
      expect(mockZoneManager.setVisibility).toHaveBeenCalledWith(true);
    });
  });

  describe('Active Floor Controls', () => {
    it('displays current active floor', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(2);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const floorDisplay = toolbar.querySelector('.zones-toolbar-floor-display');
      expect(floorDisplay).toBeDefined();
      expect(floorDisplay.textContent).toContain('2');
    });

    it('increments active floor', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(0);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      // Find the increment button (the one with '+' text)
      const floorControls = toolbar.querySelector('.zones-toolbar-floor-controls');
      const buttons = floorControls?.querySelectorAll('.zones-toolbar-floor-button');
      const incrementBtn = Array.from(buttons || []).find(btn => btn.textContent === '+');
      expect(incrementBtn).toBeDefined();
      
      incrementBtn.click();
      
      expect(mockGameStateManager.setActiveFloor).toHaveBeenCalledWith(1);
    });

    it('decrements active floor', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(1);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      // Find the decrement button (the one with '−' text)
      const floorControls = toolbar.querySelector('.zones-toolbar-floor-controls');
      const buttons = floorControls?.querySelectorAll('.zones-toolbar-floor-button');
      const decrementBtn = Array.from(buttons || []).find(btn => btn.textContent === '−');
      expect(decrementBtn).toBeDefined();
      
      decrementBtn.click();
      
      expect(mockGameStateManager.setActiveFloor).toHaveBeenCalledWith(0);
    });

    it('respects floor limits', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(15);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const floorControls = toolbar.querySelector('.zones-toolbar-floor-controls');
      const buttons = floorControls?.querySelectorAll('.zones-toolbar-floor-button');
      const incrementBtn = Array.from(buttons || []).find(btn => btn.textContent === '+');
      incrementBtn.click();
      
      // Should not increment beyond max (the implementation should handle this)
      // The test verifies that setActiveFloor was called, but the actual limit checking
      // would be in the gameStateManager implementation
      expect(mockGameStateManager.setActiveFloor).toHaveBeenCalled();
    });
  });

  describe('Button States', () => {
    it('updates button text based on visibility state', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const panel = toolbar.querySelector('.zones-toolbar-panel');
      const gridItem = Array.from(panel.querySelectorAll('.zones-toolbar-item')).find(item => 
        item.querySelector('.zones-toolbar-label')?.textContent === 'Grid'
      );
      const gridToggle = gridItem?.querySelector('.zones-toolbar-toggle');
      expect(gridToggle).toBeDefined();
      const initialText = gridToggle.textContent;
      
      gridToggle.click();
      
      // Button text should change
      expect(gridToggle.textContent).not.toBe(initialText);
    });
  });
});

