/**
 * Zone API Service
 * Handles zone-related REST calls.
 */

import { getAPIURL } from '../config.js';
import { getAccessToken, ensureValidToken } from '../auth/auth-service.js';

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
        throw new Error('Session expired. Please log in again.');
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

export async function fetchZonesByArea({ floor, minX, minY, maxX, maxY }) {
  const params = new URLSearchParams({
    floor: String(floor),
    min_x: String(minX),
    min_y: String(minY),
    max_x: String(maxX),
    max_y: String(maxY),
  });
  return authorizedRequest(`/api/zones/area?${params.toString()}`);
}

export async function fetchZonesByOwner(ownerID) {
  if (!ownerID) {
    throw new Error('Owner ID is required');
  }
  return authorizedRequest(`/api/zones/owner/${ownerID}`);
}

export async function createZone(payload) {
  return authorizedRequest('/api/zones', {
    method: 'POST',
    body: payload,
  });
}

export async function updateZone(zoneID, payload) {
  if (!zoneID) {
    throw new Error('Zone ID is required');
  }
  return authorizedRequest(`/api/zones/${zoneID}`, {
    method: 'PUT',
    body: payload,
  });
}

export async function deleteZone(zoneID) {
  if (!zoneID) {
    throw new Error('Zone ID is required');
  }
  await authorizedRequest(`/api/zones/${zoneID}`, {
    method: 'DELETE',
  });
}

/**
 * Get a zone by ID
 * @param {number} zoneID - Zone ID
 * @returns {Promise<Object>} Zone object
 */
export async function getZone(zoneID) {
  if (!zoneID) {
    throw new Error('Zone ID is required');
  }
  return authorizedRequest(`/api/zones/${zoneID}`);
}

/**
 * Get all zones for a specific floor (using a very large bounding box)
 * @param {number} floor - Floor number (-2 to +2)
 * @returns {Promise<Array>} Array of zone objects
 */
export async function getZonesByFloor(floor) {
  // Use a very large bounding box to get all zones on this floor
  const RING_CIRCUMFERENCE = 264000000;
  const MAX_WIDTH = 5000; // 5km width should cover all zones
  return fetchZonesByArea({
    floor,
    minX: 0,
    minY: -MAX_WIDTH,
    maxX: RING_CIRCUMFERENCE,
    maxY: MAX_WIDTH,
  });
}

/**
 * Get the total count of zones in the database
 * @returns {Promise<Object>} Success response with count
 */
export async function getZoneCount() {
  return authorizedRequest('/api/admin/zones/count');
}

/**
 * Delete all zones from the database
 * WARNING: This is a destructive operation that cannot be undone
 * @returns {Promise<Object>} Success response with deleted count
 */
export async function deleteAllZones(cascade = false) {
  const url = `/api/admin/zones/reset${cascade ? '?cascade=true' : ''}`;
  return authorizedRequest(url, {
    method: 'DELETE',
  });
}

