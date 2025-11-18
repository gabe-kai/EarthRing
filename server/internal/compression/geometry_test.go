package compression

import (
	"testing"

	"github.com/earthring/server/internal/procedural"
)

func TestCompressChunkGeometry(t *testing.T) {
	// Create a simple test geometry
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

	compressed, err := CompressChunkGeometry(geometry)
	if err != nil {
		t.Fatalf("CompressChunkGeometry failed: %v", err)
	}

	if len(compressed) == 0 {
		t.Fatal("Compressed data is empty")
	}

	// Verify compression ratio (should be smaller than uncompressed)
	// For this small geometry, compression might not help much, but it should still work
	t.Logf("Compressed size: %d bytes", len(compressed))
}

func TestCompressChunkGeometry_NilGeometry(t *testing.T) {
	_, err := CompressChunkGeometry(nil)
	if err == nil {
		t.Fatal("Expected error for nil geometry")
	}
}

func TestQuantizeVertices(t *testing.T) {
	vertices := [][]float64{
		{100.123, 200.456, 300.789},
		{1000.0, 400.0, 0.0},
	}

	quantized, err := quantizeVertices(vertices)
	if err != nil {
		t.Fatalf("quantizeVertices failed: %v", err)
	}

	if len(quantized) != len(vertices) {
		t.Fatalf("Expected %d quantized vertices, got %d", len(vertices), len(quantized))
	}

	// Verify quantization precision
	// X: 100.123 / 0.01 = 10012.3 -> 10012 (int32)
	expectedXFloat := float64(100.123) / QuantizationX
	expectedX := int32(expectedXFloat)
	if quantized[0].X != expectedX {
		t.Errorf("Expected X=%d, got %d", expectedX, quantized[0].X)
	}

	// Y: 200.456 / 0.001 = 200456 (int32)
	expectedYFloat := float64(200.456) / QuantizationY
	expectedY := int32(expectedYFloat)
	if quantized[0].Y != expectedY {
		t.Errorf("Expected Y=%d, got %d", expectedY, quantized[0].Y)
	}

	// Z: 300.789 / 0.01 = 30078.9 -> 30078 (int32)
	expectedZFloat := float64(300.789) / QuantizationZ
	expectedZ := int32(expectedZFloat)
	if quantized[0].Z != expectedZ {
		t.Errorf("Expected Z=%d, got %d", expectedZ, quantized[0].Z)
	}
}

func TestQuantizeVertices_InvalidVertex(t *testing.T) {
	vertices := [][]float64{
		{100.0, 200.0}, // Only 2 coordinates, need 3
	}

	_, err := quantizeVertices(vertices)
	if err == nil {
		t.Fatal("Expected error for invalid vertex")
	}
}
