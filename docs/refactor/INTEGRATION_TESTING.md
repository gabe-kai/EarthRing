# Integration Testing Plan for Client-Server Streaming Refactor

## Overview

This document outlines the integration testing strategy for the server-driven streaming refactor. The refactor moves chunk and zone processing from the client to the server, using WebSocket-based streaming subscriptions.

## Completed Unit Tests

### Streaming Manager Tests (`server/internal/streaming/manager_test.go`)

✅ **TestComputeChunkWindowBasic** - Verifies chunk window computation
✅ **TestComputeChunkWindowWraps** - Tests ring wrapping in chunk computation
✅ **TestPlanSubscriptionValidation** - Validates subscription creation
✅ **TestUpdatePoseProducesChunkDeltas** - Verifies chunk delta computation on pose updates
✅ **TestUpdatePoseValidatesOwnershipAndIDs** - Tests subscription ownership validation
✅ **TestComputeZoneDelta** - Verifies zone delta computation (added/removed zones)
✅ **TestComputeZoneBoundingBox** - Tests zone bounding box calculation

All tests passing ✓

## Integration Test Scenarios

### 1. WebSocket Connection & Authentication

**Test**: Client connects to WebSocket with JWT token
- Client sends WebSocket connection request with `?token=<jwt>`
- Server validates JWT and establishes connection
- Server sends connection acknowledgment

**Expected**: Connection established, user authenticated

### 2. Streaming Subscription (Initial Load)

**Test**: Client subscribes to streaming and receives initial data
- Client sends `stream_subscribe` message with:
  ```json
  {
    "pose": {
      "ring_position": 10000,
      "width_offset": 0,
      "elevation": 0,
      "active_floor": 0
    },
    "radius_meters": 5000,
    "width_meters": 5000,
    "include_chunks": true,
    "include_zones": true
  }
  ```
- Server responds with `stream_ack` containing `subscription_id`
- Server asynchronously sends `stream_delta` messages with:
  - Initial chunks (compressed geometry)
  - Initial zones (GeoJSON geometry)

**Expected**: 
- `stream_ack` received with valid `subscription_id`
- Chunks delivered as `stream_delta` messages
- Zones delivered as `stream_delta` messages
- All data properly formatted and parseable

### 3. Chunk Streaming

**Test**: Chunks are delivered with correct format
- Verify chunk data includes:
  - `id` (format: "floor_chunk_index")
  - `geometry` (compressed or uncompressed)
  - `metadata` (version, floor, chunk_index)
- Verify compression is applied when appropriate
- Verify chunk wrapping handles ring boundaries

**Expected**: Chunks load and render correctly in client

### 4. Zone Streaming

**Test**: Zones are delivered with correct format
- Verify zone data includes:
  - `id` (integer)
  - `geometry` (GeoJSON)
  - `zone_type`, `floor`, `name`
- Verify zones are filtered by active floor
- Verify zones respect bounding box (radius + width)

**Expected**: Zones render correctly in client

### 5. Zone Delta Computation

**Test**: Zone deltas computed correctly on pose updates
- Client moves camera to new position
- Server computes new zone bounding box
- Server queries zones for new area
- Server computes delta (added/removed zones)
- Server sends `stream_delta` with only changed zones

**Expected**: Only changed zones are sent, reducing bandwidth

### 6. Chunk Delta Computation

**Test**: Chunk deltas computed correctly on pose updates
- Client moves camera to new position
- Server computes new chunk window
- Server computes delta (added/removed chunks)
- Server sends `stream_delta` with only changed chunks

**Expected**: Only changed chunks are sent, reducing bandwidth

### 7. Ring Wrapping

**Test**: Streaming handles ring position wrapping
- Client at position near ring boundary (e.g., 263,999,000m)
- Server correctly wraps chunk indices
- Server correctly handles zone bounding boxes that cross boundary
- Chunks/zones delivered correctly across wrap point

**Expected**: No gaps or duplicates at ring boundaries

### 8. Floor Changes

**Test**: Floor changes trigger correct updates
- Client changes active floor
- Server sends chunks for new floor
- Server sends zones for new floor
- Old floor data removed from subscription

**Expected**: Smooth transition between floors

### 9. Error Handling

**Test**: Error conditions handled gracefully
- Invalid subscription request → error response
- Missing subscription ID → error response
- Database errors → logged, graceful degradation
- WebSocket disconnection → subscription cleanup

**Expected**: Errors logged, client receives error messages

### 10. Performance

**Test**: Streaming performs within acceptable limits
- Initial subscription completes within 2 seconds
- Chunk compression reduces size by >50%
- Zone queries complete within 500ms
- Delta computation completes within 100ms

**Expected**: Responsive streaming, efficient bandwidth usage

## Manual Testing Checklist

### Server Setup
- [ ] Database migrations applied
- [ ] Server running with streaming manager enabled
- [ ] WebSocket endpoint accessible at `/ws`
- [ ] JWT authentication working

### Client Setup
- [ ] Client connects to WebSocket
- [ ] Client authenticates successfully
- [ ] Client sends `stream_subscribe` on connection

### Chunk Streaming
- [ ] Initial chunks load and render
- [ ] Chunk geometry displays correctly
- [ ] Chunk compression working (check network tab)
- [ ] Chunks update when camera moves
- [ ] No duplicate chunk requests

### Zone Streaming
- [ ] Initial zones load and render
- [ ] Zone geometry displays correctly
- [ ] Zones filtered by active floor
- [ ] Zones update when camera moves
- [ ] Zone deltas only send changes

### Edge Cases
- [ ] Ring boundary wrapping works
- [ ] Floor changes work smoothly
- [ ] Multiple subscriptions (if supported)
- [ ] Reconnection after disconnect

## Automated Integration Tests (Future)

### Test Infrastructure Needed
1. **Test Server**: In-memory or test database
2. **Test Client**: WebSocket client library (e.g., `gorilla/websocket` for Go)
3. **Test Data**: Sample chunks and zones in database
4. **Test Runner**: Integration test suite

### Example Test Structure
```go
func TestStreamingIntegration(t *testing.T) {
    // Setup test server with test database
    server := setupTestServer(t)
    defer server.Close()
    
    // Connect WebSocket client
    conn := connectWebSocket(t, server.URL)
    defer conn.Close()
    
    // Authenticate
    token := authenticateTestUser(t)
    conn.WriteJSON(map[string]interface{}{
        "type": "auth",
        "token": token,
    })
    
    // Subscribe to streaming
    subscribeMsg := map[string]interface{}{
        "type": "stream_subscribe",
        "data": map[string]interface{}{
            "pose": map[string]interface{}{
                "ring_position": 10000,
                "active_floor": 0,
            },
            "radius_meters": 5000,
            "include_chunks": true,
            "include_zones": true,
        },
    }
    conn.WriteJSON(subscribeMsg)
    
    // Wait for stream_ack
    var ack map[string]interface{}
    conn.ReadJSON(&ack)
    assert.Equal(t, "stream_ack", ack["type"])
    
    // Wait for stream_delta with chunks
    var delta map[string]interface{}
    conn.ReadJSON(&delta)
    assert.Equal(t, "stream_delta", delta["type"])
    assert.NotNil(t, delta["data"].(map[string]interface{})["chunks"])
}
```

## Test Data Requirements

### Chunks
- Test chunks at various positions (including wrap boundaries)
- Test chunks at different floors
- Test chunks with different geometry versions

### Zones
- Test zones at various positions
- Test zones at different floors
- Test zones with different types
- Test zones that span ring boundaries

## Performance Benchmarks

### Target Metrics
- **Initial Subscription**: < 2 seconds
- **Chunk Compression Ratio**: > 2:1
- **Zone Query Time**: < 500ms
- **Delta Computation**: < 100ms
- **WebSocket Message Latency**: < 50ms

### Measurement Tools
- Server logs (timing information)
- Browser DevTools Network tab
- WebSocket message inspection
- Database query profiling

## Known Limitations

1. ✅ **Pose Updates**: `stream_update_pose` message handler implemented and working
2. ✅ **Zone Delta Delivery**: Zone deltas computed and sent on pose updates
3. **Full-Ring Zones**: System zones that span full ring may need special handling (future enhancement)

## Next Steps

1. ✅ Unit tests for streaming manager
2. ✅ Add `stream_update_pose` message handler
3. ✅ Implement zone delta delivery on pose updates
4. ⏳ Add unit tests for WebSocket streaming handlers (`stream_subscribe`, `stream_update_pose`)
5. ⏳ Manual testing of WebSocket streaming (in progress - chunks unloading confirmed working)
6. ⏳ Automated integration test suite
7. ⏳ Performance profiling and optimization

