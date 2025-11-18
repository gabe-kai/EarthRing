package compression

import (
	"encoding/base64"

	"github.com/earthring/server/internal/procedural"
)

// CompressedGeometry represents compressed geometry data ready for transmission
type CompressedGeometry struct {
	Format           string `json:"format"`            // "binary_gzip"
	Data             string `json:"data"`              // Base64-encoded compressed data
	Size             int    `json:"size"`              // Compressed size in bytes
	UncompressedSize int    `json:"uncompressed_size"` // Uncompressed size in bytes (for progress tracking)
}

// FormatCompressedGeometry formats compressed geometry data for JSON transmission
func FormatCompressedGeometry(compressedData []byte, uncompressedSize int) (*CompressedGeometry, error) {
	// Encode to base64 for JSON transmission
	base64Data := base64.StdEncoding.EncodeToString(compressedData)

	return &CompressedGeometry{
		Format:           "binary_gzip",
		Data:             base64Data,
		Size:             len(compressedData),
		UncompressedSize: uncompressedSize,
	}, nil
}

// CompressAndFormatGeometry compresses geometry and formats it for transmission
func CompressAndFormatGeometry(geometry interface{}) (interface{}, error) {
	// For now, we'll handle the case where geometry might be nil or not the right type
	// In the future, we can add type checking and conversion

	// If geometry is nil, return nil (no compression needed)
	if geometry == nil {
		return nil, nil
	}

	// Try to convert to ChunkGeometry type
	// This is a simplified version - in production we'd have better type handling
	// For now, we'll return the geometry as-is and add compression in the WebSocket handler
	// where we have better type information

	return geometry, nil
}

// EstimateUncompressedSize estimates the uncompressed size of geometry data
func EstimateUncompressedSize(geometry *procedural.ChunkGeometry) int {
	if geometry == nil {
		return 0
	}

	// Estimate based on actual data structure:
	// - Each vertex: 3 floats (x, y, z) = 12 bytes
	// - Each face: 3 ints = 12 bytes (assuming 32-bit)
	// - Each normal: 3 floats = 12 bytes
	// - Plus overhead for structure

	vertexSize := len(geometry.Vertices) * 3 * 8 // 3 floats * 8 bytes per float64
	faceSize := len(geometry.Faces) * 3 * 4      // 3 ints * 4 bytes per int
	normalSize := len(geometry.Normals) * 3 * 8  // 3 floats * 8 bytes per float64

	// Add overhead for JSON structure (approximately 10% for small objects, less for large)
	baseSize := vertexSize + faceSize + normalSize
	overhead := baseSize / 10 // 10% overhead

	return baseSize + overhead
}
