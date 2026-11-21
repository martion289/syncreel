import { describe, expect, it } from 'vitest';
import { evaluateDrift } from '../driftController.js';

describe('evaluateDrift', () => {
  it('stays idle inside the 180ms deadband', () => {
    expect(evaluateDrift({ expectedMs: 10_000, actualMs: 10_120, currentRate: 1 })).toEqual({
      action: 'none'
    });
    expect(evaluateDrift({ expectedMs: 10_000, actualMs: 9_850, currentRate: 1 })).toEqual({
      action: 'none'
    });
  });

  it('uses gentle playbackRate nudges between 180ms and 1500ms and resets cleanly below 80ms', () => {
    // Behind by 500ms -> speed up to 1.05x
    expect(evaluateDrift({ expectedMs: 10_000, actualMs: 9_500, currentRate: 1 })).toEqual({
      action: 'nudge',
      targetRate: 1.05
    });

    // Ahead by 500ms -> slow down to 0.95x
    expect(evaluateDrift({ expectedMs: 10_000, actualMs: 10_500, currentRate: 1 })).toEqual({
      action: 'nudge',
      targetRate: 0.95
    });

    // Already nudging, within 100ms (still >80ms) -> keep nudging
    expect(evaluateDrift({ expectedMs: 10_000, actualMs: 9_900, currentRate: 1.05 })).toEqual({
      action: 'nudge',
      targetRate: 1.05
    });

    // Converged below 80ms -> reset playbackRate back to 1.0
    expect(evaluateDrift({ expectedMs: 10_000, actualMs: 9_940, currentRate: 1.05 })).toEqual({
      action: 'nudge',
      targetRate: 1
    });
  });

  it('performs hard seek when drift exceeds 1500ms', () => {
    expect(evaluateDrift({ expectedMs: 25_000, actualMs: 22_000, currentRate: 1 })).toEqual({
      action: 'seek',
      seekToMs: 25_150,
      targetRate: 1
    });

    // Respects supportsRateNudge: false (Chromecast)
    expect(
      evaluateDrift({
        expectedMs: 25_000,
        actualMs: 24_500,
        currentRate: 1,
        supportsRateNudge: false
      })
    ).toEqual({
      action: 'none'
    });
  });
});
