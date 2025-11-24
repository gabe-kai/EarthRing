# Grid Overlay Performance Analysis

## Current Performance: ~45 FPS (Target: 60+ FPS)

## Performance Bottlenecks Identified

### 1. **Geometry Disposal and Recreation (HIGH IMPACT)**
**Location:** `updateGridLines()` → `clearLines()`

**Problem:**
- Every time the camera moves more than 1m, all grid geometries are disposed and recreated
- `clearLines()` calls `geometry.dispose()` on all existing geometries
- Then new `BufferGeometry` objects are created from scratch
- This is expensive because:
  - GPU memory allocation/deallocation
  - JavaScript object creation
  - Buffer attribute setup

**Frequency:**
- Triggered when camera moves ≥ 1m (minor spacing threshold)
- With WASD movement, this could be 10-30 times per second
- Each disposal/recreation cycle processes ~1300 vertices

**Impact:** Estimated 10-15 FPS loss

### 2. **Excessive Line Segment Count (MEDIUM IMPACT)**
**Location:** `generateMajorLines()` and `generateMinorLines()`

**Current Counts:**
- **Major lines:** ~100 lines (50 horizontal + 50 vertical)
  - Radius: 250m, spacing: 5m
  - Steps: `ceil((250 + 5) / 5) + 2 = 53` per axis
- **Minor lines:** ~500 lines (250 horizontal + 250 vertical)
  - Radius: 250m, spacing: 1m
  - Steps: `ceil((250 + 1) / 1) + 2 = 253` per axis
- **Total:** ~600 line segments when minor lines visible

**Vertex Multiplication:**
- Default lines: 2 vertices each
- Multiple-of-20 lines: 3 repeats = 6 vertices
- Axis line: 7 repeats = 14 vertices
- **Total vertices:** ~1300-2000 vertices

**Impact:** Estimated 5-8 FPS loss

### 3. **Unnecessary Shader Uniform Updates (LOW IMPACT)**
**Location:** `updatePosition()` → `updateFade()`

**Problem:**
- Shader uniforms are updated every frame via `updateFade()`
- These values rarely change (only when settings change)
- Uniform updates have minimal cost, but add up over time

**Impact:** Estimated 1-2 FPS loss

### 4. **No Geometry Reuse (MEDIUM IMPACT)**
**Location:** `generateMajorLines()` and `generateMinorLines()`

**Problem:**
- New `BufferGeometry` objects created every update
- Could reuse geometries and just update buffer attributes
- `BufferGeometry.setAttribute()` can update existing attributes more efficiently

**Impact:** Estimated 3-5 FPS loss

### 5. **Thick Line Vertex Generation (LOW-MEDIUM IMPACT)**
**Location:** `pushThickLineVertices()`

**Problem:**
- Creates multiple parallel lines for visual thickness
- Axis lines: 7 repeats = 7× vertex count
- Multiple-of-20 lines: 3 repeats = 3× vertex count
- This multiplies the vertex count significantly

**Impact:** Estimated 2-4 FPS loss

## Optimization Strategies (Priority Order)

### Priority 1: Geometry Reuse (HIGHEST IMPACT)
**Strategy:** Reuse geometries and update buffer attributes instead of disposing/recreating

**Implementation:**
- Keep geometry objects alive
- Use `geometry.setAttribute()` to update positions
- Only create new geometries when vertex count changes significantly
- Use `geometry.attributes.position.needsUpdate = true` to mark dirty

**Expected Gain:** 10-15 FPS

### Priority 2: Reduce Update Frequency (HIGH IMPACT)
**Strategy:** Only regenerate when camera movement exceeds a larger threshold

**Implementation:**
- Increase movement threshold from 1m to 2-3m
- Add debouncing/throttling for rapid camera movements
- Cache last generated grid state

**Expected Gain:** 5-8 FPS

### Priority 3: Optimize Line Generation (MEDIUM IMPACT)
**Strategy:** Reduce vertex count and optimize generation loops

**Implementation:**
- Pre-allocate vertex arrays with estimated size
- Use typed arrays (Float32Array) directly
- Reduce minor line count when camera is far (already have LOD)
- Consider reducing minor spacing when far from grid

**Expected Gain:** 3-5 FPS

### Priority 4: Conditional Uniform Updates (LOW IMPACT)
**Strategy:** Only update shader uniforms when they actually change

**Implementation:**
- Cache last uniform values
- Compare before updating
- Skip `updateFade()` if values unchanged

**Expected Gain:** 1-2 FPS

### Priority 5: Reduce Thick Line Complexity (LOW-MEDIUM IMPACT)
**Strategy:** Use fewer repeats for thick lines or use line width instead

**Implementation:**
- Reduce axis repeats from 7 to 5
- Reduce multiple repeats from 3 to 2
- Or use `LineBasicMaterial.linewidth` (if supported)

**Expected Gain:** 2-3 FPS

## Total Expected Performance Gain

**Conservative Estimate:** 21-33 FPS improvement
**Target FPS:** 45 + 21 = 66 FPS (meets 60+ target)

## Recommended Implementation Order

1. **Geometry Reuse** (Priority 1) - Biggest impact, moderate complexity
2. **Reduce Update Frequency** (Priority 2) - Easy, good impact
3. **Optimize Line Generation** (Priority 3) - Moderate complexity, good impact
4. **Conditional Uniform Updates** (Priority 4) - Easy, small impact
5. **Reduce Thick Line Complexity** (Priority 5) - Easy, small-medium impact

## Notes

- Current implementation is correct but not optimized
- The grid overlay works well visually, just needs performance tuning
- Most optimizations are low-risk and maintain visual quality
- Geometry reuse is the most impactful but requires careful state management

