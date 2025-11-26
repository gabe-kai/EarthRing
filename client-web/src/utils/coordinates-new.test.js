/**
 * Tests for new coordinate system utilities
 */

import { describe, it, expect } from 'vitest';
import {
  ringPolarToER0,
  er0ToRingPolar,
  ringArcToRingPolar,
  ringPolarToRingArc,
  wrapTheta,
  wrapArcLength,
  legacyPositionToRingPolar,
  ringPolarToLegacyPosition,
  validateRingPolar,
  validateRingArc,
  validateER0,
  RING_CIRCUMFERENCE,
  RING_ORBITAL_RADIUS,
  KONGO_HUB_RADIUS,
} from './coordinates-new.js';

const epsilon = 1e-6; // Tolerance for floating point comparisons

describe('Coordinate System Conversions', () => {
  describe('ringPolarToER0', () => {
    it('converts Kongo Hub correctly', () => {
      const polar = { theta: 0, r: 0, z: 0 };
      const er0 = ringPolarToER0(polar);
      
      expect(er0.x).toBeCloseTo(RING_ORBITAL_RADIUS, epsilon);
      expect(er0.y).toBeCloseTo(0, epsilon);
      expect(er0.z).toBeCloseTo(0, epsilon);
    });
  });

  describe('er0ToRingPolar', () => {
    it('converts Kongo Hub correctly', () => {
      const er0 = { x: RING_ORBITAL_RADIUS, y: 0, z: 0 };
      const polar = er0ToRingPolar(er0);
      
      expect(polar.theta).toBeCloseTo(0, epsilon);
      expect(polar.r).toBeCloseTo(0, epsilon);
      expect(polar.z).toBeCloseTo(0, epsilon);
    });
  });

  describe('Round-trip ER0 ↔ RingPolar', () => {
    const testCases = [
      { name: 'Kongo Hub', er0: { x: RING_ORBITAL_RADIUS, y: 0, z: 0 } },
      { name: '90° East', er0: { x: 0, y: RING_ORBITAL_RADIUS, z: 0 } },
      { name: '180° (Opposite Kongo)', er0: { x: -RING_ORBITAL_RADIUS, y: 0, z: 0 } },
      { name: '270° West', er0: { x: 0, y: -RING_ORBITAL_RADIUS, z: 0 } },
      { name: 'With radial offset', er0: { x: RING_ORBITAL_RADIUS + 1000, y: 0, z: 0 } },
      { name: 'With vertical offset', er0: { x: RING_ORBITAL_RADIUS, y: 0, z: 500 } },
      { name: 'Combined offsets', er0: { x: RING_ORBITAL_RADIUS + 500, y: 1000, z: 200 } },
    ];

    testCases.forEach(({ name, er0 }) => {
      it(`round-trips ${name}`, () => {
        const polar = er0ToRingPolar(er0);
        const er0Back = ringPolarToER0(polar);
        
        expect(er0Back.x).toBeCloseTo(er0.x, epsilon);
        expect(er0Back.y).toBeCloseTo(er0.y, epsilon);
        expect(er0Back.z).toBeCloseTo(er0.z, epsilon);
      });
    });
  });

  describe('ringArcToRingPolar', () => {
    it('converts Kongo Hub correctly', () => {
      const arc = { s: 0, r: 0, z: 0 };
      const polar = ringArcToRingPolar(arc);
      
      expect(polar.theta).toBeCloseTo(0, epsilon);
    });

    it('converts halfway around ring correctly', () => {
      const arc = { s: RING_CIRCUMFERENCE / 2, r: 0, z: 0 };
      const polar = ringArcToRingPolar(arc);
      
      expect(Math.abs(polar.theta)).toBeCloseTo(Math.PI, epsilon);
    });
  });

  describe('ringPolarToRingArc', () => {
    it('converts Kongo Hub correctly', () => {
      const polar = { theta: 0, r: 0, z: 0 };
      const arc = ringPolarToRingArc(polar);
      
      expect(arc.s).toBeCloseTo(0, epsilon);
    });

    it('converts halfway around ring correctly', () => {
      const polar = { theta: Math.PI, r: 0, z: 0 };
      const arc = ringPolarToRingArc(polar);
      
      expect(arc.s).toBeCloseTo(RING_CIRCUMFERENCE / 2, epsilon);
    });
  });

  describe('Round-trip RingPolar ↔ RingArc', () => {
    const testCases = [
      { name: 'Kongo Hub', polar: { theta: 0, r: 0, z: 0 } },
      { name: '90° East', polar: { theta: Math.PI / 2, r: 0, z: 0 } },
      { name: '180° (Opposite Kongo)', polar: { theta: Math.PI, r: 0, z: 0 } },
      { name: '-90° West', polar: { theta: -Math.PI / 2, r: 0, z: 0 } },
      { name: 'With radial offset', polar: { theta: 0, r: 1000, z: 0 } },
      { name: 'With vertical offset', polar: { theta: 0, r: 0, z: 500 } },
      { name: 'Combined offsets', polar: { theta: Math.PI / 4, r: 500, z: 200 } },
    ];

    testCases.forEach(({ name, polar }) => {
      it(`round-trips ${name}`, () => {
        const arc = ringPolarToRingArc(polar);
        const polarBack = ringArcToRingPolar(arc);
        
        // Theta might differ by 2π, so normalize
        const thetaDiff = Math.abs(polarBack.theta - polar.theta);
        expect(thetaDiff < epsilon || Math.abs(thetaDiff - 2 * Math.PI) < epsilon).toBe(true);
        expect(polarBack.r).toBeCloseTo(polar.r, epsilon);
        expect(polarBack.z).toBeCloseTo(polar.z, epsilon);
      });
    });
  });

  describe('wrapTheta', () => {
    const testCases = [
      { input: 0, expected: 0 },
      { input: Math.PI, expected: Math.PI },
      { input: -Math.PI, expected: -Math.PI },
      { input: 2 * Math.PI, expected: 0 },
      { input: -2 * Math.PI, expected: 0 },
      { input: 3 * Math.PI, expected: -Math.PI },
      { input: -3 * Math.PI, expected: Math.PI },
      { input: Math.PI / 2, expected: Math.PI / 2 },
      { input: -Math.PI / 2, expected: -Math.PI / 2 },
    ];

    testCases.forEach(({ input, expected }) => {
      it(`wraps ${input} correctly`, () => {
        const result = wrapTheta(input);
        // Handle the case where -π wraps to π (they're equivalent)
        const diff = Math.abs(result - expected);
        expect(diff < epsilon || Math.abs(diff - 2 * Math.PI) < epsilon).toBe(true);
      });
    });
  });

  describe('wrapArcLength', () => {
    const testCases = [
      { input: 0, expected: 0 },
      { input: RING_CIRCUMFERENCE, expected: 0 },
      { input: RING_CIRCUMFERENCE / 2, expected: RING_CIRCUMFERENCE / 2 },
      { input: -RING_CIRCUMFERENCE / 2, expected: RING_CIRCUMFERENCE / 2 },
      { input: 2 * RING_CIRCUMFERENCE, expected: 0 },
      { input: -2 * RING_CIRCUMFERENCE, expected: 0 },
      { input: RING_CIRCUMFERENCE + 1000, expected: 1000 },
      { input: -1000, expected: RING_CIRCUMFERENCE - 1000 },
    ];

    testCases.forEach(({ input, expected }) => {
      it(`wraps ${input} correctly`, () => {
        const result = wrapArcLength(input);
        expect(result).toBeCloseTo(expected, epsilon);
      });
    });
  });

  describe('legacyPositionToRingPolar', () => {
    it('converts Kongo Hub correctly', () => {
      const polar = legacyPositionToRingPolar(0, 0, 0);
      
      expect(polar.theta).toBeCloseTo(0, epsilon);
    });

    it('converts halfway around ring correctly', () => {
      const polar = legacyPositionToRingPolar(RING_CIRCUMFERENCE / 2, 0, 0);
      
      expect(Math.abs(polar.theta)).toBeCloseTo(Math.PI, epsilon);
    });
  });

  describe('ringPolarToLegacyPosition', () => {
    it('converts Kongo Hub correctly', () => {
      const polar = { theta: 0, r: 0, z: 0 };
      const legacy = ringPolarToLegacyPosition(polar);
      
      expect(legacy.x).toBeCloseTo(0, epsilon);
    });

    it('converts halfway around ring correctly', () => {
      const polar = { theta: Math.PI, r: 0, z: 0 };
      const legacy = ringPolarToLegacyPosition(polar);
      
      expect(legacy.x).toBeCloseTo(RING_CIRCUMFERENCE / 2, epsilon);
    });
  });

  describe('Round-trip Legacy ↔ RingPolar', () => {
    const testCases = [
      { name: 'Kongo Hub', x: 0, y: 0, z: 0 },
      { name: 'Quarter way', x: RING_CIRCUMFERENCE / 4, y: 0, z: 0 },
      { name: 'Halfway', x: RING_CIRCUMFERENCE / 2, y: 0, z: 0 },
      { name: 'Three quarters', x: 3 * RING_CIRCUMFERENCE / 4, y: 0, z: 0 },
      { name: 'With Y offset', x: 0, y: 1000, z: 0 },
      { name: 'With Z offset', x: 0, y: 0, z: 5 },
      { name: 'Combined', x: 1000000, y: 500, z: 2 },
    ];

    testCases.forEach(({ name, x, y, z }) => {
      it(`round-trips ${name}`, () => {
        const polar = legacyPositionToRingPolar(x, y, z);
        const legacy = ringPolarToLegacyPosition(polar);
        
        // X might wrap, so check wrapped difference
        const xDiff = Math.abs(legacy.x - x);
        expect(xDiff < epsilon || Math.abs(xDiff - RING_CIRCUMFERENCE) < epsilon).toBe(true);
        expect(legacy.y).toBeCloseTo(y, epsilon);
        expect(legacy.z).toBeCloseTo(z, epsilon);
      });
    });
  });

  describe('Validation', () => {
    describe('validateRingPolar', () => {
      it('validates valid coordinates', () => {
        const polar = { theta: 0, r: 0, z: 0 };
        const result = validateRingPolar(polar);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('rejects NaN values', () => {
        const polar = { theta: NaN, r: 0, z: 0 };
        const result = validateRingPolar(polar);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('rejects Infinity values', () => {
        const polar = { theta: 0, r: Infinity, z: 0 };
        const result = validateRingPolar(polar);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('validateRingArc', () => {
      it('validates valid coordinates', () => {
        const arc = { s: 0, r: 0, z: 0 };
        const result = validateRingArc(arc);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('rejects NaN values', () => {
        const arc = { s: NaN, r: 0, z: 0 };
        const result = validateRingArc(arc);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('validateER0', () => {
      it('validates valid coordinates', () => {
        const er0 = { x: RING_ORBITAL_RADIUS, y: 0, z: 0 };
        const result = validateER0(er0);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('rejects NaN values', () => {
        const er0 = { x: NaN, y: 0, z: 0 };
        const result = validateER0(er0);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });
});

