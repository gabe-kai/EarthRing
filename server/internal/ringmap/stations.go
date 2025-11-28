package ringmap

import (
	"fmt"
	"math"
)

// StationPosition represents a station position in RingArc coordinates
type StationPosition struct {
	ArcLength float64 // Arc length along ring in meters (0 at Kongo Hub)
	R         float64 // Radial offset from centerline (usually 0 for stations)
	Z         float64 // Vertical offset from equatorial plane (usually 0 for stations)
}

// KongoHubPosition is the RingArc position of Kongo Ring-1 Hub
// Kongo Hub is at theta = 0 (or s = 0) in the new coordinate system
var KongoHubPosition = StationPosition{
	ArcLength: 0, // At Kongo Hub
	R:         0, // On centerline
	Z:         0, // On equatorial plane
}

// KongoHubER0Position is the ER0 coordinates of Kongo Ring-1 Hub
// This is the anchor point for all station positioning
var KongoHubER0Position = ER0Point{
	X: KongoHubRadius, // At Kongo Hub radius from Earth center
	Y: 0,              // On prime meridian
	Z: 0,              // On equatorial plane
}

// PillarHubPositions contains the RingArc positions of all 12 pillar/elevator hubs
// These are evenly spaced around the ring at 22,000 km intervals
// Hub 0 is Kongo Hub (s = 0)
var PillarHubPositions = []StationPosition{
	{ArcLength: 0, R: 0, Z: 0},         // Hub 0: Kongo Hub
	{ArcLength: 22000000, R: 0, Z: 0},  // Hub 1: 22,000 km
	{ArcLength: 44000000, R: 0, Z: 0},  // Hub 2: 44,000 km
	{ArcLength: 66000000, R: 0, Z: 0},  // Hub 3: 66,000 km
	{ArcLength: 88000000, R: 0, Z: 0},  // Hub 4: 88,000 km
	{ArcLength: 110000000, R: 0, Z: 0}, // Hub 5: 110,000 km
	{ArcLength: 132000000, R: 0, Z: 0}, // Hub 6: 132,000 km
	{ArcLength: 154000000, R: 0, Z: 0}, // Hub 7: 154,000 km
	{ArcLength: 176000000, R: 0, Z: 0}, // Hub 8: 176,000 km
	{ArcLength: 198000000, R: 0, Z: 0}, // Hub 9: 198,000 km
	{ArcLength: 220000000, R: 0, Z: 0}, // Hub 10: 220,000 km
	{ArcLength: 242000000, R: 0, Z: 0}, // Hub 11: 242,000 km
}

// StationPositionToER0 converts a station position (RingArc) to ER0 coordinates
func StationPositionToER0(pos StationPosition) ER0Point {
	// Convert RingArc to RingPolar
	polar := RingArcToRingPolar(RingArc{
		S: pos.ArcLength,
		R: pos.R,
		Z: pos.Z,
	})

	// Convert RingPolar to ER0
	return RingPolarToER0(polar)
}

// ER0ToStationPosition converts ER0 coordinates to a station position (RingArc)
func ER0ToStationPosition(er0 ER0Point) StationPosition {
	// Convert ER0 to RingPolar
	polar := ER0ToRingPolar(er0)

	// Convert RingPolar to RingArc
	arc := RingPolarToRingArc(polar)

	return StationPosition{
		ArcLength: arc.S,
		R:         arc.R,
		Z:         arc.Z,
	}
}

// GetPillarHubER0 returns the ER0 coordinates of a pillar hub by index (0-11)
func GetPillarHubER0(index int) (ER0Point, error) {
	if index < 0 || index >= len(PillarHubPositions) {
		return ER0Point{}, fmt.Errorf("invalid hub index: %d (must be 0-11)", index)
	}
	return StationPositionToER0(PillarHubPositions[index]), nil
}

// GetPillarHubRingPolar returns the RingPolar coordinates of a pillar hub by index (0-11)
func GetPillarHubRingPolar(index int) (RingPolar, error) {
	if index < 0 || index >= len(PillarHubPositions) {
		return RingPolar{}, fmt.Errorf("invalid hub index: %d (must be 0-11)", index)
	}
	arc := RingArc{
		S: PillarHubPositions[index].ArcLength,
		R: PillarHubPositions[index].R,
		Z: PillarHubPositions[index].Z,
	}
	return RingArcToRingPolar(arc), nil
}

// FindNearestPillarHub finds the nearest pillar hub to a given RingArc position
func FindNearestPillarHub(pos StationPosition) (index int, distance float64) {
	minDistance := math.MaxFloat64
	nearestIndex := 0

	for i, hub := range PillarHubPositions {
		// Calculate arc length distance (accounting for wrapping)
		dist := ArcLengthDistance(pos.ArcLength, hub.ArcLength)
		if dist < minDistance {
			minDistance = dist
			nearestIndex = i
		}
	}

	return nearestIndex, minDistance
}

// ArcLengthDistance calculates the shortest distance between two arc lengths, accounting for wrapping
func ArcLengthDistance(s1, s2 float64) float64 {
	wrapped1 := WrapArcLength(s1)
	wrapped2 := WrapArcLength(s2)

	// Calculate direct distance
	direct := math.Abs(wrapped2 - wrapped1)

	// Calculate wrapped distance (going the other way around the ring)
	wrapped := float64(RingCircumference) - direct

	// Return the shorter distance
	if direct < wrapped {
		return direct
	}
	return wrapped
}
