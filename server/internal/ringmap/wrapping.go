package ringmap

import "fmt"

const (
	// RingCircumference is the circumference of the EarthRing in meters (264,000 km)
	RingCircumference = 264000000
	// ChunkLength is the length of each chunk in meters (1 km)
	ChunkLength = 1000
	// ChunkCount is the total number of chunks around the ring (264,000)
	ChunkCount = 264000
)

// WrapPosition wraps a ring position to the valid range [0, RingCircumference)
// Handles negative positions and positions beyond the ring circumference
func WrapPosition(position int64) int64 {
	// Use modulo arithmetic to wrap position
	// Add RingCircumference before modulo to handle negative values correctly
	wrapped := ((position % RingCircumference) + RingCircumference) % RingCircumference
	return wrapped
}

// PositionToChunkIndex converts a ring position to a chunk index, handling wrapping
// Returns chunk index in range [0, ChunkCount)
func PositionToChunkIndex(position int64) int {
	wrapped := WrapPosition(position)
	chunkIndex := int(wrapped / ChunkLength)
	// Ensure chunk index is within valid range (should be, but double-check)
	if chunkIndex >= ChunkCount {
		chunkIndex = chunkIndex % ChunkCount
	}
	return chunkIndex
}

// WrapChunkIndex wraps a chunk index to the valid range [0, ChunkCount)
// Handles negative indices and indices >= ChunkCount
func WrapChunkIndex(chunkIndex int) int {
	if chunkIndex < 0 {
		// Handle negative indices by wrapping around
		chunkIndex = ChunkCount + (chunkIndex % ChunkCount)
	}
	return chunkIndex % ChunkCount
}

// ChunkIndexToPositionRange returns the min and max ring positions for a chunk index
// Handles wrapping correctly
func ChunkIndexToPositionRange(chunkIndex int) (min, max int64) {
	wrappedIndex := WrapChunkIndex(chunkIndex)
	min = int64(wrappedIndex) * ChunkLength
	max = min + ChunkLength
	return min, max
}

// Distance calculates the shortest distance between two ring positions, accounting for wrapping
// Returns distance in meters
func Distance(pos1, pos2 int64) int64 {
	wrapped1 := WrapPosition(pos1)
	wrapped2 := WrapPosition(pos2)

	// Calculate direct distance
	direct := wrapped2 - wrapped1
	if direct < 0 {
		direct = -direct
	}

	// Calculate wrapped distance (going the other way around the ring)
	wrapped := RingCircumference - direct

	// Return the shorter distance
	if direct < wrapped {
		return direct
	}
	return wrapped
}

// ValidateChunkIndex validates and wraps a chunk index to valid range
// Returns wrapped chunk index and error if index cannot be wrapped
func ValidateChunkIndex(chunkIndex int) (int, error) {
	if chunkIndex < -ChunkCount || chunkIndex >= ChunkCount*2 {
		return 0, fmt.Errorf("chunk index %d is too far from valid range (0-%d)", chunkIndex, ChunkCount-1)
	}
	return WrapChunkIndex(chunkIndex), nil
}

// ValidatePosition validates and wraps a ring position to valid range
// Returns wrapped position (always valid)
func ValidatePosition(position int64) int64 {
	return WrapPosition(position)
}
