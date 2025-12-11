# Building Construction & Demolition Animation Strategies

**Status**: 📋 **PROPOSAL** - Strategy document for implementing real-time building construction and demolition animations.

## Overview

Currently, buildings appear/disappear instantly when chunks are loaded or refreshed. This document outlines strategies to implement:
1. **Progressive Construction**: Buildings construct over time when spawned
2. **Demolition Animation**: Buildings disappear gradually when demolished
3. **No Refresh Required**: Animations happen in real-time without page refresh

## Current Architecture

### Structure Lifecycle

1. **Loading**: Structures loaded from chunks via `extractStructuresFromChunk()` → `handleStreamedStructures()` → `upsertStructure()` → `renderStructure()`
2. **State Management**: Structures stored in `GameStateManager.structures` Map
3. **Rendering**: Structures rendered via `StructureManager.renderStructure()` which creates Three.js meshes immediately
4. **Updates**: Structure updates trigger `structureAdded`, `structureUpdated`, or `structureRemoved` events

### Current Limitations

- Structures appear instantly when rendered
- No construction state tracking
- No animation system for state transitions
- Demolition requires manual removal from database/chunk refresh

## Strategy Options

### Strategy 1: Client-Side Animation with Server State (Recommended)

**Approach**: Server tracks construction state (start time, completion time), client animates based on current time.

#### Database Schema Changes

Add construction state fields to `structures` table:

```sql
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_state VARCHAR(20) DEFAULT 'completed';
  -- 'pending', 'constructing', 'completed', 'demolishing', 'demolished'

ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_started_at TIMESTAMP;
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_completed_at TIMESTAMP;
ALTER TABLE structures ADD COLUMN IF NOT EXISTS construction_duration_seconds INTEGER DEFAULT 300;
  -- Default: 5 minutes (300 seconds) for buildings
```

Or store in `properties` JSONB (no migration needed):

```json
{
  "construction_state": "constructing",
  "construction_started_at": "2024-01-01T12:00:00Z",
  "construction_duration_seconds": 300
}
```

#### Client-Side Implementation

1. **Animation State Tracking**
   - Track animation state per structure in `StructureManager`
   - Calculate construction progress: `progress = (now - startTime) / duration`
   - Map progress to visual representation (scale, opacity, geometry reveal)

2. **Animation Techniques**
   - **Scale Animation**: Start at scale 0, grow to 1 over duration
   - **Vertical Reveal**: Start with height 0, grow to full height (more realistic)
   - **Opacity Fade**: Start transparent, fade to opaque (simpler but less realistic)
   - **Layer-by-Layer**: Reveal building floor-by-floor (most complex, most realistic)

3. **Integration Points**
   - Modify `renderStructure()` to check construction state
   - Add animation update loop in render cycle
   - Listen to `structureAdded`/`structureUpdated` to start animations

#### Pros
- ✅ Server is source of truth for state
- ✅ Works across multiple clients (syncs via WebSocket)
- ✅ Can pause/resume construction based on game mechanics
- ✅ Supports demolition state transition

#### Cons
- ❌ Requires database schema changes or properties extension
- ❌ Need to handle time sync between server/client
- ❌ More complex state management

---

### Strategy 2: Pure Client-Side Animation (Simpler)

**Approach**: Client immediately starts animation when structure is first rendered, no server state required.

#### Implementation

1. **Animation Trigger**
   - When `renderStructure()` is called, check if structure is "new" (not in `structureMeshes` Map)
   - If new, start construction animation
   - Use `created_at` timestamp or client-side timestamp for timing

2. **Animation State**
   - Store animation state in `StructureManager`:
     ```javascript
     this.constructionAnimations = new Map(); // Map<structureID, { startTime, duration, state }>
     ```

3. **Animation Loop**
   - Update animations in render loop (similar to camera updates)
   - Calculate progress and apply visual transformations

#### Pros
- ✅ No database changes needed
- ✅ Simpler implementation
- ✅ Fast to implement

#### Cons
- ❌ Not synchronized across clients
- ❌ Doesn't persist across refreshes (animation restarts)
- ❌ No server control over construction timing
- ❌ Can't support game mechanics that affect construction speed

---

### Strategy 3: Hybrid Approach (Best Balance)

**Approach**: Server provides construction metadata (duration, start time), client handles animation.

#### Server Changes

Store construction metadata in `properties` JSONB:

```json
{
  "construction": {
    "state": "constructing",
    "started_at": "2024-01-01T12:00:00Z",
    "duration_seconds": 300,
    "progress": 0.0  // Server-calculated for verification
  }
}
```

- Server calculates `progress` on each structure fetch
- Client uses this for animation, but can also calculate locally for smooth updates

#### Client Implementation

- Check `properties.construction.state` when rendering
- If `constructing`: animate from `started_at` + `duration`
- If `completed`: render normally
- If `demolishing`: reverse animation

#### Pros
- ✅ Server can control timing (game mechanics, upgrades, etc.)
- ✅ Client handles smooth animation
- ✅ Works across refreshes (state persists)
- ✅ Can sync across clients via WebSocket updates

#### Cons
- ❌ Requires server-side metadata management
- ❌ Need to handle time sync (clock drift)

---

## Recommended Implementation: Strategy 3 (Hybrid)

### Phase 1: Client-Side Animation System

1. **Add Animation Manager**
   ```javascript
   // In StructureManager
   this.constructionAnimations = new Map(); // Map<structureID, AnimationState>
   
   class AnimationState {
     constructor(startTime, duration, type = 'construction') {
       this.startTime = startTime; // timestamp
       this.duration = duration;   // milliseconds
       this.type = type;           // 'construction' | 'demolition'
       this.completed = false;
     }
     
     getProgress(now) {
       const elapsed = now - this.startTime;
       const progress = Math.min(1.0, Math.max(0.0, elapsed / this.duration));
       this.completed = progress >= 1.0;
       return progress;
     }
   }
   ```

2. **Modify renderStructure()**
   - Check for construction state in `structure.properties.construction`
   - If constructing: render at reduced scale/height, register animation
   - If completed: render normally

3. **Add Animation Update Loop**
   ```javascript
   // In main.js render loop or StructureManager
   updateConstructionAnimations(deltaTime) {
     const now = Date.now();
     for (const [structureId, animation] of this.constructionAnimations) {
       const progress = animation.getProgress(now);
       const mesh = this.structureMeshes.get(structureId);
       if (!mesh) continue;
       
       if (animation.type === 'construction') {
         this.applyConstructionAnimation(mesh, progress, structureId);
       } else if (animation.type === 'demolition') {
         this.applyDemolitionAnimation(mesh, progress, structureId);
       }
       
       if (animation.completed) {
         this.constructionAnimations.delete(structureId);
       }
     }
   }
   ```

4. **Animation Functions**
   ```javascript
   applyConstructionAnimation(mesh, progress, structureId) {
     // Option A: Scale animation (simplest)
     const scale = progress;
     mesh.scale.y = scale; // Grow vertically
     
     // Option B: Height-based reveal (more realistic)
     // Requires storing original height and modifying geometry
     
     // Option C: Opacity fade (simple but less realistic)
     mesh.traverse((child) => {
       if (child.material) {
         child.material.opacity = progress;
         child.material.transparent = progress < 1.0;
       }
     });
   }
   
   applyDemolitionAnimation(mesh, progress, structureId) {
     // Reverse of construction
     const scale = 1.0 - progress;
     mesh.scale.y = Math.max(0.01, scale); // Shrink vertically
     
     // Optional: Add rotation/fade for demolition effect
     if (progress > 0.5) {
       mesh.rotation.z += 0.01; // Tilt as it falls
     }
   }
   ```

### Phase 2: Server-Side Construction State

1. **Modify Structure Creation API**
   - When creating structure, set `properties.construction`:
     ```json
     {
       "state": "constructing",
       "started_at": "2024-01-01T12:00:00Z",
       "duration_seconds": 300
     }
     ```

2. **Construction Completion Logic**
   - Option A: Client calculates completion, server verifies on next fetch
   - Option B: Server has background job that updates state when complete
   - Option C: Server calculates on-demand when structure is fetched

3. **Demolition State**
   - When structure is deleted, set `state: "demolishing"` instead of deleting immediately
   - After demolition duration, actually delete from database
   - Or soft-delete with `state: "demolished"` and cleanup later

### Phase 3: WebSocket Integration

1. **Structure State Updates**
   - Server sends `structureUpdated` events when construction state changes
   - Client receives update and starts/updates animation accordingly

2. **Sync Considerations**
   - Handle clock drift: Use server timestamps for authoritative progress
   - Client can interpolate between server updates for smooth animation

## Animation Techniques Comparison

### 1. Scale Animation (Simplest)

**Implementation**: Scale mesh from 0 to 1 over duration

```javascript
mesh.scale.set(1, progress, 1); // Grow vertically only
// or
mesh.scale.set(progress, progress, progress); // Grow uniformly
```

**Pros**: 
- ✅ Simple to implement
- ✅ Works with existing geometry
- ✅ No geometry modifications needed

**Cons**:
- ❌ Less realistic (building appears to grow from center)
- ❌ Doesn't look like actual construction

---

### 2. Vertical Reveal (Recommended)

**Implementation**: Start with height 0, grow to full height

```javascript
// Store original height
const originalHeight = structure.dimensions.height;
const currentHeight = originalHeight * progress;

// Modify building geometry height
// This requires regenerating geometry or using a shader
```

**Pros**:
- ✅ More realistic (building appears to be built from ground up)
- ✅ Matches real-world construction

**Cons**:
- ❌ Requires geometry regeneration or shader modification
- ❌ More complex for merged geometries

**Implementation Approaches**:
- **Geometry Regeneration**: Recreate geometry with modified height each frame
- **Shader-Based**: Use vertex shader to clip geometry below `progress * height`
- **Transform-Based**: Use `mesh.position.y` offset + `mesh.scale.y` (simpler but less accurate)

---

### 3. Opacity Fade

**Implementation**: Fade from transparent to opaque

```javascript
mesh.traverse((child) => {
  if (child.material) {
    child.material.opacity = progress;
    child.material.transparent = progress < 1.0;
  }
});
```

**Pros**:
- ✅ Very simple
- ✅ Works with any geometry
- ✅ Can combine with other techniques

**Cons**:
- ❌ Not realistic for construction
- ❌ Good for demolition fade-out

**Best Use**: Combine with scale/height for demolition effects

---

### 4. Layer-by-Layer Reveal (Most Complex)

**Implementation**: Reveal building floor-by-floor

**Pros**:
- ✅ Most realistic
- ✅ Impressive visual effect

**Cons**:
- ❌ Very complex to implement
- ❌ Requires building geometry to be segmented by floor
- ❌ Performance overhead

**Implementation**: Would require pre-segmenting building geometry or using instanced floor rendering

---

## Recommended Animation Approach

**For Construction**: **Vertical Reveal (Option 2)** using transform-based approach:
- Use `mesh.scale.y = progress` to grow from ground up
- Adjust `mesh.position.y` to keep base on ground
- Combine with slight opacity fade-in for polish

**For Demolition**: **Scale Down + Rotation + Opacity**:
- Shrink vertically: `mesh.scale.y = 1 - progress`
- Add slight rotation: `mesh.rotation.z += rotationAmount * deltaTime`
- Fade out: `opacity = 1 - progress`

## Implementation Steps

### Step 1: Basic Animation Infrastructure (Client)

1. Add animation tracking to `StructureManager`
2. Modify `renderStructure()` to handle construction state
3. Add animation update loop in render cycle
4. Implement basic scale animation

### Step 2: Enhanced Animations

1. Implement vertical reveal animation
2. Add demolition animation
3. Polish with easing functions (e.g., ease-out for construction)

### Step 3: Server Integration

1. Add construction metadata to structure creation
2. Update API to include construction state
3. Add server-side state management (optional background jobs)

### Step 4: WebSocket Sync

1. Send structure state updates via WebSocket
2. Handle state transitions on client
3. Sync timing across clients

### Step 5: Game Mechanics Integration

1. Allow construction duration to vary by structure type/size
2. Support construction speed modifiers (upgrades, resources)
3. Add visual indicators (construction equipment, workers)

## Performance Considerations

1. **Animation Updates**: Only update structures that are animating (use Set/Map for active animations)
2. **Geometry Regeneration**: Avoid regenerating geometry every frame; use transforms/scales instead
3. **Material Updates**: Batch material opacity updates; avoid per-frame material cloning
4. **Culling**: Don't animate structures outside view frustum (check distance from camera)
5. **Throttling**: Update animations at 30 FPS instead of 60 FPS if needed

## Testing Strategy

1. **Unit Tests**: Test animation state calculations, progress calculations
2. **Integration Tests**: Test structure creation → animation → completion flow
3. **Performance Tests**: Measure FPS impact of animating 100+ structures
4. **Sync Tests**: Test construction state sync across multiple clients

## Future Enhancements

1. **Particle Effects**: Construction dust, demolition debris
2. **Sound Effects**: Construction sounds, demolition sounds
3. **Construction Equipment**: Visible construction vehicles/cranes during building
4. **Interruptible Construction**: Pause/resume based on resources/conditions
5. **Multi-Stage Construction**: Different phases (foundation → structure → finishing)

## References

- [Structure System Design](11-structure-system.md) - Current structure system
- [Client Architecture](06-client-architecture.md) - Client rendering architecture
- Three.js Animation: https://threejs.org/docs/#manual/en/introduction/Animation-system
- GSAP (optional animation library): https://greensock.com/gsap/

