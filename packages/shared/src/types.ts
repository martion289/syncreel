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

export type SoloDeckCategory =
  | 'unwatched'
  | 'award-winning'
  | 'popular-now'
  | 'short-sweet'
  | 'throwback'
  | 'comfort-rewatch'
  | 'wildcard';

export const SOLO_DECK_CATEGORIES: Array<{
  id: SoloDeckCategory;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'unwatched',
    label: 'Unwatched Gems',
    badge: 'Fresh to you',
    description: "Titles in your library you haven't watched yet"
  },
  {
    id: 'award-winning',
    label: 'Award-Worthy',
    badge: '7.8+ ★',
    description: 'Critically acclaimed & top audience-rated picks'
  },
  {
    id: 'popular-now',
    label: 'Popular Right Now',
    badge: 'Trending',
    description: 'Recent additions & most-watched hits on your server'
  },
  {
    id: 'short-sweet',
    label: 'Short & Sweet',
    badge: '< 100 min',
    description: 'Tight sub-100-minute movies for weeknights'
  },
  {
    id: 'throwback',
    label: 'Throwback Classics',
    badge: 'Pre-2010',
    description: 'Highest-rated classics released in 2010 or earlier'
  },
  {
    id: 'comfort-rewatch',
    label: 'Comfort Rewatch',
    badge: 'Favorites',
    description: "Watched favorites you haven't replayed recently"
  },
  {
    id: 'wildcard',
    label: 'Wildcard',
    badge: 'Anything Goes',
    description: 'Completely random draw across your chosen library'
  }
];

export interface SoloDiscoverRequest {
  category: SoloDeckCategory;
  libraryFilter: string;
  genre?: string | null;
  unwatchedOnly?: boolean;
  deckSize: number;
}

export interface SoloDiscoverResponse {
  items: MediaSummary[];
  serverMachineId?: string;
  serverName?: string;
}

export interface SwipeMatchConfig {
  category?: SoloDeckCategory;
  libraryFilter: string; // 'all' | 'movie' | 'show' | sectionKey
  genre: string | null; // null = Wildcard
  unwatchedOnly: boolean;
  deckSize: number;
}

export interface KnockoutMatchup {
  id: string;
  left: MediaSummary;
  right: MediaSummary;
  winnerKey?: string;
}

export interface KnockoutBracketState {
  roundNumber: number;
  roundTitle: string;
  roundContenderCount: number;
  matchups: KnockoutMatchup[];
  currentMatchIndex: number;
  byeItem: MediaSummary | null;
  nextRoundPool: MediaSummary[];
  eliminatedInSemis: MediaSummary[];
  runnerUp: MediaSummary | null;
  champion: MediaSummary | null;
  totalChoicesMade: number;
  totalChoicesRequired: number;
}

export interface SwipeKnockoutState extends KnockoutBracketState {
  votesByParticipantId: Record<string, string>;
  tied: boolean;
  lastTieBreakMessage?: string | null;
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
  knockout?: SwipeKnockoutState | null;
  createdAtMs: number;
}

export interface RoomSnapshot {
  code: string;
  name: string;
  purpose?: 'watch' | 'picker';
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
  purpose?: 'watch' | 'picker';
  hasPin: boolean;
  participantCount: number;
  currentMediaTitle?: string;
  currentMediaSubtitle?: string;
  currentMediaThumb?: string;
  hasAccess?: boolean;
  selfRole?: ParticipantRole;
  selfName?: string;
  hostAlreadyConnected?: boolean;
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
