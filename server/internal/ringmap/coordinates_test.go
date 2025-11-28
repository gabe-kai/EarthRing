package ringmap

import (
	"math"
	"testing"
)

const epsilon = 1e-6 // Tolerance for floating point comparisons

func TestRingPolarToER0(t *testing.T) {
	// Test Kongo Hub: theta = 0, r = 0, z = 0
	polar := RingPolar{Theta: 0, R: 0, Z: 0}
	er0 := RingPolarToER0(polar)

	expectedX := RingOrbitalRadius
	expectedY := 0.0
	expectedZ := 0.0

	if math.Abs(er0.X-expectedX) > epsilon {
		t.Errorf("RingPolarToER0: X = %f, expected %f", er0.X, expectedX)
	}
	if math.Abs(er0.Y-expectedY) > epsilon {
		t.Errorf("RingPolarToER0: Y = %f, expected %f", er0.Y, expectedY)
	}
	if math.Abs(er0.Z-expectedZ) > epsilon {
		t.Errorf("RingPolarToER0: Z = %f, expected %f", er0.Z, expectedZ)
	}
}

func TestER0ToRingPolar(t *testing.T) {
	// Test Kongo Hub: ER0 = (RingOrbitalRadius, 0, 0)
	er0 := ER0Point{X: RingOrbitalRadius, Y: 0, Z: 0}
	polar := ER0ToRingPolar(er0)

	expectedTheta := 0.0
	expectedR := 0.0
	expectedZ := 0.0

	if math.Abs(polar.Theta-expectedTheta) > epsilon {
		t.Errorf("ER0ToRingPolar: Theta = %f, expected %f", polar.Theta, expectedTheta)
	}
	if math.Abs(polar.R-expectedR) > epsilon {
		t.Errorf("ER0ToRingPolar: R = %f, expected %f", polar.R, expectedR)
	}
	if math.Abs(polar.Z-expectedZ) > epsilon {
		t.Errorf("ER0ToRingPolar: Z = %f, expected %f", polar.Z, expectedZ)
	}
}

func TestRoundTripER0RingPolar(t *testing.T) {
	// Test round-trip conversion: ER0 → RingPolar → ER0
	testCases := []struct {
		name string
		er0  ER0Point
	}{
		{"Kongo Hub", ER0Point{X: RingOrbitalRadius, Y: 0, Z: 0}},
		{"90° East", ER0Point{X: 0, Y: RingOrbitalRadius, Z: 0}},
		{"180° (Opposite Kongo)", ER0Point{X: -RingOrbitalRadius, Y: 0, Z: 0}},
		{"270° West", ER0Point{X: 0, Y: -RingOrbitalRadius, Z: 0}},
		{"With radial offset", ER0Point{X: RingOrbitalRadius + 1000, Y: 0, Z: 0}},
		{"With vertical offset", ER0Point{X: RingOrbitalRadius, Y: 0, Z: 500}},
		{"Combined offsets", ER0Point{X: RingOrbitalRadius + 500, Y: 1000, Z: 200}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			polar := ER0ToRingPolar(tc.er0)
			er0Back := RingPolarToER0(polar)

			if math.Abs(er0Back.X-tc.er0.X) > epsilon {
				t.Errorf("Round-trip X: %f → %f (diff: %f)", tc.er0.X, er0Back.X, math.Abs(er0Back.X-tc.er0.X))
			}
			if math.Abs(er0Back.Y-tc.er0.Y) > epsilon {
				t.Errorf("Round-trip Y: %f → %f (diff: %f)", tc.er0.Y, er0Back.Y, math.Abs(er0Back.Y-tc.er0.Y))
			}
			if math.Abs(er0Back.Z-tc.er0.Z) > epsilon {
				t.Errorf("Round-trip Z: %f → %f (diff: %f)", tc.er0.Z, er0Back.Z, math.Abs(er0Back.Z-tc.er0.Z))
			}
		})
	}
}

func TestRingArcToRingPolar(t *testing.T) {
	// Test Kongo Hub: s = 0
	arc := RingArc{S: 0, R: 0, Z: 0}
	polar := RingArcToRingPolar(arc)

	expectedTheta := 0.0
	if math.Abs(polar.Theta-expectedTheta) > epsilon {
		t.Errorf("RingArcToRingPolar: Theta = %f, expected %f", polar.Theta, expectedTheta)
	}

	// Test halfway around ring: s = RingCircumference / 2
	arc = RingArc{S: float64(RingCircumference) / 2, R: 0, Z: 0}
	polar = RingArcToRingPolar(arc)

	expectedTheta = math.Pi
	if math.Abs(math.Abs(polar.Theta)-expectedTheta) > epsilon {
		t.Errorf("RingArcToRingPolar: Theta = %f, expected ±%f", polar.Theta, expectedTheta)
	}
}

func TestRingPolarToRingArc(t *testing.T) {
	// Test Kongo Hub: theta = 0
	polar := RingPolar{Theta: 0, R: 0, Z: 0}
	arc := RingPolarToRingArc(polar)

	expectedS := 0.0
	if math.Abs(arc.S-expectedS) > epsilon {
		t.Errorf("RingPolarToRingArc: S = %f, expected %f", arc.S, expectedS)
	}

	// Test halfway around ring: theta = π
	polar = RingPolar{Theta: math.Pi, R: 0, Z: 0}
	arc = RingPolarToRingArc(polar)

	expectedS = float64(RingCircumference) / 2
	if math.Abs(arc.S-expectedS) > epsilon {
		t.Errorf("RingPolarToRingArc: S = %f, expected %f", arc.S, expectedS)
	}
}

func TestRoundTripRingPolarRingArc(t *testing.T) {
	// Test round-trip conversion: RingPolar → RingArc → RingPolar
	testCases := []struct {
		name  string
		polar RingPolar
	}{
		{"Kongo Hub", RingPolar{Theta: 0, R: 0, Z: 0}},
		{"90° East", RingPolar{Theta: math.Pi / 2, R: 0, Z: 0}},
		{"180° (Opposite Kongo)", RingPolar{Theta: math.Pi, R: 0, Z: 0}},
		{"-90° West", RingPolar{Theta: -math.Pi / 2, R: 0, Z: 0}},
		{"With radial offset", RingPolar{Theta: 0, R: 1000, Z: 0}},
		{"With vertical offset", RingPolar{Theta: 0, R: 0, Z: 500}},
		{"Combined offsets", RingPolar{Theta: math.Pi / 4, R: 500, Z: 200}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			arc := RingPolarToRingArc(tc.polar)
			polarBack := RingArcToRingPolar(arc)

			// Theta might differ by 2π, so normalize
			thetaDiff := math.Abs(polarBack.Theta - tc.polar.Theta)
			if thetaDiff > epsilon && math.Abs(thetaDiff-2*math.Pi) > epsilon {
				t.Errorf("Round-trip Theta: %f → %f (diff: %f)", tc.polar.Theta, polarBack.Theta, thetaDiff)
			}
			if math.Abs(polarBack.R-tc.polar.R) > epsilon {
				t.Errorf("Round-trip R: %f → %f (diff: %f)", tc.polar.R, polarBack.R, math.Abs(polarBack.R-tc.polar.R))
			}
			if math.Abs(polarBack.Z-tc.polar.Z) > epsilon {
				t.Errorf("Round-trip Z: %f → %f (diff: %f)", tc.polar.Z, polarBack.Z, math.Abs(polarBack.Z-tc.polar.Z))
			}
		})
	}
}

func TestWrapTheta(t *testing.T) {
	testCases := []struct {
		input    float64
		expected float64
	}{
		{0, 0},
		{math.Pi, math.Pi},
		{-math.Pi, -math.Pi},
		{2 * math.Pi, 0},
		{-2 * math.Pi, 0},
		{3 * math.Pi, -math.Pi},
		{-3 * math.Pi, math.Pi},
		{math.Pi / 2, math.Pi / 2},
		{-math.Pi / 2, -math.Pi / 2},
	}

	for _, tc := range testCases {
		t.Run("", func(t *testing.T) {
			result := WrapTheta(tc.input)
			// Handle the case where -π wraps to π (they're equivalent)
			diff := math.Abs(result - tc.expected)
			if diff > epsilon && math.Abs(diff-2*math.Pi) > epsilon {
				t.Errorf("WrapTheta(%f) = %f, expected %f", tc.input, result, tc.expected)
			}
		})
	}
}

func TestWrapArcLength(t *testing.T) {
	circ := float64(RingCircumference)
	testCases := []struct {
		input    float64
		expected float64
	}{
		{0, 0},
		{circ, 0},
		{circ / 2, circ / 2},
		{-circ / 2, circ / 2},
		{2 * circ, 0},
		{-2 * circ, 0},
		{circ + 1000, 1000},
		{-1000, circ - 1000},
	}

	for _, tc := range testCases {
		t.Run("", func(t *testing.T) {
			result := WrapArcLength(tc.input)
			if math.Abs(result-tc.expected) > epsilon {
				t.Errorf("WrapArcLength(%f) = %f, expected %f", tc.input, result, tc.expected)
			}
		})
	}
}

func TestLegacyPositionToRingPolar(t *testing.T) {
	// Test Kongo Hub: legacy X = 0
	legacyX := 0.0
	polar := LegacyPositionToRingPolar(legacyX, 0, 0)

	expectedTheta := 0.0
	if math.Abs(polar.Theta-expectedTheta) > epsilon {
		t.Errorf("LegacyPositionToRingPolar: Theta = %f, expected %f", polar.Theta, expectedTheta)
	}

	// Test halfway around ring: legacy X = RingCircumference / 2
	legacyX = float64(RingCircumference) / 2
	polar = LegacyPositionToRingPolar(legacyX, 0, 0)

	expectedTheta = math.Pi
	if math.Abs(math.Abs(polar.Theta)-expectedTheta) > epsilon {
		t.Errorf("LegacyPositionToRingPolar: Theta = %f, expected ±%f", polar.Theta, expectedTheta)
	}
}

func TestRingPolarToLegacyPosition(t *testing.T) {
	// Test Kongo Hub: theta = 0
	polar := RingPolar{Theta: 0, R: 0, Z: 0}
	x, _, _ := RingPolarToLegacyPosition(polar)

	expectedX := 0.0
	if math.Abs(x-expectedX) > epsilon {
		t.Errorf("RingPolarToLegacyPosition: X = %f, expected %f", x, expectedX)
	}

	// Test halfway around ring: theta = π
	polar = RingPolar{Theta: math.Pi, R: 0, Z: 0}
	x, _, _ = RingPolarToLegacyPosition(polar)

	expectedX = float64(RingCircumference) / 2
	if math.Abs(x-expectedX) > epsilon {
		t.Errorf("RingPolarToLegacyPosition: X = %f, expected %f", x, expectedX)
	}
}

func TestRoundTripLegacyRingPolar(t *testing.T) {
	// Test round-trip conversion: Legacy → RingPolar → Legacy
	testCases := []struct {
		name    string
		legacyX float64
		legacyY float64
		legacyZ float64
	}{
		{"Kongo Hub", 0, 0, 0},
		{"Quarter way", float64(RingCircumference) / 4, 0, 0},
		{"Halfway", float64(RingCircumference) / 2, 0, 0},
		{"Three quarters", 3 * float64(RingCircumference) / 4, 0, 0},
		{"With Y offset", 0, 1000, 0},
		{"With Z offset", 0, 0, 5},
		{"Combined", 1000000, 500, 2},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			polar := LegacyPositionToRingPolar(tc.legacyX, tc.legacyY, tc.legacyZ)
			x, y, z := RingPolarToLegacyPosition(polar)

			// X might wrap, so check wrapped difference
			xDiff := math.Abs(x - tc.legacyX)
			if xDiff > epsilon && math.Abs(xDiff-float64(RingCircumference)) > epsilon {
				t.Errorf("Round-trip X: %f → %f (diff: %f)", tc.legacyX, x, xDiff)
			}
			if math.Abs(y-tc.legacyY) > epsilon {
				t.Errorf("Round-trip Y: %f → %f (diff: %f)", tc.legacyY, y, math.Abs(y-tc.legacyY))
			}
			if math.Abs(z-tc.legacyZ) > epsilon {
				t.Errorf("Round-trip Z: %f → %f (diff: %f)", tc.legacyZ, z, math.Abs(z-tc.legacyZ))
			}
		})
	}
}
