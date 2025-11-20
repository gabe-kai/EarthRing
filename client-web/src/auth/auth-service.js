/**
 * Authentication Service
 * Handles API calls for authentication (register, login, refresh, logout)
 */

import { getAPIURL } from '../config.js';

/**
 * Register a new user
 * @param {string} username - Username (3-32 alphanumeric characters)
 * @param {string} email - Email address
 * @param {string} password - Password (8+ chars, uppercase, lowercase, number, special)
 * @returns {Promise<Object>} Token response with access_token, refresh_token, etc.
 */
export async function register(username, email, password) {
  try {
    const response = await fetch(getAPIURL('/api/auth/register'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password }),
    });

    if (!response.ok) {
      let errorMessage = 'Registration failed';
      try {
        const error = await response.json();
        errorMessage = error.message || error.error || errorMessage;
      } catch (e) {
        // If response is not JSON, use status text
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    // Re-throw with more context if it's a network error
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Could not connect to server. Make sure the server is running on http://localhost:8080');
    }
    throw error;
  }
}

/**
 * Login with username and password
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<Object>} Token response
 */
export async function login(username, password) {
  try {
    const response = await fetch(getAPIURL('/api/auth/login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      let errorMessage = 'Login failed';
      try {
        const error = await response.json();
        errorMessage = error.message || error.error || errorMessage;
      } catch (e) {
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    // Re-throw with more context if it's a network error
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Could not connect to server. Make sure the server is running on http://localhost:8080');
    }
    throw error;
  }
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} New token response
 */
export async function refreshToken(refreshToken) {
  const response = await fetch(getAPIURL('/api/auth/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${refreshToken}`,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || 'Token refresh failed');
  }

  return await response.json();
}

/**
 * Logout (client-side token removal)
 */
export async function logout() {
  // Clear tokens from localStorage
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('token_expires_at');
  localStorage.removeItem('user_id');
  localStorage.removeItem('username');
  
  // Optionally call server logout endpoint
  try {
    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      await fetch(getAPIURL('/api/auth/logout'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
    }
  } catch (error) {
    // Ignore logout errors
    console.warn('Logout request failed:', error);
  }
}

/**
 * Store authentication tokens
 * @param {Object} tokenResponse - Token response from server
 */
export function storeTokens(tokenResponse) {
  localStorage.setItem('access_token', tokenResponse.access_token);
  localStorage.setItem('refresh_token', tokenResponse.refresh_token);
  localStorage.setItem('token_expires_at', tokenResponse.expires_at);
  localStorage.setItem('user_id', tokenResponse.user_id.toString());
  localStorage.setItem('username', tokenResponse.username);
}

/**
 * Get stored access token
 * @returns {string|null} Access token or null
 */
export function getAccessToken() {
  return localStorage.getItem('access_token');
}

/**
 * Get stored refresh token
 * @returns {string|null} Refresh token or null
 */
export function getRefreshToken() {
  return localStorage.getItem('refresh_token');
}

/**
 * Check if user is authenticated
 * @returns {boolean} True if access token exists
 */
export function isAuthenticated() {
  return !!getAccessToken();
}

/**
 * Get current user info
 * @returns {Object|null} User info or null
 */
export function getCurrentUser() {
  const userId = localStorage.getItem('user_id');
  const username = localStorage.getItem('username');
  
  if (!userId || !username) {
    return null;
  }
  
  return {
    id: parseInt(userId, 10),
    username: username,
  };
}

/**
 * Check if access token is expired or about to expire
 * @param {number} bufferSeconds - Buffer time in seconds before expiration (default: 120 = 2 minutes)
 * @returns {boolean} True if token is expired or will expire soon
 */
export function isTokenExpired(bufferSeconds = 120) {
  const expiresAt = localStorage.getItem('token_expires_at');
  if (!expiresAt) {
    return true; // No expiration time stored, assume expired
  }
  
  const expirationTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  
  return (now + bufferMs) >= expirationTime;
}

// Token refresh state
let refreshInProgress = false;
let refreshPromise = null;
let lastRefreshAttempt = 0;
const REFRESH_RETRY_DELAY = 5000; // 5 seconds between refresh attempts

/**
 * Attempt to refresh the access token
 * @returns {Promise<boolean>} True if refresh succeeded, false otherwise
 */
export async function attemptTokenRefresh() {
  // Prevent concurrent refresh attempts
  if (refreshInProgress && refreshPromise) {
    return refreshPromise;
  }
  
  // Rate limit refresh attempts
  const now = Date.now();
  if (now - lastRefreshAttempt < REFRESH_RETRY_DELAY) {
    return false;
  }
  
  refreshInProgress = true;
  lastRefreshAttempt = now;
  
  refreshPromise = (async () => {
    try {
      const refreshTokenValue = getRefreshToken();
      if (!refreshTokenValue) {
        console.warn('[Auth] No refresh token available');
        return false;
      }
      
      const tokenResponse = await refreshToken(refreshTokenValue);
      storeTokens(tokenResponse);
      console.log('[Auth] Token refreshed successfully');
      return true;
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error.message);
      // Clear tokens on refresh failure
      logout();
      return false;
    } finally {
      refreshInProgress = false;
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
}

/**
 * Ensure access token is valid, refreshing if necessary
 * @returns {Promise<boolean>} True if token is valid, false if authentication is required
 */
export async function ensureValidToken() {
  if (!isAuthenticated()) {
    return false;
  }
  
  // If token is expired or about to expire, try to refresh
  if (isTokenExpired()) {
    const refreshed = await attemptTokenRefresh();
    if (!refreshed) {
      return false; // Refresh failed, need to re-authenticate
    }
  }
  
  return true;
}

