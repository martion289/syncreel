import { z } from 'zod';
import type {
  ChatMessage,
  MediaDetails,
  MediaSummary,
  MoviePoll,
  Participant,
  PlaybackState,
  QualityPreset,
  QueueItem,
  ReadyCheckState,
  RoomSnapshot,
  StreamMode,
  SwipeMatchState
} from './types.js';

export const QualityPresetSchema = z.enum([
  'original',
  '1080p-12m',
  '1080p-8m',
  '720p-4m',
  '480p-2m'
]);

export const StreamModeSchema = z.enum(['per-viewer', 'eco-shared']);

export const SwipeMatchConfigSchema = z.object({
  libraryFilter: z.string().min(1).max(32).default('all'),
  genre: z.string().min(1).max(60).nullable().default(null),
  unwatchedOnly: z.boolean().default(true),
  deckSize: z.number().int().min(5).max(50).default(20)
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('clock:ping'),
    clientSendMs: z.number().finite()
  }),
  z.object({
    type: z.literal('playback:play'),
    positionMs: z.number().finite().min(0)
  }),
  z.object({
    type: z.literal('playback:pause'),
    positionMs: z.number().finite().min(0)
  }),
  z.object({
    type: z.literal('playback:seek'),
    positionMs: z.number().finite().min(0)
  }),
  z.object({
    type: z.literal('playback:skipMarker'),
    targetPositionMs: z.number().finite().min(0),
    markerType: z.enum(['intro', 'credits'])
  }),
  z.object({
    type: z.literal('player:buffering'),
    isBuffering: z.boolean()
  }),
  z.object({
    type: z.literal('player:heartbeat'),
    positionMs: z.number().finite().min(0),
    driftMs: z.number().finite().nullable()
  }),
  z.object({
    type: z.literal('player:casting'),
    isCasting: z.boolean()
  }),
  z.object({
    type: z.literal('room:setMedia'),
    ratingKey: z.string().min(1).max(64),
    startPositionMs: z.number().finite().min(0).optional()
  }),
  z.object({
    type: z.literal('room:queueAdd'),
    ratingKey: z.string().min(1).max(64)
  }),
  z.object({
    type: z.literal('room:queueRemove'),
    queueItemId: z.string().min(1).max(64)
  }),
  z.object({
    type: z.literal('room:queueNext')
  }),
  z.object({
    type: z.literal('room:updateSettings'),
    hostOnlyControl: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    streamMode: StreamModeSchema.optional(),
    ecoQuality: QualityPresetSchema.optional()
  }),
  z.object({
    type: z.literal('room:kick'),
    participantId: z.string().min(1).max(120)
  }),
  z.object({
    type: z.literal('room:mute'),
    participantId: z.string().min(1).max(120),
    muted: z.boolean()
  }),
  z.object({
    type: z.literal('room:transferHost'),
    participantId: z.string().min(1).max(120)
  }),
  z.object({
    type: z.literal('room:notifyWebhook')
  }),
  z.object({
    type: z.literal('poll:start'),
    ratingKeys: z.array(z.string().min(1).max(64)).min(2).max(6)
  }),
  z.object({
    type: z.literal('poll:vote'),
    ratingKey: z.string().min(1).max(64)
  }),
  z.object({
    type: z.literal('poll:close'),
    autoPlayWinner: z.boolean().optional()
  }),
  z.object({
    type: z.literal('ready:start')
  }),
  z.object({
    type: z.literal('ready:ack'),
    ready: z.boolean()
  }),
  z.object({
    type: z.literal('ready:launchNow')
  }),
  z.object({
    type: z.literal('ready:cancel')
  }),
  z.object({
    type: z.literal('swipe:start'),
    config: SwipeMatchConfigSchema
  }),
  z.object({
    type: z.literal('swipe:vote'),
    ratingKey: z.string().min(1).max(64),
    decision: z.enum(['yes', 'no'])
  }),
  z.object({
    type: z.literal('swipe:close')
  }),
  z.object({
    type: z.literal('swipe:playMatch'),
    ratingKey: z.string().min(1).max(64)
  }),
  z.object({
    type: z.literal('swipe:queueMatch'),
    ratingKey: z.string().min(1).max(64)
  }),
  z.object({
    type: z.literal('chat:send'),
    text: z.string().trim().min(1).max(500)
  }),
  z.object({
    type: z.literal('chat:react'),
    emoji: z.string().min(1).max(16)
  })
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;

export type ServerEvent =
  | {
      type: 'clock:pong';
      clientSendMs: number;
      serverTimeMs: number;
    }
  | {
      type: 'room:snapshot';
      snapshot: RoomSnapshot;
      selfParticipantId: string;
      selfRole: 'host' | 'guest';
    }
  | {
      type: 'playback:sync';
      playback: PlaybackState;
    }
  | {
      type: 'room:participants';
      participants: Participant[];
    }
  | {
      type: 'room:mediaChanged';
      media: MediaDetails | null;
      playback: PlaybackState;
      queue: QueueItem[];
    }
  | {
      type: 'room:queueUpdated';
      queue: QueueItem[];
    }
  | {
      type: 'room:settingsUpdated';
      hostOnlyControl: boolean;
      name: string;
      streamMode: StreamMode;
      ecoQuality: QualityPreset;
    }
  | {
      type: 'room:notice';
      level: 'info' | 'warning';
      message: string;
    }
  | {
      type: 'room:kicked';
      reason: string;
    }
  | {
      type: 'poll:updated';
      poll: MoviePoll | null;
    }
  | {
      type: 'ready:updated';
      readyCheck: ReadyCheckState;
    }
  | {
      type: 'swipe:updated';
      swipeMatch: SwipeMatchState | null;
      selfSwipeOrder?: string[];
      selfSwipedKeys?: string[];
    }
  | {
      type: 'swipe:match';
      media: MediaSummary;
    }
  | {
      type: 'chat:message';
      message: ChatMessage;
    }
  | {
      type: 'chat:reaction';
      id: string;
      emoji: string;
      participantId: string;
      participantName: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
