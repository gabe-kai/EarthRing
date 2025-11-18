package compression

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"

	"github.com/earthring/server/internal/procedural"
)

const (
	// Magic number for chunk geometry format
	GeometryMagic = "CHNK"
	// Current format version
	GeometryVersion = 1
	// Gzip compression level (balance between size and speed)
	DefaultGzipLevel = 6
)

// Quantization precision (in meters)
const (
	QuantizationX = 0.01  // 1cm precision for ring position
	QuantizationY = 0.001 // 1mm precision for width
	QuantizationZ = 0.01  // 1cm precision for height/elevation
)

// GeometryHeader represents the binary format header
type GeometryHeader struct {
	Magic      [4]byte // "CHNK"
	Version    uint8
	FormatFlags uint8  // Bit flags: bit 0 = index size (0=16-bit, 1=32-bit)
	VertexCount uint16 // Or uint32 if >65k (handled separately)
	IndexCount  uint16 // Or uint32 if >65k (handled separately)
	BaseX      int64   // Base X coordinate (quantized) - added to all relative X values during decompression (int64 to handle large positions)
}

// QuantizedVertex represents a quantized vertex
type QuantizedVertex struct {
	X, Y, Z int32 // Quantized positions
	// Note: Normals and UVs would go here in full implementation
}

// CompressChunkGeometry compresses chunk geometry using the specified format
func CompressChunkGeometry(geometry *procedural.ChunkGeometry) ([]byte, error) {
	if geometry == nil {
		return nil, fmt.Errorf("geometry is nil")
	}

	// 1. Convert vertices to relative positions (relative to first vertex's X position)
	// This prevents integer overflow for large X coordinates (chunks far from origin)
	relativeVertices := make([][]float64, len(geometry.Vertices))
	if len(geometry.Vertices) > 0 && len(geometry.Vertices[0]) > 0 {
		baseX := geometry.Vertices[0][0]
		for i, vertex := range geometry.Vertices {
			relativeVertices[i] = make([]float64, len(vertex))
			copy(relativeVertices[i], vertex)
			relativeVertices[i][0] = vertex[0] - baseX // Make X relative to first vertex
		}
	} else {
		relativeVertices = geometry.Vertices
	}

	// 2. Quantize vertices (now with relative X positions)
	quantizedVertices, err := quantizeVertices(relativeVertices)
	if err != nil {
		return nil, fmt.Errorf("failed to quantize vertices: %w", err)
	}
	
	// Store base X for decompression (quantized)
	// Use int64 to handle large positions (chunks far from origin)
	var baseXQuantized int64
	if len(geometry.Vertices) > 0 && len(geometry.Vertices[0]) > 0 {
		baseXQuantized = int64(geometry.Vertices[0][0] / QuantizationX)
	}

	// 3. Determine index size (16-bit if <65k vertices, 32-bit otherwise)
	use32BitIndices := len(geometry.Faces)*3 >= 65536

	// 4. Encode to binary format (pass baseXQuantized for storage in header)
	binaryData, err := encodeToBinary(quantizedVertices, geometry.Faces, use32BitIndices, baseXQuantized)
	if err != nil {
		return nil, fmt.Errorf("failed to encode to binary: %w", err)
	}

	// 5. Compress with gzip
	compressed, err := gzipCompress(binaryData, DefaultGzipLevel)
	if err != nil {
		return nil, fmt.Errorf("failed to compress with gzip: %w", err)
	}

	return compressed, nil
}

// quantizeVertices quantizes vertex positions to reduce precision
func quantizeVertices(vertices [][]float64) ([]QuantizedVertex, error) {
	quantized := make([]QuantizedVertex, len(vertices))
	
	for i, vertex := range vertices {
		if len(vertex) < 3 {
			return nil, fmt.Errorf("vertex %d has insufficient coordinates", i)
		}

		quantized[i] = QuantizedVertex{
			X: int32(vertex[0] / QuantizationX),
			Y: int32(vertex[1] / QuantizationY),
			Z: int32(vertex[2] / QuantizationZ),
		}
	}

	return quantized, nil
}

// encodeToBinary encodes quantized vertices and faces to binary format
func encodeToBinary(vertices []QuantizedVertex, faces [][]int, use32BitIndices bool, baseX int64) ([]byte, error) {
	var buf bytes.Buffer

	// Write header
	header := GeometryHeader{
		Version: GeometryVersion,
		BaseX:   baseX,
	}
	copy(header.Magic[:], GeometryMagic)
	
	vertexCount := uint16(len(vertices))
	if len(vertices) >= 65536 {
		// For now, we'll use 16-bit and handle overflow separately if needed
		// In production, we'd use a variable-length encoding
		vertexCount = 65535
	}
	header.VertexCount = vertexCount

	indexCount := uint16(len(faces) * 3)
	if len(faces)*3 >= 65536 {
		indexCount = 65535
	}
	header.IndexCount = indexCount

	// Set format flags
	if use32BitIndices {
		header.FormatFlags |= 0x01 // Bit 0 = 32-bit indices
	}

	if err := binary.Write(&buf, binary.LittleEndian, header); err != nil {
		return nil, fmt.Errorf("failed to write header: %w", err)
	}

	// Write vertices
	for _, vertex := range vertices {
		if err := binary.Write(&buf, binary.LittleEndian, vertex.X); err != nil {
			return nil, fmt.Errorf("failed to write vertex X: %w", err)
		}
		if err := binary.Write(&buf, binary.LittleEndian, vertex.Y); err != nil {
			return nil, fmt.Errorf("failed to write vertex Y: %w", err)
		}
		if err := binary.Write(&buf, binary.LittleEndian, vertex.Z); err != nil {
			return nil, fmt.Errorf("failed to write vertex Z: %w", err)
		}
	}

	// Write indices
	for _, face := range faces {
		if len(face) < 3 {
			return nil, fmt.Errorf("face has insufficient indices")
		}

		if use32BitIndices {
			// Write 32-bit indices
			for _, idx := range face {
				if err := binary.Write(&buf, binary.LittleEndian, uint32(idx)); err != nil {
					return nil, fmt.Errorf("failed to write 32-bit index: %w", err)
				}
			}
		} else {
			// Write 16-bit indices
			for _, idx := range face {
				if idx >= 65536 {
					return nil, fmt.Errorf("index %d exceeds 16-bit limit", idx)
				}
				if err := binary.Write(&buf, binary.LittleEndian, uint16(idx)); err != nil {
					return nil, fmt.Errorf("failed to write 16-bit index: %w", err)
				}
			}
		}
	}

	return buf.Bytes(), nil
}

// gzipCompress compresses data using gzip
func gzipCompress(data []byte, level int) ([]byte, error) {
	var buf bytes.Buffer
	
	writer, err := gzip.NewWriterLevel(&buf, level)
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip writer: %w", err)
	}

	if _, err := writer.Write(data); err != nil {
		writer.Close()
		return nil, fmt.Errorf("failed to write to gzip: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip writer: %w", err)
	}

	return buf.Bytes(), nil
}

