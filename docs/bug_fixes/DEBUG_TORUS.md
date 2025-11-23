# Debug Torus Tool

## Enable Debug Logging

In the browser console, run:
```javascript
window.DEBUG_ZONE_COORDS = true;
```

Then try creating toruses at different positions and watch the console output.

## What to Look For

For each torus created, you should see:
1. `[ZoneEditor] createTorusGeometry:` - Shows center, radii, and boundary crossing detection
2. `[ZoneEditor] createTorusGeometry result:` - Shows the final GeoJSON structure

**Key checks:**
- `ringCount`: Should be **2** (outer ring + inner ring for hole)
- `outerRingPoints` and `innerRingPoints`: Should both have 65 points (64 segments + 1 to close)
- First and last points of each ring should match (ring is closed)
- `crossesBoundary`: Should be `true` for large toruses or toruses near X=0/X=264M

## Expected Behavior

**Working torus:**
- ringCount: 2
- outerRingPoints: 65
- innerRingPoints: 65
- Renders with visible hole (donut shape)

**Broken torus (appears as circle):**
- ringCount: might be 1 (only outer ring)
- OR innerRingPoints: might be 0 or undefined
- Renders as solid circle with no hole

## Test Cases

1. **Small torus away from boundary** (e.g., X=50000, Y=0)
   - Should NOT cross boundary
   - Should still have hole

2. **Large torus near X=0** (e.g., X=50, Y=0, radius > 100)
   - Might cross boundary depending on size
   - Should still have hole

3. **Torus at origin** (X=0, Y=0)
   - Likely crosses boundary
   - Should have hole (this one works according to user)

## Debugging Steps

1. Enable debug logging
2. Create a torus that appears as a circle
3. Check console output for that torus
4. Look for:
   - Is `ringCount` = 2?
   - Are both rings properly formed?
   - Is boundary crossing detected correctly?
5. Report findings

