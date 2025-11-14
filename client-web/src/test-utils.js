/**
 * Test utilities for EarthRing web client
 */

import { vi } from 'vitest';

/**
 * Creates a mock WebSocket connection
 * @param {Object} options - Configuration options
 * @returns {Object} Mock WebSocket object
 */
export function createMockWebSocket(options = {}) {
  const {
    onOpen = () => {},
    onMessage = () => {},
    onError = () => {},
    onClose = () => {},
  } = options;

  const mockWS = {
    readyState: WebSocket.CONNECTING,
    url: options.url || 'ws://localhost:8080/ws',
    protocol: options.protocol || 'earthring-v1',
    
    send: vi.fn(),
    close: vi.fn(() => {
      mockWS.readyState = WebSocket.CLOSED;
      onClose();
    }),
    
    // Simulate connection events
    _simulateOpen: () => {
      mockWS.readyState = WebSocket.OPEN;
      onOpen();
    },
    
    _simulateMessage: (data) => {
      onMessage({ data });
    },
    
    _simulateError: (error) => {
      mockWS.readyState = WebSocket.CLOSED;
      onError(error);
    },
  };

  return mockWS;
}

/**
 * Creates mock configuration for tests
 * @param {Object} overrides - Configuration overrides
 * @returns {Object} Mock configuration
 */
export function createMockConfig(overrides = {}) {
  return {
    server: {
      baseURL: 'http://localhost:8080',
      wsURL: 'ws://localhost:8080',
      apiVersion: 'v1',
      timeout: 30000,
      ...overrides.server,
    },
    client: {
      version: '1.0.0',
      environment: 'test',
      debug: true,
      ...overrides.client,
    },
    rendering: {
      chunkLoadDistance: 5,
      chunkUnloadDistance: 7,
      lodDistance1: 1000,
      lodDistance2: 5000,
      lodDistance3: 10000,
      maxFPS: 60,
      enableShadows: true,
      shadowMapSize: 2048,
      ...overrides.rendering,
    },
    network: {
      reconnectAttempts: 5,
      reconnectDelay: 3000,
      heartbeatInterval: 30000,
      ...overrides.network,
    },
  };
}

/**
 * Creates mock chunk data for testing
 * @param {Object} overrides - Chunk data overrides
 * @returns {Object} Mock chunk data
 */
export function createMockChunk(overrides = {}) {
  return {
    chunkIndex: 0,
    ringPosition: 0,
    width: 400,
    floor: 0,
    geometry: null,
    textures: [],
    metadata: {},
    version: 1,
    ...overrides,
  };
}

/**
 * Creates mock player data for testing
 * @param {Object} overrides - Player data overrides
 * @returns {Object} Mock player data
 */
export function createMockPlayer(overrides = {}) {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Waits for a specified amount of time (for async tests)
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the delay
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock fetch response
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @returns {Response} Mock fetch response
 */
export function createMockFetchResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  };
}

