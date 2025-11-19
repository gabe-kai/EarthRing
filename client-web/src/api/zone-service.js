/**
 * Zone API Service
 * Handles zone-related REST calls.
 */

import { getAPIURL } from '../config.js';
import { getAccessToken } from '../auth/auth-service.js';

async function authorizedRequest(path, { method = 'GET', body } = {}) {
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

