/**
 * Chunk API Service
 * Handles chunk-related API calls
 */

import { getAPIURL } from '../config.js';
import { getAccessToken } from '../auth/auth-service.js';

/**
 * Get chunk metadata
 * @param {string} chunkID - Format: "floor_chunk_index" (e.g., "0_12345")
 */
export async function getChunkMetadata(chunkID) {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(getAPIURL(`/api/chunks/${chunkID}`), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to fetch chunk metadata';
    try {
      const error = await response.json();
      // Server returns { "error": "...", "message": "..." } or { "code": "...", "message": "..." }
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

