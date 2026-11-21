import crypto from 'node:crypto';
import path from 'node:path';
import {
  QUALITY_PRESETS,
  type AdminStreamInfo,
  type MediaDetails,
  type QualityPreset,
  type StreamMode,
  type StreamSessionResponse,
  type TextSubtitleTrack
} from '@syncreel/shared';
import type { PlexClient } from './client.js';
import { convertToWebVtt } from './subtitleConverter.js';

export class PartMutex {
  private readonly chains = new Map<number, Promise<void>>();

  async runExclusive<T>(partId: number, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(partId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = prev.then(() => current);
    this.chains.set(partId, tail);

    await prev;
    try {
      return await task();
    } finally {
      release();
      if (this.chains.get(partId) === tail) {
        this.chains.delete(partId);
      }
    }
  }
}

function stripPlexTokenFromQuery(rawQuery: string): string {
  if (!rawQuery) return '';
  const params = new URLSearchParams(rawQuery);
  params.delete('X-Plex-Token');
  params.delete('x-plex-token');
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function rewriteSingleUri(rawUri: string, streamToken: string, baseDir: string): string {
  let uriPath = rawUri.trim();
  let query = '';

  if (/^https?:\/\//i.test(uriPath)) {
    try {
      const parsed = new URL(uriPath);
      uriPath = parsed.pathname;
      query = stripPlexTokenFromQuery(parsed.search.slice(1));
    } catch {
      return rawUri;
    }
  } else {
    const qIdx = uriPath.indexOf('?');
    if (qIdx >= 0) {
      query = stripPlexTokenFromQuery(uriPath.slice(qIdx + 1));
      uriPath = uriPath.slice(0, qIdx);
    }
  }

  let subPath: string;
  if (uriPath.startsWith('/video/:/transcode/universal/')) {
    subPath = uriPath.slice('/video/:/transcode/universal/'.length);
  } else if (uriPath.startsWith('/')) {
    subPath = uriPath.slice(1);
  } else {
    subPath = baseDir ? path.posix.normalize(`${baseDir}/${uriPath}`) : path.posix.normalize(uriPath);
  }

  subPath = subPath.replace(/^\/+/, '');
  return `/api/stream/${streamToken}/${subPath}${query}`;
}

export function rewriteM3u8Playlist(
  playlistText: string,
  streamToken: string,
  currentSubPath = 'start.m3u8'
): string {
  const normalizedSub = currentSubPath.replace(/^\/+/, '');
  const baseDir = path.posix.dirname(normalizedSub) === '.' ? '' : path.posix.dirname(normalizedSub);

  return playlistText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_match, captured: string) => {
          return `URI="${rewriteSingleUri(captured, streamToken, baseDir)}"`;
        });
      }

      return rewriteSingleUri(trimmed, streamToken, baseDir);
    })
    .join('\n');
}

export function isSafeSubPath(subPath: string): boolean {
  if (!subPath || subPath.includes('\0') || subPath.includes('\\')) return false;
  if (/^https?:\/\//i.test(subPath)) return false;
  const parts = subPath.split('/');
  return !parts.some((p) => p === '..' || p === '.');
}

interface UpstreamTranscode {
  plexSessionId: string;
  key: string; // unique per viewer or shared room key
  media: MediaDetails;
  quality: QualityPreset;
  audioStreamId?: number;
  burnInSubtitleStreamId?: number;
  initialized: boolean;
  initPromise: Promise<void> | null;
  refCount: number;
  clientId: string;
}

export interface StreamSession {
  streamToken: string;
  roomCode: string;
  participantId: string;
  streamMode: StreamMode;
  upstream: UpstreamTranscode;
  createdAtMs: number;
  lastSeenAtMs: number;
}

const VTT_CACHE_LIMIT = 24;

export class StreamSessionManager {
  private readonly sessionsByToken = new Map<string, StreamSession>();
  private readonly tokenByParticipantKey = new Map<string, string>();
  private readonly sharedUpstreamByRoom = new Map<string, UpstreamTranscode>();
  private readonly vttCache = new Map<string, string>();
  private readonly partMutex = new PartMutex();
  private readonly maintenanceTimer: NodeJS.Timeout;
  private getPlexClient: () => PlexClient | null;

  constructor(getPlexClient: () => PlexClient | null) {
    this.getPlexClient = getPlexClient;
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance();
    }, 20_000);
    this.maintenanceTimer.unref();
  }

  private participantKey(roomCode: string, participantId: string): string {
    return `${roomCode.toUpperCase()}:${participantId}`;
  }

  private cacheSetVtt(key: string, value: string): void {
    if (this.vttCache.has(key)) {
      this.vttCache.delete(key);
    } else if (this.vttCache.size >= VTT_CACHE_LIMIT) {
      const oldest = this.vttCache.keys().next().value;
      if (oldest) this.vttCache.delete(oldest);
    }
    this.vttCache.set(key, value);
  }

  async createParticipantStream(params: {
    roomCode: string;
    participantId: string;
    media: MediaDetails;
    quality: QualityPreset;
    audioStreamId?: number;
    subtitleStreamId?: number;
    streamMode?: StreamMode;
    ecoQuality?: QualityPreset;
  }): Promise<StreamSessionResponse> {
    const upperRoom = params.roomCode.toUpperCase();
    const mode: StreamMode = params.streamMode ?? 'per-viewer';
    const effectiveQuality =
      mode === 'eco-shared' ? params.ecoQuality ?? '1080p-8m' : params.quality;

    const pKey = this.participantKey(upperRoom, params.participantId);
    const prevToken = this.tokenByParticipantKey.get(pKey);
    if (prevToken) {
      await this.stopStreamByToken(prevToken);
    }

    const audioStreams = params.media.streams.filter((s) => s.streamType === 2);
    const chosenAudioId =
      params.audioStreamId && audioStreams.some((s) => s.id === params.audioStreamId)
        ? params.audioStreamId
        : audioStreams.find((s) => s.selected)?.id ?? audioStreams[0]?.id;

    let burnInSubtitleStreamId: number | undefined;
    if (mode === 'per-viewer' && typeof params.subtitleStreamId === 'number' && params.subtitleStreamId > 0) {
      const subStream = params.media.streams.find(
        (s) => s.streamType === 3 && s.id === params.subtitleStreamId
      );
      if (subStream && subStream.requiresBurnIn) {
        burnInSubtitleStreamId = subStream.id;
      }
    }

    let upstream: UpstreamTranscode;

    if (mode === 'eco-shared') {
      const existingShared = this.sharedUpstreamByRoom.get(upperRoom);
      const matchesShared =
        existingShared &&
        existingShared.media.ratingKey === params.media.ratingKey &&
        existingShared.quality === effectiveQuality &&
        existingShared.audioStreamId === chosenAudioId;

      if (matchesShared) {
        upstream = existingShared;
        upstream.refCount += 1;
      } else {
        if (existingShared) {
          this.sharedUpstreamByRoom.delete(upperRoom);
          if (existingShared.refCount <= 0 && existingShared.initialized) {
            await this.stopUpstreamPlex(existingShared);
          }
        }
        const plexSessionId = crypto.randomUUID();
        upstream = {
          plexSessionId,
          key: `eco:${upperRoom}:${params.media.ratingKey}:${effectiveQuality}`,
          media: params.media,
          quality: effectiveQuality,
          audioStreamId: chosenAudioId,
          initialized: false,
          initPromise: null,
          refCount: 1,
          clientId: `eco-${upperRoom}-${plexSessionId.slice(0, 8)}`
        };
        this.sharedUpstreamByRoom.set(upperRoom, upstream);
      }
    } else {
      const plexSessionId = crypto.randomUUID();
      upstream = {
        plexSessionId,
        key: `viewer:${pKey}:${plexSessionId}`,
        media: params.media,
        quality: effectiveQuality,
        audioStreamId: chosenAudioId,
        burnInSubtitleStreamId,
        initialized: false,
        initPromise: null,
        refCount: 1,
        clientId: `${params.participantId}-${plexSessionId.slice(0, 8)}`
      };
    }

    const streamToken = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();

    const session: StreamSession = {
      streamToken,
      roomCode: upperRoom,
      participantId: params.participantId,
      streamMode: mode,
      upstream,
      createdAtMs: now,
      lastSeenAtMs: now
    };

    this.sessionsByToken.set(streamToken, session);
    this.tokenByParticipantKey.set(pKey, streamToken);

    const textSubtitles: TextSubtitleTrack[] = params.media.streams
      .filter((s) => s.streamType === 3 && s.isTextSubtitle)
      .map((s) => ({
        streamId: s.id,
        label: s.displayTitle,
        languageCode: s.languageCode || 'und',
        url: `/api/stream/${streamToken}/subtitles/${s.id}.vtt`,
        forced: s.forced
      }));

    return {
      streamToken,
      hlsUrl: `/api/stream/${streamToken}/start.m3u8`,
      textSubtitles,
      activeAudioStreamId: upstream.audioStreamId,
      activeBurnInSubtitleStreamId: upstream.burnInSubtitleStreamId,
      streamMode: mode,
      ecoQuality: effectiveQuality
    };
  }

  getSession(streamToken: string): StreamSession | null {
    const session = this.sessionsByToken.get(streamToken) ?? null;
    if (session) {
      session.lastSeenAtMs = Date.now();
    }
    return session;
  }

  listActiveSessions(): AdminStreamInfo[] {
    return [...this.sessionsByToken.values()].map((s) => ({
      streamToken: s.streamToken,
      roomCode: s.roomCode,
      participantId: s.participantId,
      plexSessionId: s.upstream.plexSessionId,
      mediaTitle: s.upstream.media.title,
      quality: s.upstream.quality,
      streamMode: s.streamMode,
      lastSeenAtMs: s.lastSeenAtMs
    }));
  }

  private buildTranscodeParams(upstream: UpstreamTranscode): URLSearchParams {
    const preset = QUALITY_PRESETS[upstream.quality];
    const params = new URLSearchParams({
      path: `/library/metadata/${upstream.media.ratingKey}`,
      mediaIndex: '0',
      partIndex: '0',
      protocol: 'hls',
      fastSeek: '1',
      directPlay: '0',
      directStream: '1',
      directStreamAudio: '1',
      copyts: '1',
      session: upstream.plexSessionId,
      'X-Plex-Session-Identifier': upstream.plexSessionId,
      'X-Plex-Client-Identifier': upstream.clientId,
      'X-Plex-Product': 'SyncReel for Plex',
      'X-Plex-Platform': 'Chrome',
      'X-Plex-Client-Profile-Extra':
        'add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.bitDepth&value=8&replace=true)'
    });

    if (preset.maxVideoBitrate) {
      params.set('maxVideoBitrate', String(preset.maxVideoBitrate));
    }
    if (preset.videoResolution) {
      params.set('videoResolution', preset.videoResolution);
    }

    if (upstream.burnInSubtitleStreamId) {
      params.set('subtitles', 'burn');
      params.set('subtitleStreamID', String(upstream.burnInSubtitleStreamId));
    } else {
      params.set('subtitles', 'none');
    }

    if (upstream.audioStreamId) {
      params.set('audioStreamID', String(upstream.audioStreamId));
    }

    return params;
  }

  private async ensureUpstreamInitialized(plex: PlexClient, upstream: UpstreamTranscode): Promise<void> {
    if (upstream.initialized) return;
    if (upstream.initPromise) {
      await upstream.initPromise;
      return;
    }

    upstream.initPromise = this.partMutex.runExclusive(upstream.media.partId || 0, async () => {
      if (upstream.initialized) return;
      const subIdForPart = upstream.burnInSubtitleStreamId ?? 0;
      await plex.setPartStreams(upstream.media.partId, upstream.audioStreamId, subIdForPart);
      const params = this.buildTranscodeParams(upstream);
      await plex
        .requestRaw(`/video/:/transcode/universal/decision?${params.toString()}`)
        .catch(() => undefined);
      upstream.initialized = true;
    });

    try {
      await upstream.initPromise;
    } finally {
      upstream.initPromise = null;
    }
  }

  async fetchUpstreamStream(
    streamToken: string,
    subPath: string,
    queryString: string,
    rangeHeader?: string
  ): Promise<{
    status: number;
    contentType: string;
    body: string | Buffer;
    headers: Record<string, string>;
  }> {
    const session = this.getSession(streamToken);
    if (!session) {
      return {
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Stream session expired or invalid' }),
        headers: {}
      };
    }

    if (!isSafeSubPath(subPath)) {
      return {
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid stream path' }),
        headers: {}
      };
    }

    const plex = this.getPlexClient();
    if (!plex) {
      return {
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Plex client not authenticated' }),
        headers: {}
      };
    }

    await this.ensureUpstreamInitialized(plex, session.upstream);

    const forwardHeaders: Record<string, string> = {};
    if (rangeHeader) forwardHeaders.Range = rangeHeader;

    let upstreamRes: Response;
    if (subPath === 'start.m3u8') {
      const params = this.buildTranscodeParams(session.upstream);
      upstreamRes = await plex.requestRaw(
        `/video/:/transcode/universal/start.m3u8?${params.toString()}`,
        { headers: forwardHeaders }
      );
    } else {
      const qs = queryString ? `?${queryString}` : '';
      upstreamRes = await plex.requestRaw(`/video/:/transcode/universal/${subPath}${qs}`, {
        headers: forwardHeaders
      });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist =
      subPath.endsWith('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('x-mpegURL');

    if (isPlaylist && upstreamRes.ok) {
      const text = await upstreamRes.text();
      const rewritten = rewriteM3u8Playlist(text, streamToken, subPath);
      return {
        status: upstreamRes.status,
        contentType: 'application/vnd.apple.mpegurl',
        body: rewritten,
        headers: {}
      };
    }

    const arr = await upstreamRes.arrayBuffer();
    const passHeaders: Record<string, string> = {};
    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    const contentRange = upstreamRes.headers.get('content-range');
    if (acceptRanges) passHeaders['accept-ranges'] = acceptRanges;
    if (contentRange) passHeaders['content-range'] = contentRange;

    return {
      status: upstreamRes.status,
      contentType,
      body: Buffer.from(arr),
      headers: passHeaders
    };
  }

  async fetchWebVttSubtitle(streamToken: string, streamId: number): Promise<string | null> {
    const session = this.getSession(streamToken);
    if (!session) return null;

    const media = session.upstream.media;
    const sub = media.streams.find(
      (s) => s.streamType === 3 && s.id === streamId && s.isTextSubtitle
    );
    if (!sub) return null;

    const cacheKey = `${media.ratingKey}:${sub.id}`;
    const cached = this.vttCache.get(cacheKey);
    if (cached) {
      // Refresh LRU ordering
      this.cacheSetVtt(cacheKey, cached);
      return cached;
    }

    const plex = this.getPlexClient();
    if (!plex) return null;

    let rawText: string | null = null;

    // 1. Direct sidecar key OR direct Plex stream extraction endpoint (/library/streams/:id)
    const directPaths = sub.key ? [sub.key] : [`/library/streams/${sub.id}`];
    for (const p of directPaths) {
      const res = await plex.requestRaw(p).catch(() => null);
      if (res && res.ok) {
        rawText = await res.text();
        break;
      }
    }

    // 2. Fallback for embedded MKV text subtitles via Plex universal subtitle extractor
    if (!rawText && !sub.key) {
      rawText = await this.partMutex.runExclusive(media.partId || 0, async () => {
        await plex.setPartStreams(media.partId, undefined, sub.id);
        try {
          const params = new URLSearchParams({
            path: `/library/metadata/${media.ratingKey}`,
            mediaIndex: '0',
            partIndex: '0',
            protocol: 'http',
            copyts: '1',
            subtitles: 'auto',
            subtitleStreamID: String(sub.id)
          });
          if (typeof sub.streamIndex === 'number') {
            params.set('streamIndex', String(sub.streamIndex));
          }
          const res = await plex
            .requestRaw(`/video/:/transcode/universal/subtitles?${params.toString()}`)
            .catch(() => null);
          if (res && res.ok) {
            return await res.text();
          }
          return null;
        } finally {
          // Restore subtitleStreamID=0 so subsequent video transcodes don't accidentally burn in text subs
          await plex.setPartStreams(media.partId, undefined, 0).catch(() => undefined);
        }
      });
    }

    if (!rawText) return null;
    const vtt = convertToWebVtt(rawText, sub.codec);
    this.cacheSetVtt(cacheKey, vtt);
    return vtt;
  }

  private async stopUpstreamPlex(upstream: UpstreamTranscode): Promise<void> {
    const plex = this.getPlexClient();
    if (plex && upstream.initialized) {
      await plex
        .requestRaw(
          `/video/:/transcode/universal/stop?session=${encodeURIComponent(upstream.plexSessionId)}`
        )
        .catch(() => undefined);
    }
  }

  async stopStreamByToken(streamToken: string): Promise<void> {
    const session = this.sessionsByToken.get(streamToken);
    if (!session) return;

    this.sessionsByToken.delete(streamToken);
    const pKey = this.participantKey(session.roomCode, session.participantId);
    if (this.tokenByParticipantKey.get(pKey) === streamToken) {
      this.tokenByParticipantKey.delete(pKey);
    }

    session.upstream.refCount = Math.max(0, session.upstream.refCount - 1);
    if (session.upstream.refCount === 0) {
      if (this.sharedUpstreamByRoom.get(session.roomCode) === session.upstream) {
        this.sharedUpstreamByRoom.delete(session.roomCode);
      }
      await this.stopUpstreamPlex(session.upstream);
    }
  }

  async stopParticipantStreams(roomCode: string, participantId: string): Promise<void> {
    const token = this.tokenByParticipantKey.get(this.participantKey(roomCode, participantId));
    if (token) {
      await this.stopStreamByToken(token);
    }
  }

  async stopRoomStreams(roomCode: string): Promise<void> {
    const upper = roomCode.toUpperCase();
    const tokens = [...this.sessionsByToken.values()]
      .filter((s) => s.roomCode === upper)
      .map((s) => s.streamToken);
    await Promise.all(tokens.map((t) => this.stopStreamByToken(t)));

    const shared = this.sharedUpstreamByRoom.get(upper);
    if (shared) {
      this.sharedUpstreamByRoom.delete(upper);
      await this.stopUpstreamPlex(shared);
    }
  }

  async stopAll(): Promise<void> {
    clearInterval(this.maintenanceTimer);
    const tokens = [...this.sessionsByToken.keys()];
    await Promise.all(tokens.map((t) => this.stopStreamByToken(t)));
  }

  private async runMaintenance(): Promise<void> {
    const plex = this.getPlexClient();
    if (!plex) return;
    const now = Date.now();
    const staleTokens: string[] = [];
    const pingedSessions = new Set<string>();

    for (const session of this.sessionsByToken.values()) {
      if (now - session.lastSeenAtMs > 60_000) {
        staleTokens.push(session.streamToken);
      } else if (session.upstream.initialized && !pingedSessions.has(session.upstream.plexSessionId)) {
        pingedSessions.add(session.upstream.plexSessionId);
        await plex
          .requestRaw(
            `/video/:/transcode/universal/ping?session=${encodeURIComponent(session.upstream.plexSessionId)}`
          )
          .catch(() => undefined);
      }
    }

    await Promise.all(staleTokens.map((t) => this.stopStreamByToken(t)));
  }
}
