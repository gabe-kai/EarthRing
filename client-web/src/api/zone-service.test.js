/**
 * Tests for Zone Service
 * Tests authentication error handling in zone API calls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as zoneService from './zone-service.js';
import * as authService from '../auth/auth-service.js';
import { getAPIURL } from '../config.js';

// Mock dependencies
vi.mock('../config.js', () => ({
  getAPIURL: vi.fn((path) => `http://localhost:8080${path}`),
}));

vi.mock('../auth/auth-service.js', () => ({
  getAccessToken: vi.fn(),
  ensureValidToken: vi.fn(),
  handleAuthenticationFailure: vi.fn(),
}));

describe('Zone Service - Authentication Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('401 Unauthorized handling', () => {
    it('should attempt token refresh on 401 error', async () => {
      authService.getAccessToken.mockReturnValue('expired-token');
      authService.ensureValidToken.mockResolvedValue(true);
      
      // First call returns 401
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        })
        // Retry after refresh succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, name: 'Test Zone' }),
        });

      authService.getAccessToken.mockReturnValueOnce('expired-token').mockReturnValueOnce('new-token');

      const result = await zoneService.fetchZonesByArea({
        floor: 0,
        minX: 0,
        minY: 0,
        maxX: 1000,
        maxY: 1000,
      });

      expect(authService.ensureValidToken).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 1, name: 'Test Zone' });
    });

    it('should throw Session expired error if refresh fails', async () => {
      authService.getAccessToken.mockReturnValue('expired-token');
      authService.ensureValidToken.mockResolvedValue(false);

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(
        zoneService.fetchZonesByArea({
          floor: 0,
          minX: 0,
          minY: 0,
          maxX: 1000,
          maxY: 1000,
        })
      ).rejects.toThrow();

      expect(authService.ensureValidToken).toHaveBeenCalled();
      // handleAuthenticationFailure is called by ensureValidToken, not directly here
    });

    it('should throw error if retry after refresh also fails', async () => {
      authService.getAccessToken
        .mockReturnValueOnce('expired-token')
        .mockReturnValueOnce('new-token');
      authService.ensureValidToken.mockResolvedValue(true);

      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Still unauthorized' }),
        });

      await expect(
        zoneService.fetchZonesByArea({
          floor: 0,
          minX: 0,
          minY: 0,
          maxX: 1000,
          maxY: 1000,
        })
      ).rejects.toThrow();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Not authenticated error', () => {
    it('should throw error if no token available', async () => {
      authService.getAccessToken.mockReturnValue(null);

      await expect(
        zoneService.fetchZonesByArea({
          floor: 0,
          minX: 0,
          minY: 0,
          maxX: 1000,
          maxY: 1000,
        })
      ).rejects.toThrow('Not authenticated');
    });
  });
});

