import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  advanceKnockoutBracket,
  createKnockoutBracket,
  type AdminRoomInfo,
  type ChatMessage,
  type MediaDetails,
  type MediaSummary,
  type MoviePoll,
  type Participant,
  type ParticipantRole,
  type QualityPreset,
  type QueueItem,
  type ReadyCheckState,
  type RoomPublicInfo,
  type RoomSnapshot,
  type ServerEvent,
  type StreamMode,
  type SwipeKnockoutState,
  type SwipeMatchConfig,
  type SwipeMatchState
} from '@syncreel/shared';
import { hashPin, verifyPin } from '../auth/tokens.js';
import { PlexClient, shuffleCopy } from '../plex/client.js';
import type { StreamSessionManager } from '../plex/streamProxy.js';
import { sendRoomWebhook } from '../notifications/webhook.js';
import { SyncEngine } from './syncEngine.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RESERVED_SLUGS = new Set([
  'new',
  'admin',
  'setup',
  'api',
  'ws',
  'room',
  'login',
  'logout',
  'health'
]);

export function validateVanitySlug(rawSlug: string): string {
  const cleaned = rawSlug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(cleaned)) {
    throw new Error(
      'Custom room URL must be 3–32 characters using lowercase letters, numbers, or hyphens.'
    );
  }
  if (RESERVED_SLUGS.has(cleaned)) {
    throw new Error(`"${cleaned}" is a reserved name. Please choose another room URL.`);
  }
  return cleaned;
}

interface ParticipantEntry {
  id: string;
  name: string;
  role: ParticipantRole;
  isConnected: boolean;
  isBuffering: boolean;
  isCasting: boolean;
  isMuted: boolean;
  isReady: boolean;
  driftMs: number | null;
  personalPlexToken?: string;
  sockets: Set<WebSocket>;
  lastDisconnectedAtMs?: number;
}

interface SwipeMatchInternal {
  id: string;
  status: 'active' | 'finished';
  createdBy: string;
  config: SwipeMatchConfig;
  deck: MediaSummary[];
  likesByRatingKey: Map<string, Set<string>>;
  swipedByParticipant: Map<string, Set<string>>;
  orderByParticipant: Map<string, string[]>;
  matchedRatingKeys: string[];
  knockout: SwipeKnockoutState | null;
  createdAtMs: number;
}

export interface RoomInstance {
  code: string;
  name: string;
  purpose: 'watch' | 'picker';
  pinHash: string | null;
  streamMode: StreamMode;
  ecoQuality: QualityPreset;
  currentMedia: MediaDetails | null;
  queue: QueueItem[];
  sync: SyncEngine;
  participants: Map<string, ParticipantEntry>;
  kickedParticipantIds: Set<string>;
  chatHistory: ChatMessage[];
  poll: MoviePoll | null;
  readyCheck: ReadyCheckState;
  readyCountdownTimer: NodeJS.Timeout | null;
  swipeMatch: SwipeMatchInternal | null;
  scrobbledKeysByToken: Map<string, Set<string>>;
  hostPlexToken?: string;
  hostUsername?: string;
  createdAtMs: number;
  lastActiveAtMs: number;
}

export interface RoomManagerDeps {
  getPlexClient: () => PlexClient | null;
  getPlexUrl: () => string;
  clientIdentifier: string;
  streamManager: StreamSessionManager;
  getWebhookConfig: () => { webhookUrl: string; webhookAutoNotify: boolean; publicUrl: string };
  fetchFn: typeof fetch;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomInstance>();
  private readonly deps: RoomManagerDeps;
  private readonly maintenanceTimer: NodeJS.Timeout;

  constructor(deps: RoomManagerDeps) {
    this.deps = deps;

    this.maintenanceTimer = setInterval(() => {
      void this.runRoomMaintenance();
    }, 15_000);
    this.maintenanceTimer.unref();
  }

  private roomKey(code: string): string {
    return code.trim().toUpperCase();
  }

  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  createRoom(options: {
    name?: string;
    slug?: string;
    pin?: string;
    purpose?: 'watch' | 'picker';
    hostOnlyControl?: boolean;
    streamMode?: StreamMode;
    ecoQuality?: QualityPreset;
    hostPlexToken?: string;
    hostUsername?: string;
  }): RoomInstance {
    let displayCode: string;
    if (options.slug && options.slug.trim().length > 0) {
      displayCode = validateVanitySlug(options.slug);
      if (this.rooms.has(this.roomKey(displayCode))) {
        const err = new Error(`Room "/room/${displayCode}" is already active.`);
        (err as Error & { statusCode?: number }).statusCode = 409;
        throw err;
      }
    } else {
      displayCode = this.generateUniqueCode();
    }

    const key = this.roomKey(displayCode);
    const now = Date.now();
    const cleanPin = options.pin?.trim();

    const sync = new SyncEngine({
      hostOnlyControl: options.hostOnlyControl ?? false,
      onBufferTimeout: (evictedIds, state) => {
        const room = this.rooms.get(key);
        if (!room) return;
        const names: string[] = [];
        for (const id of evictedIds) {
          const p = room.participants.get(id);
          if (p) {
            p.isBuffering = false;
            names.push(p.name);
          }
        }
        this.broadcast(room, { type: 'playback:sync', playback: state });
        this.broadcast(room, {
          type: 'room:participants',
          participants: this.serializeParticipants(room)
        });
        if (names.length > 0) {
          this.broadcast(room, {
            type: 'room:notice',
            level: 'warning',
            message: `Resumed playback after waiting 12s for ${names.join(', ')}`
          });
        }
      }
    });

    const room: RoomInstance = {
      code: displayCode,
      name: options.name?.trim() || 'Movie Night',
      purpose: options.purpose ?? 'watch',
      pinHash: cleanPin ? hashPin(cleanPin) : null,
      streamMode: options.streamMode ?? 'per-viewer',
      ecoQuality: options.ecoQuality ?? '1080p-8m',
      currentMedia: null,
      queue: [],
      sync,
      participants: new Map(),
      kickedParticipantIds: new Set(),
      chatHistory: [],
      poll: null,
      readyCheck: {
        active: false,
        initiatedBy: '',
        readyParticipantIds: [],
        countdownEndServerTimeMs: null
      },
      readyCountdownTimer: null,
      swipeMatch: null,
      scrobbledKeysByToken: new Map(),
      hostPlexToken: options.hostPlexToken,
      hostUsername: options.hostUsername,
      createdAtMs: now,
      lastActiveAtMs: now
    };

    this.rooms.set(key, room);
    return room;
  }

  getRoom(code: string): RoomInstance | null {
    return this.rooms.get(this.roomKey(code)) ?? null;
  }

  listAdminRooms(): AdminRoomInfo[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      name: room.name,
      hasPin: Boolean(room.pinHash),
      streamMode: room.streamMode,
      participantCount: [...room.participants.values()].filter((p) => p.isConnected).length,
      currentMediaTitle: room.currentMedia?.title,
      createdAtMs: room.createdAtMs
    }));
  }

  async closeRoom(code: string): Promise<boolean> {
    const key = this.roomKey(code);
    const room = this.rooms.get(key);
    if (!room) return false;

    if (room.readyCountdownTimer) {
      clearTimeout(room.readyCountdownTimer);
      room.readyCountdownTimer = null;
    }
    room.sync.destroy();
    for (const p of room.participants.values()) {
      for (const sock of p.sockets) {
        if (sock.readyState === 1) {
          this.sendToSocket(sock, {
            type: 'room:kicked',
            reason: 'This screening room was closed by the administrator.'
          });
          sock.close(4009, 'Room closed');
        }
      }
    }
    await this.deps.streamManager.stopRoomStreams(room.code);
    this.rooms.delete(key);
    return true;
  }

  getEffectivePlexClient(room: RoomInstance): PlexClient | null {
    const baseUrl = this.deps.getPlexUrl();
    if (room.hostPlexToken && baseUrl) {
      return new PlexClient({
        baseUrl,
        token: room.hostPlexToken,
        clientId: this.deps.clientIdentifier,
        fetchFn: this.deps.fetchFn
      });
    }
    return this.deps.getPlexClient();
  }

  getPublicInfo(code: string): RoomPublicInfo | null {
    const room = this.getRoom(code);
    if (!room) return null;

    const connectedCount = [...room.participants.values()].filter((p) => p.isConnected).length;
    const media = room.currentMedia;
    let subtitle: string | undefined;
    if (media) {
      subtitle =
        media.type === 'episode' && media.grandparentTitle
          ? `${media.grandparentTitle} • S${media.parentIndex ?? 1}E${media.index ?? 1}`
          : media.year
            ? String(media.year)
            : undefined;
    }

    return {
      code: room.code,
      name: room.name,
      purpose: room.purpose,
      hasPin: Boolean(room.pinHash),
      participantCount: connectedCount,
      currentMediaTitle: media?.title,
      currentMediaSubtitle: subtitle,
      currentMediaThumb: media?.thumb
        ? `/api/rooms/${encodeURIComponent(room.code)}/artwork?path=${encodeURIComponent(media.thumb)}`
        : undefined
    };
  }

  verifyRoomPin(room: RoomInstance, pin: string | undefined): boolean {
    if (!room.pinHash) return true;
    if (!pin) return false;
    return verifyPin(pin.trim(), room.pinHash);
  }

  isParticipantKicked(room: RoomInstance, participantId: string): boolean {
    return room.kickedParticipantIds.has(participantId);
  }

  getParticipantRole(room: RoomInstance, participantId: string, fallbackRole: ParticipantRole): ParticipantRole {
    return room.participants.get(participantId)?.role ?? fallbackRole;
  }

  ensureParticipant(
    room: RoomInstance,
    info: { id: string; name: string; role: ParticipantRole; personalPlexToken?: string }
  ): ParticipantEntry {
    const existing = room.participants.get(info.id);
    if (existing) {
      existing.name = info.name;
      // Preserve promoted host role if this participant was granted host
      if (info.role === 'host') existing.role = 'host';
      if (info.personalPlexToken) existing.personalPlexToken = info.personalPlexToken;
      return existing;
    }
    const created: ParticipantEntry = {
      id: info.id,
      name: info.name,
      role: info.role,
      isConnected: false,
      isBuffering: false,
      isCasting: false,
      isMuted: false,
      isReady: false,
      driftMs: null,
      personalPlexToken: info.personalPlexToken,
      sockets: new Set()
    };
    room.participants.set(info.id, created);
    return created;
  }

  attachParticipantPlexToken(room: RoomInstance, participantId: string, token: string): void {
    const entry = room.participants.get(participantId);
    if (!entry) return;
    entry.personalPlexToken = token;
    this.broadcast(room, {
      type: 'room:participants',
      participants: this.serializeParticipants(room)
    });
  }

  attachSocket(
    room: RoomInstance,
    participant: { id: string; name: string; role: ParticipantRole; personalPlexToken?: string },
    ws: WebSocket
  ): void {
    const entry = this.ensureParticipant(room, participant);
    const wasConnected = entry.isConnected;
    entry.sockets.add(ws);
    entry.isConnected = true;
    entry.lastDisconnectedAtMs = undefined;
    room.lastActiveAtMs = Date.now();

    if (room.swipeMatch && !room.swipeMatch.orderByParticipant.has(entry.id)) {
      room.swipeMatch.orderByParticipant.set(
        entry.id,
        shuffleCopy(room.swipeMatch.deck.map((d) => d.ratingKey))
      );
    }

    if (room.swipeMatch && !wasConnected) {
      const connectedIds = [...room.participants.values()]
        .filter((p) => p.isConnected)
        .map((p) => p.id);
      if (room.swipeMatch.status === 'finished' && !room.swipeMatch.swipedByParticipant.has(entry.id)) {
        room.swipeMatch.status = 'active';
      }
      if (connectedIds.length >= 2) {
        room.swipeMatch.matchedRatingKeys = room.swipeMatch.deck
          .filter((item) => {
            const likes = room.swipeMatch!.likesByRatingKey.get(item.ratingKey);
            return Boolean(likes && connectedIds.every((id) => likes.has(id)));
          })
          .map((item) => item.ratingKey);
      }
    }

    this.sendToSocket(ws, {
      type: 'room:snapshot',
      snapshot: this.serializeSnapshotFor(room, entry.id),
      selfParticipantId: entry.id,
      selfRole: entry.role
    });

    if (!wasConnected) {
      this.broadcast(room, {
        type: 'room:participants',
        participants: this.serializeParticipants(room)
      });
      if (room.swipeMatch) {
        this.broadcastSwipeUpdate(room);
      }
    }
  }

  detachSocket(room: RoomInstance, participantId: string, ws: WebSocket): void {
    const entry = room.participants.get(participantId);
    if (!entry) return;

    entry.sockets.delete(ws);
    if (entry.sockets.size > 0) return;

    entry.isConnected = false;
    entry.isBuffering = false;
    entry.isCasting = false;
    entry.isReady = false;
    entry.driftMs = null;
    entry.lastDisconnectedAtMs = Date.now();

    const syncRes = room.sync.removeParticipant(participantId);
    void this.deps.streamManager.stopParticipantStreams(room.code, participantId);

    if (syncRes.changed) {
      this.broadcast(room, { type: 'playback:sync', playback: syncRes.state });
    }
    this.broadcast(room, {
      type: 'room:participants',
      participants: this.serializeParticipants(room)
    });
  }

  // ── Media & Queue ──────────────────────────────────────────────────────────

  async setRoomMedia(
    room: RoomInstance,
    ratingKey: string,
    actorName: string,
    startPositionMs?: number
  ): Promise<MediaDetails> {
    const plex = this.getEffectivePlexClient(room);
    if (!plex) {
      throw new Error('Plex server is not connected');
    }

    if (room.currentMedia) {
      const prevTime = room.sync.getProjectedPositionMs();
      this.reportAllParticipantsTimeline(room, room.currentMedia, 'stopped', prevTime);
    }

    const details = await plex.getMediaDetails(ratingKey);
    room.currentMedia = details;
    room.lastActiveAtMs = Date.now();
    this.cancelReadyCheck(room, false);

    const initialPos =
      typeof startPositionMs === 'number' ? startPositionMs : details.viewOffsetMs ?? 0;

    for (const p of room.participants.values()) {
      p.isBuffering = false;
    }

    const playback = room.sync.loadMedia(initialPos, actorName);
    this.broadcast(room, {
      type: 'room:mediaChanged',
      media: details,
      playback,
      queue: [...room.queue]
    });

    const wh = this.deps.getWebhookConfig();
    if (wh.webhookAutoNotify && wh.webhookUrl) {
      void sendRoomWebhook({
        webhookUrl: wh.webhookUrl,
        publicUrl: wh.publicUrl,
        roomCode: room.code,
        roomName: room.name,
        hostName: actorName,
        media: details,
        fetchFn: this.deps.fetchFn
      });
    }

    return details;
  }

  async addToQueue(room: RoomInstance, ratingKey: string, addedBy: string): Promise<QueueItem[]> {
    const plex = this.getEffectivePlexClient(room);
    if (!plex) {
      throw new Error('Plex server is not connected');
    }
    const playableKey = await plex.resolvePlayableRatingKey(ratingKey);
    const details = await plex.getMediaDetails(playableKey);
    const item: QueueItem = {
      id: crypto.randomUUID(),
      media: details,
      addedBy
    };
    room.queue.push(item);
    room.lastActiveAtMs = Date.now();
    this.broadcast(room, { type: 'room:queueUpdated', queue: [...room.queue] });
    return [...room.queue];
  }

  removeFromQueue(room: RoomInstance, queueItemId: string): QueueItem[] {
    room.queue = room.queue.filter((item) => item.id !== queueItemId);
    this.broadcast(room, { type: 'room:queueUpdated', queue: [...room.queue] });
    return [...room.queue];
  }

  async playNextInQueue(room: RoomInstance, actorName: string): Promise<MediaDetails | null> {
    const nextItem = room.queue.shift();
    if (nextItem) {
      return this.setRoomMedia(room, nextItem.media.ratingKey, actorName, 0);
    }
    if (room.currentMedia?.nextEpisode) {
      return this.setRoomMedia(room, room.currentMedia.nextEpisode.ratingKey, actorName, 0);
    }
    return null;
  }

  async notifyWebhook(room: RoomInstance, actorName: string): Promise<{ ok: boolean; error?: string }> {
    const wh = this.deps.getWebhookConfig();
    if (!wh.webhookUrl) {
      return { ok: false, error: 'No webhook URL configured in Admin Settings' };
    }
    return sendRoomWebhook({
      webhookUrl: wh.webhookUrl,
      publicUrl: wh.publicUrl,
      roomCode: room.code,
      roomName: room.name,
      hostName: actorName,
      media: room.currentMedia,
      fetchFn: this.deps.fetchFn
    });
  }

  // ── Ready Check & 3-2-1 Countdown ──────────────────────────────────────────

  startReadyCheck(room: RoomInstance, actorName: string): void {
    if (room.readyCountdownTimer) {
      clearTimeout(room.readyCountdownTimer);
      room.readyCountdownTimer = null;
    }
    for (const p of room.participants.values()) {
      p.isReady = false;
    }
    room.readyCheck = {
      active: true,
      initiatedBy: actorName,
      readyParticipantIds: [],
      countdownEndServerTimeMs: null
    };
    this.broadcast(room, { type: 'ready:updated', readyCheck: { ...room.readyCheck } });
    this.broadcast(room, {
      type: 'room:participants',
      participants: this.serializeParticipants(room)
    });
  }

  ackReady(room: RoomInstance, participantId: string, ready: boolean): void {
    if (!room.readyCheck.active || room.readyCheck.countdownEndServerTimeMs !== null) return;
    const entry = room.participants.get(participantId);
    if (!entry) return;

    entry.isReady = ready;
    const readyIds = [...room.participants.values()]
      .filter((p) => p.isConnected && p.isReady)
      .map((p) => p.id);

    room.readyCheck = {
      ...room.readyCheck,
      readyParticipantIds: readyIds
    };
    this.broadcast(room, { type: 'ready:updated', readyCheck: { ...room.readyCheck } });
    this.broadcast(room, {
      type: 'room:participants',
      participants: this.serializeParticipants(room)
    });

    const connected = [...room.participants.values()].filter((p) => p.isConnected);
    if (connected.length > 0 && connected.every((p) => p.isReady)) {
      this.launchReadyCountdown(room, room.readyCheck.initiatedBy || 'Room');
    }
  }

  launchReadyCountdown(room: RoomInstance, actorName: string): void {
    if (!room.readyCheck.active) return;
    if (room.readyCountdownTimer) {
      clearTimeout(room.readyCountdownTimer);
    }
    const endAt = Date.now() + 3000;
    room.readyCheck = {
      ...room.readyCheck,
      countdownEndServerTimeMs: endAt
    };
    this.broadcast(room, { type: 'ready:updated', readyCheck: { ...room.readyCheck } });

    room.readyCountdownTimer = setTimeout(() => {
      room.readyCountdownTimer = null;
      this.cancelReadyCheck(room, true);
      const pos = room.sync.getProjectedPositionMs();
      const res = room.sync.play(pos, 'host', actorName);
      if (res.changed) {
        this.broadcast(room, { type: 'playback:sync', playback: res.state });
      }
    }, 3000);
    room.readyCountdownTimer.unref();
  }

  cancelReadyCheck(room: RoomInstance, notify = true): void {
    if (room.readyCountdownTimer) {
      clearTimeout(room.readyCountdownTimer);
      room.readyCountdownTimer = null;
    }
    for (const p of room.participants.values()) {
      p.isReady = false;
    }
    room.readyCheck = {
      active: false,
      initiatedBy: '',
      readyParticipantIds: [],
      countdownEndServerTimeMs: null
    };
    if (notify) {
      this.broadcast(room, { type: 'ready:updated', readyCheck: { ...room.readyCheck } });
      this.broadcast(room, {
        type: 'room:participants',
        participants: this.serializeParticipants(room)
      });
    }
  }

  // ── Movie Poll ─────────────────────────────────────────────────────────────

  async startPoll(room: RoomInstance, ratingKeys: string[], actorName: string): Promise<MoviePoll> {
    const plex = this.getEffectivePlexClient(room);
    if (!plex) throw new Error('Plex server is not connected');

    const uniqueKeys = [...new Set(ratingKeys)].slice(0, 6);
    const items = await Promise.all(uniqueKeys.map((k) => plex.getMediaDetails(k)));
    const poll: MoviePoll = {
      id: crypto.randomUUID(),
      status: 'open',
      createdBy: actorName,
      options: items.map((media) => ({ media, voterIds: [] })),
      createdAtMs: Date.now()
    };
    room.poll = poll;
    this.broadcast(room, { type: 'poll:updated', poll });
    return poll;
  }

  votePoll(room: RoomInstance, participantId: string, ratingKey: string): MoviePoll | null {
    if (!room.poll || room.poll.status !== 'open') return null;
    for (const opt of room.poll.options) {
      opt.voterIds = opt.voterIds.filter((id) => id !== participantId);
      if (opt.media.ratingKey === ratingKey) {
        opt.voterIds.push(participantId);
      }
    }
    this.broadcast(room, { type: 'poll:updated', poll: room.poll });
    return room.poll;
  }

  async closePoll(
    room: RoomInstance,
    actorName: string,
    autoPlayWinner = true
  ): Promise<MoviePoll | null> {
    if (!room.poll) return null;
    const sorted = [...room.poll.options].sort((a, b) => b.voterIds.length - a.voterIds.length);
    const winner = sorted[0];
    room.poll = {
      ...room.poll,
      status: 'closed',
      winnerRatingKey: winner?.media.ratingKey
    };
    this.broadcast(room, { type: 'poll:updated', poll: room.poll });

    if (autoPlayWinner && winner) {
      const playable = await this.getEffectivePlexClient(room)?.resolvePlayableRatingKey(
        winner.media.ratingKey
      );
      if (playable) {
        await this.setRoomMedia(room, playable, actorName, 0);
      }
    }
    return room.poll;
  }

  // ── Tinder-Style Swipe Match ───────────────────────────────────────────────

  async startSwipeMatch(
    room: RoomInstance,
    config: SwipeMatchConfig,
    actorName: string
  ): Promise<SwipeMatchInternal> {
    const plex = this.getEffectivePlexClient(room);
    if (!plex) throw new Error('Plex server is not connected');

    const deck = await plex.getRandomDeckCandidates(config);
    if (deck.length === 0) {
      throw new Error('No titles matched that library/genre filter.');
    }

    const likesByRatingKey = new Map<string, Set<string>>();
    for (const item of deck) {
      likesByRatingKey.set(item.ratingKey, new Set());
    }

    const deckKeys = deck.map((d) => d.ratingKey);
    const orderByParticipant = new Map<string, string[]>();
    for (const p of room.participants.values()) {
      if (p.isConnected) {
        orderByParticipant.set(p.id, shuffleCopy(deckKeys));
      }
    }

    const session: SwipeMatchInternal = {
      id: crypto.randomUUID(),
      status: 'active',
      createdBy: actorName,
      config,
      deck,
      likesByRatingKey,
      swipedByParticipant: new Map(),
      orderByParticipant,
      matchedRatingKeys: [],
      knockout: null,
      createdAtMs: Date.now()
    };

    room.swipeMatch = session;
    this.broadcastSwipeUpdate(room);
    return session;
  }

  recordSwipeVote(
    room: RoomInstance,
    participantId: string,
    ratingKey: string,
    decision: 'yes' | 'no'
  ): { matchedMedia: MediaSummary | null } {
    const sm = room.swipeMatch;
    if (!sm || sm.status !== 'active') return { matchedMedia: null };

    const media = sm.deck.find((d) => d.ratingKey === ratingKey);
    if (!media) return { matchedMedia: null };

    let swiped = sm.swipedByParticipant.get(participantId);
    if (!swiped) {
      swiped = new Set();
      sm.swipedByParticipant.set(participantId, swiped);
    }
    swiped.add(ratingKey);

    const likes = sm.likesByRatingKey.get(ratingKey) ?? new Set<string>();
    sm.likesByRatingKey.set(ratingKey, likes);
    if (decision === 'yes') {
      likes.add(participantId);
    } else {
      likes.delete(participantId);
    }

    const connectedIds = [...room.participants.values()]
      .filter((p) => p.isConnected)
      .map((p) => p.id);
    const requiredIds = connectedIds.length > 0 ? connectedIds : [participantId];

    let matchedMedia: MediaSummary | null = null;
    const isUnanimous = requiredIds.every((id) => likes.has(id));
    if (isUnanimous && !sm.matchedRatingKeys.includes(ratingKey)) {
      sm.matchedRatingKeys.push(ratingKey);
      matchedMedia = media;
      this.broadcast(room, { type: 'swipe:match', media });
    }

    const everyoneFinished = requiredIds.every(
      (id) => (sm.swipedByParticipant.get(id)?.size ?? 0) >= sm.deck.length
    );
    if (everyoneFinished) {
      sm.status = 'finished';
    }

    this.broadcastSwipeUpdate(room);
    return { matchedMedia };
  }

  closeSwipeMatch(room: RoomInstance): void {
    room.swipeMatch = null;
    this.broadcastSwipeUpdate(room);
  }

  private getKnockoutCandidates(sm: SwipeMatchInternal): MediaSummary[] {
    const byKey = new Map(sm.deck.map((item) => [item.ratingKey, item]));
    const matched = sm.matchedRatingKeys
      .map((key) => byKey.get(key))
      .filter((item): item is MediaSummary => Boolean(item));
    if (matched.length >= 2) {
      return matched;
    }

    const matchSet = new Set(sm.matchedRatingKeys);
    const partial = sm.deck
      .filter((item) => !matchSet.has(item.ratingKey))
      .map((item) => ({
        item,
        likes: sm.likesByRatingKey.get(item.ratingKey)?.size ?? 0
      }))
      .filter((entry) => entry.likes > 0)
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 8)
      .map((entry) => entry.item);

    return partial.length >= 2 ? partial : [];
  }

  startSwipeKnockout(room: RoomInstance, actorName: string): SwipeKnockoutState {
    const sm = room.swipeMatch;
    if (!sm) {
      throw new Error('No active Swipe Match session.');
    }
    const candidates = this.getKnockoutCandidates(sm);
    if (candidates.length < 2) {
      throw new Error('Need at least 2 matched or liked titles to start a 1v1 Knockout.');
    }

    const bracket = createKnockoutBracket(candidates);
    const knockout: SwipeKnockoutState = {
      ...bracket,
      votesByParticipantId: {},
      tied: false,
      lastTieBreakMessage: null
    };
    sm.knockout = knockout;
    this.broadcast(room, {
      type: 'room:notice',
      level: 'info',
      message: `${actorName} started the 1v1 Knockout (${candidates.length} contenders)!`
    });
    this.broadcastSwipeUpdate(room);
    return knockout;
  }

  voteSwipeKnockout(
    room: RoomInstance,
    participantId: string,
    ratingKey: string
  ): SwipeKnockoutState | null {
    const sm = room.swipeMatch;
    const ko = sm?.knockout;
    if (!sm || !ko || ko.champion || ko.currentMatchIndex >= ko.matchups.length) {
      return null;
    }

    const activeMatch = ko.matchups[ko.currentMatchIndex];
    const leftKey = activeMatch.left.ratingKey;
    const rightKey = activeMatch.right.ratingKey;
    if (ratingKey !== leftKey && ratingKey !== rightKey) {
      return null;
    }

    const votesByParticipantId: Record<string, string> = {
      ...ko.votesByParticipantId,
      [participantId]: ratingKey
    };

    const connectedIds = [...room.participants.values()]
      .filter((p) => p.isConnected)
      .map((p) => p.id);
    const requiredIds = connectedIds.length > 0 ? connectedIds : [participantId];

    let leftVotes = 0;
    let rightVotes = 0;
    for (const id of requiredIds) {
      const vote = votesByParticipantId[id];
      if (vote === leftKey) leftVotes += 1;
      else if (vote === rightKey) rightVotes += 1;
    }

    const totalVotes = leftVotes + rightVotes;
    const majorityCount = Math.floor(requiredIds.length / 2) + 1;

    let winnerKey: string | null = null;
    if (leftVotes >= majorityCount || (totalVotes >= requiredIds.length && leftVotes > rightVotes)) {
      winnerKey = leftKey;
    } else if (
      rightVotes >= majorityCount ||
      (totalVotes >= requiredIds.length && rightVotes > leftVotes)
    ) {
      winnerKey = rightKey;
    }

    if (winnerKey) {
      const nextBracket = advanceKnockoutBracket(ko, winnerKey);
      sm.knockout = {
        ...nextBracket,
        votesByParticipantId: {},
        tied: false,
        lastTieBreakMessage: null
      };
    } else {
      sm.knockout = {
        ...ko,
        votesByParticipantId,
        tied: totalVotes >= requiredIds.length && leftVotes === rightVotes
      };
    }

    this.broadcastSwipeUpdate(room);
    return sm.knockout;
  }

  resolveSwipeKnockoutTie(
    room: RoomInstance,
    actorName: string,
    mode: 'coinflip' | 'pick',
    ratingKey?: string
  ): SwipeKnockoutState | null {
    const sm = room.swipeMatch;
    const ko = sm?.knockout;
    if (!sm || !ko || ko.champion || ko.currentMatchIndex >= ko.matchups.length) {
      return null;
    }

    const activeMatch = ko.matchups[ko.currentMatchIndex];
    const winner =
      mode === 'pick' &&
      (ratingKey === activeMatch.left.ratingKey || ratingKey === activeMatch.right.ratingKey)
        ? ratingKey === activeMatch.left.ratingKey
          ? activeMatch.left
          : activeMatch.right
        : Math.random() < 0.5
          ? activeMatch.left
          : activeMatch.right;

    const nextBracket = advanceKnockoutBracket(ko, winner.ratingKey);
    const lastTieBreakMessage =
      mode === 'coinflip'
        ? `🎲 Coin flip picked "${winner.title}"!`
        : `⚡ ${actorName} broke the tie with "${winner.title}"!`;

    sm.knockout = {
      ...nextBracket,
      votesByParticipantId: {},
      tied: false,
      lastTieBreakMessage
    };

    this.broadcastSwipeUpdate(room);
    return sm.knockout;
  }

  async playSwipeMatchItem(
    room: RoomInstance,
    ratingKey: string,
    actorName: string
  ): Promise<MediaDetails> {
    const plex = this.getEffectivePlexClient(room);
    if (!plex) throw new Error('Plex server is not connected');
    const playableKey = await plex.resolvePlayableRatingKey(ratingKey);
    const details = await this.setRoomMedia(room, playableKey, actorName, 0);
    room.swipeMatch = null;
    this.broadcastSwipeUpdate(room);
    return details;
  }

  private serializeSwipeMatch(sm: SwipeMatchInternal | null): SwipeMatchState | null {
    if (!sm) return null;
    const likesByRatingKey: Record<string, string[]> = {};
    for (const [k, set] of sm.likesByRatingKey.entries()) {
      likesByRatingKey[k] = [...set];
    }
    const progressByParticipantId: Record<string, number> = {};
    for (const [pid, set] of sm.swipedByParticipant.entries()) {
      progressByParticipantId[pid] = set.size;
    }
    return {
      id: sm.id,
      status: sm.status,
      createdBy: sm.createdBy,
      config: sm.config,
      deck: sm.deck,
      likesByRatingKey,
      progressByParticipantId,
      matchedRatingKeys: [...sm.matchedRatingKeys],
      knockout: sm.knockout,
      createdAtMs: sm.createdAtMs
    };
  }

  private broadcastSwipeUpdate(room: RoomInstance): void {
    const state = this.serializeSwipeMatch(room.swipeMatch);
    for (const p of room.participants.values()) {
      if (!p.isConnected) continue;
      const order = room.swipeMatch?.orderByParticipant.get(p.id);
      const swiped = room.swipeMatch?.swipedByParticipant.get(p.id);
      for (const sock of p.sockets) {
        this.sendToSocket(sock, {
          type: 'swipe:updated',
          swipeMatch: state,
          selfSwipeOrder: order,
          selfSwipedKeys: swiped ? [...swiped] : undefined
        });
      }
    }
  }

  // ── Moderation ─────────────────────────────────────────────────────────────

  kickParticipant(room: RoomInstance, actorId: string, targetId: string): boolean {
    if (actorId === targetId) return false;
    const target = room.participants.get(targetId);
    if (!target) return false;

    room.kickedParticipantIds.add(targetId);
    target.isConnected = false;
    target.isBuffering = false;
    target.isReady = false;

    for (const sock of target.sockets) {
      if (sock.readyState === 1) {
        this.sendToSocket(sock, {
          type: 'room:kicked',
          reason: 'You were removed from this screening room by the host.'
        });
        sock.close(4008, 'Kicked by host');
      }
    }
    target.sockets.clear();

    const syncRes = room.sync.removeParticipant(targetId);
    void this.deps.streamManager.stopParticipantStreams(room.code, targetId);
    if (syncRes.changed) {
      this.broadcast(room, { type: 'playback:sync', playback: syncRes.state });
    }
    this.broadcast(room, {
      type: 'room:participants',
      participants: this.serializeParticipants(room)
    });
    this.broadcast(room, {
      type: 'room:notice',
      level: 'warning',
      message: `${target.name} was removed from the room.`
    });
    return true;
  }

  muteParticipant(room: RoomInstance, targetId: string, muted: boolean): boolean {
    const target = room.participants.get(targetId);
    if (!target) return false;
    target.isMuted = muted;
    this.broadcast(room, {
      type: 'room:participants',
      participants: this.serializeParticipants(room)
    });
    this.broadcast(room, {
      type: 'room:notice',
      level: 'info',
      message: `${target.name} was ${muted ? 'muted in chat' : 'unmuted'} by the host.`
    });
    return true;
  }

  transferHost(room: RoomInstance, fromHostId: string, targetId: string): boolean {
    if (fromHostId === targetId) return false;
    const from = room.participants.get(fromHostId);
    const target = room.participants.get(targetId);
    if (!from || !target || !target.isConnected) return false;

    from.role = 'guest';
    target.role = 'host';

    for (const p of [from, target]) {
      for (const sock of p.sockets) {
        this.sendToSocket(sock, {
          type: 'room:snapshot',
          snapshot: this.serializeSnapshotFor(room, p.id),
          selfParticipantId: p.id,
          selfRole: p.role
        });
      }
    }
    this.broadcast(room, {
      type: 'room:notice',
      level: 'info',
      message: `${target.name} is now the room host.`
    });
    return true;
  }

  // ── Artwork Guard & Serialization ──────────────────────────────────────────

  isArtworkAllowedForRoom(room: RoomInstance, artworkPath: string): boolean {
    if (!artworkPath.startsWith('/')) return false;
    if (room.currentMedia) {
      if (room.currentMedia.thumb === artworkPath || room.currentMedia.art === artworkPath) {
        return true;
      }
      if (
        room.currentMedia.nextEpisode &&
        (room.currentMedia.nextEpisode.thumb === artworkPath ||
          room.currentMedia.nextEpisode.art === artworkPath)
      ) {
        return true;
      }
    }
    for (const item of room.queue) {
      if (item.media.thumb === artworkPath || item.media.art === artworkPath) {
        return true;
      }
    }
    if (room.poll) {
      for (const opt of room.poll.options) {
        if (opt.media.thumb === artworkPath || opt.media.art === artworkPath) {
          return true;
        }
      }
    }
    if (room.swipeMatch) {
      for (const item of room.swipeMatch.deck) {
        if (item.thumb === artworkPath || item.art === artworkPath) {
          return true;
        }
      }
    }
    return false;
  }

  serializeParticipants(room: RoomInstance): Participant[] {
    return [...room.participants.values()]
      .filter((p) => p.isConnected)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        isConnected: p.isConnected,
        isBuffering: p.isBuffering,
        isCasting: p.isCasting,
        isMuted: p.isMuted,
        isReady: p.isReady,
        plexScrobbleLinked: Boolean(p.personalPlexToken),
        driftMs: p.driftMs
      }));
  }

  serializeSnapshotFor(room: RoomInstance, participantId?: string): RoomSnapshot {
    const wh = this.deps.getWebhookConfig();
    return {
      code: room.code,
      name: room.name,
      purpose: room.purpose,
      hasPin: Boolean(room.pinHash),
      hostOnlyControl: room.sync.getHostOnlyControl(),
      streamMode: room.streamMode,
      ecoQuality: room.ecoQuality,
      currentMedia: room.currentMedia,
      queue: [...room.queue],
      playback: room.sync.getState(),
      participants: this.serializeParticipants(room),
      chatHistory: [...room.chatHistory],
      poll: room.poll,
      readyCheck: { ...room.readyCheck },
      swipeMatch: this.serializeSwipeMatch(room.swipeMatch),
      selfSwipeOrder: participantId ? room.swipeMatch?.orderByParticipant.get(participantId) : undefined,
      selfSwipedKeys:
        participantId && room.swipeMatch?.swipedByParticipant.get(participantId)
          ? [...room.swipeMatch.swipedByParticipant.get(participantId)!]
          : undefined,
      hasWebhook: Boolean(wh.webhookUrl)
    };
  }

  pushChatMessage(room: RoomInstance, msg: ChatMessage): void {
    room.chatHistory.push(msg);
    if (room.chatHistory.length > 100) {
      room.chatHistory.shift();
    }
    room.lastActiveAtMs = Date.now();
    this.broadcast(room, { type: 'chat:message', message: msg });
  }

  sendToSocket(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(event));
    }
  }

  broadcast(room: RoomInstance, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const participant of room.participants.values()) {
      for (const sock of participant.sockets) {
        if (sock.readyState === 1) {
          sock.send(payload);
        }
      }
    }
  }

  reportAllParticipantsTimeline(
    room: RoomInstance,
    media: MediaDetails,
    state: 'playing' | 'paused' | 'stopped',
    timeMs: number
  ): void {
    const baseUrl = this.deps.getPlexUrl();
    if (!baseUrl) return;

    const tokens = new Set<string>();
    for (const p of room.participants.values()) {
      if (p.isConnected && p.personalPlexToken) {
        tokens.add(p.personalPlexToken);
      }
    }
    if (tokens.size === 0) return;

    for (const token of tokens) {
      const client = new PlexClient({
        baseUrl,
        token,
        clientId: this.deps.clientIdentifier,
        fetchFn: this.deps.fetchFn
      });
      void client.reportTimeline({
        ratingKey: media.ratingKey,
        state,
        timeMs,
        durationMs: media.durationMs
      });

      if (media.durationMs > 0 && timeMs / media.durationMs >= 0.9) {
        let scrobbled = room.scrobbledKeysByToken.get(token);
        if (!scrobbled) {
          scrobbled = new Set();
          room.scrobbledKeysByToken.set(token, scrobbled);
        }
        if (!scrobbled.has(media.ratingKey)) {
          scrobbled.add(media.ratingKey);
          void client.scrobble(media.ratingKey);
        }
      }
    }
  }

  private async runRoomMaintenance(): Promise<void> {
    const now = Date.now();

    for (const [key, room] of this.rooms.entries()) {
      const anyConnected = [...room.participants.values()].some((p) => p.isConnected);
      if (anyConnected) {
        room.lastActiveAtMs = now;
      }

      for (const [pid, p] of room.participants.entries()) {
        if (!p.isConnected && p.lastDisconnectedAtMs && now - p.lastDisconnectedAtMs > 5 * 60_000) {
          room.participants.delete(pid);
        }
      }

      if (room.currentMedia && anyConnected) {
        const state = room.sync.getState();
        if (state.status === 'playing' || state.status === 'buffering') {
          const posMs = room.sync.getProjectedPositionMs(now);
          this.reportAllParticipantsTimeline(room, room.currentMedia, 'playing', posMs);
        }
      }

      if (!anyConnected && now - room.lastActiveAtMs > 30 * 60_000) {
        if (room.readyCountdownTimer) {
          clearTimeout(room.readyCountdownTimer);
          room.readyCountdownTimer = null;
        }
        room.sync.destroy();
        await this.deps.streamManager.stopRoomStreams(room.code);
        this.rooms.delete(key);
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.maintenanceTimer);
    for (const room of this.rooms.values()) {
      if (room.readyCountdownTimer) {
        clearTimeout(room.readyCountdownTimer);
      }
      room.sync.destroy();
    }
    this.rooms.clear();
  }
}
