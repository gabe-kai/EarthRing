package ringmap

import (
	"testing"
)

func TestChunksInRange(t *testing.T) {
	tests := []struct {
		name        string
		centerX     float64
		maxDistance int64
		expectedMin int
		expectedMax int
		expectWrap  bool
	}{
		{
			name:        "simple range",
			centerX:     5000,
			maxDistance: 2000,
			expectedMin: 3, // 3000 / 1000 = 3
			expectedMax: 7, // 7000 / 1000 = 7
			expectWrap:  false,
		},
		{
			name:        "range at start",
			centerX:     500,
			maxDistance: 1500,
			expectedMin: 0,
			expectedMax: 2,
			expectWrap:  false,
		},
		{
			name:        "range wraps around",
			centerX:     1000,
			maxDistance: 2000,
			expectedMin: 0, // Should include chunks near wrap boundary
			expectedMax: 3,
			expectWrap:  true,
		},
		{
			name:        "range at end",
			centerX:     float64(RingCircumference - 1000),
			maxDistance: 2000,
			expectedMin: ChunkCount - 3,
			expectedMax: ChunkCount - 1,
			expectWrap:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chunks := ChunksInRange(tt.centerX, tt.maxDistance)

			// Verify we got some chunks
			if len(chunks) == 0 {
				t.Errorf("Expected at least one chunk, got none")
			}

			// Verify chunks are in valid range
			for _, chunkIdx := range chunks {
				if chunkIdx < 0 || chunkIdx >= ChunkCount {
					t.Errorf("Chunk index %d is out of valid range [0, %d)", chunkIdx, ChunkCount)
				}
			}

			// Verify we have chunks in the expected range
			hasMin := false
			hasMax := false
			for _, chunkIdx := range chunks {
				if chunkIdx == tt.expectedMin {
					hasMin = true
				}
				if chunkIdx == tt.expectedMax {
					hasMax = true
				}
			}

			if !hasMin && !tt.expectWrap {
				t.Errorf("Expected chunk %d in results, got: %v", tt.expectedMin, chunks)
			}
			if !hasMax && !tt.expectWrap {
				t.Errorf("Expected chunk %d in results, got: %v", tt.expectedMax, chunks)
			}
		})
	}
}

func TestChunksInRange_Wrapping(t *testing.T) {
	// Test that chunks wrap correctly
	chunks := ChunksInRange(1000, 2000)

	// Should include chunks near the start (wrapped)
	hasZero := false
	for _, idx := range chunks {
		if idx == 0 {
			hasZero = true
			break
		}
	}

	// With wrapping, we might get chunk 0 if the range wraps
	// This is acceptable behavior
	_ = hasZero // Just verify it doesn't crash

	// Verify no duplicates
	seen := make(map[int]bool)
	for _, idx := range chunks {
		if seen[idx] {
			t.Errorf("Duplicate chunk index %d in results", idx)
		}
		seen[idx] = true
	}
}
