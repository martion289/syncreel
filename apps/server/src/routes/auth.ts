import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '@syncreel/shared';
import { HOST_COOKIE_NAME, signSessionToken } from '../auth/tokens.js';
import {
  checkPlexAuthPin,
  createPlexAuthPin,
  createRequestForwardUrlBuilder,
  verifyPlexUserForServer
} from '../plex/oauth.js';
import { getHostAuthSession, type AppContext } from '../context.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/auth/me', async (req) => {
    const host = getHostAuthSession(req, ctx);
    if (!host) {
      return { authenticated: false, user: null };
    }
    const user: AuthUser = {
      role: host.role,
      plexUserId: host.plexUserId,
      username: host.username,
      email: host.email,
      thumb: host.thumb,
      serverName: host.serverName
    };
    return { authenticated: true, user };
  });

  app.post('/api/auth/plex/pin', async (req, reply) => {
    try {
      const body = req.body as { returnPath?: unknown } | undefined;
      const returnPath = typeof body?.returnPath === 'string' ? body.returnPath : undefined;
      const pin = await createPlexAuthPin(ctx.config.clientIdentifier, ctx.fetchFn, {
        buildForwardUrl: createRequestForwardUrlBuilder(
          req,
          ctx.config.isHttps,
          returnPath,
          'authPin'
        )
      });
      return pin;
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : 'Failed to initiate account sign-in'
      });
    }
  });

  app.get<{ Params: { id: string } }>('/api/auth/plex/pin/:id', async (req, reply) => {
    const pinId = Number(req.params.id);
    if (!Number.isInteger(pinId) || pinId <= 0) {
      return reply.status(400).send({ error: 'Invalid PIN id' });
    }

    const plexUrl = ctx.getPlexUrl();
    if (!plexUrl) {
      return reply.status(409).send({ error: 'Complete initial server setup first' });
    }

    try {
      const result = await checkPlexAuthPin(ctx.config.clientIdentifier, pinId, ctx.fetchFn);
      if (!result.claimed || !result.authToken) {
        return { authenticated: false };
      }

      const owner = ctx.storage.getOwnerAuth(ctx.config.plexUrl);
      const settings = ctx.storage.getSettings();

      const verified = await verifyPlexUserForServer({
        token: result.authToken,
        plexUrl,
        clientId: ctx.config.clientIdentifier,
        expectedMachineId: owner?.serverMachineId,
        allowFriends: settings.allowPlexFriends,
        fetchFn: ctx.fetchFn
      });

      if (verified.role === 'admin') {
        ctx.storage.setOwnerAuth({
          plexToken: result.authToken,
          plexUserId: verified.plexUserId,
          username: verified.username,
          email: verified.email,
          thumb: verified.thumb,
          serverMachineId: verified.serverMachineId,
          serverName: verified.serverName,
          plexUrl,
          updatedAtMs: Date.now()
        });
        ctx.refreshPlexClient();
      } else {
        ctx.storage.setFriendAuth({
          plexToken: result.authToken,
          plexUserId: verified.plexUserId,
          username: verified.username,
          email: verified.email,
          thumb: verified.thumb,
          updatedAtMs: Date.now()
        });
      }

      const cookieValue = signSessionToken(
        {
          kind: 'host',
          role: verified.role,
          plexUserId: verified.plexUserId,
          username: verified.username,
          exp: Date.now() + 30 * 24 * 60 * 60_000
        },
        ctx.config.appSecret
      );

      reply.setCookie(HOST_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.config.isHttps,
        path: '/',
        maxAge: 30 * 24 * 60 * 60
      });

      const user: AuthUser = {
        role: verified.role,
        plexUserId: verified.plexUserId,
        username: verified.username,
        email: verified.email,
        thumb: verified.thumb,
        serverName: verified.serverName
      };
      return { authenticated: true, user };
    } catch (err) {
      return reply.status(403).send({
        error: err instanceof Error ? err.message : 'Account verification failed'
      });
    }
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(HOST_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}
