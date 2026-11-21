import { useEffect } from 'react';
import type { MediaDetails, PlaybackStatus } from '@syncreel/shared';
import { formatMediaSubtitle, getRoomArtworkUrl } from '../lib/format.js';

export function useMediaSession(params: {
  roomCode: string;
  media: MediaDetails | null;
  status: PlaybackStatus;
  canControl: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeekBy: (deltaMs: number) => void;
}) {
  const { roomCode, media, status, canControl, onPlay, onPause, onSeekBy } = params;

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    if (!media) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const art = getRoomArtworkUrl(roomCode, media.thumb, 512, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: media.title,
      artist: formatMediaSubtitle(media),
      album: 'SyncReel Screening Room',
      artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : []
    });

    navigator.mediaSession.playbackState =
      status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';

    try {
      navigator.mediaSession.setActionHandler('play', canControl ? onPlay : null);
      navigator.mediaSession.setActionHandler('pause', canControl ? onPause : null);
      navigator.mediaSession.setActionHandler(
        'seekbackward',
        canControl ? () => onSeekBy(-10_000) : null
      );
      navigator.mediaSession.setActionHandler(
        'seekforward',
        canControl ? () => onSeekBy(10_000) : null
      );
    } catch {
      // Unsupported browser action handlers are non-fatal
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
      } catch {
        // Ignore cleanup failures
      }
    };
  }, [roomCode, media, status, canControl, onPlay, onPause, onSeekBy]);
}
