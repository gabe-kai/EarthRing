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
    };
    
    // Mock grid overlay
    mockGridOverlay = {
      setVisible: vi.fn(),
    };
    
    // Mock game state manager
    mockGameStateManager = {
      getActiveFloor: vi.fn(() => 0),
      setActiveFloor: vi.fn(),
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
      
      const gridToggle = toolbar.querySelector('[data-toggle="grid"]');
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
      
      const residentialToggle = toolbar.querySelector('[data-toggle="residential"]');
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
      
      const allZonesToggle = toolbar.querySelector('[data-toggle="allZones"]');
      expect(allZonesToggle).toBeDefined();
      
      allZonesToggle.click();
      
      expect(mockZoneManager.setAllZonesVisible).toHaveBeenCalledWith(false);
      
      allZonesToggle.click();
      
      expect(mockZoneManager.setAllZonesVisible).toHaveBeenCalledWith(true);
    });
  });

  describe('Active Floor Controls', () => {
    it('displays current active floor', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(2);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const floorDisplay = toolbar.querySelector('.floor-display');
      expect(floorDisplay).toBeDefined();
      expect(floorDisplay.textContent).toContain('2');
    });

    it('increments active floor', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(0);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const incrementBtn = toolbar.querySelector('.floor-increment');
      expect(incrementBtn).toBeDefined();
      
      incrementBtn.click();
      
      expect(mockGameStateManager.setActiveFloor).toHaveBeenCalledWith(1);
    });

    it('decrements active floor', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(1);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const decrementBtn = toolbar.querySelector('.floor-decrement');
      expect(decrementBtn).toBeDefined();
      
      decrementBtn.click();
      
      expect(mockGameStateManager.setActiveFloor).toHaveBeenCalledWith(0);
    });

    it('respects floor limits', () => {
      mockGameStateManager.getActiveFloor.mockReturnValue(15);
      
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const incrementBtn = toolbar.querySelector('.floor-increment');
      incrementBtn.click();
      
      // Should not increment beyond max
      expect(mockGameStateManager.setActiveFloor).not.toHaveBeenCalledWith(16);
    });
  });

  describe('Button States', () => {
    it('updates button text based on visibility state', () => {
      const toolbar = createZonesToolbar(mockZoneManager, mockGridOverlay, mockGameStateManager);
      const icon = toolbar.querySelector('.zones-toolbar-icon');
      icon.click(); // Expand panel
      
      const gridToggle = toolbar.querySelector('[data-toggle="grid"]');
      const initialText = gridToggle.textContent;
      
      gridToggle.click();
      
      // Button text should change
      expect(gridToggle.textContent).not.toBe(initialText);
    });
  });
});

