# Compression Package

This package provides chunk geometry compression and decompression functionality for the EarthRing server.

## Overview

The compression system uses a custom binary format with gzip compression to reduce network bandwidth and improve chunk loading performance. Geometry is compressed on the server and automatically decompressed on the client.

## Features

- **Custom Binary Format**: Optimized for chunk geometry data
- **Vertex Quantization**: Reduces precision to save space (1cm for X/Z, 1mm for Y)
- **Relative X Encoding**: Prevents integer overflow for chunks far from origin
- **Gzip Compression**: Level 6 (balance between size and speed)
- **Compression Ratios**: 2.6:1 to 3.1:1 (achieved in production)
- **Performance**: <3ms decompression time per chunk (client-side)

## Binary Format

**Header (24 bytes)**:
- Magic number: 4 bytes ("CHNK")
- Version: 1 byte
- Format flags: 1 byte (index size, etc.)
- Vertex count: 2 bytes
- Index count: 2 bytes
- Base X: 8 bytes (int64, quantized) - base X coordinate for relative positions

**Vertex Data**:
- Quantized positions (X relative to Base X, Y, Z)
- Each vertex: 12 bytes (3 × int32)

**Index Data**:
- Triangle indices (16-bit or 32-bit based on vertex count)

## Usage

### Server-Side Compression

```go
import "github.com/earthring/server/internal/compression"

// Compress geometry
compressed, err := compression.CompressChunkGeometry(geometry)
if err != nil {
    // Handle error
}

// Format for transmission
formatted, err := compression.FormatCompressedGeometry(compressed, uncompressedSize)
if err != nil {
    // Handle error
}
```

### Client-Side Decompression

The client automatically detects and decompresses compressed geometry. See `client-web/src/utils/decompression.js` for implementation details.

## Implementation Details

### Integer Overflow Prevention

Large X coordinates (e.g., chunk 263996 at position 263,996,000m) would overflow int32 when quantized. The solution:

1. **Relative X Encoding**: Store X coordinates relative to the first vertex's X position
2. **Base X Storage**: Store the base X (int64) in the header
3. **Decompression**: Add base X back to restore absolute positions

This ensures all relative X values are small (within a chunk's 1000m range), preventing overflow.

## Testing

Run tests:
```bash
go test ./internal/compression -v
```

Test coverage includes:
- Compression and decompression round-trip
- Quantization accuracy
- Format encoding/decoding
- Edge cases (nil geometry, invalid data)

## Performance

**Compression Ratios** (measured):
- Small chunks (4 vertices): ~2.6:1 to 2.9:1
- Standard chunks: ~2.6:1 to 3.1:1

**Decompression Performance** (client-side):
- Average: <3ms per chunk
- Measured on modern hardware with real chunk data

## Future Enhancements

- Delta encoding for smoother surfaces
- Mesh optimization (duplicate vertex removal)
- LOD-specific compression levels
- Metadata compression (MessagePack + gzip) - deferred (metadata currently small)

