package ringmap

import "testing"

func TestWrapPosition(t *testing.T) {
	tests := []struct {
		name     string
		input    int64
		expected int64
	}{
		{"zero", 0, 0},
		{"within range", 1000000, 1000000},
		{"at circumference", RingCircumference, 0},
		{"just over circumference", RingCircumference + 100, 100},
		{"double circumference", RingCircumference * 2, 0},
		{"negative", -100, RingCircumference - 100},
		{"negative large", -RingCircumference, 0},
		{"negative over circumference", -RingCircumference - 100, RingCircumference - 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := WrapPosition(tt.input)
			if result != tt.expected {
				t.Errorf("WrapPosition(%d) = %d, expected %d", tt.input, result, tt.expected)
			}
		})
	}
}

func TestPositionToChunkIndex(t *testing.T) {
	tests := []struct {
		name     string
		position int64
		expected int
	}{
		{"zero", 0, 0},
		{"first chunk", 500, 0},
		{"second chunk", 1500, 1},
		{"chunk 100", 100000, 100},
		{"last chunk start", int64(ChunkCount-1) * ChunkLength, ChunkCount - 1},
		{"wraps to zero", int64(ChunkCount) * ChunkLength, 0},
		{"negative wraps", -500, ChunkCount - 1},
		{"negative large", -RingCircumference, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := PositionToChunkIndex(tt.position)
			if result != tt.expected {
				t.Errorf("PositionToChunkIndex(%d) = %d, expected %d", tt.position, result, tt.expected)
			}
		})
	}
}

func TestWrapChunkIndex(t *testing.T) {
	tests := []struct {
		name     string
		input    int
		expected int
	}{
		{"zero", 0, 0},
		{"within range", 1000, 1000},
		{"at max", ChunkCount - 1, ChunkCount - 1},
		{"at max+1 wraps to zero", ChunkCount, 0},
		{"double wraps", ChunkCount * 2, 0},
		{"negative wraps", -1, ChunkCount - 1},
		{"negative large", -ChunkCount, 0},
		{"negative over", -ChunkCount - 1, ChunkCount - 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := WrapChunkIndex(tt.input)
			if result != tt.expected {
				t.Errorf("WrapChunkIndex(%d) = %d, expected %d", tt.input, result, tt.expected)
			}
		})
	}
}

func TestChunkIndexToPositionRange(t *testing.T) {
	tests := []struct {
		name        string
		chunkIndex  int
		expectedMin int64
		expectedMax int64
	}{
		{"zero", 0, 0, ChunkLength},
		{"chunk 100", 100, 100000, 101000},
		{"last chunk", ChunkCount - 1, int64(ChunkCount-1) * ChunkLength, int64(ChunkCount) * ChunkLength},
		{"wraps to zero", ChunkCount, 0, ChunkLength},
		{"negative wraps", -1, int64(ChunkCount-1) * ChunkLength, int64(ChunkCount) * ChunkLength},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			min, max := ChunkIndexToPositionRange(tt.chunkIndex)
			if min != tt.expectedMin || max != tt.expectedMax {
				t.Errorf("ChunkIndexToPositionRange(%d) = (%d, %d), expected (%d, %d)",
					tt.chunkIndex, min, max, tt.expectedMin, tt.expectedMax)
			}
		})
	}
}

func TestDistance(t *testing.T) {
	tests := []struct {
		name     string
		pos1     int64
		pos2     int64
		expected int64
	}{
		{"same position", 1000, 1000, 0},
		{"close positions", 1000, 2000, 1000},
		{"wrapped shorter", 1000, RingCircumference - 1000, 2000},                        // Wrapped path is shorter
		{"wrapped longer", RingCircumference/2 - 1000, RingCircumference/2 + 1000, 2000}, // Direct path is shorter
		{"at boundaries", 0, RingCircumference - 1, 1},                                   // Wrapped path is shorter
		{"negative positions", -1000, 1000, 2000},
		{"both negative", -2000, -1000, 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Distance(tt.pos1, tt.pos2)
			if result != tt.expected {
				t.Errorf("Distance(%d, %d) = %d, expected %d", tt.pos1, tt.pos2, result, tt.expected)
			}
		})
	}
}

func TestValidateChunkIndex(t *testing.T) {
	tests := []struct {
		name        string
		input       int
		expected    int
		expectError bool
	}{
		{"valid zero", 0, 0, false},
		{"valid max", ChunkCount - 1, ChunkCount - 1, false},
		{"wraps to zero", ChunkCount, 0, false},
		{"negative wraps", -1, ChunkCount - 1, false},
		{"too large", ChunkCount * 2, 0, true},
		{"too negative", -ChunkCount - 1, 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ValidateChunkIndex(tt.input)
			if tt.expectError {
				if err == nil {
					t.Errorf("ValidateChunkIndex(%d) expected error, got nil", tt.input)
				}
			} else {
				if err != nil {
					t.Errorf("ValidateChunkIndex(%d) unexpected error: %v", tt.input, err)
				}
				if result != tt.expected {
					t.Errorf("ValidateChunkIndex(%d) = %d, expected %d", tt.input, result, tt.expected)
				}
			}
		})
	}
}

func TestValidatePosition(t *testing.T) {
	tests := []struct {
		name     string
		input    int64
		expected int64
	}{
		{"zero", 0, 0},
		{"within range", 1000000, 1000000},
		{"wraps", RingCircumference + 100, 100},
		{"negative wraps", -100, RingCircumference - 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidatePosition(tt.input)
			if result != tt.expected {
				t.Errorf("ValidatePosition(%d) = %d, expected %d", tt.input, result, tt.expected)
			}
		})
	}
}
