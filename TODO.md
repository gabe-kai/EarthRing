# TODO Items

## Pending Issues

### Zone Refresh Issue
**Status**: Pending investigation  
**Description**: Upon a full refresh, some zones disappear, but the structures in those zones do not. This suggests a synchronization issue between zone loading and structure loading, or a mismatch in how zones vs structures are associated with chunks.

**Investigation needed**:
- Check if zones are being loaded correctly from chunk_data.zone_ids
- Verify structure-to-zone relationships are maintained after refresh
- Check if there's a race condition between zone and structure loading
- Verify chunk_data.zone_ids includes all zones that contain structures

**Related files**:
- `server/internal/api/websocket.go` - Zone/structure loading logic
- `server/internal/database/chunks.go` - Chunk data storage and retrieval
- `client-web/src/chunks/chunk-manager.js` - Client-side chunk/zone loading
