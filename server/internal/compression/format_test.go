package compression

import (
	"testing"

	"github.com/earthring/server/internal/procedural"
)

func TestFormatCompressedGeometry(t *testing.T) {
	// Create test compressed data
	compressedData := []byte{1, 2, 3, 4, 5}
	uncompressedSize := 100

	formatted, err := FormatCompressedGeometry(compressedData, uncompressedSize)
	if err != nil {
		t.Fatalf("FormatCompressedGeometry failed: %v", err)
	}

	if formatted.Format != "binary_gzip" {
		t.Errorf("Expected format 'binary_gzip', got '%s'", formatted.Format)
	}

	if formatted.Size != len(compressedData) {
		t.Errorf("Expected size %d, got %d", len(compressedData), formatted.Size)
	}

	if formatted.UncompressedSize != uncompressedSize {
		t.Errorf("Expected uncompressed size %d, got %d", uncompressedSize, formatted.UncompressedSize)
	}

	if len(formatted.Data) == 0 {
		t.Fatal("Base64 data is empty")
	}
}

func TestEstimateUncompressedSize(t *testing.T) {
	geometry := &procedural.ChunkGeometry{
		Type: "ring_floor",
		Vertices: [][]float64{
			{0.0, 0.0, 0.0},
			{1000.0, 0.0, 0.0},
			{1000.0, 400.0, 0.0},
			{0.0, 400.0, 0.0},
		},
		Faces: [][]int{
			{0, 1, 2},
			{0, 2, 3},
		},
		Normals: [][]float64{
			{0.0, 0.0, 1.0},
			{0.0, 0.0, 1.0},
			{0.0, 0.0, 1.0},
			{0.0, 0.0, 1.0},
		},
		Width:  400.0,
		Length: 1000.0,
	}

	size := EstimateUncompressedSize(geometry)
	if size == 0 {
		t.Fatal("Estimated size should be greater than 0")
	}

	// Verify the estimate is reasonable
	// 4 vertices * 3 floats * 8 bytes = 96 bytes
	// 2 faces * 3 ints * 4 bytes = 24 bytes
	// 4 normals * 3 floats * 8 bytes = 96 bytes
	// Total: ~216 bytes + overhead
	expectedMin := 200
	expectedMax := 500 // Allow for overhead

	if size < expectedMin || size > expectedMax {
		t.Errorf("Estimated size %d is outside expected range [%d, %d]", size, expectedMin, expectedMax)
	}
}

func TestEstimateUncompressedSize_NilGeometry(t *testing.T) {
	size := EstimateUncompressedSize(nil)
	if size != 0 {
		t.Errorf("Expected size 0 for nil geometry, got %d", size)
	}
}

func TestCompressAndFormatRoundTrip(t *testing.T) {
	// Create test geometry
	geometry := &procedural.ChunkGeometry{
		Type: "ring_floor",
		Vertices: [][]float64{
			{0.0, 0.0, 0.0},
			{1000.0, 0.0, 0.0},
			{1000.0, 400.0, 0.0},
			{0.0, 400.0, 0.0},
		},
		Faces: [][]int{
			{0, 1, 2},
			{0, 2, 3},
		},
		Normals: [][]float64{
			{0.0, 0.0, 1.0},
			{0.0, 0.0, 1.0},
			{0.0, 0.0, 1.0},
			{0.0, 0.0, 1.0},
		},
		Width:  400.0,
		Length: 1000.0,
	}

	// Compress
	compressed, err := CompressChunkGeometry(geometry)
	if err != nil {
		t.Fatalf("CompressChunkGeometry failed: %v", err)
	}

	// Estimate size
	uncompressedSize := EstimateUncompressedSize(geometry)

	// Format for transmission
	formatted, err := FormatCompressedGeometry(compressed, uncompressedSize)
	if err != nil {
		t.Fatalf("FormatCompressedGeometry failed: %v", err)
	}

	// Verify compression ratio
	compressionRatio := float64(uncompressedSize) / float64(formatted.Size)
	t.Logf("Compression ratio: %.2f:1 (uncompressed: %d bytes, compressed: %d bytes)", 
		compressionRatio, uncompressedSize, formatted.Size)

	// For small geometries, compression might not be great, but should still work
	if formatted.Size == 0 {
		t.Fatal("Compressed size should be greater than 0")
	}

	// Verify format
	if formatted.Format != "binary_gzip" {
		t.Errorf("Expected format 'binary_gzip', got '%s'", formatted.Format)
	}
}

