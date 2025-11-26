# Performance Profiling Guide

This guide explains how to use the performance profiling system to measure and optimize EarthRing's streaming system.

## Overview

The performance profiler tracks timing metrics for key operations in the streaming system:
- Subscription planning
- Chunk loading
- Zone queries
- Delta computation
- WebSocket message handling
- Database queries

## Enabling Profiling

### Server Configuration

Add to your `.env` file:
```bash
ENABLE_PERFORMANCE_PROFILING=true
```

Or set via environment variable:
```powershell
$env:ENABLE_PERFORMANCE_PROFILING="true"
```

### Runtime Control

Profiling can be enabled/disabled at runtime via API (if implemented) or by restarting the server with the flag.

## Using the Profiler

### Basic Usage

```go
import "github.com/earthring/server/internal/performance"

// Create profiler (usually done at server startup)
profiler := performance.NewProfiler(true) // true = enabled

// Time an operation
op := profiler.Start("chunk_loading")
// ... do work ...
op.End()

// Or record directly
profiler.Record("zone_query", duration)
```

### Viewing Metrics

#### Console Report

```go
profiler.LogReport()
```

Output example:
```
=== Performance Report (since 2024-01-01T12:00:00Z) ===
Operation                               Count       Avg       Min       Max      Last
--------------------------------------------------------------------------------------------------------
stream_subscribe                           10   150.2ms    120.5ms    180.3ms    145.8ms
stream_update_pose                         50    45.3ms     32.1ms     78.9ms     42.1ms
chunk_loading                              25   320.5ms    250.1ms    450.2ms    335.2ms
zone_query                                 15   180.3ms    150.2ms    220.5ms    195.4ms
delta_computation                          50    12.5ms      8.2ms     25.3ms     11.8ms

Total runtime: 5m30s
```

#### JSON Report

```go
jsonData, err := profiler.JSONReport()
// Save to file or send via API
```

## Target Metrics

Based on `docs/refactor/INTEGRATION_TESTING.md`:

| Operation | Target | Current | Status |
|-----------|--------|---------|--------|
| Initial Subscription | < 2s | ? | ⏳ |
| Chunk Compression Ratio | > 2:1 | ? | ⏳ |
| Zone Query Time | < 500ms | ? | ⏳ |
| Delta Computation | < 100ms | ? | ⏳ |
| WebSocket Message Latency | < 50ms | ? | ⏳ |
| Pose Update | < 500ms | ? | ⏳ |

## Profiling Key Operations

### 1. Subscription Planning

```go
op := profiler.Start("stream_subscribe")
plan, err := streamManager.PlanSubscription(userID, req)
op.End()
```

### 2. Chunk Loading

```go
op := profiler.Start("chunk_loading")
chunks := loadChunksForIDs(chunkIDs, lodLevel)
op.End()
```

### 3. Zone Queries

```go
op := profiler.Start("zone_query")
zones, err := zoneStorage.ListZonesByRingArc(bbox, floor)
op.End()
```

### 4. Delta Computation

```go
op := profiler.Start("delta_computation")
delta := streamManager.UpdatePose(userID, subscriptionID, pose)
op.End()
```

### 5. WebSocket Message Handling

```go
op := profiler.Start("websocket_message")
handleMessage(conn, msg)
op.End()
```

## Integration Points

### WebSocket Handlers

Add profiling to `server/internal/api/websocket.go`:

```go
import "github.com/earthring/server/internal/performance"

// In handleStreamSubscribe
op := h.profiler.Start("stream_subscribe")
defer op.End()
// ... existing code ...
```

### Streaming Manager

Add profiling to `server/internal/streaming/manager.go`:

```go
// In PlanSubscription
op := profiler.Start("subscription_planning")
defer op.End()
// ... existing code ...
```

### Database Operations

Add profiling to database operations:

```go
// In chunkStorage.LoadChunk
op := profiler.Start("database_chunk_query")
defer op.End()
// ... existing code ...
```

## Performance Analysis Workflow

1. **Enable Profiling**: Set `ENABLE_PERFORMANCE_PROFILING=true`
2. **Run Tests**: Execute integration tests or manual testing
3. **Collect Metrics**: Run profiler report
4. **Identify Bottlenecks**: Look for operations exceeding targets
5. **Optimize**: Focus on slowest operations first
6. **Re-measure**: Verify improvements

## Benchmarking Script

Create a benchmarking script to automate performance testing:

```go
// server/cmd/benchmark/main.go
package main

import (
    "github.com/earthring/server/internal/performance"
    // ... other imports
)

func main() {
    profiler := performance.NewProfiler(true)
    
    // Run benchmark scenarios
    benchmarkSubscription(profiler)
    benchmarkPoseUpdates(profiler)
    benchmarkChunkLoading(profiler)
    
    // Print report
    profiler.LogReport()
    
    // Save JSON report
    jsonData, _ := profiler.JSONReport()
    os.WriteFile("performance_report.json", jsonData, 0644)
}
```

## Continuous Monitoring

### Periodic Reports

Add periodic report generation:

```go
// Report every 5 minutes
ticker := time.NewTicker(5 * time.Minute)
go func() {
    for range ticker.C {
        profiler.LogReport()
        profiler.Reset() // Optional: reset for next period
    }
}()
```

### API Endpoint

Expose metrics via REST API:

```go
// GET /api/v1/metrics/performance
func handlePerformanceMetrics(w http.ResponseWriter, r *http.Request) {
    jsonData, err := profiler.JSONReport()
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.Write(jsonData)
}
```

## Best Practices

1. **Profile in Production-like Environment**: Use realistic data volumes
2. **Profile Under Load**: Test with multiple concurrent clients
3. **Profile Key Paths**: Focus on frequently called operations
4. **Compare Before/After**: Measure improvements quantitatively
5. **Profile Regularly**: Catch performance regressions early

## Troubleshooting

### Profiler Not Recording

- Check `ENABLE_PERFORMANCE_PROFILING` is set to `true`
- Verify profiler is enabled: `profiler.IsEnabled()`
- Check that operations are being timed (not nil when disabled)

### High Overhead

- Profiler has minimal overhead, but if needed:
  - Disable in production
  - Use sampling (only profile every Nth operation)
  - Profile specific operations only

### Missing Metrics

- Ensure `op.End()` is called (use `defer` for safety)
- Check that profiler instance is shared across code paths
- Verify operation names are consistent

## Next Steps

1. ✅ Create profiler package
2. ⏳ Integrate profiler into WebSocket handlers
3. ⏳ Integrate profiler into streaming manager
4. ⏳ Integrate profiler into database operations
5. ⏳ Create benchmarking script
6. ⏳ Add API endpoint for metrics
7. ⏳ Run baseline performance tests
8. ⏳ Document baseline metrics
9. ⏳ Set up continuous monitoring

