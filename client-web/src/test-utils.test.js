/**
 * Tests for test utilities
 */

import { describe, it, expect } from 'vitest';
import {
  createMockWebSocket,
  createMockConfig,
  createMockChunk,
  createMockPlayer,
  wait,
  createMockFetchResponse,
  WebSocketConstants,
} from './test-utils';

describe('Test Utilities', () => {
  describe('createMockWebSocket', () => {
    it('should create a mock WebSocket with default values', () => {
      const mockWS = createMockWebSocket();
      
      expect(mockWS.readyState).toBe(WebSocketConstants.CONNECTING);
      expect(mockWS.url).toBe('ws://localhost:8080/ws');
      expect(mockWS.protocol).toBe('earthring-v1');
      expect(typeof mockWS.send).toBe('function');
      expect(typeof mockWS.close).toBe('function');
    });

    it('should allow custom configuration', () => {
      const mockWS = createMockWebSocket({
        url: 'ws://example.com/ws',
        protocol: 'earthring-v2',
      });
      
      expect(mockWS.url).toBe('ws://example.com/ws');
      expect(mockWS.protocol).toBe('earthring-v2');
    });
  });

  describe('createMockConfig', () => {
    it('should create default configuration', () => {
      const config = createMockConfig();
      
      expect(config.server.baseURL).toBe('http://localhost:8080');
      expect(config.client.environment).toBe('test');
      expect(config.rendering.chunkLoadDistance).toBe(5);
    });

    it('should allow overrides', () => {
      const config = createMockConfig({
        server: { baseURL: 'http://example.com' },
      });
      
      expect(config.server.baseURL).toBe('http://example.com');
      expect(config.client.environment).toBe('test'); // Unchanged
    });
  });

  describe('createMockChunk', () => {
    it('should create default chunk data', () => {
      const chunk = createMockChunk();
      
      expect(chunk.chunkIndex).toBe(0);
      expect(chunk.ringPosition).toBe(0);
      expect(chunk.width).toBe(400);
      expect(chunk.floor).toBe(0);
    });

    it('should allow overrides', () => {
      const chunk = createMockChunk({ chunkIndex: 100 });
      
      expect(chunk.chunkIndex).toBe(100);
      expect(chunk.ringPosition).toBe(0); // Unchanged
    });
  });

  describe('createMockPlayer', () => {
    it('should create default player data', () => {
      const player = createMockPlayer();
      
      expect(player.id).toBe(1);
      expect(player.username).toBe('testuser');
      expect(player.email).toBe('test@example.com');
    });
  });

  describe('wait', () => {
    it('should wait for specified time', async () => {
      const start = Date.now();
      await wait(100);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some variance
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe('createMockFetchResponse', () => {
    it('should create successful response', async () => {
      const data = { status: 'ok' };
      const response = createMockFetchResponse(data, 200);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual(data);
    });

    it('should create error response', () => {
      const response = createMockFetchResponse({ error: 'Not found' }, 404);
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });
});

