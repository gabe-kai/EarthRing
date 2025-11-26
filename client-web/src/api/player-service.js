/**
 * Player API Service
 * Handles player-related API calls
 */

import { getAPIURL } from '../config.js';
import { getAccessToken, ensureValidToken } from '../auth/auth-service.js';

/**
 * Get current player's profile
 */
export async function getCurrentPlayerProfile() {
  // Ensure token is valid (refresh if needed)
  await ensureValidToken();
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please log in again.');
  }

  const response = await fetch(getAPIURL('/api/players/me'), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to fetch player profile';
    try {
      const error = await response.json();
      // Server returns { "error": "...", "message": "...", "code": "..." }
      errorMessage = error.message || error.error || errorMessage;
      // If it's an authentication error, suggest re-login
      if (response.status === 401 || error.code === 'InvalidToken' || error.code === 'MissingToken') {
        errorMessage = 'Session expired. Please log in again.';
      }
    } catch (e) {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}

/**
 * Get player profile by ID
 */
export async function getPlayerProfile(playerID) {
  // Ensure token is valid (refresh if needed)
  await ensureValidToken();
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please log in again.');
  }

  const response = await fetch(getAPIURL(`/api/players/${playerID}`), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to fetch player profile';
    try {
      const error = await response.json();
      errorMessage = error.message || error.error || errorMessage;
      if (response.status === 401 || error.code === 'InvalidToken' || error.code === 'MissingToken') {
        errorMessage = 'Session expired. Please log in again.';
      }
    } catch (e) {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}

/**
 * Update player position
 */
export async function updatePlayerPosition(playerID, position, floor) {
  // Ensure token is valid (refresh if needed)
  const tokenValid = await ensureValidToken();
  if (!tokenValid) {
    throw new Error('Not authenticated. Please log in again.');
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please log in again.');
  }

  const requestBody = {
    position: {
      x: parseFloat(position.x),
      y: parseFloat(position.y),
    },
    floor: parseInt(floor),
  };

  const makeRequest = async (authToken) => {
    return await fetch(getAPIURL(`/api/players/${playerID}/position`), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  };

  let response = await makeRequest(token);

  // If 401, try to refresh token and retry once
  if (!response.ok && response.status === 401) {
    const refreshed = await ensureValidToken();
    if (!refreshed) {
      throw new Error('Session expired. Please log in again.');
    }
    // Retry request with new token
    const newToken = getAccessToken();
    response = await makeRequest(newToken);
  }

  if (!response.ok) {
    let errorMessage = 'Failed to update position';
    try {
      const error = await response.json();
      errorMessage = error.message || error.error || errorMessage;
      if (response.status === 401 || error.code === 'InvalidToken' || error.code === 'MissingToken') {
        errorMessage = 'Session expired. Please log in again.';
      }
    } catch (e) {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}

