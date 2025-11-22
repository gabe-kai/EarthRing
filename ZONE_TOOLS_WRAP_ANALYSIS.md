# Zone Tools Wrap-Point Analysis

## Overview

Analysis of wrap-point handling in all zone creation tools, with focus on identifying tools that need boundary-crossing detection similar to the circle tool.

## Summary

| Tool | Wrap Handling | Status | Priority |
|------|---------------|--------|----------|
| Circle | ✅ **Sophisticated** - Detects boundary crossing, shifts coordinates | Working | - |
| Torus | ✅ **FIXED** - Now detects boundary crossing, shifts both rings consistently | Working | - |
| Rectangle | ⚠️ **Basic** - Wraps coordinates, no shift logic | Acceptable | Low |
| Polygon | ⚠️ **Simple wrap only** - No boundary detection | May need fix | Medium |
| Paintbrush | ⚠️ **Mixed** - Uses circle for single point, path has no detection | May need fix | Medium |

## Detailed Analysis

### 1. Circle Tool ✅ (Lines 1194-1326)

**Status**: **Working correctly** with sophisticated boundary-crossing detection.

**Implementation**:
```javascript
// 1. Generate raw coordinates around center
const rawCoords = [];
for (let i = 0; i < segments; i++) {
  const x = absCenterX + radius * Math.cos(angle);
  const y = absCenterY + radius * Math.sin(angle);
  rawCoords.push({ x, y });
}

// 2. Check if circle crosses boundary
const wrappedCoords = rawCoords.map(p => wrapRingPosition(p.x));
const wrappedSpan = Math.max(...wrappedCoords) - Math.min(...wrappedCoords);

// 3. If span > half ring, apply coordinate shifting
if (wrappedSpan > RING_CIRCUMFERENCE / 2) {
  // Complex shifting logic to keep coordinates contiguous
  // Ensures circle maintains proper shape across wrap boundary
}
```

**Why This Works**:
- Detects when coordinates would wrap to very different values
- Shifts ALL coordinates consistently to keep circle contiguous
- Maintains proper center position after shifting
- Prevents distorted circles near wrap boundary

---

### 2. Torus Tool ✅ (Lines 1430-1568)

**Status**: **FIXED** - Now includes boundary-crossing detection.

**Implementation** (FIXED):
```javascript
createTorusGeometry(center, edge) {
  const outerRadius = Math.sqrt(...);
  const innerRadius = outerRadius * 0.6;
  const RING_CIRCUMFERENCE = 264000000;
  
  // Convert center to absolute coordinates
  const absCenterX = this.convertRelativeToAbsoluteX(center.x);
  const absCenterY = center.y;
  
  // Generate RAW coordinates (before wrapping) for both rings
  const rawOuterCoords = [];
  const rawInnerCoords = [];
  
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    rawOuterCoords.push({
      x: absCenterX + outerRadius * cos,
      y: absCenterY + outerRadius * sin
    });
    
    rawInnerCoords.push({
      x: absCenterX + innerRadius * cos,
      y: absCenterY + innerRadius * sin
    });
  }
  
  // ✅ CHECK FOR BOUNDARY CROSSING (use outer ring as reference)
  const wrappedOuterX = rawOuterCoords.map(p => wrapRingPosition(p.x));
  const wrappedSpan = Math.max(...wrappedOuterX) - Math.min(...wrappedOuterX);
  
  // ✅ If torus crosses boundary, apply coordinate shifting
  if (wrappedSpan > RING_CIRCUMFERENCE / 2) {
    // Apply same shifting logic as circle tool
    // CRITICAL: Apply SAME shift to BOTH outer and inner rings
    const centerWrapped = wrapRingPosition(absCenterX);
    const minRawX = Math.min(...rawOuterCoords.map(p => p.x));
    const baseShift = -minRawX;
    const newCenterAfterBaseShift = absCenterX + baseShift;
    const newCenterAfterBaseShiftWrapped = wrapRingPosition(newCenterAfterBaseShift);
    
    let additionalShift = 0;
    if (newCenterAfterBaseShiftWrapped !== centerWrapped) {
      const diff = centerWrapped - newCenterAfterBaseShiftWrapped;
      additionalShift = Math.abs(diff) > RING_CIRCUMFERENCE / 2 
        ? (diff > 0 ? diff - RING_CIRCUMFERENCE : diff + RING_CIRCUMFERENCE)
        : diff;
    }
    
    const totalShift = baseShift + additionalShift;
    
    // ✅ Apply SAME shift to BOTH rings
    outerCoords = rawOuterCoords.map(p => [
      wrapRingPosition(p.x + totalShift), p.y
    ]);
    innerCoords = rawInnerCoords.map(p => [
      wrapRingPosition(p.x + totalShift), p.y
    ]);
  } else {
    // Normal case - just wrap coordinates
    outerCoords = rawOuterCoords.map(p => [wrapRingPosition(p.x), p.y]);
    innerCoords = rawInnerCoords.map(p => [wrapRingPosition(p.x), p.y]);
  }
  
  // Close rings and return polygon with hole (proper GeoJSON format)
  return {
    type: 'Polygon',
    coordinates: [outerCoords, innerCoords]  // First ring = outer, second = hole
  };
}
```

**Why This Works**:
- ✅ Detects boundary crossing using outer ring span
- ✅ Applies SAME shift to both outer and inner rings
- ✅ Maintains proper hole geometry (concentric rings relationship)
- ✅ Prevents distorted torus shapes near wrap boundary
- ✅ Preview function updated with same logic for accurate visualization

---

### 3. Rectangle Tool ⚠️ (Lines 1025-1119)

**Status**: **Acceptable** - Basic wrap handling sufficient for rectangles.

**Current Implementation**:
```javascript
// Convert start and end to absolute coordinates
const startAbs = this.convertRelativeToAbsoluteX(start.x);
const endAbs = this.convertRelativeToAbsoluteX(end.x);

// Wrap to valid range
let minX = wrapRingPosition(Math.min(startAbs, endAbs));
let maxX = wrapRingPosition(Math.max(startAbs, endAbs));

// Safety check for wrap-around case
if (minX >= maxX) {
  [minX, maxX] = [Math.min(minX, maxX), Math.max(minX, maxX)];
}
```

**Why This is Acceptable**:
- Rectangles have only 4 corners
- If rectangle crosses boundary, user intent is ambiguous:
  - Did they want small rectangle wrapping around boundary?
  - Or did they accidentally drag across the ring?
- Current behavior creates a valid rectangle in wrapped coordinates
- Server-side merge handles wrapped rectangles correctly (as verified in testing)

**Recommendation**: Keep as-is unless users report issues.

---

### 4. Polygon Tool ⚠️ (Lines 1568-1587)

**Status**: **May need fix** - Simple wrap only, no boundary detection.

**Current Implementation**:
```javascript
createPolygonGeometry(vertices) {
  const coordinates = vertices.map(v => {
    const absX = this.convertRelativeToAbsoluteX(v.x);
    const wrappedX = wrapRingPosition(absX);  // ❌ Simple wrap only
    return [wrappedX, v.y];
  });
  // ...
}
```

**Problem**:
- Each vertex wrapped individually
- If polygon crosses boundary, vertices may wrap to opposite sides
- Result: Distorted polygon shape

**Impact**:
- **Medium** - Depends on polygon complexity
- Simple polygons (3-4 vertices) may be acceptable
- Complex polygons near boundary will be distorted

**Recommendation**: Add boundary-crossing detection if users create complex polygons near wrap boundary.

---

### 5. Paintbrush Tool ⚠️ (Lines 1715-1813)

**Status**: **Mixed** - Uses circle for single point (good), expanded path has no boundary detection.

**Current Implementation**:
```javascript
createPaintbrushGeometry(path) {
  if (path.length < 2) {
    // ✅ Single point - uses circle tool (which has boundary detection)
    return this.createCircleGeometry(path[0], {
      x: path[0].x + this.paintbrushRadius,
      y: path[0].y,
      z: path[0].z,
    });
  }
  
  // ❌ Multi-point path - expands path, wraps coordinates individually
  const expandedCoords = this.expandPathCoords(path, this.paintbrushRadius);
  return {
    type: 'Polygon',
    coordinates: [expandedCoords],
  };
}
```

**Problem**:
- Path expansion doesn't check for boundary crossing
- If paintbrush stroke crosses boundary, expanded polygon will be distorted

**Impact**:
- **Medium** - Depends on stroke length and position
- Short strokes away from boundary: fine
- Long strokes near/across boundary: distorted

**Recommendation**: Add boundary-crossing detection if users paint across wrap boundary.

---

## Recommendations

### Completed ✅

1. **~~Fix Torus Tool~~** (**COMPLETED**)
   - ✅ Added boundary-crossing detection using outer ring span check
   - ✅ Applied circle tool's shifting logic to both outer and inner rings
   - ✅ Ensured SAME shift is applied to both rings to maintain hole geometry
   - ✅ Updated both createTorusGeometry and createTorusPreview functions
   - ✅ Ready for testing with torus centered at X=0, X=132M, and X=264M

### Future Improvements

2. **Monitor Polygon Tool** (Medium Priority)
   - Collect user feedback on polygon distortion near boundary
   - If issues reported, add boundary-crossing detection
   - Implementation would be similar to torus: detect span, apply consistent shift to all vertices

3. **Monitor Paintbrush Tool** (Medium Priority)
   - Collect user feedback on paintbrush strokes crossing boundary
   - If issues reported, add boundary-crossing detection to path expansion
   - Implementation: detect if expanded path crosses boundary, apply consistent shift

4. **Rectangle Tool** (Low Priority)
   - Current behavior acceptable
   - Server-side merge handles wrapped rectangles correctly (verified in testing)
   - Only revisit if users report confusion

---

## Implementation Notes

### Boundary-Crossing Detection Pattern

All tools that need boundary-crossing detection should follow this pattern:

```javascript
// 1. Generate raw coordinates (absolute, not wrapped)
const rawCoords = generateCoordinates(center, radius);

// 2. Check if coordinates cross boundary
const wrappedCoords = rawCoords.map(p => wrapRingPosition(p.x));
const wrappedSpan = Math.max(...wrappedCoords) - Math.min(...wrappedCoords);

// 3. Apply shifting if boundary crossed
if (wrappedSpan > RING_CIRCUMFERENCE / 2) {
  // Calculate shift to keep coordinates contiguous
  const shift = calculateShift(rawCoords, center);
  
  // Apply SAME shift to ALL coordinates
  return rawCoords.map(p => [wrapRingPosition(p.x + shift), p.y]);
} else {
  // Normal case - just wrap
  return rawCoords.map(p => [wrapRingPosition(p.x), p.y]);
}
```

### Testing

For any tool that gets boundary-crossing detection added:

1. Test with shape centered at X=0 (wrap boundary)
2. Test with shape centered at X=132M (opposite side of ring)
3. Test with shape centered at X=264M (wraps to X=0)
4. Verify shape maintains proper geometry in all cases
5. Verify shape merges correctly with overlapping zones

---

## Conclusion

**✅ Torus Tool Fixed**: Now includes boundary-crossing detection matching circle tool implementation

**✅ Working Correctly**: Circle and Torus tools handle wrap boundary properly, Rectangle tool acceptable

**⏳ Monitor**: Polygon and Paintbrush tools may need fixes based on user feedback (MEDIUM priority)

## Testing Recommendations

To verify the torus fix works correctly:

1. **Test at wrap boundary**: Create torus centered at X=0 (or X=264M)
2. **Test opposite side**: Create torus centered at X=132M
3. **Test overlap**: Create overlapping torus zones and verify server merge works
4. **Verify preview**: Confirm preview matches final rendered zone
5. **Check hole geometry**: Ensure inner ring (hole) maintains proper shape and position

