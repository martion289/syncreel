import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QualityPresetSchema, StreamModeSchema, SwipeMatchConfigSchema } from '@syncreel/shared';
import { GUEST_COOKIE_NAME, signSessionToken } from '../auth/tokens.js';
import { checkPlexAuthPin, createPlexAuthPin } from '../plex/oauth.js';
import {
  getGuestSession,
  getHostAuthSession,
  resolveRoomParticipant,
  type AppContext
} from '../context.js';

const CreateRoomBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().trim().max(40).optional(),
  pin: z.string().trim().max(24).optional(),
  purpose: z.enum(['watch', 'picker']).optional(),
  hostOnlyControl: z.boolean().optional(),
  streamMode: StreamModeSchema.optional(),
  ecoQuality: QualityPresetSchema.optional(),
  initialRatingKey: z.string().min(1).max(64).optional(),
  autoStartSwipe: SwipeMatchConfigSchema.optional()
});

const JoinRoomBody = z.object({
  name: z.string().trim().min(1).max(40),
  pin: z.string().trim().max(24).optional(),
  previewGuest: z.boolean().optional(),
  forceGuestSeat: z.boolean().optional()
});

const MintStreamBody = z.object({
  ratingKey: z.string().min(1).max(64),
  quality: QualityPresetSchema.default('original'),
  audioStreamId: z.number().int().positive().optional(),
  subtitleStreamId: z.number().int().min(0).optional()
});

export function registerRoomRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/rooms', async (req, reply) => {
    const host = getHostAuthSession(req, ctx);
    if (!host) {
      const guest = getGuestSession(req, ctx);
      return reply
        .status(guest ? 403 : 401)
        .send({ error: 'Only a signed-in Plex host can create rooms' });
    }

    const parsed = CreateRoomBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid room options' });
    }

    try {
      const settings = ctx.storage.getSettings();
      const room = ctx.roomManager.createRoom({
        name: parsed.data.name,
        slug: parsed.data.slug,
        pin: parsed.data.pin,
        purpose: parsed.data.purpose ?? 'watch',
        hostOnlyControl: parsed.data.hostOnlyControl ?? settings.defaultHostOnlyControl,
        streamMode: parsed.data.streamMode,
        ecoQuality: parsed.data.ecoQuality,
        hostPlexToken: host.plexToken,
        hostUsername: host.username
      });

      if (parsed.data.initialRatingKey) {
        const plex = ctx.roomManager.getEffectivePlexClient(room);
        if (plex) {
          const playableKey = await plex.resolvePlayableRatingKey(parsed.data.initialRatingKey);
          await ctx.roomManager.setRoomMedia(room, playableKey, host.username, 0);
        }
      }

      if (parsed.data.autoStartSwipe) {
        await ctx.roomManager.startSwipeMatch(room, parsed.data.autoStartSwipe, host.username);
      }

      return reply.status(201).send({
        code: room.code,
        name: room.name,
        purpose: room.purpose,
        hasPin: Boolean(room.pinHash),
        hostOnlyControl: room.sync.getHostOnlyControl(),
        streamMode: room.streamMode,
        ecoQuality: room.ecoQuality
      });
    } catch (err) {
      const status = (err as Error & { statusCode?: number }).statusCode ?? 400;
      return reply.status(status).send({
        error: err instanceof Error ? err.message : 'Unable to create room'
      });
    }
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code/info', async (req, reply) => {
    const info = ctx.roomManager.getPublicInfo(req.params.code);
    if (!info) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    const participant = resolveRoomParticipant(req, ctx, info.code);
    const room = ctx.roomManager.getRoom(info.code);
    const effectiveRole =
      participant && room
        ? ctx.roomManager.getParticipantRole(room, participant.id, participant.role)
        : undefined;

    const host = getHostAuthSession(req, ctx);
    const hostEntry =
      host && room ? room.participants.get(`host-${host.plexUserId}`) : undefined;
    const hostAlreadyConnected = Boolean(
      host && hostEntry?.isConnected && participant?.role === 'host'
    );

    return {
      ...info,
      hasAccess: Boolean(participant),
      selfRole: effectiveRole,
      selfName: participant?.name,
      hostAlreadyConnected
    };
  });

  app.post<{ Params: { code: string } }>('/api/rooms/:code/join', async (req, reply) => {
    const room = ctx.roomManager.getRoom(req.params.code);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    const parsed = JoinRoomBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Please enter a valid display name (1–40 chars)' });
    }

    const isPreview = Boolean(parsed.data.previewGuest || req.headers['x-syncreel-role'] === 'guest');
    const isSeatJoin = Boolean(parsed.data.forceGuestSeat);
    if (!isPreview && !isSeatJoin) {
      const host = getHostAuthSession(req, ctx);
      if (host) {
        return {
          joined: true,
          role: 'host' as const,
          participantId: `host-${host.plexUserId}`,
          name: host.username,
          roomCode: room.code
        };
      }
    }

    if (ctx.pinLimiter.isBlocked(req.ip, room.code)) {
      return reply.status(429).send({
        error: 'Too many incorrect PIN attempts. Please wait a few minutes and try again.'
      });
    }

    if (!ctx.roomManager.verifyRoomPin(room, parsed.data.pin)) {
      ctx.pinLimiter.recordFailure(req.ip, room.code);
      return reply.status(401).send({ error: 'Incorrect room PIN' });
    }

    ctx.pinLimiter.clear(req.ip, room.code);

    const existingGuest = getGuestSession(req, ctx);
    const participantId =
      existingGuest && existingGuest.roomCode.toUpperCase() === room.code.toUpperCase()
        ? existingGuest.participantId
        : crypto.randomUUID();

    if (ctx.roomManager.isParticipantKicked(room, participantId)) {
      return reply.status(403).send({ error: 'You were removed from this room by the host' });
    }

    const guestToken = signSessionToken(
      {
        kind: 'guest',
        roomCode: room.code,
        participantId,
        name: parsed.data.name,
        ...(isSeatJoin ? { isSeat: true } : {}),
        exp: Date.now() + 24 * 60 * 60_000
      },
      ctx.config.appSecret
    );

    if (!isPreview) {
      reply.setCookie(GUEST_COOKIE_NAME, guestToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.config.isHttps,
        path: '/',
        maxAge: 24 * 60 * 60
      });
    }

    return {
      joined: true,
      role: 'guest' as const,
      participantId,
      name: parsed.data.name,
      roomCode: room.code,
      guestToken
    };
  });

  // Optional personal Plex watch-history linking for guests
  app.post<{ Params: { code: string } }>(
    '/api/rooms/:code/plex-link/pin',
    async (req, reply) => {
      const room = ctx.roomManager.getRoom(req.params.code);
      if (!room) return reply.status(404).send({ error: 'Room not found' });
      const participant = resolveRoomParticipant(req, ctx, room.code);
      if (!participant) return reply.status(403).send({ error: 'Join the room first' });

      try {
        return await createPlexAuthPin(ctx.config.clientIdentifier, ctx.fetchFn);
      } catch (err) {
        return reply.status(502).send({
          error: err instanceof Error ? err.message : 'Failed to create Plex link PIN'
        });
      }
    }
  );

  app.get<{ Params: { code: string; id: string } }>(
    '/api/rooms/:code/plex-link/pin/:id',
    async (req, reply) => {
      const room = ctx.roomManager.getRoom(req.params.code);
      if (!room) return reply.status(404).send({ error: 'Room not found' });
      const participant = resolveRoomParticipant(req, ctx, room.code);
      if (!participant) return reply.status(403).send({ error: 'Join the room first' });

      const pinId = Number(req.params.id);
      if (!Number.isInteger(pinId) || pinId <= 0) {
        return reply.status(400).send({ error: 'Invalid PIN id' });
      }

      const check = await checkPlexAuthPin(ctx.config.clientIdentifier, pinId, ctx.fetchFn);
      if (!check.claimed || !check.authToken) {
        return { linked: false };
      }

      ctx.roomManager.attachParticipantPlexToken(room, participant.id, check.authToken);
      return { linked: true };
    }
  );

  app.post<{ Params: { code: string } }>('/api/rooms/:code/stream', async (req, reply) => {
    const room = ctx.roomManager.getRoom(req.params.code);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    const participant = resolveRoomParticipant(req, ctx, room.code);
    if (!participant || ctx.roomManager.isParticipantKicked(room, participant.id)) {
      return reply.status(403).send({ error: 'Join the room first to stream playback' });
    }

    const parsed = MintStreamBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid stream parameters' });
    }

    if (!room.currentMedia) {
      return reply.status(400).send({ error: 'No media is currently loaded in this room' });
    }

    if (parsed.data.ratingKey !== room.currentMedia.ratingKey) {
      return reply.status(403).send({
        error: 'Cannot stream media outside the room active title'
      });
    }

    const stream = await ctx.streamManager.createParticipantStream({
      roomCode: room.code,
      participantId: participant.id,
      media: room.currentMedia,
      quality: parsed.data.quality,
      audioStreamId: parsed.data.audioStreamId,
      subtitleStreamId: parsed.data.subtitleStreamId,
      streamMode: room.streamMode,
      ecoQuality: room.ecoQuality
    });

    return stream;
  });

  app.get<{
    Params: { code: string };
    Querystring: { path?: string; w?: string; h?: string };
  }>('/api/rooms/:code/artwork', async (req, reply) => {
    const room = ctx.roomManager.getRoom(req.params.code);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    const artPath = req.query.path;
    if (!artPath || !artPath.startsWith('/')) {
      return reply.status(400).send({ error: 'Invalid artwork path' });
    }

    const participant = resolveRoomParticipant(req, ctx, room.code);
    const isCurrentMediaArt =
      room.currentMedia &&
      (room.currentMedia.thumb === artPath || room.currentMedia.art === artPath);

    if (!isCurrentMediaArt && (!participant || !ctx.roomManager.isArtworkAllowedForRoom(room, artPath))) {
      return reply.status(403).send({ error: 'Artwork path not authorized for this room' });
    }

    const plex = ctx.roomManager.getEffectivePlexClient(room);
    if (!plex) {
      return reply.status(503).send({ error: 'Plex server unavailable' });
    }

    const w = Math.min(1920, Math.max(80, Number(req.query.w ?? 500) || 500));
    const h = Math.min(1080, Math.max(80, Number(req.query.h ?? 750) || 750));
    const img = await plex.fetchArtwork(artPath, w, h);
    if (!img) {
      return reply.status(404).send({ error: 'Artwork not found' });
    }

    reply.header('Content-Type', img.contentType);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(img.buffer);
  });
}
