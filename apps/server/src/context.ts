import type { FastifyRequest } from 'fastify';
import type { ParticipantRole, UserRole } from '@syncreel/shared';
import type { AppConfig } from './config.js';
import type { StateStorage } from './storage.js';
import {
  GUEST_COOKIE_NAME,
  HOST_COOKIE_NAME,
  PinRateLimiter,
  verifySessionToken,
  type GuestSessionPayload,
  type HostSessionPayload
} from './auth/tokens.js';
import type { PlexClient } from './plex/client.js';
import type { StreamSessionManager } from './plex/streamProxy.js';
import type { RoomManager } from './rooms/roomManager.js';

export interface PendingSetupSession {
  plexToken: string;
  plexUserId: number;
  username: string;
  email?: string;
  thumb?: string;
  createdAtMs: number;
}

export interface AppContext {
  config: AppConfig;
  storage: StateStorage;
  getPlexUrl: () => string;
  getPlexClient: () => PlexClient | null;
  refreshPlexClient: () => void;
  streamManager: StreamSessionManager;
  roomManager: RoomManager;
  pinLimiter: PinRateLimiter;
  pendingSetups: Map<string, PendingSetupSession>;
  fetchFn: typeof fetch;
}

export interface AuthenticatedPlexUser {
  role: UserRole;
  plexUserId: number;
  username: string;
  email?: string;
  thumb?: string;
  plexToken: string;
  serverName: string;
}

function isPreviewGuestRequest(req: FastifyRequest): boolean {
  const headerRole = req.headers['x-syncreel-role'];
  if (typeof headerRole === 'string' && headerRole.toLowerCase() === 'guest') {
    return true;
  }
  const q = req.query as Record<string, string | undefined> | undefined;
  return q?.asGuest === '1';
}

export function getHostAuthSession(
  req: FastifyRequest,
  ctx: AppContext
): AuthenticatedPlexUser | null {
  if (isPreviewGuestRequest(req)) {
    return null;
  }

  const token = req.cookies?.[HOST_COOKIE_NAME];
  const payload = verifySessionToken<HostSessionPayload>(token, ctx.config.appSecret, 'host');
  if (!payload) return null;

  const owner = ctx.storage.getOwnerAuth(ctx.config.plexUrl);
  if (owner && owner.plexUserId === payload.plexUserId) {
    return {
      role: 'admin',
      plexUserId: owner.plexUserId,
      username: owner.username,
      email: owner.email,
      thumb: owner.thumb,
      plexToken: owner.plexToken,
      serverName: owner.serverName
    };
  }

  const settings = ctx.storage.getSettings();
  if (payload.role === 'friend' && settings.allowPlexFriends) {
    const friend = ctx.storage.getFriendAuth(payload.plexUserId);
    if (friend) {
      return {
        role: 'friend',
        plexUserId: friend.plexUserId,
        username: friend.username,
        email: friend.email,
        thumb: friend.thumb,
        plexToken: friend.plexToken,
        serverName: owner?.serverName ?? 'Plex Media Server'
      };
    }
  }

  return null;
}

export function getGuestSession(
  req: FastifyRequest,
  ctx: AppContext
): GuestSessionPayload | null {
  const headerGuest = req.headers['x-syncreel-guest-token'];
  const q = req.query as Record<string, string | undefined> | undefined;
  const queryGuest = q?.guestToken;

  if (isPreviewGuestRequest(req)) {
    const raw =
      (typeof headerGuest === 'string' ? headerGuest : undefined) || queryGuest;
    return verifySessionToken<GuestSessionPayload>(raw, ctx.config.appSecret, 'guest');
  }

  const token =
    (typeof headerGuest === 'string' ? headerGuest : undefined) ||
    queryGuest ||
    req.cookies?.[GUEST_COOKIE_NAME];
  return verifySessionToken<GuestSessionPayload>(token, ctx.config.appSecret, 'guest');
}

export function resolveRoomParticipant(
  req: FastifyRequest,
  ctx: AppContext,
  roomCode: string
): { id: string; name: string; role: ParticipantRole; personalPlexToken?: string } | null {
  const guest = getGuestSession(req, ctx);
  const host = getHostAuthSession(req, ctx);

  // Explicit single-account 2nd-device seat or guest preview tab takes priority over host cookie
  if (
    guest &&
    guest.roomCode.toUpperCase() === roomCode.trim().toUpperCase() &&
    (guest.isSeat || isPreviewGuestRequest(req))
  ) {
    return {
      id: guest.participantId,
      name: guest.name,
      role: 'guest',
      personalPlexToken: host?.plexToken
    };
  }

  if (host) {
    return {
      id: `host-${host.plexUserId}`,
      name: host.username,
      role: 'host',
      personalPlexToken: host.plexToken
    };
  }

  if (guest && guest.roomCode.toUpperCase() === roomCode.trim().toUpperCase()) {
    return {
      id: guest.participantId,
      name: guest.name,
      role: 'guest'
    };
  }

  return null;
}
