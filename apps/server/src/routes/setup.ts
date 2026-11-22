import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HOST_COOKIE_NAME, signSessionToken } from '../auth/tokens.js';
import {
  checkPlexAuthPin,
  createPlexAuthPin,
  discoverPlexServers,
  verifyPlexUserForServer
} from '../plex/oauth.js';
import { validateWebhookUrl } from '../notifications/webhook.js';
import { getHostAuthSession, type AppContext } from '../context.js';

const DiscoverBody = z.object({
  setupTicket: z.string().min(1)
});

const CompleteSetupBody = z.object({
  setupTicket: z.string().min(1),
  plexUrl: z.string().url(),
  allowPlexFriends: z.boolean().default(false),
  webhookUrl: z.string().max(500).optional(),
  webhookAutoNotify: z.boolean().default(false)
});

export function registerSetupRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/setup/status', async () => {
    const owner = ctx.storage.getOwnerAuth(ctx.config.plexUrl);
    const settings = ctx.storage.getSettings();
    const configured = ctx.storage.isSetupComplete(ctx.config.plexUrl);
    return {
      configured,
      serverName: owner?.serverName,
      plexUrl: configured ? ctx.getPlexUrl() : undefined,
      allowPlexFriends: settings.allowPlexFriends,
      hasWebhook: Boolean(settings.webhookUrl)
    };
  });

  app.post('/api/setup/plex/pin', async (_req, reply) => {
    if (ctx.storage.isSetupComplete(ctx.config.plexUrl)) {
      return reply.status(409).send({ error: 'Setup is already complete' });
    }
    try {
      return await createPlexAuthPin(ctx.config.clientIdentifier, ctx.fetchFn);
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : 'Failed to create sign-in PIN'
      });
    }
  });

  app.get<{ Params: { id: string } }>('/api/setup/plex/pin/:id', async (req, reply) => {
    if (ctx.storage.isSetupComplete(ctx.config.plexUrl)) {
      return reply.status(409).send({ error: 'Setup is already complete' });
    }
    const pinId = Number(req.params.id);
    if (!Number.isInteger(pinId) || pinId <= 0) {
      return reply.status(400).send({ error: 'Invalid PIN id' });
    }

    try {
      const check = await checkPlexAuthPin(ctx.config.clientIdentifier, pinId, ctx.fetchFn);
      if (!check.claimed || !check.authToken) {
        return { claimed: false };
      }

      const userRes = await ctx.fetchFn('https://plex.tv/api/v2/user', {
        headers: {
          Accept: 'application/json',
          'X-Plex-Token': check.authToken,
          'X-Plex-Client-Identifier': ctx.config.clientIdentifier
        }
      });
      if (!userRes.ok) {
        throw new Error('Failed to fetch account profile');
      }
      const userJson = (await userRes.json()) as {
        id: number;
        username?: string;
        title?: string;
        email?: string;
        thumb?: string;
      };

      const setupTicket = crypto.randomBytes(24).toString('base64url');
      ctx.pendingSetups.set(setupTicket, {
        plexToken: check.authToken,
        plexUserId: userJson.id,
        username: userJson.username || userJson.title || 'Server Owner',
        email: userJson.email,
        thumb: userJson.thumb,
        createdAtMs: Date.now()
      });

      const servers = await discoverPlexServers(
        check.authToken,
        ctx.config.clientIdentifier,
        ctx.fetchFn
      );

      return {
        claimed: true,
        setupTicket,
        username: userJson.username || userJson.title || 'Server Owner',
        servers
      };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : 'Account authentication failed'
      });
    }
  });

  app.post('/api/setup/plex/servers', async (req, reply) => {
    const parsed = DiscoverBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Missing setupTicket' });
    }
    const pending = ctx.pendingSetups.get(parsed.data.setupTicket);
    if (!pending) {
      return reply.status(401).send({ error: 'Setup session expired; sign in again' });
    }

    const servers = await discoverPlexServers(
      pending.plexToken,
      ctx.config.clientIdentifier,
      ctx.fetchFn
    );
    return { servers };
  });

  app.post('/api/setup/complete', async (req, reply) => {
    if (ctx.storage.isSetupComplete(ctx.config.plexUrl)) {
      const host = getHostAuthSession(req, ctx);
      if (host?.role !== 'admin') {
        return reply.status(409).send({ error: 'Setup is already complete' });
      }
    }

    const parsed = CompleteSetupBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid setup options' });
    }

    const pending = ctx.pendingSetups.get(parsed.data.setupTicket);
    if (!pending) {
      return reply.status(401).send({ error: 'Setup ticket expired; please sign in again' });
    }

    const webhook = parsed.data.webhookUrl?.trim() ?? '';
    const whValidation = validateWebhookUrl(webhook, ctx.config.nodeEnv === 'test');
    if (!whValidation.valid) {
      return reply.status(400).send({ error: whValidation.reason });
    }

    try {
      const verified = await verifyPlexUserForServer({
        token: pending.plexToken,
        plexUrl: parsed.data.plexUrl,
        clientId: ctx.config.clientIdentifier,
        allowFriends: false,
        fetchFn: ctx.fetchFn
      });

      const cleanUrl = parsed.data.plexUrl.replace(/\/+$/, '');
      ctx.storage.setOwnerAuth({
        plexToken: pending.plexToken,
        plexUserId: verified.plexUserId,
        username: verified.username,
        email: verified.email,
        thumb: verified.thumb,
        serverMachineId: verified.serverMachineId,
        serverName: verified.serverName,
        plexUrl: cleanUrl,
        updatedAtMs: Date.now()
      });

      ctx.storage.updateSettings({
        allowPlexFriends: parsed.data.allowPlexFriends,
        webhookUrl: webhook,
        webhookAutoNotify: parsed.data.webhookAutoNotify
      });

      ctx.pendingSetups.delete(parsed.data.setupTicket);
      ctx.refreshPlexClient();

      const cookieValue = signSessionToken(
        {
          kind: 'host',
          role: 'admin',
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

      return {
        configured: true,
        user: {
          role: 'admin' as const,
          plexUserId: verified.plexUserId,
          username: verified.username,
          email: verified.email,
          thumb: verified.thumb,
          serverName: verified.serverName
        }
      };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Unable to connect to that media server URL'
      });
    }
  });
}
