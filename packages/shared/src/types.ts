export type QualityPreset =
  | 'original'
  | '1080p-12m'
  | '1080p-8m'
  | '720p-4m'
  | '480p-2m';

export interface QualityPresetMeta {
  id: QualityPreset;
  label: string;
  shortLabel: string;
  maxVideoBitrate?: number;
  videoResolution?: string;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityPresetMeta> = {
  original: {
    id: 'original',
    label: 'Original (Direct Stream preferred)',
    shortLabel: 'Original'
  },
  '1080p-12m': {
    id: '1080p-12m',
    label: '1080p HD (12 Mbps)',
    shortLabel: '1080p High',
    maxVideoBitrate: 12000,
    videoResolution: '1920x1080'
  },
  '1080p-8m': {
    id: '1080p-8m',
    label: '1080p HD (8 Mbps)',
    shortLabel: '1080p',
    maxVideoBitrate: 8000,
    videoResolution: '1920x1080'
  },
  '720p-4m': {
    id: '720p-4m',
    label: '720p HD (4 Mbps)',
    shortLabel: '720p',
    maxVideoBitrate: 4000,
    videoResolution: '1280x720'
  },
  '480p-2m': {
    id: '480p-2m',
    label: '480p SD (2 Mbps)',
    shortLabel: '480p',
    maxVideoBitrate: 2000,
    videoResolution: '854x480'
  }
};

export type StreamMode = 'per-viewer' | 'eco-shared';

export interface MediaStreamInfo {
  id: number;
  streamType: 1 | 2 | 3; // 1 = video, 2 = audio, 3 = subtitle
  streamIndex?: number;
  codec: string;
  displayTitle: string;
  language?: string;
  languageCode?: string;
  selected: boolean;
  default: boolean;
  forced: boolean;
  key?: string;
  isTextSubtitle: boolean;
  isEmbeddedTextSubtitle: boolean;
  requiresBurnIn: boolean;
}

export interface MediaMarker {
  type: 'intro' | 'credits';
  startMs: number;
  endMs: number;
}

export interface MediaSummary {
  ratingKey: string;
  type: 'movie' | 'episode' | 'show' | 'season';
  title: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  durationMs: number;
  viewOffsetMs?: number;
  thumb?: string;
  art?: string;
  summary?: string;
  rating?: number;
  genres?: string[];
  contentRating?: string;
  childCount?: number;
}

export interface MediaDetails extends MediaSummary {
  partId: number;
  streams: MediaStreamInfo[];
  markers: MediaMarker[];
  nextEpisode?: MediaSummary;
}

export interface QueueItem {
  id: string;
  media: MediaSummary;
  addedBy: string;
}

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'buffering';

export interface PlaybackState {
  status: PlaybackStatus;
  anchorPositionMs: number;
  anchorServerTimeMs: number;
  playbackRate: number;
  version: number;
  bufferingParticipantIds: string[];
  updatedBy?: string;
}

export type ParticipantRole = 'host' | 'guest';
export type UserRole = 'admin' | 'friend';

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  isConnected: boolean;
  isBuffering: boolean;
  isCasting: boolean;
  isMuted: boolean;
  isReady: boolean;
  plexScrobbleLinked: boolean;
  driftMs: number | null;
}

export interface ChatMessage {
  id: string;
  participantId: string;
  participantName: string;
  role: ParticipantRole;
  text: string;
  createdAtMs: number;
}

export interface MoviePollOption {
  media: MediaSummary;
  voterIds: string[];
}

export interface MoviePoll {
  id: string;
  status: 'open' | 'closed';
  createdBy: string;
  options: MoviePollOption[];
  winnerRatingKey?: string;
  createdAtMs: number;
}

export interface ReadyCheckState {
  active: boolean;
  initiatedBy: string;
  readyParticipantIds: string[];
  countdownEndServerTimeMs: number | null;
}

export interface SwipeMatchConfig {
  libraryFilter: string; // 'all' | 'movie' | 'show' | sectionKey
  genre: string | null; // null = Wildcard
  unwatchedOnly: boolean;
  deckSize: number;
}

export interface SwipeMatchState {
  id: string;
  status: 'active' | 'finished';
  createdBy: string;
  config: SwipeMatchConfig;
  deck: MediaSummary[];
  likesByRatingKey: Record<string, string[]>;
  progressByParticipantId: Record<string, number>;
  matchedRatingKeys: string[];
  createdAtMs: number;
}

export interface RoomSnapshot {
  code: string;
  name: string;
  hasPin: boolean;
  hostOnlyControl: boolean;
  streamMode: StreamMode;
  ecoQuality: QualityPreset;
  currentMedia: MediaDetails | null;
  queue: QueueItem[];
  playback: PlaybackState;
  participants: Participant[];
  chatHistory: ChatMessage[];
  poll: MoviePoll | null;
  readyCheck: ReadyCheckState;
  swipeMatch: SwipeMatchState | null;
  selfSwipeOrder?: string[];
  selfSwipedKeys?: string[];
  hasWebhook: boolean;
}

export interface PlexLibrarySection {
  key: string;
  title: string;
  type: 'movie' | 'show';
}

export interface PlexGenre {
  title: string;
  keysBySection: Record<string, string>;
}

export interface AuthUser {
  role: UserRole;
  plexUserId: number;
  username: string;
  email?: string;
  thumb?: string;
  serverName?: string;
}

export interface SetupStatus {
  configured: boolean;
  serverName?: string;
  plexUrl?: string;
  allowPlexFriends: boolean;
  hasWebhook: boolean;
}

export interface DiscoveredPlexConnection {
  uri: string;
  local: boolean;
  relay: boolean;
  reachable: boolean;
  latencyMs?: number;
}

export interface DiscoveredPlexServer {
  name: string;
  machineIdentifier: string;
  owned: boolean;
  connections: DiscoveredPlexConnection[];
}

export interface RoomPublicInfo {
  code: string;
  name: string;
  hasPin: boolean;
  participantCount: number;
  currentMediaTitle?: string;
  currentMediaSubtitle?: string;
  currentMediaThumb?: string;
  hasAccess?: boolean;
  selfRole?: ParticipantRole;
  selfName?: string;
}

export interface TextSubtitleTrack {
  streamId: number;
  label: string;
  languageCode: string;
  url: string;
  forced: boolean;
}

export interface StreamSessionResponse {
  streamToken: string;
  hlsUrl: string;
  textSubtitles: TextSubtitleTrack[];
  activeAudioStreamId?: number;
  activeBurnInSubtitleStreamId?: number;
  streamMode: StreamMode;
  ecoQuality: QualityPreset;
}

export interface AdminRoomInfo {
  code: string;
  name: string;
  hasPin: boolean;
  streamMode: StreamMode;
  participantCount: number;
  currentMediaTitle?: string;
  createdAtMs: number;
}

export interface AdminStreamInfo {
  streamToken: string;
  roomCode: string;
  participantId: string;
  plexSessionId: string;
  mediaTitle: string;
  quality: QualityPreset;
  streamMode: StreamMode;
  lastSeenAtMs: number;
}

export interface AdminOverview {
  settings: {
    plexUrl: string;
    serverName: string;
    allowPlexFriends: boolean;
    webhookUrl: string;
    webhookAutoNotify: boolean;
    defaultHostOnlyControl: boolean;
  };
  rooms: AdminRoomInfo[];
  streams: AdminStreamInfo[];
}
