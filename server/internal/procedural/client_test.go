package procedural

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/earthring/server/internal/config"
)

func TestNewProceduralClient(t *testing.T) {
	cfg := &config.Config{
		Procedural: config.ProceduralConfig{
			BaseURL:    "http://localhost:8081",
			Timeout:    30 * time.Second,
			RetryCount: 3,
		},
	}

	client := NewProceduralClient(cfg)
	if client == nil {
		t.Fatal("NewProceduralClient returned nil")
	}

	if client.baseURL != "http://localhost:8081" {
		t.Errorf("Expected baseURL http://localhost:8081, got %s", client.baseURL)
	}

	if client.timeout != 30*time.Second {
		t.Errorf("Expected timeout 30s, got %v", client.timeout)
	}

	if client.retryCount != 3 {
		t.Errorf("Expected retryCount 3, got %d", client.retryCount)
	}
}

func TestProceduralClient_HealthCheck(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("Expected path /health, got %s", r.URL.Path)
		}

		response := HealthResponse{
			Status:  "ok",
			Service: "earthring-procedural-service",
			Version: "0.1.0",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		Procedural: config.ProceduralConfig{
			BaseURL:    server.URL,
			Timeout:    5 * time.Second,
			RetryCount: 0,
		},
	}

	client := NewProceduralClient(cfg)
	err := client.HealthCheck()
	if err != nil {
		t.Errorf("HealthCheck failed: %v", err)
	}
}

func TestProceduralClient_HealthCheck_Unhealthy(t *testing.T) {
	// Create mock server that returns unhealthy status
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := HealthResponse{
			Status:  "error",
			Service: "earthring-procedural-service",
			Version: "0.1.0",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		Procedural: config.ProceduralConfig{
			BaseURL:    server.URL,
			Timeout:    5 * time.Second,
			RetryCount: 0,
		},
	}

	client := NewProceduralClient(cfg)
	err := client.HealthCheck()
	if err == nil {
		t.Error("Expected error for unhealthy service, got nil")
	}
}

func TestProceduralClient_GenerateChunk(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/chunks/generate" {
			t.Errorf("Expected path /api/v1/chunks/generate, got %s", r.URL.Path)
		}

		if r.Method != "POST" {
			t.Errorf("Expected method POST, got %s", r.Method)
		}

		// Parse request
		var req GenerateChunkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("Failed to decode request: %v", err)
		}

		response := GenerateChunkResponse{
			Success: true,
			Chunk: ChunkMetadata{
				ChunkID:    "0_12345",
				Floor:      0,
				ChunkIndex: 12345,
				Width:      400.0,
				Version:    1,
			},
			Geometry:   nil,
			Structures: []interface{}{},
			Zones:      []interface{}{},
			Message:    stringPtr("Empty chunk generated"),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		Procedural: config.ProceduralConfig{
			BaseURL:    server.URL,
			Timeout:    5 * time.Second,
			RetryCount: 0,
		},
	}

	client := NewProceduralClient(cfg)
	response, err := client.GenerateChunk(0, 12345, "medium", nil)
	if err != nil {
		t.Fatalf("GenerateChunk failed: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}

	if response.Chunk.ChunkID != "0_12345" {
		t.Errorf("Expected chunk ID 0_12345, got %s", response.Chunk.ChunkID)
	}

	if response.Chunk.Width != 400.0 {
		t.Errorf("Expected width 400.0, got %f", response.Chunk.Width)
	}
}

func TestProceduralClient_GenerateChunk_Retry(t *testing.T) {
	attempts := 0

	// Create mock server that fails first two times, succeeds on third
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		response := GenerateChunkResponse{
			Success: true,
			Chunk: ChunkMetadata{
				ChunkID:    "0_100",
				Floor:      0,
				ChunkIndex: 100,
				Width:      400.0,
				Version:    1,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		Procedural: config.ProceduralConfig{
			BaseURL:    server.URL,
			Timeout:    5 * time.Second,
			RetryCount: 3,
		},
	}

	client := NewProceduralClient(cfg)
	response, err := client.GenerateChunk(0, 100, "medium", nil)
	if err != nil {
		t.Fatalf("GenerateChunk failed after retries: %v", err)
	}

	if !response.Success {
		t.Error("Expected success=true")
	}

	if attempts != 3 {
		t.Errorf("Expected 3 attempts, got %d", attempts)
	}
}

// Helper function
func stringPtr(s string) *string {
	return &s
}
