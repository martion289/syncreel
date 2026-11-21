import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../syncEngine.js';

describe('SyncEngine', () => {
  it('enforces collaborative vs hostOnlyControl permissions', () => {
    let now = 1_000;
    const engine = new SyncEngine({ now: () => now, hostOnlyControl: false });
    engine.loadMedia(0, 'Host');

    const guestPlay = engine.play(0, 'guest', 'Guest');
    expect(guestPlay.changed).toBe(true);
    expect(guestPlay.state.status).toBe('playing');

    engine.setHostOnlyControl(true);
    const blockedPause = engine.pause(5_000, 'guest', 'Guest');
    expect(blockedPause.changed).toBe(false);
    expect(blockedPause.reason).toContain('Host-only');
    expect(blockedPause.state.status).toBe('playing');

    const hostPause = engine.pause(5_000, 'host', 'Host');
    expect(hostPause.changed).toBe(true);
    expect(hostPause.state.status).toBe('paused');
    expect(hostPause.state.anchorPositionMs).toBe(5_000);
  });

  it('projects playback position forward while playing and bumps monotonic versions', () => {
    let now = 10_000;
    const engine = new SyncEngine({ now: () => now });
    const v1 = engine.loadMedia(2_000, 'Host');
    expect(v1.version).toBe(1);
    expect(engine.getProjectedPositionMs(15_000)).toBe(2_000);

    const v2 = engine.play(2_000, 'host', 'Host');
    expect(v2.state.version).toBe(2);

    now = 17_500;
    expect(engine.getProjectedPositionMs()).toBe(9_500);

    const v3 = engine.skipMarker(90_000, 'guest', 'Alex');
    expect(v3.changed).toBe(true);
    expect(v3.state.version).toBe(3);
    expect(v3.state.anchorPositionMs).toBe(90_000);
    expect(v3.state.status).toBe('playing');
  });

  it('auto-pauses on buffering, resumes when cleared, and evicts stalled peers after timeout', () => {
    vi.useFakeTimers();
    try {
      let now = 50_000;
      const timeouts: Array<{ evicted: string[]; status: string }> = [];

      const engine = new SyncEngine({
        now: () => now,
        bufferTimeoutMs: 12_000,
        onBufferTimeout: (evicted, state) => {
          timeouts.push({ evicted, status: state.status });
        }
      });

      engine.loadMedia(0, 'Host');
      engine.play(10_000, 'host', 'Host');

      now = 54_000;
      const buf = engine.setBuffering('guest-1', true);
      expect(buf.changed).toBe(true);
      expect(buf.state.status).toBe('buffering');
      expect(buf.state.anchorPositionMs).toBe(14_000);
      expect(buf.state.bufferingParticipantIds).toEqual(['guest-1']);

      // Normal recovery before timeout
      now = 56_000;
      const cleared = engine.setBuffering('guest-1', false);
      expect(cleared.changed).toBe(true);
      expect(cleared.state.status).toBe('playing');
      expect(cleared.state.anchorPositionMs).toBe(14_000);
      expect(cleared.state.bufferingParticipantIds).toEqual([]);

      // Stall past 12s safety timeout
      now = 60_000;
      engine.setBuffering('guest-2', true);
      expect(engine.getState().status).toBe('buffering');

      vi.advanceTimersByTime(12_000);
      expect(timeouts).toEqual([{ evicted: ['guest-2'], status: 'playing' }]);
      expect(engine.getState().status).toBe('playing');
      expect(engine.getState().bufferingParticipantIds).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears buffering barrier when the buffering participant disconnects', () => {
    let now = 1_000;
    const engine = new SyncEngine({ now: () => now });
    engine.loadMedia(0, 'Host');
    engine.play(0, 'host', 'Host');

    now = 3_000;
    engine.setBuffering('guest-1', true);
    expect(engine.getState().status).toBe('buffering');

    const res = engine.removeParticipant('guest-1');
    expect(res.changed).toBe(true);
    expect(res.state.status).toBe('playing');
    expect(res.state.bufferingParticipantIds).toEqual([]);
  });
});
