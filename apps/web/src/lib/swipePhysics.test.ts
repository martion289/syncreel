import { describe, expect, it } from 'vitest';
import {
  computeCardTransform,
  computeUnderCardStyle,
  computeVelocityX,
  resolveSwipeDecision
} from './swipePhysics.js';

describe('resolveSwipeDecision', () => {
  it('triggers yes or no on slow drags past the distance threshold', () => {
    expect(resolveSwipeDecision(85, 0)).toBe('yes');
    expect(resolveSwipeDecision(120, 0.05)).toBe('yes');
    expect(resolveSwipeDecision(-85, 0)).toBe('no');
    expect(resolveSwipeDecision(-140, -0.02)).toBe('no');
  });

  it('triggers on fast thumb flicks even over short drag distances', () => {
    expect(resolveSwipeDecision(40, 0.7)).toBe('yes');
    expect(resolveSwipeDecision(-40, -0.7)).toBe('no');
  });

  it('rejects opposing velocity and short slow drags', () => {
    expect(resolveSwipeDecision(40, -0.7)).toBeNull();
    expect(resolveSwipeDecision(-40, 0.7)).toBeNull();
    expect(resolveSwipeDecision(40, 0.1)).toBeNull();
    expect(resolveSwipeDecision(-40, -0.1)).toBeNull();
    expect(resolveSwipeDecision(25, 1.2)).toBeNull();
  });
});

describe('computeUnderCardStyle', () => {
  it('interpolates scale, lift, and opacity from resting stack to active card', () => {
    const rest = computeUnderCardStyle(0);
    expect(rest.scale).toBeCloseTo(0.94);
    expect(rest.translateY).toBeCloseTo(12);
    expect(rest.opacity).toBeCloseTo(0.78);

    const full = computeUnderCardStyle(1);
    expect(full.scale).toBeCloseTo(1);
    expect(full.translateY).toBeCloseTo(0);
    expect(full.opacity).toBeCloseTo(1);

    const clamped = computeUnderCardStyle(2.5);
    expect(clamped).toEqual(full);
  });
});

describe('computeCardTransform', () => {
  it('clamps rotation bounds and damps vertical movement', () => {
    const upper = computeCardTransform(900, 100, true);
    expect(upper.rotateDeg).toBe(22);
    expect(upper.translateY).toBe(35);
    expect(upper.progress).toBe(1);

    const lower = computeCardTransform(-90, 40, false);
    expect(lower.rotateDeg).toBeCloseTo(3.75);
    expect(lower.translateY).toBe(14);
    expect(lower.progress).toBeCloseTo(90 / 110);
  });
});

describe('computeVelocityX', () => {
  it('calculates velocity from recent samples within the velocity window', () => {
    expect(computeVelocityX([])).toBe(0);
    expect(computeVelocityX([{ x: 10, t: 100 }])).toBe(0);
    expect(
      computeVelocityX([
        { x: 0, t: 0 },
        { x: 20, t: 100 },
        { x: 80, t: 150 }
      ])
    ).toBeCloseTo(1.2);
    expect(
      computeVelocityX([
        { x: 10, t: 100 },
        { x: 50, t: 100 }
      ])
    ).toBe(0);
  });
});
