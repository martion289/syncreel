import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Hls from 'hls.js';
import {
  QUALITY_PRESETS,
  type ClientEvent,
  type MediaDetails,
  type Participant,
  type ParticipantRole,
  type PlaybackState,
  type QualityPreset,
  type ReadyCheckState,
  type StreamMode,
  type StreamSessionResponse
} from '@syncreel/shared';
import {
  Airplay,
  Cast,
  Captions,
  Check,
  Film,
  Flame,
  Leaf,
  Loader2,
  Lock,
  Maximize,
  MessageSquare,
  Minimize,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Settings2,
  Share2,
  SkipForward,
  Users,
  Volume2,
  VolumeX
} from 'lucide-react';
import { api, isGuestPreviewTab } from '../../lib/api.js';
import { formatMediaSubtitle, formatTimeMs } from '../../lib/format.js';
import {
  applyOffsetToCues,
  DEFAULT_SUBTITLE_APPEARANCE,
  getSubtitleCssVars,
  type SubtitleAppearance,
  type SubtitleSizePreset
} from '../../lib/subtitleOffset.js';
import { useAirPlay } from '../../hooks/useAirPlay.js';
import { useChromecast } from '../../hooks/useChromecast.js';
import { useMediaSession } from '../../hooks/useMediaSession.js';
import {
  getExpectedPositionMs,
  usePlaybackSync,
  type PlayerAdapter
} from '../../hooks/usePlaybackSync.js';

interface VideoStageProps {
  roomCode: string;
  media: MediaDetails | null;
  playback: PlaybackState;
  participants: Participant[];
  selfParticipantId: string | null;
  selfRole: ParticipantRole;
  hostOnlyControl: boolean;
  streamMode: StreamMode;
  ecoQuality: QualityPreset;
  readyCheck: ReadyCheckState;
  clockOffsetMs: number;
  hasNextInQueue: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenLibrary?: () => void;
  onOpenSwipeMatch?: () => void;
  onOpenInvite?: () => void;
  overlay?: ReactNode;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  isSelfMuted?: boolean;
  floatingOverlayEnabled?: boolean;
  onToggleFloatingOverlay?: () => void;
  sendEvent: (event: ClientEvent) => void;
}

const SUB_STYLE_STORAGE_KEY = 'syncreel_subtitle_appearance_v1';
const QUICK_CHAT_EMOJIS = ['😂', '🔥', '😱', '❤️', '👏', '🍿'];

export function VideoStage(props: VideoStageProps) {
  const {
    roomCode,
    media,
    playback,
    participants,
    selfParticipantId,
    selfRole,
    hostOnlyControl,
    streamMode,
    ecoQuality,
    readyCheck,
    clockOffsetMs,
    hasNextInQueue,
    isSidebarOpen,
    onToggleSidebar,
    onOpenLibrary,
    onOpenSwipeMatch,
    onOpenInvite,
    overlay,
    onFullscreenChange,
    isSelfMuted = false,
    floatingOverlayEnabled = true,
    onToggleFloatingOverlay,
    sendEvent
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [quality, setQuality] = useState<QualityPreset>('original');
  const [audioStreamId, setAudioStreamId] = useState<number | undefined>(undefined);
  const [burnInSubtitleId, setBurnInSubtitleId] = useState<number | undefined>(undefined);
  const [activeTextSubId, setActiveTextSubId] = useState<number | null>(null);

  const [subStyle, setSubStyle] = useState<SubtitleAppearance>(() => {
    try {
      const saved = localStorage.getItem(SUB_STYLE_STORAGE_KEY);
      if (saved) return { ...DEFAULT_SUBTITLE_APPEARANCE, ...JSON.parse(saved) };
    } catch {
      // Ignore storage failures
    }
    return DEFAULT_SUBTITLE_APPEARANCE;
  });

  useEffect(() => {
    try {
      localStorage.setItem(SUB_STYLE_STORAGE_KEY, JSON.stringify(subStyle));
    } catch {
      // Ignore storage failures
    }
  }, [subStyle]);

  const [stream, setStream] = useState<StreamSessionResponse | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mediaReady, setMediaReady] = useState(false);

  const [hudVisible, setHudVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [quickDraft, setQuickDraft] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [displayPosMs, setDisplayPosMs] = useState(0);
  const [countdownNum, setCountdownNum] = useState<number | null>(null);
  const [simulatingBuffer, setSimulatingBuffer] = useState(false);

  const hudTimerRef = useRef<number | null>(null);
  const bufferDebounceRef = useRef<number | null>(null);
  const isBufferingSentRef = useRef(false);

  const canControl = !hostOnlyControl || selfRole === 'host';
  const isPreviewGuest = isGuestPreviewTab();
  const canPip = typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);

  const isSafariNativeHls = useMemo(() => {
    if (typeof document === 'undefined') return false;
    const v = document.createElement('video');
    const nativeSupport = Boolean(v.canPlayType('application/vnd.apple.mpegurl'));
    return nativeSupport && !Hls.isSupported()
      ? true
      : nativeSupport && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
  }, []);

  // Reset track selections when media changes
  useEffect(() => {
    setAudioStreamId(undefined);
    setBurnInSubtitleId(undefined);
    const defaultTextSub = media?.streams.find(
      (s) => s.streamType === 3 && s.isTextSubtitle && (s.selected || s.default)
    );
    setActiveTextSubId(defaultTextSub?.id ?? null);
    setStream(null);
    setMediaReady(false);
    setStreamError(null);
  }, [media?.ratingKey]);

  // Mint HLS stream whenever media, quality, audio, burn-in, or room streamMode changes
  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    setStreamLoading(true);
    setStreamError(null);
    setMediaReady(false);

    const effectiveQuality = streamMode === 'eco-shared' ? ecoQuality : quality;

    api
      .mintStream(roomCode, {
        ratingKey: media.ratingKey,
        quality: effectiveQuality,
        audioStreamId,
        subtitleStreamId: streamMode === 'eco-shared' ? undefined : burnInSubtitleId
      })
      .then((res) => {
        if (!cancelled) {
          setStream(res);
          setStreamLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStreamError(err instanceof Error ? err.message : 'Unable to start stream');
          setStreamLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [roomCode, media?.ratingKey, quality, audioStreamId, burnInSubtitleId, streamMode, ecoQuality]);

  const { canAirPlay, isAirPlayActive, showAirPlayPicker } = useAirPlay(videoEl);

  const handleCastStateChange = useCallback(
    (casting: boolean) => {
      sendEvent({ type: 'player:casting', isCasting: casting });
    },
    [sendEvent]
  );

  const handleRemoteCastPlayPause = useCallback(
    (paused: boolean, posMs: number) => {
      if (!canControl) return;
      sendEvent({
        type: paused ? 'playback:pause' : 'playback:play',
        positionMs: posMs
      });
    },
    [canControl, sendEvent]
  );

  const { castAvailable, isCasting, startOrStopCast, castAdapter } = useChromecast({
    roomCode,
    media,
    stream,
    activeSubtitleId: activeTextSubId,
    initialPositionMs: getExpectedPositionMs(playback, clockOffsetMs),
    shouldAutoPlay: playback.status === 'playing',
    onRemotePlayPause: handleRemoteCastPlayPause,
    onCastStateChange: handleCastStateChange
  });

  useEffect(() => {
    if (!isCasting) {
      sendEvent({ type: 'player:casting', isCasting: isAirPlayActive });
    }
  }, [isAirPlayActive, isCasting, sendEvent]);

  // Mount HLS stream onto local <video>
  useEffect(() => {
    if (!videoEl || !stream || isCasting) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    setMediaReady(false);

    const onReady = () => setMediaReady(true);

    if (isSafariNativeHls) {
      videoEl.src = stream.hlsUrl;
      videoEl.addEventListener('loadedmetadata', onReady, { once: true });
      return () => {
        videoEl.removeEventListener('loadedmetadata', onReady);
        videoEl.removeAttribute('src');
        videoEl.load();
      };
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        backBufferLength: 30,
        maxBufferLength: 30
      });
      hlsRef.current = hls;
      hls.loadSource(stream.hlsUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, onReady);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setStreamError('Video playback encountered a fatal HLS error');
          }
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    setStreamError('This browser does not support HLS video playback.');
  }, [videoEl, stream, isSafariNativeHls, isCasting]);

  // Keep sidecar/extracted WebVTT tracks synced and apply per-viewer offset
  useEffect(() => {
    if (!videoEl) return;
    const applyAll = () => {
      const tracks = videoEl.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const showing = activeTextSubId !== null && t.id === `sub-${activeTextSubId}`;
        t.mode = showing ? 'showing' : 'disabled';
        if (showing && t.cues) {
          applyOffsetToCues(Array.from(t.cues), subStyle.offsetMs);
        }
      }
    };

    applyAll();
    const id = window.setInterval(applyAll, 1500);
    return () => clearInterval(id);
  }, [videoEl, activeTextSubId, stream, subStyle.offsetMs]);

  // Inject dynamic subtitle cue styling CSS
  const cueVars = useMemo(() => getSubtitleCssVars(subStyle), [subStyle]);

  const localAdapter: PlayerAdapter | null = useMemo(() => {
    if (!videoEl) return null;
    return {
      supportsRateNudge: true,
      getPositionMs: () => Math.round((videoEl.currentTime || 0) * 1000),
      getPlaybackRate: () => videoEl.playbackRate || 1,
      isPaused: () => videoEl.paused,
      play: () => videoEl.play(),
      pause: () => videoEl.pause(),
      seek: (posMs: number) => {
        if (Number.isFinite(posMs)) {
          videoEl.currentTime = Math.max(0, posMs / 1000);
        }
      },
      setPlaybackRate: (rate: number) => {
        videoEl.playbackRate = rate;
      }
    };
  }, [videoEl]);

  const activeAdapter = isCasting ? castAdapter : localAdapter;
  const activeMediaReady = isCasting ? Boolean(stream) : mediaReady;

  const {
    driftMs,
    autoplayBlocked,
    resumeAfterAutoplayBlock,
    markLocalSuppression
  } = usePlaybackSync({
    playback,
    clockOffsetMs,
    adapter: activeAdapter,
    mediaReady: activeMediaReady,
    sendEvent
  });

  useEffect(() => {
    if (isCasting && videoEl && !videoEl.paused) {
      videoEl.pause();
    }
  }, [isCasting, videoEl]);

  // Emit buffering state cleanly
  useEffect(() => {
    if (!videoEl || isCasting) return;

    const clearPendingBuffer = () => {
      if (bufferDebounceRef.current !== null) {
        clearTimeout(bufferDebounceRef.current);
        bufferDebounceRef.current = null;
      }
    };

    const onWaiting = () => {
      if (playback.status !== 'playing' || videoEl.seeking) return;
      clearPendingBuffer();
      bufferDebounceRef.current = window.setTimeout(() => {
        if (!isBufferingSentRef.current) {
          isBufferingSentRef.current = true;
          sendEvent({ type: 'player:buffering', isBuffering: true });
        }
      }, 350);
    };

    const onPlaying = () => {
      clearPendingBuffer();
      if (isBufferingSentRef.current && !simulatingBuffer) {
        isBufferingSentRef.current = false;
        sendEvent({ type: 'player:buffering', isBuffering: false });
      }
    };

    videoEl.addEventListener('waiting', onWaiting);
    videoEl.addEventListener('playing', onPlaying);
    videoEl.addEventListener('canplay', onPlaying);
    return () => {
      clearPendingBuffer();
      videoEl.removeEventListener('waiting', onWaiting);
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('canplay', onPlaying);
    };
  }, [videoEl, isCasting, playback.status, simulatingBuffer, sendEvent]);

  // Ready Check 3-2-1 Countdown ticker
  useEffect(() => {
    const endAt = readyCheck.countdownEndServerTimeMs;
    if (!readyCheck.active || !endAt) {
      setCountdownNum(null);
      return;
    }

    const update = () => {
      const serverNow = Date.now() + clockOffsetMs;
      const rem = endAt - serverNow;
      if (rem <= 0) {
        setCountdownNum(null);
      } else {
        setCountdownNum(Math.ceil(rem / 1000));
      }
    };
    update();
    const id = window.setInterval(update, 100);
    return () => clearInterval(id);
  }, [readyCheck.active, readyCheck.countdownEndServerTimeMs, clockOffsetMs]);

  // Smooth HUD timeline counter
  useEffect(() => {
    const tick = () => {
      if (isCasting && castAdapter) {
        setDisplayPosMs(castAdapter.getPositionMs());
      } else if (videoEl && !isCasting) {
        setDisplayPosMs(Math.round((videoEl.currentTime || 0) * 1000));
      } else {
        setDisplayPosMs(getExpectedPositionMs(playback, clockOffsetMs));
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [videoEl, isCasting, castAdapter, playback, clockOffsetMs]);

  const wakeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current !== null) clearTimeout(hudTimerRef.current);
    if (playback.status === 'playing' && !settingsOpen && !quickChatOpen) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 3000);
    }
  }, [playback.status, settingsOpen, quickChatOpen]);

  useEffect(() => {
    if (playback.status !== 'playing' || settingsOpen || quickChatOpen) {
      setHudVisible(true);
      if (hudTimerRef.current !== null) clearTimeout(hudTimerRef.current);
    } else {
      wakeHud();
    }
  }, [playback.status, settingsOpen, quickChatOpen, wakeHud]);

  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const onFs = () => {
      const fs = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      setIsFullscreen(fs);
      onFullscreenChange?.(fs);
      if (!fs && isSidebarOpen) {
        setQuickChatOpen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, [onFullscreenChange, isSidebarOpen]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    if (!el) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen().catch(() => undefined);
      } else if (doc.webkitExitFullscreen) {
        await Promise.resolve(doc.webkitExitFullscreen()).catch(() => undefined);
      }
    } else if (el.requestFullscreen) {
      await el.requestFullscreen().catch(() => undefined);
    } else if (el.webkitRequestFullscreen) {
      await Promise.resolve(el.webkitRequestFullscreen()).catch(() => undefined);
    }
  }, []);

  const togglePip = useCallback(async () => {
    if (!videoEl || !canPip) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => undefined);
    } else {
      await videoEl.requestPictureInPicture().catch(() => undefined);
    }
  }, [videoEl, canPip]);

  const togglePlayPause = useCallback(() => {
    if (!media || !canControl) return;
    const pos = activeAdapter ? activeAdapter.getPositionMs() : displayPosMs;
    markLocalSuppression(500);
    if (playback.status === 'playing') {
      sendEvent({ type: 'playback:pause', positionMs: pos });
    } else {
      sendEvent({ type: 'playback:play', positionMs: pos });
    }
  }, [media, canControl, activeAdapter, displayPosMs, markLocalSuppression, playback.status, sendEvent]);

  const seekBy = useCallback(
    (deltaMs: number) => {
      if (!media || !canControl) return;
      const cur = activeAdapter ? activeAdapter.getPositionMs() : displayPosMs;
      const maxMs = media.durationMs || cur + Math.max(0, deltaMs);
      const next = Math.max(0, Math.min(maxMs, cur + deltaMs));
      markLocalSuppression(500);
      sendEvent({ type: 'playback:seek', positionMs: next });
    },
    [media, canControl, activeAdapter, displayPosMs, markLocalSuppression, sendEvent]
  );

  // OS Media Session API integration (phone lock screens, AirPods, media keys)
  useMediaSession({
    roomCode,
    media,
    status: playback.status,
    canControl,
    onPlay: () => {
      const pos = activeAdapter ? activeAdapter.getPositionMs() : displayPosMs;
      markLocalSuppression(500);
      sendEvent({ type: 'playback:play', positionMs: pos });
    },
    onPause: () => {
      const pos = activeAdapter ? activeAdapter.getPositionMs() : displayPosMs;
      markLocalSuppression(500);
      sendEvent({ type: 'playback:pause', positionMs: pos });
    },
    onSeekBy: seekBy
  });

  const toggleMute = useCallback(() => {
    if (!videoEl) return;
    const nextMuted = !videoEl.muted;
    videoEl.muted = nextMuted;
    setIsMuted(nextMuted);
  }, [videoEl]);

  const cycleCaptions = useCallback(() => {
    const textSubs = media?.streams.filter((s) => s.streamType === 3 && s.isTextSubtitle) ?? [];
    if (textSubs.length === 0) return;
    if (activeTextSubId === null) {
      setActiveTextSubId(textSubs[0].id);
    } else {
      const idx = textSubs.findIndex((s) => s.id === activeTextSubId);
      setActiveTextSubId(idx >= 0 && idx + 1 < textSubs.length ? textSubs[idx + 1].id : null);
    }
  }, [media, activeTextSubId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }

      wakeHud();
      switch (e.key) {
        case ' ':
        case 'k':
        case 'MediaPlayPause':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'MediaPlay':
          if (playback.status !== 'playing') {
            e.preventDefault();
            togglePlayPause();
          }
          break;
        case 'MediaPause':
          if (playback.status === 'playing') {
            e.preventDefault();
            togglePlayPause();
          }
          break;
        case 'ArrowLeft':
        case 'MediaRewind':
          if (media) {
            e.preventDefault();
            seekBy(-10_000);
          }
          break;
        case 'ArrowRight':
        case 'MediaFastForward':
          if (media) {
            e.preventDefault();
            seekBy(10_000);
          }
          break;
        case 'f':
          e.preventDefault();
          void toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'c':
          e.preventDefault();
          cycleCaptions();
          break;
        case 't':
          e.preventDefault();
          onToggleSidebar();
          break;
        case 'Escape':
          if (quickChatOpen) {
            setQuickChatOpen(false);
          } else {
            setSettingsOpen(false);
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    wakeHud,
    togglePlayPause,
    playback.status,
    media,
    seekBy,
    toggleFullscreen,
    toggleMute,
    cycleCaptions,
    onToggleSidebar,
    quickChatOpen
  ]);

  const activeIntro = useMemo(() => {
    if (!media) return null;
    return (
      media.markers.find(
        (m) => m.type === 'intro' && displayPosMs >= m.startMs - 500 && displayPosMs < m.endMs - 1000
      ) ?? null
    );
  }, [media, displayPosMs]);

  const activeCredits = useMemo(() => {
    if (!media) return null;
    return (
      media.markers.find(
        (m) => m.type === 'credits' && displayPosMs >= m.startMs && displayPosMs <= m.endMs
      ) ?? null
    );
  }, [media, displayPosMs]);

  const showNextEpisodeBtn = Boolean(
    media && (hasNextInQueue || media.nextEpisode) &&
      (activeCredits || (media.durationMs > 0 && media.durationMs - displayPosMs <= 12_000))
  );

  const bufferingNames = useMemo(() => {
    return playback.bufferingParticipantIds
      .map((id) => participants.find((p) => p.id === id)?.name)
      .filter((n): n is string => Boolean(n));
  }, [playback.bufferingParticipantIds, participants]);

  const audioStreams = useMemo(
    () => media?.streams.filter((s) => s.streamType === 2) ?? [],
    [media]
  );
  const subtitleStreams = useMemo(
    () => media?.streams.filter((s) => s.streamType === 3) ?? [],
    [media]
  );

  const selfIsReady = selfParticipantId
    ? readyCheck.readyParticipantIds.includes(selfParticipantId)
    : false;

  const durationMs = media?.durationMs || 0;
  const progressPct = durationMs > 0 ? Math.min(100, (displayPosMs / durationMs) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={wakeHud}
      onTouchStart={wakeHud}
      className="relative flex-1 bg-black overflow-hidden select-none flex items-center justify-center min-h-[260px]"
    >
      {/* Dynamic Per-Viewer Subtitle Styling */}
      <style>{`.syncreel-video::cue { font-size: ${cueVars.fontSize}; background-color: ${cueVars.bgColor}; }`}</style>

      {/* Empty Stage before media is chosen */}
      {!media && (
        <div className="flex flex-col items-center justify-center text-center px-6 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-[#101216] border border-white/12 flex items-center justify-center mb-5 text-[#F5F7FA]">
            <Film className="w-8 h-8" />
          </div>
          <h2 className="font-display text-xl font-semibold text-[#F5F7FA] mb-2">
            Screening room is ready
          </h2>
          <p className="text-sm text-[#98A0B0] leading-relaxed mb-6">
            {selfRole === 'host'
              ? 'Choose a title from your library or launch Swipe Match to pick something together.'
              : 'Waiting for the host to pick a movie or start Swipe Match.'}
          </p>
          {(selfRole === 'host' || onOpenInvite) && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {selfRole === 'host' && onOpenLibrary && (
                <button
                  onClick={onOpenLibrary}
                  className="px-5 py-2.5 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  Browse Library
                </button>
              )}
              {selfRole === 'host' && onOpenSwipeMatch && (
                <button
                  onClick={onOpenSwipeMatch}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#101216] border border-white/12 text-[#F5F7FA] font-semibold text-sm hover:border-white/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <Flame className="w-4 h-4" />
                  <span>Swipe Match</span>
                </button>
              )}
              {onOpenInvite && (
                <button
                  type="button"
                  onClick={onOpenInvite}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#101216] border border-white/12 text-[#F5F7FA] font-semibold text-sm hover:border-white/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Invite Friends</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Video Element */}
      {media && (
        <video
          ref={setVideoEl}
          playsInline
          crossOrigin="anonymous"
          onClick={() => {
            if (isCasting) return;
            togglePlayPause();
          }}
          className={`syncreel-video w-full h-full object-contain ${
            isCasting ? 'opacity-20' : 'opacity-100'
          }`}
        >
          {stream?.textSubtitles.map((sub) => (
            <track
              key={sub.streamId}
              id={`sub-${sub.streamId}`}
              kind="subtitles"
              label={sub.label}
              srcLang={sub.languageCode}
              src={sub.url}
              default={activeTextSubId === sub.streamId}
            />
          ))}
        </video>
      )}

      {/* Chromecast Active Overlay */}
      {media && isCasting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07080A]/88 text-center px-6 pointer-events-none">
          <Cast className="w-10 h-10 text-[#F5F7FA] mb-3" />
          <p className="font-display text-base font-semibold text-[#F5F7FA]">Casting to TV</p>
          <p className="text-sm text-[#98A0B0] mt-1">{media.title}</p>
        </div>
      )}

      {/* Fullscreen-Safe Floating Messages, Emoji Bursts & Match Banners */}
      {overlay}

      {/* Ready Check & Synced 3-2-1 Countdown Overlay */}
      {readyCheck.active && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
          {countdownNum !== null ? (
            <div className="text-center space-y-2">
              <p className="text-xs uppercase tracking-[0.25em] text-[#98A0B0] font-semibold">
                Starting Together
              </p>
              <div className="text-7xl font-bold font-mono text-[#F5F7FA] tabular-nums">
                {countdownNum}
              </div>
            </div>
          ) : (
            <div className="w-full max-w-sm rounded-2xl bg-[#101216] border border-white/12 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-[#F5F7FA]">
                  <Users className="w-4 h-4" />
                  <span>Ready Check</span>
                </div>
                <span className="font-mono text-xs text-[#98A0B0]">
                  {readyCheck.readyParticipantIds.length}/{participants.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {participants.map((p) => {
                  const rdy = readyCheck.readyParticipantIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#07080A] border border-white/10 text-xs"
                    >
                      <span className="text-[#F5F7FA] font-medium">{p.name}</span>
                      <span className={rdy ? 'text-[#22C55E] font-semibold' : 'text-[#5C6475]'}>
                        {rdy ? 'Ready ✓' : 'Waiting…'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => sendEvent({ type: 'ready:ack', ready: !selfIsReady })}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${
                    selfIsReady
                      ? 'bg-[#22C55E]/15 border border-[#22C55E] text-[#22C55E]'
                      : 'bg-[#F5F7FA] text-[#07080A] hover:bg-white'
                  }`}
                >
                  {selfIsReady ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Check className="w-4 h-4" /> Ready — Waiting for group
                    </span>
                  ) : (
                    "I'm Ready"
                  )}
                </button>

                {selfRole === 'host' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendEvent({ type: 'ready:launchNow' })}
                      className="flex-1 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                    >
                      Start Anyway (3-2-1)
                    </button>
                    <button
                      onClick={() => sendEvent({ type: 'ready:cancel' })}
                      className="px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs text-[#98A0B0] hover:text-[#F5F7FA]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stream Loading / Error Banner */}
      {media && (streamLoading || streamError) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          {streamError ? (
            <div className="bg-[#101216] border border-[#F43F5E]/40 text-[#F5F7FA] px-5 py-4 rounded-xl max-w-sm text-center pointer-events-auto">
              <p className="text-sm font-medium text-[#F43F5E] mb-1">Stream Error</p>
              <p className="text-xs text-[#98A0B0]">{streamError}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 bg-[#101216]/95 border border-white/12 px-4 py-2.5 rounded-full text-sm text-[#F5F7FA]">
              <Loader2 className="w-4 h-4 animate-spin text-[#F5F7FA]" />
              <span>Preparing stream…</span>
            </div>
          )}
        </div>
      )}

      {/* Autoplay Blocked Gesture Prompt */}
      {media && autoplayBlocked && !readyCheck.active && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-20">
          <button
            onClick={() => void resumeAfterAutoplayBlock()}
            className="flex items-center gap-3 px-6 py-3.5 rounded-full bg-[#F5F7FA] text-[#07080A] font-semibold text-base hover:bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Tap to Join Synced Playback</span>
          </button>
        </div>
      )}

      {/* Buffering Barrier Status */}
      {media && playback.status === 'buffering' && bufferingNames.length > 0 && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#101216]/95 border border-white/15 text-xs font-medium text-[#F5F7FA]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F5F7FA]" />
          <span>Waiting for {bufferingNames.join(', ')} to buffer…</span>
        </div>
      )}

      {/* Synced Skip Intro / Next Episode Action Pills */}
      {media && (activeIntro || showNextEpisodeBtn || activeCredits) && (
        <div className="absolute bottom-24 right-5 z-20 flex items-center gap-2.5">
          {activeIntro && (
            <button
              disabled={!canControl}
              onClick={() =>
                sendEvent({
                  type: 'playback:skipMarker',
                  targetPositionMs: activeIntro.endMs,
                  markerType: 'intro'
                })
              }
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#101216]/95 border border-white/25 text-[#F5F7FA] text-sm font-semibold hover:bg-[#F5F7FA] hover:text-[#07080A] disabled:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <SkipForward className="w-4 h-4" />
              <span>Skip Intro</span>
            </button>
          )}
          {showNextEpisodeBtn && (
            <button
              disabled={!canControl}
              onClick={() => sendEvent({ type: 'room:queueNext' })}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F5F7FA] text-[#07080A] text-sm font-semibold hover:bg-white disabled:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <SkipForward className="w-4 h-4" />
              <span>{hasNextInQueue ? 'Play Up Next' : 'Next Episode'}</span>
            </button>
          )}
        </div>
      )}

      {/* Top Media Title Overlay */}
      {media && (
        <div
          className={`absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/30 to-transparent transition-opacity duration-200 flex items-start justify-between gap-4 pointer-events-none ${
            hudVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-semibold text-[#F5F7FA] truncate">
              {media.title}
            </h2>
            <p className="text-xs text-[#98A0B0] truncate">{formatMediaSubtitle(media)}</p>
          </div>
          <div className="flex items-center gap-2 pointer-events-auto">
            {isPreviewGuest && (
              <button
                disabled={simulatingBuffer}
                onClick={() => {
                  setSimulatingBuffer(true);
                  isBufferingSentRef.current = true;
                  sendEvent({ type: 'player:buffering', isBuffering: true });
                  window.setTimeout(() => {
                    isBufferingSentRef.current = false;
                    setSimulatingBuffer(false);
                    sendEvent({ type: 'player:buffering', isBuffering: false });
                  }, 4000);
                }}
                className="text-[11px] px-2 py-0.5 rounded bg-[#181B22]/90 border border-white/20 text-[#F5F7FA] hover:bg-[#F5F7FA] hover:text-[#07080A] transition"
              >
                {simulatingBuffer ? 'Buffering (4s)…' : 'Sim 4s Buffer'}
              </button>
            )}
            {streamMode === 'eco-shared' && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[#101216]/85 border border-[#22C55E]/40 text-[#22C55E]">
                <Leaf className="w-3 h-3" />
                Eco
              </span>
            )}
            {driftMs !== null && playback.status === 'playing' && (
              <span
                className={`font-mono text-[11px] px-2 py-0.5 rounded border tabular-nums ${
                  Math.abs(driftMs) < 180
                    ? 'bg-[#101216]/85 border-[#22C55E]/40 text-[#22C55E]'
                    : 'bg-[#101216]/85 border-white/25 text-[#F5F7FA]'
                }`}
              >
                {driftMs >= 0 ? `+${driftMs}ms` : `${driftMs}ms`}
              </span>
            )}
            {hostOnlyControl && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[#101216]/85 border border-white/10 text-[#98A0B0]">
                <Lock className="w-3 h-3 text-[#F5F7FA]" />
                Host Lock
              </span>
            )}
          </div>
        </div>
      )}

      {/* Track, Quality & Subtitle Styling Popover */}
      {media && settingsOpen && (
        <div className="absolute bottom-20 right-4 z-30 w-76 max-h-[68vh] overflow-y-auto rounded-xl bg-[#101216] border border-white/12 p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                {streamMode === 'eco-shared' ? 'Shared Eco Quality' : 'Quality'}
              </p>
              {streamMode === 'eco-shared' && (
                <span className="text-[10px] text-[#22C55E]">1x Shared Transcode</span>
              )}
            </div>

            {streamMode === 'eco-shared' && selfRole !== 'host' ? (
              <p className="text-xs text-[#98A0B0] px-2 py-1.5 rounded bg-[#07080A]">
                Locked to {QUALITY_PRESETS[ecoQuality].shortLabel} (Eco mode managed by host)
              </p>
            ) : (
              <div className="space-y-1">
                {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((presetKey) => {
                  const preset = QUALITY_PRESETS[presetKey];
                  const active =
                    streamMode === 'eco-shared'
                      ? ecoQuality === presetKey
                      : quality === presetKey;
                  return (
                    <button
                      key={presetKey}
                      onClick={() => {
                        if (streamMode === 'eco-shared' && selfRole === 'host') {
                          sendEvent({ type: 'room:updateSettings', ecoQuality: presetKey });
                        } else {
                          setQuality(presetKey);
                        }
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                        active
                          ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                          : 'text-[#F5F7FA] hover:bg-[#181B22]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {audioStreams.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0] mb-2">
                Audio Track
              </p>
              <div className="space-y-1">
                {audioStreams.map((a) => {
                  const active = (audioStreamId ?? stream?.activeAudioStreamId) === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAudioStreamId(a.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                        active
                          ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                          : 'text-[#F5F7FA] hover:bg-[#181B22]'
                      }`}
                    >
                      {a.displayTitle}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {subtitleStreams.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0] mb-2">
                Subtitles
              </p>
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setActiveTextSubId(null);
                    setBurnInSubtitleId(undefined);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    activeTextSubId === null && !burnInSubtitleId
                      ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                      : 'text-[#F5F7FA] hover:bg-[#181B22]'
                  }`}
                >
                  Off
                </button>
                {subtitleStreams.map((sub) => {
                  const isActive = sub.isTextSubtitle
                    ? activeTextSubId === sub.id
                    : burnInSubtitleId === sub.id;
                  const disabledInEco = streamMode === 'eco-shared' && sub.requiresBurnIn;
                  return (
                    <button
                      key={sub.id}
                      disabled={disabledInEco}
                      onClick={() => {
                        if (sub.isTextSubtitle) {
                          setBurnInSubtitleId(undefined);
                          setActiveTextSubId(sub.id);
                        } else {
                          setActiveTextSubId(null);
                          setBurnInSubtitleId(sub.id);
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-lg text-xs transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                        isActive
                          ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                          : 'text-[#F5F7FA] hover:bg-[#181B22]'
                      }`}
                    >
                      <span className="truncate">{sub.displayTitle}</span>
                      {sub.requiresBurnIn && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isActive ? 'bg-black/20 text-[#07080A]' : 'bg-[#181B22] text-[#98A0B0]'
                          }`}
                        >
                          Burn-in
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Subtitle Appearance & Sync Offset */}
          <div className="pt-3 border-t border-white/8 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
              Subtitle Style &amp; Timing
            </p>
            <div className="grid grid-cols-4 gap-1">
              {(['small', 'medium', 'large', 'xlarge'] as SubtitleSizePreset[]).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setSubStyle((prev) => ({ ...prev, size: sz }))}
                  className={`py-1 rounded text-[11px] capitalize ${
                    subStyle.size === sz
                      ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                      : 'bg-[#07080A] text-[#98A0B0]'
                  }`}
                >
                  {sz === 'xlarge' ? 'XL' : sz[0].toUpperCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#98A0B0]">
              <span>Background</span>
              <div className="flex gap-1">
                {([0, 0.5, 0.82] as const).map((op) => (
                  <button
                    key={op}
                    onClick={() => setSubStyle((prev) => ({ ...prev, bgOpacity: op }))}
                    className={`px-2 py-0.5 rounded ${
                      subStyle.bgOpacity === op
                        ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                        : 'bg-[#07080A] text-[#98A0B0]'
                    }`}
                  >
                    {op === 0 ? 'None' : op === 0.5 ? 'Soft' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-[#98A0B0] mb-1">
                <span>Sync Offset</span>
                <span className="font-mono text-[#F5F7FA]">
                  {subStyle.offsetMs >= 0 ? `+${subStyle.offsetMs}ms` : `${subStyle.offsetMs}ms`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    setSubStyle((prev) => ({
                      ...prev,
                      offsetMs: Math.max(-5000, prev.offsetMs - 250)
                    }))
                  }
                  className="px-2 py-1 rounded bg-[#07080A] text-[10px] font-mono text-[#F5F7FA]"
                >
                  -250
                </button>
                <input
                  type="range"
                  min={-5000}
                  max={5000}
                  step={100}
                  value={subStyle.offsetMs}
                  onChange={(e) =>
                    setSubStyle((prev) => ({ ...prev, offsetMs: Number(e.target.value) }))
                  }
                  className="flex-1 accent-[#F5F7FA]"
                />
                <button
                  onClick={() =>
                    setSubStyle((prev) => ({
                      ...prev,
                      offsetMs: Math.min(5000, prev.offsetMs + 250)
                    }))
                  }
                  className="px-2 py-1 rounded bg-[#07080A] text-[10px] font-mono text-[#F5F7FA]"
                >
                  +250
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen / Theater Quick Chat & Emoji Bar */}
      {media && quickChatOpen && (
        <div className="absolute bottom-20 right-4 left-4 sm:left-auto sm:w-[360px] z-30 rounded-2xl bg-[#101216]/94 backdrop-blur-md border border-white/12 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-0.5 flex-1">
              {QUICK_CHAT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => sendEvent({ type: 'chat:react', emoji })}
                  aria-label={`React ${emoji}`}
                  className="flex-1 py-1 rounded-lg text-base hover:bg-white/10 active:scale-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {onToggleFloatingOverlay && (
              <button
                type="button"
                onClick={onToggleFloatingOverlay}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold border whitespace-nowrap transition ${
                  floatingOverlayEnabled
                    ? 'bg-white/10 border-white/25 text-[#F5F7FA]'
                    : 'bg-[#07080A] border-white/10 text-[#98A0B0] hover:text-[#F5F7FA]'
                }`}
              >
                {floatingOverlayEnabled ? 'On-screen: On' : 'On-screen: Off'}
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = quickDraft.trim();
              if (!text || isSelfMuted) return;
              sendEvent({ type: 'chat:send', text });
              setQuickDraft('');
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={quickDraft}
              disabled={isSelfMuted}
              onChange={(e) => setQuickDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setQuickChatOpen(false);
                }
              }}
              maxLength={500}
              placeholder={isSelfMuted ? 'Muted by host…' : 'Send floating message…'}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-[#07080A] border border-white/10 text-xs text-[#F5F7FA] placeholder-[#5C6475] disabled:opacity-50 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={isSelfMuted || !quickDraft.trim()}
              aria-label="Send floating message"
              className="p-2 rounded-xl bg-[#F5F7FA] text-[#07080A] hover:bg-white disabled:opacity-40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* Bottom Cinema Controls Bar */}
      {media && (
        <div
          className={`absolute bottom-0 inset-x-0 px-4 pt-10 pb-3 bg-gradient-to-t from-black/90 via-black/55 to-transparent transition-opacity duration-200 ${
            hudVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="relative h-6 flex items-center group mb-1">
            <div className="relative w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
              {durationMs > 0 &&
                media.markers.map((m, idx) => {
                  const leftPct = (m.startMs / durationMs) * 100;
                  const widthPct = ((m.endMs - m.startMs) / durationMs) * 100;
                  return (
                    <div
                      key={`${m.type}-${idx}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className="absolute inset-y-0 bg-white/45"
                      title={m.type === 'intro' ? 'Intro' : 'Credits'}
                    />
                  );
                })}
              <div
                style={{ width: `${progressPct}%` }}
                className="absolute inset-y-0 left-0 bg-[#F5F7FA]"
              />
            </div>
            <input
              type="range"
              aria-label="Seek video timeline"
              min={0}
              max={durationMs || 100}
              value={Math.min(displayPosMs, durationMs || 100)}
              disabled={!canControl}
              onChange={(e) => {
                const target = Number(e.target.value);
                setDisplayPosMs(target);
                markLocalSuppression(500);
                sendEvent({ type: 'playback:seek', positionMs: target });
              }}
              className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <button
                onClick={togglePlayPause}
                disabled={!canControl}
                aria-label={playback.status === 'playing' ? 'Pause' : 'Play'}
                className="p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 disabled:opacity-40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {playback.status === 'playing' ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current" />
                )}
              </button>

              <button
                onClick={() => seekBy(-10_000)}
                disabled={!canControl}
                aria-label="Rewind 10 seconds"
                className="p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 disabled:opacity-40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => seekBy(10_000)}
                disabled={!canControl}
                aria-label="Fast-forward 10 seconds"
                className="p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 disabled:opacity-40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setVolume(next);
                    if (videoEl) {
                      videoEl.volume = next;
                      videoEl.muted = next === 0;
                      setIsMuted(next === 0);
                    }
                  }}
                  className="w-16 accent-[#F5F7FA] cursor-pointer"
                />
              </div>

              <span className="font-mono text-xs text-[#98A0B0] tabular-nums ml-1">
                <span className="text-[#F5F7FA]">{formatTimeMs(displayPosMs)}</span>
                {' / '}
                {formatTimeMs(durationMs)}
              </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5">
              {subtitleStreams.some((s) => s.isTextSubtitle) && (
                <button
                  onClick={cycleCaptions}
                  aria-label="Toggle captions"
                  className={`p-2 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    activeTextSubId !== null
                      ? 'text-[#07080A] bg-[#F5F7FA]'
                      : 'text-[#F5F7FA] hover:bg-white/10'
                  }`}
                >
                  <Captions className="w-4 h-4" />
                </button>
              )}

              {canPip && !isCasting && (
                <button
                  onClick={() => void togglePip()}
                  aria-label="Picture in Picture"
                  className="p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <PictureInPicture2 className="w-4 h-4" />
                </button>
              )}

              {canAirPlay && (
                <button
                  onClick={showAirPlayPicker}
                  aria-label="AirPlay to TV"
                  className={`p-2 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    isAirPlayActive
                      ? 'text-[#07080A] bg-[#F5F7FA]'
                      : 'text-[#F5F7FA] hover:bg-white/10'
                  }`}
                >
                  <Airplay className="w-4 h-4" />
                </button>
              )}

              {castAvailable && (
                <button
                  onClick={() => void startOrStopCast()}
                  aria-label="Cast to Chromecast"
                  className={`p-2 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    isCasting
                      ? 'text-[#07080A] bg-[#F5F7FA]'
                      : 'text-[#F5F7FA] hover:bg-white/10'
                  }`}
                >
                  <Cast className="w-4 h-4" />
                </button>
              )}

              {(isFullscreen || !isSidebarOpen) && (
                <button
                  type="button"
                  onClick={() =>
                    setQuickChatOpen((o) => {
                      const next = !o;
                      if (next) setSettingsOpen(false);
                      return next;
                    })
                  }
                  aria-label={quickChatOpen ? 'Hide quick chat' : 'Quick chat and emojis'}
                  className={`p-2 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    quickChatOpen
                      ? 'text-[#07080A] bg-[#F5F7FA]'
                      : 'text-[#F5F7FA] hover:bg-white/10'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={() =>
                  setSettingsOpen((o) => {
                    const next = !o;
                    if (next) setQuickChatOpen(false);
                    return next;
                  })
                }
                aria-label="Quality and tracks"
                className={`p-2 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  settingsOpen
                    ? 'text-[#07080A] bg-[#F5F7FA]'
                    : 'text-[#F5F7FA] hover:bg-white/10'
                }`}
              >
                <Settings2 className="w-4 h-4" />
              </button>

              <button
                onClick={onToggleSidebar}
                aria-label={isSidebarOpen ? 'Hide sidebar (Theater Mode)' : 'Show sidebar'}
                className="hidden lg:inline-flex p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {isSidebarOpen ? (
                  <PanelRightClose className="w-4 h-4" />
                ) : (
                  <PanelRightOpen className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className="p-2 rounded-lg text-[#F5F7FA] hover:bg-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
