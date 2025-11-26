package ringmap

import (
	"fmt"
	"math"
)

// Earth-Centered, Earth-Fixed (ER0) Frame Constants
const (
	// EarthRadius is Earth's equatorial radius in meters (~6,378 km)
	EarthRadius = 6378137.0 // WGS84 equatorial radius
	// RingOrbitalRadius is the ring's orbital radius from Earth's center in meters (~42,164 km)
	// This is geostationary orbit altitude: EarthRadius + 35,786 km
	RingOrbitalRadius = 42164000.0
	// KongoHubAltitude is Kongo Ring-1 Hub altitude above Earth's surface in meters (500 km)
	KongoHubAltitude = 500000.0
	// KongoHubRadius is Kongo Hub's radius from Earth's center in meters
	KongoHubRadius = EarthRadius + KongoHubAltitude
)

// ER0Point represents a point in Earth-Centered, Earth-Fixed coordinates
// (0,0,0) = center of Earth
// +X = intersection of equator and prime meridian (Kongo Pillar vertical line)
// +Y = 90°E on the equator
// +Z = North Pole
type ER0Point struct {
	X float64 // meters
	Y float64 // meters
	Z float64 // meters
}

// RingPolar represents a position in EarthRing polar coordinates
// theta: angle around the ring in radians (0 at Kongo Hub, increases eastward, wraps at ±π)
// r: radial offset from ring's centerline in meters (positive = outward from Earth)
// z: vertical offset from equatorial plane in meters (positive = north)
type RingPolar struct {
	Theta float64 // radians, range [-π, π)
	R     float64 // meters, radial offset from centerline
	Z     float64 // meters, vertical offset from equatorial plane
}

// RingArc represents a position in EarthRing arc-length coordinates
// s: arc length along ring in meters (0 at Kongo Hub, wraps at circumference)
// r: radial offset from ring's centerline in meters
// z: vertical offset from equatorial plane in meters
type RingArc struct {
	S float64 // meters, arc length along ring
	R float64 // meters, radial offset from centerline
	Z float64 // meters, vertical offset from equatorial plane
}

// KongoHubER0 is the ER0 coordinates of Kongo Ring-1 Hub
var KongoHubER0 = ER0Point{
	X: KongoHubRadius,
	Y: 0,
	Z: 0,
}

// RingPolarToER0 converts RingPolar coordinates to ER0 coordinates
// Formula: R = R_ring + r, x = R * cos(theta), y = R * sin(theta), z_world = z
func RingPolarToER0(polar RingPolar) ER0Point {
	R := RingOrbitalRadius + polar.R
	return ER0Point{
		X: R * math.Cos(polar.Theta),
		Y: R * math.Sin(polar.Theta),
		Z: polar.Z,
	}
}

// ER0ToRingPolar converts ER0 coordinates to RingPolar coordinates
func ER0ToRingPolar(er0 ER0Point) RingPolar {
	// Calculate theta from X and Y
	theta := math.Atan2(er0.Y, er0.X)
	
	// Calculate radial distance from Earth's center in the equatorial plane
	R := math.Sqrt(er0.X*er0.X + er0.Y*er0.Y)
	
	// Calculate radial offset from ring centerline
	r := R - RingOrbitalRadius
	
	// Z is the vertical offset from equatorial plane
	z := er0.Z
	
	return RingPolar{
		Theta: theta,
		R:     r,
		Z:     z,
	}
}

// RingArcToRingPolar converts RingArc coordinates to RingPolar coordinates
// s = theta * R_ring, so theta = s / R_ring
func RingArcToRingPolar(arc RingArc) RingPolar {
	// Use RingCircumference to calculate theta
	// theta = (s / RingCircumference) * 2π, then normalize to [-π, π)
	theta := (arc.S / float64(RingCircumference)) * 2 * math.Pi
	// Normalize theta to [-π, π)
	theta = math.Mod(theta+math.Pi, 2*math.Pi) - math.Pi
	return RingPolar{
		Theta: theta,
		R:     arc.R,
		Z:     arc.Z,
	}
}

// RingPolarToRingArc converts RingPolar coordinates to RingArc coordinates
// s = theta * R_ring, wrapped to [0, RingCircumference)
func RingPolarToRingArc(polar RingPolar) RingArc {
	// Normalize theta to [0, 2π) for arc length calculation
	theta := polar.Theta
	if theta < 0 {
		theta += 2 * math.Pi
	}
	// Convert to arc length: s = (theta / 2π) * RingCircumference
	s := (theta / (2 * math.Pi)) * float64(RingCircumference)
	// Wrap s to [0, RingCircumference)
	s = math.Mod(s+float64(RingCircumference), float64(RingCircumference))
	return RingArc{
		S: s,
		R: polar.R,
		Z: polar.Z,
	}
}

// WrapTheta wraps theta to the range [-π, π)
func WrapTheta(theta float64) float64 {
	return math.Mod(theta+math.Pi, 2*math.Pi) - math.Pi
}

// WrapArcLength wraps arc length s to the range [0, RingCircumference)
func WrapArcLength(s float64) float64 {
	circ := float64(RingCircumference)
	return math.Mod(s+circ, circ)
}

// LegacyPositionToRingPolar converts legacy X position (0 to 264,000,000) to RingPolar
// Legacy X=0 corresponds to Kongo Hub (theta=0)
// Legacy X increases eastward, so theta = (X / RingCircumference) * 2π
// Legacy Y (width position) maps to R (radial offset)
// Legacy Z (floor/level) maps to Z (vertical offset)
func LegacyPositionToRingPolar(legacyX float64, legacyY float64, legacyZ float64) RingPolar {
	// Wrap legacy X to [0, RingCircumference)
	wrappedX := math.Mod(legacyX+float64(RingCircumference), float64(RingCircumference))
	
	// Convert to theta: theta = (X / C) * 2π, then shift to [-π, π)
	theta := (wrappedX / float64(RingCircumference)) * 2 * math.Pi
	theta = WrapTheta(theta)
	
	return RingPolar{
		Theta: theta,
		R:     legacyY, // Legacy Y (width position) maps to R (radial offset)
		Z:     legacyZ, // Legacy Z (floor/level) maps to Z (vertical offset)
	}
}

// RingPolarToLegacyPosition converts RingPolar to legacy position
// Legacy X = (theta / 2π) * RingCircumference, wrapped to [0, RingCircumference)
// Legacy Y = R (radial offset)
// Legacy Z = Z (vertical offset)
func RingPolarToLegacyPosition(polar RingPolar) (x float64, y float64, z float64) {
	// Normalize theta to [0, 2π)
	theta := polar.Theta
	if theta < 0 {
		theta += 2 * math.Pi
	}
	
	// Convert to legacy X
	x = (theta / (2 * math.Pi)) * float64(RingCircumference)
	x = math.Mod(x+float64(RingCircumference), float64(RingCircumference))
	
	// Legacy Y is the radial offset (R)
	y = polar.R
	
	// Legacy Z is the vertical offset (Z)
	z = polar.Z
	
	return x, y, z
}

// ValidateRingPolar validates a RingPolar coordinate
func ValidateRingPolar(polar RingPolar) error {
	// Theta should be in [-π, π) (will be wrapped if needed)
	// R and Z can be any value (no hard limits, but should be reasonable)
	if math.IsNaN(polar.Theta) || math.IsInf(polar.Theta, 0) {
		return fmt.Errorf("invalid theta: %f", polar.Theta)
	}
	if math.IsNaN(polar.R) || math.IsInf(polar.R, 0) {
		return fmt.Errorf("invalid r: %f", polar.R)
	}
	if math.IsNaN(polar.Z) || math.IsInf(polar.Z, 0) {
		return fmt.Errorf("invalid z: %f", polar.Z)
	}
	return nil
}

// ValidateRingArc validates a RingArc coordinate
func ValidateRingArc(arc RingArc) error {
	// S should be in [0, RingCircumference) (will be wrapped if needed)
	// R and Z can be any value
	if math.IsNaN(arc.S) || math.IsInf(arc.S, 0) {
		return fmt.Errorf("invalid s: %f", arc.S)
	}
	if math.IsNaN(arc.R) || math.IsInf(arc.R, 0) {
		return fmt.Errorf("invalid r: %f", arc.R)
	}
	if math.IsNaN(arc.Z) || math.IsInf(arc.Z, 0) {
		return fmt.Errorf("invalid z: %f", arc.Z)
	}
	return nil
}

// ValidateER0 validates an ER0 coordinate
func ValidateER0(er0 ER0Point) error {
	if math.IsNaN(er0.X) || math.IsInf(er0.X, 0) {
		return fmt.Errorf("invalid X: %f", er0.X)
	}
	if math.IsNaN(er0.Y) || math.IsInf(er0.Y, 0) {
		return fmt.Errorf("invalid Y: %f", er0.Y)
	}
	if math.IsNaN(er0.Z) || math.IsInf(er0.Z, 0) {
		return fmt.Errorf("invalid Z: %f", er0.Z)
	}
	return nil
}

// RingArcToChunkIndex converts RingArc arc length (s) to chunk index
// Chunk index = s / ChunkLength, wrapped to [0, ChunkCount)
func RingArcToChunkIndex(arc RingArc) int {
	wrappedS := WrapArcLength(arc.S)
	chunkIndex := int(wrappedS / float64(ChunkLength))
	if chunkIndex >= ChunkCount {
		chunkIndex = chunkIndex % ChunkCount
	}
	return chunkIndex
}

// ChunkIndexToRingArc converts chunk index to RingArc arc length (s)
// Returns the center arc length of the chunk
func ChunkIndexToRingArc(chunkIndex int) RingArc {
	wrappedIndex := WrapChunkIndex(chunkIndex)
	// Center of chunk: s = (chunkIndex + 0.5) * ChunkLength
	s := (float64(wrappedIndex) + 0.5) * float64(ChunkLength)
	s = WrapArcLength(s)
	return RingArc{
		S: s,
		R: 0, // Default to centerline
		Z: 0, // Default to equatorial plane
	}
}

// RingPolarToChunkIndex converts RingPolar to chunk index via RingArc
func RingPolarToChunkIndex(polar RingPolar) int {
	arc := RingPolarToRingArc(polar)
	return RingArcToChunkIndex(arc)
}

// ChunkIndexToRingPolar converts chunk index to RingPolar via RingArc
func ChunkIndexToRingPolar(chunkIndex int) RingPolar {
	arc := ChunkIndexToRingArc(chunkIndex)
	return RingArcToRingPolar(arc)
}

