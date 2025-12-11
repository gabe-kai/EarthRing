/**
 * WebSocket Client for EarthRing
 * Handles WebSocket connections with version negotiation and authentication
 */

import { getAccessToken, isTokenExpired, ensureValidToken } from '../auth/auth-service.js';
import { getAPIURL } from '../config.js';

// WebSocket readyState constants
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

// Protocol version
const PROTOCOL_VERSION = 'earthring-v1';

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.messageHandlers = new Map();
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    this.onOpenCallbacks = [];
    this.onCloseCallbacks = [];
    this.onErrorCallbacks = [];
    this.authFailureDetected = false; // Track if we've detected an auth failure to prevent reconnection
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    // Check if we've detected an auth failure - don't try to reconnect
    if (this.authFailureDetected) {
      throw new Error('Authentication failed. Please log in again.');
    }

    // Check if token is expired and attempt refresh before connecting
    if (isTokenExpired()) {
      const tokenValid = await ensureValidToken();
      if (!tokenValid) {
        // Token refresh failed, authentication is required
        this.authFailureDetected = true;
        import('../auth/auth-service.js').then(({ handleAuthenticationFailure }) => {
          handleAuthenticationFailure('Token expired and refresh failed');
        });
        throw new Error('Token expired. Please log in again.');
      }
    }

    const token = getAccessToken();
    if (!token) {
      throw new Error('Not authenticated. Please log in first.');
    }

    // Build WebSocket URL with token
    const wsURL = getAPIURL('/ws').replace('http://', 'ws://').replace('https://', 'wss://');
    const url = `${wsURL}?token=${encodeURIComponent(token)}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, [PROTOCOL_VERSION]);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          
          // Verify protocol version
          const protocol = this.ws.protocol;
          if (protocol !== PROTOCOL_VERSION) {
            console.warn(`Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${protocol}`);
          }
          
          // Call all open callbacks
          this.onOpenCallbacks.forEach(callback => callback());
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            // Check for authentication errors in WebSocket messages
            if (message.type === 'error' && 
                (message.code === 'InvalidToken' || message.code === 'MissingToken' || 
                 message.message?.includes('authentication') || message.message?.includes('unauthorized'))) {
              console.error('[WebSocket] Authentication error:', message.message || message.error);
              // Import and call handleAuthenticationFailure
              import('../auth/auth-service.js').then(({ handleAuthenticationFailure }) => {
                handleAuthenticationFailure('WebSocket authentication failed');
              });
              this.disconnect();
              return;
            }
          } catch (e) {
            // Not JSON, continue with normal handling
          }
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          // If connection fails to open, check if token is expired
          // This handles cases where the HTTP handshake fails with 401
          if (this.ws.readyState === WS_CLOSED || this.ws.readyState === WS_CLOSING) {
            if (isTokenExpired()) {
              this.authFailureDetected = true;
              import('../auth/auth-service.js').then(({ handleAuthenticationFailure }) => {
                handleAuthenticationFailure('WebSocket connection failed - token expired');
              });
            }
          }
          this.onErrorCallbacks.forEach(callback => callback(error));
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.ws = null;
          
          // Check for authentication failure close codes
          // 1008 = Policy Violation (often used for auth failures)
          // 1003 = Invalid Data (can be used for invalid tokens)
          // 4001-4003 = Custom codes for authentication errors
          const isAuthFailure = event.code === 1008 || event.code === 1003 || 
                                (event.code >= 4001 && event.code <= 4003) ||
                                event.reason?.includes('authentication') ||
                                event.reason?.includes('token') ||
                                event.reason?.includes('expired');
          
          if (isAuthFailure) {
            console.error('[WebSocket] Authentication failure detected:', event.code, event.reason);
            this.authFailureDetected = true;
            // Import and call handleAuthenticationFailure
            import('../auth/auth-service.js').then(({ handleAuthenticationFailure }) => {
              handleAuthenticationFailure('WebSocket authentication failed');
            });
            // Don't attempt to reconnect on auth failure
            this.onCloseCallbacks.forEach(callback => callback(event));
            return;
          }
          
          // Call all close callbacks
          this.onCloseCallbacks.forEach(callback => callback(event));
          
          // Attempt to reconnect if not a normal closure and no auth failure
          if (event.code !== 1000 && !this.authFailureDetected && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => this.connect(), this.reconnectDelay);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    // Reset auth failure flag on manual disconnect
    this.authFailureDetected = false;
  }

  /**
   * Reset auth failure flag (called after successful login)
   */
  resetAuthFailure() {
    this.authFailureDetected = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Send a message to the server
   */
  send(type, data, id = null) {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const messageId = id || this.generateRequestId();
    const message = {
      type,
      id: messageId,
      data,
    };

    this.ws.send(JSON.stringify(message));
    return messageId;
  }

  /**
   * Send a request and wait for response
   */
  async request(type, data, timeout = 30000) {
    const messageId = this.send(type, data);
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout: ${type}`));
      }, timeout);

      this.pendingRequests.set(messageId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
    });
  }

  /**
   * Handle incoming messages
   * Supports both single JSON messages and NDJSON (newline-delimited JSON) format
   */
  handleMessage(data) {
    // Split by newlines to handle NDJSON format (multiple JSON objects separated by \n)
    const lines = typeof data === 'string' ? data.split('\n').filter(line => line.trim()) : [data];
    
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      
      try {
        const message = JSON.parse(line);
        this.processMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error, { 
          raw: typeof line === 'string' ? line.slice(0, 500) : line,
          lineLength: typeof line === 'string' ? line.length : 'N/A'
        });
      }
    }
  }

  /**
   * Process a single parsed message
   */
  processMessage(message) {
    // Handle responses to pending requests
    if (message.id && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.type === 'error') {
        const error = new Error(message.message || message.error);
        // Check if it's an authentication error
        if (message.code === 'InvalidToken' || message.code === 'MissingToken' || 
            message.message?.includes('authentication') || message.message?.includes('unauthorized')) {
          // Import and call handleAuthenticationFailure
          import('../auth/auth-service.js').then(({ handleAuthenticationFailure }) => {
            handleAuthenticationFailure('WebSocket authentication failed');
          });
          this.disconnect();
        }
        pending.reject(error);
      } else {
        pending.resolve(message.data);
      }
      // Don't return - continue to handle as event too (for chunk_data, etc.)
    }

    // Handle message type handlers (always process, even if it was a response)
    if (this.messageHandlers.has(message.type)) {
      const handlers = this.messageHandlers.get(message.type);
      handlers.forEach(handler => handler(message.data, message));
    }
  }

  /**
   * Register a message handler
   */
  on(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(handler);
  }

  /**
   * Remove a message handler
   */
  off(type, handler) {
    if (this.messageHandlers.has(type)) {
      const handlers = this.messageHandlers.get(type);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Register connection event callbacks
   */
  onOpen(callback) {
    this.onOpenCallbacks.push(callback);
  }

  onClose(callback) {
    this.onCloseCallbacks.push(callback);
  }

  onError(callback) {
    this.onErrorCallbacks.push(callback);
  }

  /**
   * Generate a unique request ID
   */
  generateRequestId() {
    return `req_${++this.requestIdCounter}_${Date.now()}`;
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected() {
    return this.ws && this.ws.readyState === WS_OPEN;
  }

  /**
   * Get connection state
   */
  getState() {
    if (!this.ws) {
      return WS_CLOSED;
    }
    return this.ws.readyState;
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();

// Export constants
export { WS_CONNECTING, WS_OPEN, WS_CLOSING, WS_CLOSED, PROTOCOL_VERSION };

