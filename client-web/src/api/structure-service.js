/**
 * Structure API Service
 * Handles structure-related REST calls.
 */

import { getAPIURL } from '../config.js';
import { getAccessToken, ensureValidToken, handleAuthenticationFailure } from '../auth/auth-service.js';

async function authorizedRequest(path, { method = 'GET', body } = {}) {
  // Ensure token is valid before making request
  const tokenValid = await ensureValidToken();
  if (!tokenValid) {
    throw new Error('Not authenticated. Please log in again.');
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(getAPIURL(path), {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Handle 401 Unauthorized - token expired or invalid
    if (response.status === 401) {
      // Try to refresh token once
      const refreshed = await ensureValidToken();
      if (!refreshed) {
        // ensureValidToken already handled logout and redirect
        throw new Error('Session expired');
      }
      // Retry request with new token
      const newToken = getAccessToken();
      const retryResponse = await fetch(getAPIURL(path), {
        method,
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!retryResponse.ok) {
        let errorMessage = `Request failed (${retryResponse.status})`;
        try {
          const error = await retryResponse.json();
          errorMessage = error.message || error.error || errorMessage;
        } catch (err) {
          errorMessage = `${errorMessage}: ${retryResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      if (retryResponse.status === 204) {
        return null;
      }
      return await retryResponse.json();
    }

    let errorMessage = `Request failed (${response.status})`;
    try {
      const error = await response.json();
      errorMessage = error.message || error.error || errorMessage;
    } catch (err) {
      errorMessage = `${errorMessage}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null;
  }

  return await response.json();
}

export async function createStructure(payload) {
  return authorizedRequest('/api/structures', {
    method: 'POST',
    body: payload,
  });
}

export async function getStructure(structureID) {
  if (!structureID) {
    throw new Error('Structure ID is required');
  }
  return authorizedRequest(`/api/structures/${structureID}`);
}

export async function updateStructure(structureID, payload) {
  if (!structureID) {
    throw new Error('Structure ID is required');
  }
  return authorizedRequest(`/api/structures/${structureID}`, {
    method: 'PUT',
    body: payload,
  });
}

export async function deleteStructure(structureID) {
  if (!structureID) {
    throw new Error('Structure ID is required');
  }
  await authorizedRequest(`/api/structures/${structureID}`, {
    method: 'DELETE',
  });
}

export async function fetchStructuresByArea({ floor, minX, minY, maxX, maxY }) {
  const params = new URLSearchParams({
    floor: String(floor),
    min_x: String(minX),
    min_y: String(minY),
    max_x: String(maxX),
    max_y: String(maxY),
  });
  return authorizedRequest(`/api/structures/area?${params.toString()}`);
}

export async function fetchStructuresByOwner(ownerID) {
  if (!ownerID) {
    throw new Error('Owner ID is required');
  }
  return authorizedRequest(`/api/structures/owner/${ownerID}`);
}


