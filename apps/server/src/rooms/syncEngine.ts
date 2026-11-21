import type { ParticipantRole, PlaybackState } from '@syncreel/shared';

export interface SyncActionResult {
  changed: boolean;
  reason?: string;
  state: PlaybackState;
}

export interface SyncEngineOptions {
  hostOnlyControl?: boolean;
  bufferTimeoutMs?: number;
  now?: () => number;
  onBufferTimeout?: (evictedIds: string[], state: PlaybackState) => void;
}

export class SyncEngine {
  private state: PlaybackState;
  private hostOnlyControl: boolean;
  private readonly bufferTimeoutMs: number;
  private readonly now: () => number;
  private readonly onBufferTimeout?: (evictedIds: string[], state: PlaybackState) => void;
  private resumeAfterBuffer = false;
  private bufferTimer: NodeJS.Timeout | null = null;

  constructor(options: SyncEngineOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.hostOnlyControl = options.hostOnlyControl ?? false;
    this.bufferTimeoutMs = options.bufferTimeoutMs ?? 12_000;
    this.onBufferTimeout = options.onBufferTimeout;
    this.state = {
      status: 'idle',
      anchorPositionMs: 0,
      anchorServerTimeMs: this.now(),
      playbackRate: 1,
      version: 0,
      bufferingParticipantIds: []
    };
  }

  getHostOnlyControl(): boolean {
    return this.hostOnlyControl;
  }

  setHostOnlyControl(enabled: boolean): void {
    this.hostOnlyControl = enabled;
  }

  canControl(role: ParticipantRole): boolean {
    return !this.hostOnlyControl || role === 'host';
  }

  getState(): PlaybackState {
    return {
      ...this.state,
      bufferingParticipantIds: [...this.state.bufferingParticipantIds]
    };
  }

  getProjectedPositionMs(atMs = this.now()): number {
    if (this.state.status !== 'playing') {
      return this.state.anchorPositionMs;
    }
    const elapsed = Math.max(0, atMs - this.state.anchorServerTimeMs);
    return Math.max(0, Math.round(this.state.anchorPositionMs + elapsed * this.state.playbackRate));
  }

  loadMedia(startPositionMs = 0, actorName?: string): PlaybackState {
    this.clearBufferTimer();
    this.resumeAfterBuffer = false;
    this.state = {
      status: 'paused',
      anchorPositionMs: Math.max(0, Math.round(startPositionMs)),
      anchorServerTimeMs: this.now(),
      playbackRate: 1,
      version: this.state.version + 1,
      bufferingParticipantIds: [],
      updatedBy: actorName
    };
    return this.getState();
  }

  clearMedia(): PlaybackState {
    this.clearBufferTimer();
    this.resumeAfterBuffer = false;
    this.state = {
      status: 'idle',
      anchorPositionMs: 0,
      anchorServerTimeMs: this.now(),
      playbackRate: 1,
      version: this.state.version + 1,
      bufferingParticipantIds: []
    };
    return this.getState();
  }

  play(positionMs: number, role: ParticipantRole, actorName: string): SyncActionResult {
    if (!this.canControl(role)) {
      return { changed: false, reason: 'Host-only playback control is enabled', state: this.getState() };
    }
    if (this.state.status === 'idle') {
      return { changed: false, reason: 'No media loaded', state: this.getState() };
    }

    this.clearBufferTimer();
    this.resumeAfterBuffer = false;
    this.state = {
      status: 'playing',
      anchorPositionMs: Math.max(0, Math.round(positionMs)),
      anchorServerTimeMs: this.now(),
      playbackRate: 1,
      version: this.state.version + 1,
      bufferingParticipantIds: [],
      updatedBy: actorName
    };
    return { changed: true, state: this.getState() };
  }

  pause(positionMs: number, role: ParticipantRole, actorName: string): SyncActionResult {
    if (!this.canControl(role)) {
      return { changed: false, reason: 'Host-only playback control is enabled', state: this.getState() };
    }
    if (this.state.status === 'idle') {
      return { changed: false, reason: 'No media loaded', state: this.getState() };
    }

    this.clearBufferTimer();
    this.resumeAfterBuffer = false;
    this.state = {
      status: 'paused',
      anchorPositionMs: Math.max(0, Math.round(positionMs)),
      anchorServerTimeMs: this.now(),
      playbackRate: 1,
      version: this.state.version + 1,
      bufferingParticipantIds: [],
      updatedBy: actorName
    };
    return { changed: true, state: this.getState() };
  }

  seek(positionMs: number, role: ParticipantRole, actorName: string): SyncActionResult {
    if (!this.canControl(role)) {
      return { changed: false, reason: 'Host-only playback control is enabled', state: this.getState() };
    }
    if (this.state.status === 'idle') {
      return { changed: false, reason: 'No media loaded', state: this.getState() };
    }

    const nextStatus =
      this.state.status === 'buffering'
        ? this.resumeAfterBuffer
          ? 'playing'
          : 'paused'
        : this.state.status;

    this.clearBufferTimer();
    this.resumeAfterBuffer = false;

    this.state = {
      status: nextStatus,
      anchorPositionMs: Math.max(0, Math.round(positionMs)),
      anchorServerTimeMs: this.now(),
      playbackRate: 1,
      version: this.state.version + 1,
      bufferingParticipantIds: [],
      updatedBy: actorName
    };
    return { changed: true, state: this.getState() };
  }

  skipMarker(targetPositionMs: number, role: ParticipantRole, actorName: string): SyncActionResult {
    return this.seek(targetPositionMs, role, actorName);
  }

  setBuffering(participantId: string, isBuffering: boolean): SyncActionResult {
    if (this.state.status === 'idle') {
      return { changed: false, state: this.getState() };
    }

    const exists = this.state.bufferingParticipantIds.includes(participantId);

    if (isBuffering) {
      if (this.state.status !== 'playing' && this.state.status !== 'buffering') {
        // Ignore buffering notifications while room is explicitly paused
        return { changed: false, state: this.getState() };
      }
      if (exists && this.state.status === 'buffering') {
        return { changed: false, state: this.getState() };
      }

      const nowMs = this.now();
      const frozenPos =
        this.state.status === 'playing'
          ? this.getProjectedPositionMs(nowMs)
          : this.state.anchorPositionMs;

      if (this.state.status === 'playing') {
        this.resumeAfterBuffer = true;
      }

      this.state = {
        ...this.state,
        status: 'buffering',
        anchorPositionMs: frozenPos,
        anchorServerTimeMs: nowMs,
        version: this.state.version + 1,
        bufferingParticipantIds: exists
          ? [...this.state.bufferingParticipantIds]
          : [...this.state.bufferingParticipantIds, participantId]
      };

      this.armBufferTimer();
      return { changed: true, state: this.getState() };
    }

    // Buffering cleared
    if (!exists) {
      return { changed: false, state: this.getState() };
    }

    const remaining = this.state.bufferingParticipantIds.filter((id) => id !== participantId);
    if (remaining.length > 0) {
      this.state = {
        ...this.state,
        version: this.state.version + 1,
        bufferingParticipantIds: remaining
      };
      return { changed: true, state: this.getState() };
    }

    this.clearBufferTimer();
    const nextStatus =
      this.state.status === 'buffering'
        ? this.resumeAfterBuffer
          ? 'playing'
          : 'paused'
        : this.state.status;
    this.resumeAfterBuffer = false;

    this.state = {
      ...this.state,
      status: nextStatus,
      anchorServerTimeMs: this.now(),
      version: this.state.version + 1,
      bufferingParticipantIds: []
    };

    return { changed: true, state: this.getState() };
  }

  removeParticipant(participantId: string): SyncActionResult {
    return this.setBuffering(participantId, false);
  }

  private armBufferTimer(): void {
    this.clearBufferTimer();
    this.bufferTimer = setTimeout(() => {
      this.handleBufferTimeout();
    }, this.bufferTimeoutMs);
    this.bufferTimer.unref();
  }

  private clearBufferTimer(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  private handleBufferTimeout(): void {
    this.bufferTimer = null;
    if (this.state.status !== 'buffering' || this.state.bufferingParticipantIds.length === 0) {
      return;
    }

    const evicted = [...this.state.bufferingParticipantIds];
    const nextStatus = this.resumeAfterBuffer ? 'playing' : 'paused';
    this.resumeAfterBuffer = false;

    this.state = {
      ...this.state,
      status: nextStatus,
      anchorServerTimeMs: this.now(),
      version: this.state.version + 1,
      bufferingParticipantIds: []
    };

    this.onBufferTimeout?.(evicted, this.getState());
  }

  destroy(): void {
    this.clearBufferTimer();
  }
}
