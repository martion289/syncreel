import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientEvent, PlaybackState } from '@syncreel/shared';
import { evaluateDrift } from '../lib/driftController.js';

export interface PlayerAdapter {
  readonly supportsRateNudge: boolean;
  getPositionMs(): number;
  getPlaybackRate(): number;
  isPaused(): boolean;
  play(): Promise<void> | void;
  pause(): Promise<void> | void;
  seek(positionMs: number): Promise<void> | void;
  setPlaybackRate(rate: number): void;
}

export function getExpectedPositionMs(playback: PlaybackState, clockOffsetMs: number): number {
  if (playback.status !== 'playing') {
    return playback.anchorPositionMs;
  }
  const serverNow = Date.now() + clockOffsetMs;
  const elapsed = Math.max(0, serverNow - playback.anchorServerTimeMs);
  return Math.max(0, playback.anchorPositionMs + elapsed * playback.playbackRate);
}

export function usePlaybackSync(params: {
  playback: PlaybackState | undefined;
  clockOffsetMs: number;
  adapter: PlayerAdapter | null;
  mediaReady: boolean;
  sendEvent: (event: ClientEvent) => void;
}) {
  const { playback, clockOffsetMs, adapter, mediaReady, sendEvent } = params;
  const [driftMs, setDriftMs] = useState<number | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const suppressUntilRef = useRef<number>(0);
  const lastVersionRef = useRef<number>(-1);
  const playbackRef = useRef<PlaybackState | undefined>(playback);
  playbackRef.current = playback;

  const markLocalSuppression = useCallback((ms = 750) => {
    suppressUntilRef.current = Date.now() + ms;
  }, []);

  const isSuppressed = useCallback(() => {
    return Date.now() < suppressUntilRef.current;
  }, []);

  useEffect(() => {
    if (!playback || !adapter || !mediaReady) return;
    if (playback.status === 'idle') return;

    const versionChanged = playback.version !== lastVersionRef.current;
    lastVersionRef.current = playback.version;
    if (!versionChanged) return;

    const expected = getExpectedPositionMs(playback, clockOffsetMs);
    const actual = adapter.getPositionMs();

    markLocalSuppression(900);

    if (playback.status === 'playing') {
      if (Math.abs(actual - expected) > 850) {
        void adapter.seek(expected);
      }
      adapter.setPlaybackRate(1);
      if (adapter.isPaused()) {
        Promise.resolve(adapter.play())
          .then(() => setAutoplayBlocked(false))
          .catch(() => setAutoplayBlocked(true));
      } else {
        setAutoplayBlocked(false);
      }
    } else {
      setAutoplayBlocked(false);
      adapter.setPlaybackRate(1);
      if (!adapter.isPaused()) {
        void adapter.pause();
      }
      if (Math.abs(actual - playback.anchorPositionMs) > 450) {
        void adapter.seek(playback.anchorPositionMs);
      }
    }
  }, [playback, adapter, mediaReady, clockOffsetMs, markLocalSuppression]);

  useEffect(() => {
    if (!adapter || !mediaReady) return;

    const interval = window.setInterval(() => {
      const current = playbackRef.current;
      if (!current || current.status === 'idle') return;

      const expected = getExpectedPositionMs(current, clockOffsetMs);
      const actual = adapter.getPositionMs();

      if (current.status === 'playing') {
        const diff = Math.round(actual - expected);
        setDriftMs(diff);
        sendEvent({
          type: 'player:heartbeat',
          positionMs: Math.max(0, Math.round(actual)),
          driftMs: diff
        });

        if (adapter.isPaused() && !autoplayBlocked) {
          markLocalSuppression(600);
          Promise.resolve(adapter.play()).catch(() => setAutoplayBlocked(true));
        }

        const decision = evaluateDrift({
          expectedMs: expected,
          actualMs: actual,
          currentRate: adapter.getPlaybackRate(),
          supportsRateNudge: adapter.supportsRateNudge
        });

        if (decision.action === 'seek') {
          markLocalSuppression(900);
          adapter.setPlaybackRate(decision.targetRate);
          void adapter.seek(decision.seekToMs);
        } else if (decision.action === 'nudge') {
          adapter.setPlaybackRate(decision.targetRate);
        }
      } else {
        setDriftMs(0);
        if (!adapter.isPaused()) {
          markLocalSuppression(600);
          void adapter.pause();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [adapter, mediaReady, clockOffsetMs, sendEvent, autoplayBlocked, markLocalSuppression]);

  const resumeAfterAutoplayBlock = useCallback(async () => {
    if (!adapter || !playbackRef.current) return;
    const expected = getExpectedPositionMs(playbackRef.current, clockOffsetMs);
    markLocalSuppression(900);
    await adapter.seek(expected);
    try {
      await adapter.play();
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
    }
  }, [adapter, clockOffsetMs, markLocalSuppression]);

  return {
    driftMs,
    autoplayBlocked,
    resumeAfterAutoplayBlock,
    isSuppressed,
    markLocalSuppression
  };
}
