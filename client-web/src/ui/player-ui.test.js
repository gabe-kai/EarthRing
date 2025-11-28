/**
 * Tests for Player UI Component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPlayerPanelContent, showPlayerPanel, hidePlayerPanel } from './player-ui.js';
import * as playerService from '../api/player-service.js';
import * as authService from '../auth/auth-service.js';

// Setup jsdom environment
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable',
});

global.window = dom.window;
global.document = dom.window.document;
global.alert = vi.fn();

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;

// Mock window.earthring
global.window.earthring = {
  cameraController: {
    moveToPosition: vi.fn(),
  },
};

describe('Player UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    localStorageMock.getItem.mockReturnValue('mock-token');
    
    // Mock auth service
    vi.spyOn(authService, 'getCurrentUser').mockReturnValue({
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
    });
    
    // Mock player service
    vi.spyOn(playerService, 'getCurrentPlayerProfile').mockResolvedValue({
      id: 1,
      username: 'testuser',
      current_position: { x: 1000, y: 0 },
      current_floor: 0,
    });
    
    vi.spyOn(playerService, 'updatePlayerPosition').mockResolvedValue({
      success: true,
      position: { x: 2000, y: 0 },
      floor: 0,
    });
  });

  afterEach(() => {
    // Clean up any panels
    const panel = document.getElementById('player-panel');
    if (panel) {
      panel.remove();
    }
  });

  describe('createPlayerPanelContent', () => {
    it('returns null when user is not logged in', () => {
      vi.spyOn(authService, 'getCurrentUser').mockReturnValue(null);
      
      const result = createPlayerPanelContent();
      
      expect(result).toBeNull();
      expect(global.alert).toHaveBeenCalledWith('Please log in first');
    });

    it('creates player panel with correct structure', () => {
      const container = createPlayerPanelContent();
      
      expect(container).toBeDefined();
      expect(container.id).toBe('player-panel');
      expect(container.querySelector('.player-panel-header')).toBeDefined();
      expect(container.querySelector('#load-profile-btn')).toBeDefined();
      expect(container.querySelector('#position-form')).toBeDefined();
    });

    it('can be embedded in existing container', () => {
      const existingContainer = document.createElement('div');
      existingContainer.id = 'custom-container';
      
      const result = createPlayerPanelContent(existingContainer);
      
      expect(result).toBe(existingContainer);
      expect(result.id).toBe('custom-container');
      expect(result.querySelector('.player-panel-content')).toBeDefined();
    });

    it('adds styles to document head', () => {
      createPlayerPanelContent();
      
      const style = document.getElementById('player-panel-styles');
      expect(style).toBeDefined();
      expect(style.textContent).toContain('#player-panel');
    });
  });

  describe('showPlayerPanel', () => {
    it('creates and shows player panel', () => {
      showPlayerPanel();
      
      const panel = document.getElementById('player-panel');
      expect(panel).toBeDefined();
      expect(document.body.contains(panel)).toBe(true);
    });

    it('does not create duplicate panels', () => {
      showPlayerPanel();
      const firstPanel = document.getElementById('player-panel');
      
      showPlayerPanel();
      const panels = document.querySelectorAll('#player-panel');
      
      expect(panels.length).toBe(1);
      expect(panels[0]).toBe(firstPanel);
    });
  });

  describe('hidePlayerPanel', () => {
    it('removes player panel from DOM', () => {
      showPlayerPanel();
      expect(document.getElementById('player-panel')).toBeDefined();
      
      hidePlayerPanel();
      
      expect(document.getElementById('player-panel')).toBeNull();
    });

    it('handles hiding when panel does not exist', () => {
      expect(() => hidePlayerPanel()).not.toThrow();
    });
  });

  describe('Load Profile', () => {
    it('loads and displays player profile', async () => {
      const container = createPlayerPanelContent();
      const loadBtn = container.querySelector('#load-profile-btn');
      const display = container.querySelector('#profile-display');
      
      loadBtn.click();
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(playerService.getCurrentPlayerProfile).toHaveBeenCalled();
      expect(display.textContent).toContain('testuser');
      expect(display.classList.contains('show')).toBe(true);
      expect(display.classList.contains('success')).toBe(true);
    });

    it('handles profile load errors', async () => {
      vi.spyOn(playerService, 'getCurrentPlayerProfile').mockRejectedValue(
        new Error('Network error')
      );
      
      const container = createPlayerPanelContent();
      const loadBtn = container.querySelector('#load-profile-btn');
      const display = container.querySelector('#profile-display');
      
      loadBtn.click();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(display.textContent).toContain('Error: Network error');
      expect(display.classList.contains('error')).toBe(true);
    });

    it('shows error when no access token', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      
      const container = createPlayerPanelContent();
      const loadBtn = container.querySelector('#load-profile-btn');
      const display = container.querySelector('#profile-display');
      
      loadBtn.click();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(display.textContent).toContain('No access token found');
      expect(display.classList.contains('error')).toBe(true);
    });
  });

  describe('Update Position', () => {
    it('updates player position on form submit', async () => {
      const container = createPlayerPanelContent();
      const form = container.querySelector('#position-form');
      const xInput = container.querySelector('#position-x');
      const yInput = container.querySelector('#position-y');
      const floorInput = container.querySelector('#position-floor');
      const resultDisplay = container.querySelector('#position-result');
      
      xInput.value = '5000';
      yInput.value = '10';
      floorInput.value = '1';
      
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(playerService.updatePlayerPosition).toHaveBeenCalledWith(
        1,
        { x: '5000', y: '10' },
        '1'
      );
      expect(resultDisplay.classList.contains('show')).toBe(true);
      expect(resultDisplay.classList.contains('success')).toBe(true);
    });

    it('moves camera to new position after update', async () => {
      const container = createPlayerPanelContent();
      const form = container.querySelector('#position-form');
      const xInput = container.querySelector('#position-x');
      
      xInput.value = '10000';
      
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(global.window.earthring.cameraController.moveToPosition).toHaveBeenCalledWith(
        { x: 10000, y: 0, z: 0 },
        2
      );
    });

    it('handles position update errors', async () => {
      vi.spyOn(playerService, 'updatePlayerPosition').mockRejectedValue(
        new Error('Invalid position')
      );
      
      const container = createPlayerPanelContent();
      const form = container.querySelector('#position-form');
      const resultDisplay = container.querySelector('#position-result');
      
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(resultDisplay.textContent).toContain('Error: Invalid position');
      expect(resultDisplay.classList.contains('error')).toBe(true);
    });

    it('disables submit button during update', async () => {
      const container = createPlayerPanelContent();
      const form = container.querySelector('#position-form');
      const submitButton = form.querySelector('button[type="submit"]');
      
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      
      expect(submitButton.disabled).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(submitButton.disabled).toBe(false);
    });
  });

  describe('Close Button', () => {
    it('closes panel when close button clicked', () => {
      const container = createPlayerPanelContent();
      document.body.appendChild(container);
      
      const closeBtn = container.querySelector('#player-panel-close');
      closeBtn.click();
      
      expect(document.getElementById('player-panel')).toBeNull();
    });
  });
});

