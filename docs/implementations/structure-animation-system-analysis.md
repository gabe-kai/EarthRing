# Structure Animation System Analysis

**Status**: ✅ **ANALYZED & IMPROVED** (December 2024)

This document provides a comprehensive analysis of the structure construction and demolition animation system, including current implementation, timing defaults, and future extensibility.

## Overview

The animation system handles visual feedback for:
- **Construction**: Buildings grow from bottom up with scale-based animation
- **Demolition**: Buildings shrink and fade out with rotation

All animations are client-side, driven by server-provided timestamps to prevent client-side manipulation.

---

## Animation Architecture

### Core Components

1. **AnimationState Class**: Tracks animation progress, timing, and state
   - `startTime`: Timestamp when animation started (milliseconds)
   - `duration`: Animation duration (milliseconds)
   - `type`: 'construction' | 'demolition'
   - `boundingBox`: Structure bounding box for position calculations
   - `originalPosition`: Original Y position (for scale-based animation)
   - `originalRotation`: Original Z rotation (for demolition tilt)

2. **StructureManager Methods**:
   - `registerConstructionAnimation()`: Registers construction animation from structure data
   - `startDemolitionAnimation()`: Starts demolition animation (called by `removeStructure()`)
   - `applyConstructionAnimation()`: Updates construction animation each frame
   - `applyDemolitionAnimation()`: Updates demolition animation each frame
   - `updateConstructionAnimations()`: Main animation loop (called each frame)
   - `removeStructure()`: Triggers demolition animation (default) or immediate removal
   - `removeStructureImmediate()`: Immediate removal without animation
   - `hasActiveDemolitionAnimations()`: Checks if any demolition animations are in progress
   - `waitForDemolitionAnimations()`: Waits for all demolition animations to complete (up to 10 seconds)

### Animation Flow

#### Construction Animation
1. Structure loaded from database/stream with `construction_state = 'constructing'`
2. `registerConstructionAnimation()` called when structure is rendered
3. Parses `construction_started_at` timestamp from database
4. Calculates current progress: `(now - startTime) / duration`
5. Sets initial scale/opacity based on current progress
6. `updateConstructionAnimations()` updates each frame until complete

#### Demolition Animation
1. `removeStructure()` called (from admin reset, chunk cleanup, etc.)
2. `startDemolitionAnimation()` registered with 7.5 second duration
3. Modal closes immediately (if from admin action) so user can view animations
4. `updateConstructionAnimations()` applies animation each frame
5. Admin handlers wait for demolitions to complete using `waitForDemolitionAnimations()`
6. When complete, `removeStructureImmediate()` removes mesh from scene
7. New chunks loaded only after all demolitions finish (prevents visual overlap)

---

## Current Timing Defaults

### Construction Duration

**Default**: **5 minutes (300 seconds)**

- Used as placeholder until per-structure build times are implemented
- Stored in database as `construction_duration_seconds`
- Can be overridden per-structure (future: based on build requirements)
- Range: Intended to support 2 minutes to 60 minutes eventually

**Code Location**: `client-web/src/structures/structure-manager.js:1150`
```javascript
let durationMs = 300000; // Default: 5 minutes
if (structure.construction_duration_seconds) {
  durationMs = structure.construction_duration_seconds * 1000;
} else {
  // Default construction duration: 5 minutes (300 seconds) as placeholder
  // TODO: Later this will be per-structure based on build requirements
  durationMs = 300000; // 5 minutes in milliseconds
}
```

### Demolition Duration

**Default**: **7.5 seconds** (within 5-10 second range)

- Quick demolition for responsive gameplay
- Fixed duration (not stored in database)
- Applied to all demolitions for consistency

**Code Location**: `client-web/src/structures/structure-manager.js:2707`
```javascript
startDemolitionAnimation(structureID, durationSeconds = 7.5) {
  // Default: 7.5 seconds (5-10 second range)
  const durationMs = durationSeconds * 1000;
  // ...
}
```

---

## Animation Techniques

### Construction Animation

**Method**: Scale-based vertical reveal with bottom-up growth

1. **Scale**: Y-axis scales from 0.01 to 1.0
2. **Position Adjustment**: Mesh position adjusted to keep bottom fixed
   - Formula: `positionY = originalY + box.min.y * (1 - scaleY)`
   - As scale increases, building grows upward from bottom
3. **Opacity**: Fades in during first 10% of animation (minimum 30% opacity)
4. **Easing**: Cubic ease-out `1 - (1 - progress)³` for smooth appearance

**Visual Effect**: Building grows from the ground up

### Demolition Animation

**Method**: Scale down + rotation + opacity fade

1. **Scale**: Y-axis scales from 1.0 down to 0.01
2. **Position Adjustment**: Mesh position adjusted to keep bottom fixed
   - Formula: `positionY = originalY + box.min.y * (1 - scaleProgress)`
   - As scale decreases, building shrinks upward (top disappears first)
3. **Rotation**: Tilts forward (15° max) after 20% progress
4. **Opacity**: Fades out faster than scale (uses `progress^1.5` for faster fade)
5. **Easing**: Quadratic ease-in `progress²` for acceleration

**Visual Effect**: Building shrinks and tilts forward as it disappears

---

## Database Integration

### Construction State Fields

Structures table columns (added in migration 000024):
- `construction_state`: VARCHAR(50) - 'constructing' | 'completed' | 'demolishing'
- `construction_started_at`: TIMESTAMP - When construction/demolition started
- `construction_completed_at`: TIMESTAMP - When construction/demolition completes
- `construction_duration_seconds`: INTEGER - Duration in seconds

### Server Behavior

**When storing procedural structures** (`server/internal/database/chunks.go`):
- Buildings: `construction_state = 'constructing'`, `construction_started_at = now`, `construction_duration_seconds = 300` (5 minutes)
- Non-buildings: `construction_state = 'completed'`, instant completion

**When loading from database** (`server/internal/api/websocket.go:loadStructuresAndZonesFromDB`):
- Construction state fields included in structure data
- Timestamps sent as ISO 8601 strings
- Client parses and calculates progress

---

## Trigger Points

### Construction Animations

Automatically triggered when:
1. Structures loaded from database with `construction_state = 'constructing'`
2. Structures streamed via WebSocket with construction state
3. New structures created via API (player-placed)

### Demolition Animations

Triggered when:
1. **Admin reset actions**:
   - "Reset All Chunks Database" → Structures in removed chunks
   - "Rebuild Structures" → All procedural structures
   - "Clean Reset (TRUNCATE CASCADE)" → Structures in removed chunks
2. **Chunk cleanup**: When chunks are removed from game state
3. **Structure removal**: When `removeStructure()` is called
4. **Floor changes**: Structures on inactive floors

**Current Implementation**: 
- All `removeStructure()` calls now trigger demolition animation by default (`animate = true`)
- Admin handlers close modal immediately after starting demolitions so user can view animations
- System waits for all demolitions to complete before loading new chunks (prevents visual overlap)
- Uses `hasActiveDemolitionAnimations()` and `waitForDemolitionAnimations()` to coordinate timing

---

## Future Extensibility

### Per-Structure Build Times

**Current**: All buildings use 5-minute placeholder duration

**Future**: Support per-structure build times (2 minutes to 60 minutes)
- Store `construction_duration_seconds` in database per structure
- Calculate based on:
  - Structure type (residential, commercial, industrial)
  - Structure size (small, medium, large)
  - Build requirements (materials, resources, workforce)
- Client already supports per-structure duration (reads from `construction_duration_seconds`)

### Build Requirements

**Future Enhancement**: Track build requirements per structure
- Materials needed (steel, concrete, etc.)
- Resource costs
- Workforce requirements
- Pre-requisites (e.g., infrastructure, research)

**Implementation Path**:
1. Add `build_requirements` JSONB column to structures table
2. Store requirements when structure is created
3. Use requirements to calculate build duration
4. Display requirements in structure info panel

### Dynamic Demolition Duration

**Current**: Fixed 7.5 seconds for all demolitions

**Future**: Variable demolition duration based on structure
- Small structures: 3-5 seconds
- Medium structures: 5-7 seconds
- Large structures: 7-10 seconds
- Could be stored in structure properties or calculated from size

---

## Code Locations

### Client-Side

- **StructureManager**: `client-web/src/structures/structure-manager.js`
  - Animation registration: `registerConstructionAnimation()` (line ~1128)
  - Demolition trigger: `startDemolitionAnimation()` (line ~2707)
  - Animation updates: `updateConstructionAnimations()` (line ~3057)
  - Construction apply: `applyConstructionAnimation()` (line ~2876)
  - Demolition apply: `applyDemolitionAnimation()` (line ~2965)

### Server-Side

- **Database Storage**: `server/internal/database/chunks.go:StoreChunk()` (line ~551)
- **Structure Loading**: `server/internal/api/websocket.go:loadStructuresAndZonesFromDB()` (line ~765)
- **Structure Creation**: `server/internal/database/structures.go:CreateStructure()` (line ~200+)

### Admin UI

- **Reset Handlers**: `client-web/src/ui/admin-modal.js`
  - Chunk reset: `handleAdminResetAllChunks()` (line ~1845)
  - Zone reset: `handleAdminResetAllZones()` (line ~1711)
  - Structure rebuild: `setupAdminStructuresListeners()` (line ~862)

---

## Known Issues & Limitations

1. **Server Clock Dependency**: Animation progress calculated from server timestamps. If client clock is significantly off, animations may appear incorrect.
   - **Mitigation**: Client should sync with server time (future enhancement)

2. **Animation Start Time**: If structure construction started before client loaded, animation starts at current progress. This is intentional and prevents "rush" via refresh.

3. **Demolition on Floor Change**: Structures removed due to floor change don't animate (uses `removeStructure(id, animate=false)`). This is intentional for performance.

4. **No Build Requirements Yet**: All buildings use placeholder 5-minute duration. Per-structure durations not yet implemented.

---

## Testing Checklist

- [x] Construction animations play when structures loaded from database
- [x] Construction animations start at correct progress if construction already started
- [x] Demolition animations play when chunks reset
- [x] Demolition animations play when structures rebuilt
- [x] Demolition animations complete in ~7.5 seconds
- [x] Construction animations complete in ~5 minutes (placeholder)
- [ ] Per-structure build times (future)
- [ ] Build requirements (future)

---

## Related Documentation

- [Building Construction Animations Implementation](building-construction-animations.md) - Detailed implementation guide
- [Building Construction Animation Strategies](strategies/building-construction-animation.md) - Strategy selection and design
- [Structure System](../11-structure-system.md) - Overall structure system documentation

