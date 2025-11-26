# Manual Testing Guide

This guide walks you through the manual testing checklist for the client-server refactor.

## Pre-Testing Setup

### 1. Start All Services

**Terminal 1: Go Server**
```powershell
cd server
go run cmd/earthring-server/main.go
```
Expected output: Server starts on `http://localhost:8080` (or your configured port)

**Terminal 2: Python Procedural Service**
```powershell
cd server
python -m uvicorn internal.procedural.main:app --host 0.0.0.0 --port 8081 --reload
```
Expected output: Service starts on `http://localhost:8081`

**Terminal 3: Client Development Server**
```powershell
cd client-web
npm run dev
```
Expected output: Client starts on `http://localhost:5173` (or Vite's default port)

### 2. Open Browser DevTools

1. Open your browser (Chrome/Edge recommended)
2. Press `F12` to open DevTools
3. Go to **Network** tab
4. Filter by **WS** (WebSocket) to see WebSocket messages
5. Go to **Console** tab for logs
6. Enable **Preserve log** in Console settings

### 3. Navigate to Client

Open `http://localhost:5173` (or your client URL) in the browser.

---

## Testing Workflow

### Phase 1: Prerequisites & Server Setup

#### ✅ Prerequisites Check
- [ ] Database migrations applied (check server logs for migration status)
- [ ] Server running (check Terminal 1 for "Server started" message)
- [ ] Procedural service running (check Terminal 2 for "Uvicorn running" message)
- [ ] Client built and running (check browser loads without errors)
- [ ] Browser DevTools open (Network tab, Console tab)

#### ✅ Server Setup Verification
1. **Check server logs** (Terminal 1):
   - [ ] No error messages on startup
   - [ ] Database connection established
   - [ ] "Streaming manager initialized" or similar message
   - [ ] Server listening on correct port

2. **Test WebSocket endpoint**:
   - Open browser console
   - Try connecting: `new WebSocket('ws://localhost:8080/ws?token=test')`
   - Should see connection attempt (may fail without valid token, but endpoint should be accessible)

3. **Verify JWT authentication**:
   - Check server logs for authentication messages
   - Server should handle JWT validation

---

### Phase 2: Client Setup & Authentication

1. **Load the client** in browser
   - [ ] Page loads without errors
   - [ ] No console errors on initial load

2. **Login/Authentication**:
   - [ ] Login form appears (if not authenticated)
   - [ ] Enter credentials and login
   - [ ] Authentication succeeds
   - [ ] Console shows "WebSocket opened" message

3. **WebSocket Connection**:
   - [ ] Check Network tab → WS filter
   - [ ] WebSocket connection shows as "101 Switching Protocols"
   - [ ] Console shows "WebSocket opened"
   - [ ] Connection status shows as "connected"

4. **Automatic Subscription**:
   - [ ] Check Console for `[Chunks] Subscribed to server-driven streaming`
   - [ ] Check Network tab → WS → Messages
   - [ ] Should see `stream_subscribe` message sent
   - [ ] Should see `stream_ack` message received
   - [ ] `stream_ack` contains `subscription_id`

**Expected Console Output:**
```
WebSocket opened
[Chunks] Subscribed to server-driven streaming
```

**Expected Network Tab (WS Messages):**
```
→ stream_subscribe: {"pose": {...}, "radius_meters": 5000, ...}
← stream_ack: {"subscription_id": "...", ...}
```

---

### Phase 3: Chunk Streaming - Initial Load

1. **Initial Chunk Loading**:
   - [ ] Wait 1-2 seconds after subscription
   - [ ] Check Console for chunk loading messages
   - [ ] Check 3D view - chunks should appear around camera
   - [ ] Chunks render as platforms/floors

2. **Chunk Geometry**:
   - [ ] Chunks display correctly in 3D view
   - [ ] No visual glitches or missing geometry
   - [ ] Chunks appear at correct positions relative to camera

3. **Chunk Compression**:
   - [ ] Check Network tab → WS → Messages
   - [ ] Look for `stream_delta` messages with chunks
   - [ ] Check message size (should be compressed)
   - [ ] Compression ratio should be >50% (compare compressed vs uncompressed size if visible)

4. **No Duplicates**:
   - [ ] Check Network tab for duplicate chunk requests
   - [ ] Each chunk ID should appear only once
   - [ ] Console should not show duplicate loading messages

**Expected Console Output:**
```
[Chunks] Received stream_delta: added=11 chunks
[Chunks] Loading chunk: 0_5
[Chunks] Loading chunk: 0_6
...
```

---

### Phase 4: Chunk Streaming - Movement & Updates

1. **Move Camera Forward** (WASD keys):
   - [ ] Camera moves smoothly
   - [ ] New chunks load ahead of camera
   - [ ] Check Console for chunk loading messages
   - [ ] Check Network tab for `stream_update_pose` messages

2. **Chunk Unloading**:
   - [ ] Move camera forward significantly (1000m+)
   - [ ] Check Console for "Removing X chunks" messages
   - [ ] Chunks behind camera should disappear
   - [ ] No chunks remain loaded behind camera

3. **Delta Messages**:
   - [ ] Check Network tab → WS → Messages
   - [ ] Look for `stream_delta` messages (not full reloads)
   - [ ] Messages should contain only `added_chunks` and `removed_chunks`
   - [ ] No full chunk list in every message

4. **Smooth Transitions**:
   - [ ] No gaps between chunks
   - [ ] No flickering during chunk loading/unloading
   - [ ] Frame rate remains stable

5. **Performance**:
   - [ ] Chunk updates happen quickly (<500ms)
   - [ ] No frame rate drops
   - [ ] Smooth camera movement

**Expected Console Output:**
```
[Chunks] Updating streaming pose (moved 1200m, chunk changed: true)
[Chunks] stream_pose_ack: Removing 3 chunks.
[Chunks] Pose updated successfully
```

**Expected Network Tab:**
```
→ stream_update_pose: {"subscription_id": "...", "pose": {...}}
← stream_pose_ack: {"chunk_delta": {"added_chunks": [...], "removed_chunks": [...]}}
← stream_delta: {"chunks": [...]}
```

---

### Phase 5: Zone Streaming

1. **Initial Zone Loading**:
   - [ ] Zones should load with chunks (if `include_zones: true`)
   - [ ] Check Console for zone loading messages
   - [ ] Zones appear as translucent polygons in 3D view

2. **Zone Geometry**:
   - [ ] Zone boundaries render correctly
   - [ ] Zones display at correct positions
   - [ ] Zone colors match zone types

3. **Floor Filtering**:
   - [ ] Only zones for current floor are visible
   - [ ] Change active floor (use +/- buttons in zone toolbar)
   - [ ] Zones for new floor appear
   - [ ] Zones for old floor disappear

4. **Zone Updates on Movement**:
   - [ ] Move camera to new area
   - [ ] Zones load/unload as camera moves
   - [ ] Check Network tab for `stream_delta` messages with zones
   - [ ] Only changed zones are sent (delta, not full list)

**Expected Console Output:**
```
[Zones] Received stream_delta: added=2 zones
[Zones] Loading zone: 123 (Residential)
```

---

### Phase 6: Pose Updates

1. **Pose Update Messages**:
   - [ ] Move camera around
   - [ ] Check Network tab → WS → Messages
   - [ ] Look for `stream_update_pose` messages
   - [ ] Messages sent at reasonable intervals (not every frame)

2. **Server Response**:
   - [ ] Server responds with `stream_pose_ack`
   - [ ] Response includes `chunk_delta` when chunks change
   - [ ] Response received quickly (<500ms)

3. **Zone Deltas**:
   - [ ] When zones change, `stream_delta` sent separately
   - [ ] Zone deltas contain only added/removed zones
   - [ ] No duplicate zone data

**Expected Network Tab:**
```
→ stream_update_pose: {"subscription_id": "...", "pose": {"ring_position": 15000, ...}}
← stream_pose_ack: {"subscription_id": "...", "chunk_delta": {...}}
← stream_delta: {"zones": [...]}  (if zones changed)
```

---

### Phase 7: Ring Boundary Wrapping

1. **Move to Boundary**:
   - Use Admin → Player pane to teleport to position `263999000` (near end of ring)
   - [ ] Camera teleports successfully
   - [ ] Chunks load correctly near boundary

2. **Cross Wrap Point**:
   - Move camera forward past wrap point (to ~`1000m`)
   - [ ] Chunks from both sides of boundary load correctly
   - [ ] No gaps at wrap point
   - [ ] Chunk `263999` appears adjacent to chunk `0`

3. **Zone Wrapping**:
   - [ ] Zones near boundary load correctly
   - [ ] Zone queries handle wrapping
   - [ ] No missing zones at wrap point

**Testing Tip**: Use Admin → Player pane to quickly jump to boundary positions:
- Position: `263999000` (near end)
- Position: `1000` (just past wrap)

---

### Phase 8: Floor Changes

1. **Change Active Floor**:
   - Use zone toolbar `+`/`−` buttons to change floor
   - [ ] Floor changes successfully
   - [ ] Console shows floor change messages

2. **Chunk Loading/Unloading**:
   - [ ] Chunks for new floor load
   - [ ] Chunks for old floor unload
   - [ ] Check Console for chunk loading/unloading messages

3. **Zone Loading/Unloading**:
   - [ ] Zones for new floor load
   - [ ] Zones for old floor unload
   - [ ] Only current floor zones visible

4. **Smooth Transition**:
   - [ ] No flickering during floor change
   - [ ] Transition happens quickly
   - [ ] Pose updates reflect new floor

**Expected Console Output:**
```
[GameState] Active floor changed: 0 → 1
[Chunks] Updating streaming pose (floor changed: 0 → 1)
[Chunks] stream_pose_ack: Removing 11 chunks (old floor)
[Chunks] Loading chunk: 1_5 (new floor)
```

---

### Phase 9: Error Handling

1. **Invalid Subscription** (requires code modification or manual WebSocket message):
   - Send invalid `stream_subscribe` with `radius_meters: 0`
   - [ ] Server returns error message
   - [ ] Error code is `InvalidSubscriptionRequest`
   - [ ] Client handles error gracefully (doesn't crash)

2. **Error Recovery**:
   - [ ] Client can retry after error
   - [ ] Client falls back to legacy chunk_request if streaming fails
   - [ ] Console shows error messages clearly

**Testing Tip**: Use browser console to send test messages:
```javascript
// Get WebSocket connection (if exposed)
const ws = window.earthring?.wsClient;
// Send invalid message (if API available)
```

---

### Phase 10: Reconnection & Resilience

1. **Disconnect WebSocket**:
   - Close browser tab or disconnect network
   - [ ] WebSocket closes gracefully
   - [ ] Server cleans up subscription (check server logs)

2. **Reconnect**:
   - Reload page or restore network
   - [ ] Client automatically reconnects
   - [ ] Client automatically re-subscribes
   - [ ] Chunks/zones reload correctly

3. **No Memory Leaks**:
   - [ ] Check browser memory usage (DevTools → Performance → Memory)
   - [ ] Memory usage remains stable after multiple reconnects
   - [ ] No orphaned subscriptions on server

**Expected Console Output:**
```
WebSocket closed
WebSocket opened
[Chunks] Subscribed to server-driven streaming
```

---

### Phase 11: Performance

1. **Initial Subscription**:
   - [ ] Subscription completes within 2 seconds
   - [ ] Measure time from connection to first chunks visible

2. **Chunk Compression**:
   - [ ] Check Network tab → WS → Message sizes
   - [ ] Compression ratio >50% (compare message sizes)
   - [ ] Compressed chunks decompress correctly

3. **Response Times**:
   - [ ] Zone queries complete within 500ms (check server logs)
   - [ ] Delta computation <100ms (check server logs)
   - [ ] WebSocket message latency <50ms

4. **Frame Rate**:
   - [ ] No frame rate drops during chunk loading
   - [ ] Smooth 60 FPS (or target FPS) maintained
   - [ ] Check DevTools → Performance tab

5. **Memory Usage**:
   - [ ] Memory usage remains stable during extended play
   - [ ] No memory leaks over time
   - [ ] Check DevTools → Memory tab

**Performance Measurement Tools:**
- Browser DevTools → Performance tab (frame rate)
- Browser DevTools → Memory tab (memory usage)
- Browser DevTools → Network tab (message sizes, timing)
- Server logs (query times, delta computation times)

---

### Phase 12: Coordinate System

1. **Debug Info Panel**:
   - Open Debug Info panel (if available)
   - [ ] "Position (ER)" shows RingArc coordinates (s, θ, r, z)
   - [ ] Coordinates update as camera moves
   - [ ] Coordinates are correct

2. **Admin Player Pane**:
   - Open Admin → Player pane
   - [ ] Position form shows RingArc coordinates (s, r, z)
   - [ ] Theta (θ) input available
   - [ ] Position updates work with new coordinates
   - [ ] Teleport works correctly

3. **Coordinate Conversion**:
   - [ ] Legacy coordinate conversion working
   - [ ] Station positions use new coordinate system
   - [ ] No coordinate-related errors in console

---

### Phase 13: Browser Compatibility

Test in multiple browsers:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (if available)

For each browser:
- [ ] WebSocket connection works
- [ ] No console errors
- [ ] Chunks load and render correctly
- [ ] Zones load and render correctly

---

### Phase 14: Network Conditions

1. **Slow Network**:
   - Use DevTools → Network → Throttling → "Slow 3G"
   - [ ] System handles slow network gracefully
   - [ ] Chunks still load (may be slower)
   - [ ] No crashes or errors

2. **High Latency**:
   - Use DevTools → Network → Add latency (200ms)
   - [ ] System handles latency gracefully
   - [ ] Responses still received correctly

3. **Packet Loss**:
   - Simulate packet loss (if possible)
   - [ ] System recovers from lost messages
   - [ ] Reconnection works after network issues

---

## Recording Test Results

As you complete each test, mark items in the checklist in `docs/refactor/INTEGRATION_TESTING.md`.

### Issues Found

If you find any issues, document them:

1. **Issue Description**: What happened?
2. **Steps to Reproduce**: How can we reproduce it?
3. **Expected Behavior**: What should have happened?
4. **Actual Behavior**: What actually happened?
5. **Console/Log Output**: Any error messages?
6. **Screenshots**: If applicable

### Test Completion

Once all tests are complete:
- [ ] All checklist items marked
- [ ] Issues documented
- [ ] Performance metrics recorded
- [ ] Test results summary created

---

## Quick Reference

### Key Console Messages to Look For

**Successful Connection:**
```
WebSocket opened
[Chunks] Subscribed to server-driven streaming
```

**Chunk Loading:**
```
[Chunks] Received stream_delta: added=11 chunks
[Chunks] Loading chunk: 0_5
```

**Pose Updates:**
```
[Chunks] Updating streaming pose (moved 1200m, chunk changed: true)
[Chunks] stream_pose_ack: Removing 3 chunks.
```

**Errors (should not appear):**
```
[Chunks] Failed to update streaming pose
WebSocket error
```

### Key Network Messages

**Subscription:**
- `stream_subscribe` → `stream_ack`

**Pose Updates:**
- `stream_update_pose` → `stream_pose_ack` + `stream_delta`

**Chunk/Zone Deltas:**
- `stream_delta` (with `chunks` or `zones`)

---

## Troubleshooting

### WebSocket Not Connecting
- Check server is running
- Check server logs for errors
- Verify JWT token is valid
- Check browser console for errors

### Chunks Not Loading
- Check procedural service is running
- Check server logs for chunk generation errors
- Verify database has chunk data
- Check Network tab for WebSocket messages

### Performance Issues
- Check server logs for slow queries
- Check browser Performance tab for frame rate
- Verify chunk compression is working
- Check memory usage in DevTools

---

Good luck with testing! 🚀

