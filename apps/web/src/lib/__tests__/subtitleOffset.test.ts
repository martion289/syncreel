import { describe, expect, it } from 'vitest';
import { applyOffsetToCues, type CueLike } from '../subtitleOffset.js';

describe('applyOffsetToCues', () => {
  it('shifts cue times accurately without accumulating floating-point drift across repeated updates', () => {
    const cue1: CueLike = { startTime: 10.0, endTime: 12.5 };
    const cue2: CueLike = { startTime: 0.4, endTime: 2.0 };
    const cues = [cue1, cue2];

    applyOffsetToCues(cues, 500);
    expect(cue1.startTime).toBe(10.5);
    expect(cue1.endTime).toBe(13.0);

    // Adjusting again applies relative to original unshifted cue bounds, not cumulative
    applyOffsetToCues(cues, -500);
    expect(cue1.startTime).toBe(9.5);
    expect(cue1.endTime).toBe(12.0);
    expect(cue2.startTime).toBe(0);
    expect(cue2.endTime).toBe(1.5);

    // Resetting to 0 restores exact original bounds
    applyOffsetToCues(cues, 0);
    expect(cue1.startTime).toBe(10.0);
    expect(cue1.endTime).toBe(12.5);
    expect(cue2.startTime).toBe(0.4);
    expect(cue2.endTime).toBe(2.0);
  });
});
