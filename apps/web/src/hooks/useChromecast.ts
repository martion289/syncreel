import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaDetails, StreamSessionResponse } from '@syncreel/shared';
import type { PlayerAdapter } from './usePlaybackSync.js';

export function useChromecast(params: {
  roomCode: string;
  media: MediaDetails | null;
  stream: StreamSessionResponse | null;
  activeSubtitleId: number | null;
  initialPositionMs: number;
  shouldAutoPlay: boolean;
  onRemotePlayPause?: (isPaused: boolean, positionMs: number) => void;
  onCastStateChange?: (isCasting: boolean) => void;
}) {
  const {
    media,
    stream,
    activeSubtitleId,
    initialPositionMs,
    shouldAutoPlay,
    onRemotePlayPause,
    onCastStateChange
  } = params;

  const [castAvailable, setCastAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);

  const playerRef = useRef<RemotePlayer | null>(null);
  const controllerRef = useRef<RemotePlayerController | null>(null);
  const lastLoadedStreamTokenRef = useRef<string | null>(null);
  const onRemotePlayPauseRef = useRef(onRemotePlayPause);
  onRemotePlayPauseRef.current = onRemotePlayPause;

  useEffect(() => {
    const initCast = () => {
      const fw = window.cast?.framework;
      const castMedia = window.chrome?.cast?.media;
      const autoJoin = window.chrome?.cast?.AutoJoinPolicy;
      if (!fw || !castMedia || !autoJoin) return;

      const ctx = fw.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: castMedia.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: autoJoin.ORIGIN_SCOPED
      });

      const player = new fw.RemotePlayer();
      const controller = new fw.RemotePlayerController(player);
      playerRef.current = player;
      controllerRef.current = controller;

      setCastAvailable(true);
      const connectedNow = Boolean(ctx.getCurrentSession() && player.isConnected);
      setIsCasting(connectedNow);

      const onSessionState = () => {
        const active = Boolean(ctx.getCurrentSession());
        setIsCasting(active);
        onCastStateChange?.(active);
        if (!active) {
          lastLoadedStreamTokenRef.current = null;
        }
      };

      const onPausedChanged = () => {
        if (!player.isConnected || !player.isMediaLoaded) return;
        onRemotePlayPauseRef.current?.(player.isPaused, Math.round(player.currentTime * 1000));
      };

      ctx.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, onSessionState);
      controller.addEventListener(fw.RemotePlayerEventType.IS_PAUSED_CHANGED, onPausedChanged);

      return () => {
        ctx.removeEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, onSessionState);
        controller.removeEventListener(fw.RemotePlayerEventType.IS_PAUSED_CHANGED, onPausedChanged);
      };
    };

    if (window.cast?.framework) {
      return initCast();
    }

    let cleanup: (() => void) | undefined;
    window.__onGCastApiAvailable = (available: boolean) => {
      if (available) {
        cleanup = initCast();
      }
    };

    return () => {
      cleanup?.();
    };
  }, [onCastStateChange]);

  useEffect(() => {
    if (!isCasting || !stream || !media) return;
    if (lastLoadedStreamTokenRef.current === stream.streamToken) return;

    const fw = window.cast?.framework;
    const castMedia = window.chrome?.cast?.media;
    const session = fw?.CastContext.getInstance().getCurrentSession();
    if (!session || !castMedia) return;

    const absHlsUrl = new URL(stream.hlsUrl, window.location.origin).toString();
    const mediaInfo = new castMedia.MediaInfo(absHlsUrl, 'application/x-mpegurl');
    mediaInfo.streamType = 'BUFFERED';

    const meta = new castMedia.GenericMediaMetadata();
    meta.title = media.title;
    meta.subtitle = media.grandparentTitle || (media.year ? String(media.year) : 'SyncReel');
    mediaInfo.metadata = meta;

    const activeTrackIds: number[] = [];
    mediaInfo.tracks = stream.textSubtitles.map((t, index) => {
      const trackId = index + 1;
      const track = new castMedia.Track(trackId, castMedia.TrackType.TEXT);
      track.trackContentId = new URL(t.url, window.location.origin).toString();
      track.trackContentType = 'text/vtt';
      track.subtype = castMedia.TextTrackType.SUBTITLES;
      track.name = t.label;
      track.language = t.languageCode;
      if (activeSubtitleId && t.streamId === activeSubtitleId) {
        activeTrackIds.push(trackId);
      }
      return track;
    });

    const req = new castMedia.LoadRequest(mediaInfo);
    req.currentTime = Math.max(0, initialPositionMs / 1000);
    req.autoplay = shouldAutoPlay;
    req.activeTrackIds = activeTrackIds;

    lastLoadedStreamTokenRef.current = stream.streamToken;
    void session.loadMedia(req).catch(() => {
      lastLoadedStreamTokenRef.current = null;
    });
  }, [isCasting, stream, media, activeSubtitleId, initialPositionMs, shouldAutoPlay]);

  const startOrStopCast = useCallback(async () => {
    const fw = window.cast?.framework;
    if (!fw) return;
    const ctx = fw.CastContext.getInstance();
    const current = ctx.getCurrentSession();
    if (current) {
      current.endSession(true);
      setIsCasting(false);
      onCastStateChange?.(false);
    } else {
      try {
        await ctx.requestSession();
      } catch {
        // User dismissed cast picker
      }
    }
  }, [onCastStateChange]);

  const castAdapter: PlayerAdapter | null = useMemo(() => {
    if (!isCasting) return null;
    return {
      supportsRateNudge: false,
      getPositionMs: () => Math.round((playerRef.current?.currentTime ?? 0) * 1000),
      getPlaybackRate: () => 1,
      isPaused: () => Boolean(playerRef.current?.isPaused ?? true),
      play: () => {
        if (playerRef.current?.isPaused) {
          controllerRef.current?.playOrPause();
        }
      },
      pause: () => {
        if (playerRef.current && !playerRef.current.isPaused) {
          controllerRef.current?.playOrPause();
        }
      },
      seek: (positionMs: number) => {
        if (playerRef.current && controllerRef.current) {
          playerRef.current.currentTime = Math.max(0, positionMs / 1000);
          controllerRef.current.seek();
        }
      },
      setPlaybackRate: () => {}
    };
  }, [isCasting]);

  return {
    castAvailable,
    isCasting,
    startOrStopCast,
    castAdapter
  };
}
