import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendRoomWebhook, validateWebhookUrl } from '../notifications/webhook.js';
import { getHostAuthSession, type AppContext } from '../context.js';

const UpdateAdminSettingsBody = z.object({
  plexUrl: z.string().url().optional(),
  allowPlexFriends: z.boolean().optional(),
  webhookUrl: z.string().max(500).optional(),
  webhookAutoNotify: z.boolean().optional(),
  defaultHostOnlyControl: z.boolean().optional()
});

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getHostAuthSession(req, ctx);
    if (!user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Server owner admin privileges required' });
    }
    return user;
  };

  app.get('/api/admin/overview', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const owner = ctx.storage.getOwnerAuth(ctx.config.plexUrl);
    const settings = ctx.storage.getSettings();

    return {
      settings: {
        plexUrl: ctx.getPlexUrl(),
        serverName: owner?.serverName || 'Media Server',
        allowPlexFriends: settings.allowPlexFriends,
        webhookUrl: settings.webhookUrl,
        webhookAutoNotify: settings.webhookAutoNotify,
        defaultHostOnlyControl: settings.defaultHostOnlyControl
      },
      rooms: ctx.roomManager.listAdminRooms(),
      streams: ctx.streamManager.listActiveSessions()
    };
  });

  app.patch('/api/admin/settings', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const parsed = UpdateAdminSettingsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid settings payload' });
    }

    if (typeof parsed.data.webhookUrl === 'string') {
      const check = validateWebhookUrl(parsed.data.webhookUrl, ctx.config.nodeEnv === 'test');
      if (!check.valid) {
        return reply.status(400).send({ error: check.reason });
      }
    }

    if (parsed.data.plexUrl) {
      const owner = ctx.storage.getOwnerAuth(ctx.config.plexUrl);
      if (owner) {
        ctx.storage.setOwnerAuth({
          ...owner,
          plexUrl: parsed.data.plexUrl.replace(/\/+$/, ''),
          updatedAtMs: Date.now()
        });
        ctx.refreshPlexClient();
      }
    }

    const updated = ctx.storage.updateSettings({
      ...(typeof parsed.data.allowPlexFriends === 'boolean'
        ? { allowPlexFriends: parsed.data.allowPlexFriends }
        : {}),
      ...(typeof parsed.data.webhookUrl === 'string'
        ? { webhookUrl: parsed.data.webhookUrl.trim() }
        : {}),
      ...(typeof parsed.data.webhookAutoNotify === 'boolean'
        ? { webhookAutoNotify: parsed.data.webhookAutoNotify }
        : {}),
      ...(typeof parsed.data.defaultHostOnlyControl === 'boolean'
        ? { defaultHostOnlyControl: parsed.data.defaultHostOnlyControl }
        : {})
    });

    return { ok: true, settings: updated, plexUrl: ctx.getPlexUrl() };
  });

  app.post('/api/admin/webhook/test', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const body = (req.body ?? {}) as { webhookUrl?: string };
    const url = (body.webhookUrl ?? ctx.storage.getSettings().webhookUrl).trim();
    const res = await sendRoomWebhook({
      webhookUrl: url,
      publicUrl: ctx.config.publicUrl || `${req.protocol}://${req.headers.host || 'localhost'}`,
      roomCode: 'TEST',
      roomName: 'SyncReel Test Room',
      hostName: admin.username,
      media: null,
      isTest: true,
      fetchFn: ctx.fetchFn
    });
    if (!res.ok) {
      return reply.status(400).send({ error: res.error || 'Webhook test failed' });
    }
    return { ok: true };
  });

  app.delete<{ Params: { code: string } }>('/api/admin/rooms/:code', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const closed = await ctx.roomManager.closeRoom(req.params.code);
    if (!closed) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return { ok: true };
  });

  app.delete<{ Params: { token: string } }>('/api/admin/streams/:token', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    await ctx.streamManager.stopStreamByToken(req.params.token);
    return { ok: true };
  });
}
