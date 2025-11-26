package performance

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

// Profiler tracks performance metrics for various operations
type Profiler struct {
	mu       sync.RWMutex
	metrics  map[string]*Metric
	enabled  bool
	startTime time.Time
}

// Metric tracks statistics for a specific operation
type Metric struct {
	Name        string
	Count       int64
	TotalTime   time.Duration
	MinTime     time.Duration
	MaxTime     time.Duration
	LastTime    time.Duration
	LastCall    time.Time
	mu          sync.Mutex
}

// Operation represents a single timed operation
type Operation struct {
	profiler *Profiler
	name     string
	start    time.Time
}

// NewProfiler creates a new performance profiler
func NewProfiler(enabled bool) *Profiler {
	return &Profiler{
		metrics:  make(map[string]*Metric),
		enabled:  enabled,
		startTime: time.Now(),
	}
}

// Start begins timing an operation
func (p *Profiler) Start(name string) *Operation {
	if !p.enabled {
		return nil
	}
	return &Operation{
		profiler: p,
		name:     name,
		start:    time.Now(),
	}
}

// End completes timing an operation and records the metric
func (o *Operation) End() {
	if o == nil || !o.profiler.enabled {
		return
	}
	duration := time.Since(o.start)
	o.profiler.record(o.name, duration)
}

// Record directly records a duration for an operation
func (p *Profiler) Record(name string, duration time.Duration) {
	if !p.enabled {
		return
	}
	p.record(name, duration)
}

func (p *Profiler) record(name string, duration time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()

	metric, exists := p.metrics[name]
	if !exists {
		metric = &Metric{
			Name:    name,
			MinTime: duration,
			MaxTime: duration,
		}
		p.metrics[name] = metric
	}

	metric.mu.Lock()
	defer metric.mu.Unlock()

	metric.Count++
	metric.TotalTime += duration
	metric.LastTime = duration
	metric.LastCall = time.Now()

	if duration < metric.MinTime {
		metric.MinTime = duration
	}
	if duration > metric.MaxTime {
		metric.MaxTime = duration
	}
}

// GetMetric returns statistics for a specific operation
func (p *Profiler) GetMetric(name string) *Metric {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.metrics[name]
}

// GetMetrics returns all metrics
func (p *Profiler) GetMetrics() map[string]*Metric {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make(map[string]*Metric)
	for name, metric := range p.metrics {
		metric.mu.Lock()
		result[name] = &Metric{
			Name:      metric.Name,
			Count:     metric.Count,
			TotalTime: metric.TotalTime,
			MinTime:   metric.MinTime,
			MaxTime:   metric.MaxTime,
			LastTime:  metric.LastTime,
			LastCall:  metric.LastCall,
		}
		metric.mu.Unlock()
	}
	return result
}

// AverageTime returns the average time for a metric
func (m *Metric) AverageTime() time.Duration {
	if m.Count == 0 {
		return 0
	}
	return m.TotalTime / time.Duration(m.Count)
}

// Reset clears all metrics
func (p *Profiler) Reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.metrics = make(map[string]*Metric)
	p.startTime = time.Now()
}

// Report generates a human-readable performance report
func (p *Profiler) Report() string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if len(p.metrics) == 0 {
		return "No performance metrics recorded"
	}

	report := fmt.Sprintf("\n=== Performance Report (since %s) ===\n", p.startTime.Format(time.RFC3339))
	report += fmt.Sprintf("%-40s %10s %10s %10s %10s %10s\n", "Operation", "Count", "Avg", "Min", "Max", "Last")
	report += fmt.Sprintf("%s\n", "--------------------------------------------------------------------------------------------------------")

	for name, metric := range p.metrics {
		metric.mu.Lock()
		avg := metric.AverageTime()
		report += fmt.Sprintf("%-40s %10d %10s %10s %10s %10s\n",
			name,
			metric.Count,
			avg.Round(time.Millisecond),
			metric.MinTime.Round(time.Millisecond),
			metric.MaxTime.Round(time.Millisecond),
			metric.LastTime.Round(time.Millisecond),
		)
		metric.mu.Unlock()
	}

	report += fmt.Sprintf("\nTotal runtime: %s\n", time.Since(p.startTime).Round(time.Second))
	return report
}

// LogReport logs the performance report
func (p *Profiler) LogReport() {
	log.Print(p.Report())
}

// JSONReport generates a JSON performance report
func (p *Profiler) JSONReport() ([]byte, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	type MetricJSON struct {
		Name      string        `json:"name"`
		Count     int64         `json:"count"`
		TotalTime time.Duration `json:"total_time_ms"`
		AvgTime   time.Duration `json:"avg_time_ms"`
		MinTime   time.Duration `json:"min_time_ms"`
		MaxTime   time.Duration `json:"max_time_ms"`
		LastTime  time.Duration `json:"last_time_ms"`
		LastCall  time.Time     `json:"last_call"`
	}

	type ReportJSON struct {
		StartTime time.Time              `json:"start_time"`
		Runtime   time.Duration          `json:"runtime_ms"`
		Metrics   map[string]*MetricJSON `json:"metrics"`
	}

	report := ReportJSON{
		StartTime: p.startTime,
		Runtime:   time.Since(p.startTime),
		Metrics:   make(map[string]*MetricJSON),
	}

	for name, metric := range p.metrics {
		metric.mu.Lock()
		report.Metrics[name] = &MetricJSON{
			Name:      metric.Name,
			Count:     metric.Count,
			TotalTime: metric.TotalTime,
			AvgTime:   metric.AverageTime(),
			MinTime:   metric.MinTime,
			MaxTime:   metric.MaxTime,
			LastTime:  metric.LastTime,
			LastCall:  metric.LastCall,
		}
		metric.mu.Unlock()
	}

	return json.MarshalIndent(report, "", "  ")
}

// Enable enables profiling
func (p *Profiler) Enable() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.enabled = true
}

// Disable disables profiling
func (p *Profiler) Disable() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.enabled = false
}

// IsEnabled returns whether profiling is enabled
func (p *Profiler) IsEnabled() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.enabled
}

