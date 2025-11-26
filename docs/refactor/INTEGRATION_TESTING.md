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

### Prerequisites
- [ ] Database migrations applied (including coordinate system migrations)
- [ ] Server running with streaming manager enabled
- [ ] Procedural service running and accessible
- [ ] Client built and running
- [ ] Browser DevTools open (Network tab, Console tab)

### Server Setup
- [ ] Server starts without errors
- [ ] WebSocket endpoint accessible at `/ws`
- [ ] JWT authentication working
- [ ] Database connection established
- [ ] Streaming manager initialized

### Client Setup & Authentication
- [ ] Client connects to WebSocket successfully
- [ ] Client authenticates with JWT token
- [ ] WebSocket connection shows as "connected" in console
- [ ] Client automatically sends `stream_subscribe` on connection
- [ ] Client receives `stream_ack` with subscription ID

### Chunk Streaming - Initial Load
- [ ] Initial chunks load within 2 seconds of subscription
- [ ] Chunk geometry displays correctly in 3D view
- [ ] Chunk compression working (check network tab for compressed payloads)
- [ ] Chunks appear at correct positions relative to camera
- [ ] No duplicate chunk requests in network tab
- [ ] Console shows chunk loading messages (if debug enabled)

### Chunk Streaming - Movement & Updates
- [ ] Chunks load ahead of camera as you move forward
- [ ] Chunks unload behind camera as you move (verify in console/logs)
- [ ] Chunk deltas sent via `stream_delta` messages (not full reloads)
- [ ] Smooth chunk transitions (no gaps or flickering)
- [ ] Chunk updates happen within 500ms of pose change
- [ ] No performance degradation during movement

### Zone Streaming - Initial Load
- [ ] Initial zones load with chunks (if `include_zones: true`)
- [ ] Zone geometry displays correctly in 3D view
- [ ] Zones filtered by active floor (only current floor visible)
- [ ] Zone boundaries render correctly
- [ ] Zone metadata (name, type) accessible

### Zone Streaming - Movement & Updates
- [ ] Zones load/unload as camera moves
- [ ] Zone deltas sent via `stream_delta` messages (only changes)
- [ ] Zones respect bounding box (radius + width)
- [ ] Zone updates happen within 500ms of pose change
- [ ] No duplicate zone requests

### Pose Updates
- [ ] `stream_update_pose` messages sent when camera moves
- [ ] Pose updates sent at appropriate intervals (not too frequent)
- [ ] Server responds with `stream_pose_ack`
- [ ] Chunk deltas included in `stream_pose_ack` when chunks change
- [ ] Zone deltas sent separately via `stream_delta` when zones change

### Ring Boundary Wrapping
- [ ] Move camera to position near 263,999,000m (near end of ring)
- [ ] Chunks load correctly near boundary
- [ ] Move camera past wrap point (to ~1,000m)
- [ ] Chunks from both sides of boundary load correctly
- [ ] No gaps or missing chunks at wrap point
- [ ] Zone queries handle wrapping correctly

### Floor Changes
- [ ] Change active floor (via UI or command)
- [ ] Chunks for new floor load correctly
- [ ] Chunks for old floor unload correctly
- [ ] Zones for new floor load correctly
- [ ] Zones for old floor unload correctly
- [ ] Smooth transition between floors (no flickering)
- [ ] Pose updates reflect new floor

### Error Handling
- [ ] Invalid subscription request (e.g., zero radius) returns error
- [ ] Error messages display correct error codes
- [ ] Client handles errors gracefully (doesn't crash)
- [ ] Client can recover from errors (retry subscription)
- [ ] Unknown message types return appropriate errors

### Reconnection & Resilience
- [ ] Disconnect WebSocket (close browser tab, network disconnect)
- [ ] Reconnect WebSocket (reload page, restore network)
- [ ] Client automatically re-subscribes on reconnect
- [ ] Old subscription cleaned up on server
- [ ] Chunks/zones reload correctly after reconnect
- [ ] No memory leaks or orphaned subscriptions

### Performance
- [ ] Initial subscription completes within 2 seconds
- [ ] Chunk compression reduces payload size by >50%
- [ ] Zone queries complete within 500ms
- [ ] Delta computation completes within 100ms
- [ ] WebSocket message latency < 50ms
- [ ] No frame rate drops during chunk loading
- [ ] Memory usage remains stable during extended play

### Coordinate System
- [ ] Debug Info panel shows correct RingArc coordinates
- [ ] Admin Player pane accepts RingArc coordinates
- [ ] Position updates work with new coordinate system
- [ ] Legacy coordinate conversion working correctly
- [ ] Station positions use new coordinate system

### Browser Compatibility
- [ ] Test in Chrome/Edge (Chromium)
- [ ] Test in Firefox
- [ ] Test in Safari (if available)
- [ ] WebSocket connection works in all browsers
- [ ] No console errors in any browser

### Network Conditions
- [ ] Test with slow network (throttle to 3G)
- [ ] Test with high latency (add 200ms delay)
- [ ] Test with packet loss (simulate 1% loss)
- [ ] System handles network issues gracefully
- [ ] Reconnection works after network issues

## Automated Integration Tests ✅ **IMPLEMENTED**

### Test Infrastructure
1. ✅ **Test Server**: `IntegrationTestFramework` with test database and HTTP server
2. ✅ **Test Client**: WebSocket client using `gorilla/websocket`
3. ✅ **Test Data**: Helper functions to create test chunks and zones
4. ✅ **Test Runner**: Go test suite with 8 integration test scenarios

### Implemented Test Scenarios

1. **TestIntegration_StreamingSubscription**: Tests initial subscription flow
   - WebSocket connection and authentication
   - `stream_subscribe` message handling
   - `stream_ack` response
   - Initial chunk delivery via `stream_delta`

2. **TestIntegration_PoseUpdate**: Tests pose updates and chunk deltas
   - `stream_update_pose` message handling
   - Chunk delta computation (added/removed chunks)
   - `stream_pose_ack` response with chunk delta

3. **TestIntegration_ZoneStreaming**: Tests zone streaming
   - Zone creation and database insertion
   - Zone delivery via `stream_delta` messages
   - Zone filtering by bounding box

4. **TestIntegration_RingWrapping**: Tests ring boundary wrapping
   - Subscription near ring boundary (263,999,000m)
   - Pose update across wrap point
   - Chunk loading on both sides of boundary

5. **TestIntegration_ErrorHandling**: Tests error conditions
   - Invalid subscription requests (zero radius)
   - Missing subscription ID
   - Nonexistent subscription
   - Unknown message types

6. **TestIntegration_FloorChanges**: Tests floor change handling
   - Chunk creation on different floors
   - Floor change via pose update
   - Chunk loading/unloading for new floor

7. **TestIntegration_Reconnection**: Tests WebSocket reconnection
   - Connection closure
   - Reconnection and new subscription
   - Subscription cleanup

8. **TestIntegration_Performance**: Tests performance benchmarks
   - Subscription time measurement
   - Pose update time measurement
   - Performance target validation

### Test Framework Features

- **IntegrationTestFramework**: Encapsulates test setup (DB, server, handlers, JWT)
- **Helper Methods**: `ConnectWebSocket`, `SendMessage`, `ReadMessage`, `WaitForMessage`, `SubscribeToStreaming`, `UpdatePose`, `CreateTestChunk`, `CreateTestZone`
- **Mock Procedural Service**: HTTP test server for chunk generation
- **Test Database**: Isolated test database per test run
- **Error Recovery**: Panic recovery in async goroutines

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
4. ✅ Add unit tests for WebSocket streaming handlers (`stream_subscribe`, `stream_update_pose`)
5. ✅ Create integration test framework
6. ✅ Implement basic integration test scenarios (subscription, pose update, zone streaming)
7. ✅ Additional integration test scenarios (ring wrapping, error handling, floor changes, reconnection, performance)
8. ⏳ Manual testing checklist completion
9. ⏳ Performance profiling and optimization

