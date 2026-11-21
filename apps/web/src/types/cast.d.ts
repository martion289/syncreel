export {};

declare global {
  interface WebKitPlaybackTargetAvailabilityEvent extends Event {
    availability: 'available' | 'not-available';
  }

  interface HTMLVideoElement {
    webkitShowPlaybackTargetPicker?: () => void;
    webkitCurrentPlaybackTargetIsWireless?: boolean;
  }

  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: {
      framework: {
        CastContext: {
          getInstance(): {
            setOptions(options: {
              receiverApplicationId: string;
              autoJoinPolicy: string;
            }): void;
            getCurrentSession(): CastSession | null;
            requestSession(): Promise<void>;
            addEventListener(type: string, listener: (evt: unknown) => void): void;
            removeEventListener(type: string, listener: (evt: unknown) => void): void;
          };
        };
        CastContextEventType: {
          SESSION_STATE_CHANGED: string;
          CAST_STATE_CHANGED: string;
        };
        SessionState: {
          SESSION_STARTED: string;
          SESSION_RESUMED: string;
          SESSION_ENDED: string;
        };
        CastState: {
          NO_DEVICES_AVAILABLE: string;
          NOT_CONNECTED: string;
          CONNECTING: string;
          CONNECTED: string;
        };
        RemotePlayer: new () => RemotePlayer;
        RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
        RemotePlayerEventType: {
          IS_PAUSED_CHANGED: string;
          CURRENT_TIME_CHANGED: string;
          PLAYER_STATE_CHANGED: string;
          IS_CONNECTED_CHANGED: string;
        };
      };
    };
    chrome?: {
      cast?: {
        AutoJoinPolicy: {
          ORIGIN_SCOPED: string;
        };
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: string;
          MediaInfo: new (contentId: string, contentType: string) => CastMediaInfo;
          GenericMediaMetadata: new () => { title?: string; subtitle?: string; images?: Array<{ url: string }> };
          MetadataType: { GENERIC: number };
          Track: new (trackId: number, trackType: string) => CastTrack;
          TrackType: { TEXT: string };
          TextTrackType: { SUBTITLES: string };
          LoadRequest: new (mediaInfo: CastMediaInfo) => {
            currentTime: number;
            autoplay: boolean;
            activeTrackIds: number[];
          };
        };
      };
    };
  }

  interface CastSession {
    loadMedia(request: unknown): Promise<void>;
    endSession(stopCasting: boolean): void;
    getMediaSession(): {
      editTracksInfo(
        request: unknown,
        onSuccess?: () => void,
        onError?: (e: unknown) => void
      ): void;
    } | null;
  }

  interface RemotePlayer {
    isConnected: boolean;
    isMediaLoaded: boolean;
    isPaused: boolean;
    currentTime: number;
    duration: number;
    playerState: string | null;
  }

  interface RemotePlayerController {
    playOrPause(): void;
    seek(): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  }

  interface CastTrack {
    trackContentId: string;
    trackContentType: string;
    subtype: string;
    name: string;
    language: string;
  }

  interface CastMediaInfo {
    metadata: unknown;
    tracks: CastTrack[];
    streamType: string;
  }
}
