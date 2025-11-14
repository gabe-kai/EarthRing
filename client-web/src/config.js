/**
 * EarthRing Web Client Configuration
 * Loads configuration from environment variables and provides defaults
 */

// Configuration object with defaults
const config = {
  // Server configuration
  server: {
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
    wsURL: import.meta.env.VITE_WS_URL || 'ws://localhost:8080',
    apiVersion: import.meta.env.VITE_API_VERSION || 'v1',
    timeout: parseInt(import.meta.env.VITE_API_TIMEOUT || '30000', 10),
  },

  // Client configuration
  client: {
    version: import.meta.env.VITE_CLIENT_VERSION || '1.0.0',
    environment: import.meta.env.MODE || 'development',
    debug: import.meta.env.VITE_DEBUG === 'true' || import.meta.env.MODE === 'development',
  },

  // Rendering configuration
  rendering: {
    // Chunk loading configuration
    chunkLoadDistance: parseInt(import.meta.env.VITE_CHUNK_LOAD_DISTANCE || '5', 10),
    chunkUnloadDistance: parseInt(import.meta.env.VITE_CHUNK_UNLOAD_DISTANCE || '7', 10),
    
    // LOD (Level of Detail) configuration
    lodDistance1: parseInt(import.meta.env.VITE_LOD_DISTANCE_1 || '1000', 10),
    lodDistance2: parseInt(import.meta.env.VITE_LOD_DISTANCE_2 || '5000', 10),
    lodDistance3: parseInt(import.meta.env.VITE_LOD_DISTANCE_3 || '10000', 10),
    
    // Performance settings
    maxFPS: parseInt(import.meta.env.VITE_MAX_FPS || '60', 10),
    enableShadows: import.meta.env.VITE_ENABLE_SHADOWS !== 'false',
    shadowMapSize: parseInt(import.meta.env.VITE_SHADOW_MAP_SIZE || '2048', 10),
  },

  // Network configuration
  network: {
    reconnectAttempts: parseInt(import.meta.env.VITE_RECONNECT_ATTEMPTS || '5', 10),
    reconnectDelay: parseInt(import.meta.env.VITE_RECONNECT_DELAY || '3000', 10),
    heartbeatInterval: parseInt(import.meta.env.VITE_HEARTBEAT_INTERVAL || '30000', 10),
  },
};

/**
 * Get full API URL for a given endpoint
 * @param {string} endpoint - API endpoint (e.g., '/api/auth/login')
 * @returns {string} Full URL
 */
export function getAPIURL(endpoint) {
  const baseURL = config.server.baseURL.replace(/\/$/, '');
  const apiPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseURL}${apiPath}`;
}

/**
 * Get WebSocket URL with protocol version
 * @param {string} version - Protocol version (default: 'v1')
 * @returns {string} WebSocket URL with protocol
 */
export function getWebSocketURL(version = 'v1') {
  const wsURL = config.server.wsURL.replace(/\/$/, '');
  return `${wsURL}/ws?protocol=earthring-${version}`;
}

/**
 * Check if running in development mode
 * @returns {boolean}
 */
export function isDevelopment() {
  return config.client.environment === 'development';
}

/**
 * Check if running in production mode
 * @returns {boolean}
 */
export function isProduction() {
  return config.client.environment === 'production';
}

/**
 * Check if debug mode is enabled
 * @returns {boolean}
 */
export function isDebug() {
  return config.client.debug;
}

// Export default configuration
export default config;

