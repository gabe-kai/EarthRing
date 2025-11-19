package ringmap

import (
	"database/sql"
	"fmt"
)

// SpatialQuery provides utilities for spatial queries on the ring
type SpatialQuery struct {
	db *sql.DB
}

// NewSpatialQuery creates a new spatial query utility
func NewSpatialQuery(db *sql.DB) *SpatialQuery {
	return &SpatialQuery{db: db}
}

// RingPosition represents a 2D position on the ring
// Note: This is separate from api.Position to avoid circular dependencies
type RingPosition struct {
	X float64 `json:"x"` // Ring position (0 to 264,000,000 meters)
	Y float64 `json:"y"` // Width position
}

// NearbyPlayersResult represents a player found in a spatial query
type NearbyPlayersResult struct {
	PlayerID int64        `json:"player_id"`
	Username string       `json:"username"`
	Position RingPosition `json:"position"`
	Floor    int          `json:"floor"`
	Distance int64        `json:"distance"` // Distance in meters
}

// FindNearbyPlayers finds players within a specified distance of a position
// Accounts for ring wrapping when calculating distances
func (sq *SpatialQuery) FindNearbyPlayers(centerX, centerY float64, floor int, maxDistance int64) ([]NearbyPlayersResult, error) {
	// Wrap center position to ensure it's valid
	wrappedCenterX := ValidatePosition(int64(centerX))

	// Query players on the same floor within a reasonable bounding box
	// We'll use a simple bounding box first, then filter by actual distance
	// This is a simplified approach - for production, consider using PostGIS spatial queries
	query := `
		SELECT id, username,
		       CASE WHEN current_position IS NULL THEN NULL ELSE ST_X(current_position::geometry) END as pos_x,
		       CASE WHEN current_position IS NULL THEN NULL ELSE ST_Y(current_position::geometry) END as pos_y,
		       current_floor
		FROM players
		WHERE current_floor = $1
		  AND current_position IS NOT NULL
	`
	rows, err := sq.db.Query(query, floor)
	if err != nil {
		return nil, fmt.Errorf("failed to query nearby players: %w", err)
	}
	defer func() {
		_ = rows.Close() // Ignore close error - rows close errors are typically non-critical
	}()

	var results []NearbyPlayersResult
	for rows.Next() {
		var playerID int64
		var username string
		var posX, posY sql.NullFloat64
		var playerFloor int

		if err := rows.Scan(&playerID, &username, &posX, &posY, &playerFloor); err != nil {
			continue
		}

		if !posX.Valid || !posY.Valid {
			continue
		}

		// Calculate distance accounting for ring wrapping
		playerX := int64(posX.Float64)
		distance := Distance(wrappedCenterX, playerX)

		// Also check Y distance (simple Euclidean for width)
		yDistance := int64(abs(posY.Float64 - centerY))
		totalDistance := distance + yDistance // Simplified: ring distance + width distance

		// Filter by max distance
		if totalDistance <= maxDistance {
			results = append(results, NearbyPlayersResult{
				PlayerID: playerID,
				Username: username,
				Position: RingPosition{
					X: posX.Float64,
					Y: posY.Float64,
				},
				Floor:    playerFloor,
				Distance: totalDistance,
			})
		}
	}

	return results, nil
}

// ChunksInRange finds chunk indices within a specified distance of a position
// Returns chunk indices that overlap with the range
func ChunksInRange(centerX float64, maxDistance int64) []int {
	wrappedCenterX := ValidatePosition(int64(centerX))
	var chunkIndices []int

	// Calculate range boundaries
	minX := wrappedCenterX - maxDistance
	maxX := wrappedCenterX + maxDistance

	// Handle wrapping
	if minX < 0 {
		// Range wraps around the ring
		// Add chunks from wrapped position to end
		wrappedMinX := RingCircumference + minX
		for i := PositionToChunkIndex(wrappedMinX); i < ChunkCount; i++ {
			chunkIndices = append(chunkIndices, i)
		}
		// Add chunks from start to maxX
		minX = 0
	}
	if maxX >= RingCircumference {
		// Range wraps around the ring
		// Add chunks from start to wrapped position
		wrappedMaxX := maxX - RingCircumference
		for i := 0; i <= PositionToChunkIndex(wrappedMaxX); i++ {
			chunkIndices = append(chunkIndices, i)
		}
		// Add chunks from minX to end
		maxX = RingCircumference - 1
	}

	// Add chunks in the main range
	minChunk := PositionToChunkIndex(minX)
	maxChunk := PositionToChunkIndex(maxX)
	for i := minChunk; i <= maxChunk; i++ {
		chunkIndices = append(chunkIndices, i)
	}

	// Remove duplicates (could happen if range wraps)
	seen := make(map[int]bool)
	var unique []int
	for _, idx := range chunkIndices {
		if !seen[idx] {
			seen[idx] = true
			unique = append(unique, idx)
		}
	}

	return unique
}

// abs returns the absolute value of a float64
func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
