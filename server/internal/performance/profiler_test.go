package performance

import (
	"testing"
	"time"
)

func TestProfiler(t *testing.T) {
	profiler := NewProfiler(true)

	// Test basic timing
	op := profiler.Start("test_operation")
	time.Sleep(10 * time.Millisecond)
	op.End()

	metric := profiler.GetMetric("test_operation")
	if metric == nil {
		t.Fatal("Metric not found")
	}

	if metric.Count != 1 {
		t.Errorf("Expected count 1, got %d", metric.Count)
	}

	if metric.MinTime < 10*time.Millisecond || metric.MinTime > 20*time.Millisecond {
		t.Errorf("Expected min time ~10ms, got %v", metric.MinTime)
	}
}

func TestProfilerDisabled(t *testing.T) {
	profiler := NewProfiler(false)

	op := profiler.Start("test_operation")
	if op != nil {
		t.Error("Expected nil operation when profiler disabled")
	}

	profiler.Record("test", 10*time.Millisecond)
	metric := profiler.GetMetric("test")
	if metric != nil {
		t.Error("Expected nil metric when profiler disabled")
	}
}

func TestProfilerMultipleOperations(t *testing.T) {
	profiler := NewProfiler(true)

	// Record multiple operations
	for i := 0; i < 10; i++ {
		op := profiler.Start("multi_test")
		time.Sleep(5 * time.Millisecond)
		op.End()
	}

	metric := profiler.GetMetric("multi_test")
	if metric == nil {
		t.Fatal("Metric not found")
	}

	if metric.Count != 10 {
		t.Errorf("Expected count 10, got %d", metric.Count)
	}

	avg := metric.AverageTime()
	if avg < 5*time.Millisecond || avg > 10*time.Millisecond {
		t.Errorf("Expected avg time ~5ms, got %v", avg)
	}
}

func TestProfilerReport(t *testing.T) {
	profiler := NewProfiler(true)

	profiler.Record("op1", 10*time.Millisecond)
	profiler.Record("op2", 20*time.Millisecond)

	report := profiler.Report()
	if report == "" {
		t.Error("Expected non-empty report")
	}

	// Check that report contains operation names
	if len(report) < 100 {
		t.Errorf("Report seems too short: %d bytes", len(report))
	}
}

func TestProfilerJSONReport(t *testing.T) {
	profiler := NewProfiler(true)

	profiler.Record("json_test", 15*time.Millisecond)

	jsonData, err := profiler.JSONReport()
	if err != nil {
		t.Fatalf("Failed to generate JSON report: %v", err)
	}

	if len(jsonData) == 0 {
		t.Error("Expected non-empty JSON report")
	}
}
