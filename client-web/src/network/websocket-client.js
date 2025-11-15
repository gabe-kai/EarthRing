/**
 * WebSocket Client for EarthRing
 * Handles WebSocket connections with version negotiation and authentication
 */

import { getAccessToken } from '../auth/auth-service.js';
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
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      console.log('WebSocket already connected');
      return;
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
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.onErrorCallbacks.forEach(callback => callback(error));
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.ws = null;
          
          // Call all close callbacks
          this.onCloseCallbacks.forEach(callback => callback(event));
          
          // Attempt to reconnect if not a normal closure
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
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
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);

      // Handle responses to pending requests
      if (message.id && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id);
        this.pendingRequests.delete(message.id);

        if (message.type === 'error') {
          pending.reject(new Error(message.message || message.error));
        } else {
          pending.resolve(message.data);
        }
        return;
      }

      // Handle message type handlers
      if (this.messageHandlers.has(message.type)) {
        const handlers = this.messageHandlers.get(message.type);
        handlers.forEach(handler => handler(message.data, message));
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
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

