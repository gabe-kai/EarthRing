package procedural

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/earthring/server/internal/config"
)

// ProceduralClient handles communication with the Python procedural generation service
type ProceduralClient struct {
	baseURL    string
	timeout    time.Duration
	retryCount int
	client     *http.Client
}

// NewProceduralClient creates a new procedural service client
func NewProceduralClient(cfg *config.Config) *ProceduralClient {
	return &ProceduralClient{
		baseURL:    cfg.Procedural.BaseURL,
		timeout:    cfg.Procedural.Timeout,
		retryCount: cfg.Procedural.RetryCount,
		client: &http.Client{
			Timeout: cfg.Procedural.Timeout,
		},
	}
}

// GenerateChunkRequest represents a request to generate a chunk
type GenerateChunkRequest struct {
	Floor      int    `json:"floor"`
	ChunkIndex int    `json:"chunk_index"`
	LODLevel   string `json:"lod_level"`
	WorldSeed  *int   `json:"world_seed,omitempty"`
}

// ChunkGeometry represents chunk geometry data (Phase 2: ring floor geometry)
type ChunkGeometry struct {
	Type     string      `json:"type"`     // e.g., "ring_floor"
	Vertices [][]float64 `json:"vertices"` // Array of [x, y, z] vertices
	Faces    [][]int     `json:"faces"`    // Array of [v1, v2, v3] face indices
	Normals  [][]float64 `json:"normals"`  // Array of [nx, ny, nz] normals
	Width    float64     `json:"width"`    // Chunk width in meters
	Length   float64     `json:"length"`   // Chunk length in meters
}

// VersionMetadata represents version metadata for granular version checking
type VersionMetadata struct {
	GeometryVersion int      `json:"geometry_version"`
	SampleInterval  *float64 `json:"sample_interval,omitempty"`
	Algorithm       *string  `json:"algorithm,omitempty"`
	VertexCount     *int     `json:"vertex_count,omitempty"`
	FaceCount       *int     `json:"face_count,omitempty"`
}

// ChunkMetadata represents chunk metadata
type ChunkMetadata struct {
	ChunkID         string           `json:"chunk_id"`
	Floor           int              `json:"floor"`
	ChunkIndex      int              `json:"chunk_index"`
	Width           float64          `json:"width"`
	Version         int              `json:"version"`
	VersionMetadata *VersionMetadata `json:"version_metadata,omitempty"`
}

// GenerateChunkResponse represents the response from chunk generation
type GenerateChunkResponse struct {
	Success    bool           `json:"success"`
	Chunk      ChunkMetadata  `json:"chunk"`
	Geometry   *ChunkGeometry `json:"geometry,omitempty"`
	Structures []interface{}  `json:"structures"`
	Zones      []interface{}  `json:"zones"`
	Message    *string        `json:"message,omitempty"`
}

// HealthResponse represents a health check response
type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Version string `json:"version"`
}

// HealthCheck checks if the procedural service is healthy
func (c *ProceduralClient) HealthCheck() error {
	url := fmt.Sprintf("%s/health", c.baseURL)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create health check request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("health check request failed: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("Warning: failed to close procedural health response body: %v", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed with status %d", resp.StatusCode)
	}

	var health HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return fmt.Errorf("failed to decode health response: %w", err)
	}

	if health.Status != "ok" {
		return fmt.Errorf("service reported unhealthy status: %s", health.Status)
	}

	return nil
}

// GenerateChunk requests chunk generation from the procedural service
func (c *ProceduralClient) GenerateChunk(floor, chunkIndex int, lodLevel string, worldSeed *int) (*GenerateChunkResponse, error) {
	url := fmt.Sprintf("%s/api/v1/chunks/generate", c.baseURL)

	request := GenerateChunkRequest{
		Floor:      floor,
		ChunkIndex: chunkIndex,
		LODLevel:   lodLevel,
		WorldSeed:  worldSeed,
	}

	body, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt <= c.retryCount; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 100ms, 200ms, 400ms
			backoff := time.Duration(100*(1<<uint(attempt-1))) * time.Millisecond
			time.Sleep(backoff)
		}

		req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
		if err != nil {
			lastErr = fmt.Errorf("failed to create request: %w", err)
			continue
		}

		req.Header.Set("Content-Type", "application/json")

		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			continue
		}

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			if closeErr := resp.Body.Close(); closeErr != nil {
				log.Printf("Warning: failed to close procedural response body: %v", closeErr)
			}
			continue
		}

		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("Warning: failed to close procedural response body: %v", closeErr)
		}

		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("generation failed with status %d: %s", resp.StatusCode, string(respBody))
			continue
		}

		var response GenerateChunkResponse
		if err := json.Unmarshal(respBody, &response); err != nil {
			lastErr = fmt.Errorf("failed to decode response: %w", err)
			continue
		}

		if !response.Success {
			lastErr = fmt.Errorf("generation failed: %v", response.Message)
			continue
		}

		return &response, nil
	}

	return nil, fmt.Errorf("generation failed after %d attempts: %w", c.retryCount+1, lastErr)
}
