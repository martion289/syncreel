import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { loadConfig, type AppConfig } from './config.js';
import { StateStorage } from './storage.js';
import { PinRateLimiter } from './auth/tokens.js';
import { PlexClient } from './plex/client.js';
import { StreamSessionManager } from './plex/streamProxy.js';
import { RoomManager } from './rooms/roomManager.js';
import type { AppContext, PendingSetupSession } from './context.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlexRoutes } from './routes/plex.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerWsRoutes } from './routes/ws.js';

export interface BuildAppOptions {
  configOverrides?: Partial<Record<string, string>>;
  fetchFn?: typeof fetch;
  serveStatic?: boolean;
  webDistDir?: string;
}

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
  config: AppConfig;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<BuiltServer> {
  const config = loadConfig(options.configOverrides);
  const fetchFn = options.fetchFn ?? fetch;
  const storage = new StateStorage(config.dataDir, config.appSecret);
  const pendingSetups = new Map<string, PendingSetupSession>();

  const getPlexUrl = () => storage.getActivePlexUrl(config.plexUrl);

  let plexClient: PlexClient | null = null;
  const refreshPlexClient = () => {
    const owner = storage.getOwnerAuth(config.plexUrl);
    const activeUrl = getPlexUrl();
    if (owner?.plexToken && activeUrl) {
      plexClient = new PlexClient({
        baseUrl: activeUrl,
        token: owner.plexToken,
        clientId: config.clientIdentifier,
        fetchFn
      });
    } else {
      plexClient = null;
    }
  };
  refreshPlexClient();

  const getPlexClient = () => plexClient;
  const streamManager = new StreamSessionManager(getPlexClient);
  const roomManager = new RoomManager({
    getPlexClient,
    getPlexUrl,
    clientIdentifier: config.clientIdentifier,
    streamManager,
    getWebhookConfig: () => {
      const s = storage.getSettings();
      return {
        webhookUrl: s.webhookUrl,
        webhookAutoNotify: s.webhookAutoNotify,
        publicUrl: config.publicUrl
      };
    },
    fetchFn
  });
  const pinLimiter = new PinRateLimiter();

  const ctx: AppContext = {
    config,
    storage,
    getPlexUrl,
    getPlexClient,
    refreshPlexClient,
    streamManager,
    roomManager,
    pinLimiter,
    pendingSetups,
    fetchFn
  };

  const app = Fastify({
    logger: config.nodeEnv !== 'test',
    trustProxy: true
  });

  await app.register(cookie);
  await app.register(websocket);
  await app.register(rateLimit, {
    max: config.nodeEnv === 'test' ? 1000 : 240,
    timeWindow: '1 minute'
  });

  // Security headers for web pages & API responses
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!req.url.startsWith('/api/stream/')) {
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self' https://www.gstatic.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: blob: https://plex.tv https://*.plex.tv",
          "media-src 'self' blob:",
          "connect-src 'self' ws: wss: https://www.gstatic.com",
          "frame-ancestors 'none'"
        ].join('; ')
      );
    }
  });

  app.get('/api/health', async () => {
    const plex = getPlexClient();
    const plexStatus = plex ? await plex.checkHealth() : { ok: false };
    return {
      status: 'ok',
      configured: storage.isSetupComplete(config.plexUrl),
      plexConfigured: Boolean(getPlexUrl()),
      hostAuthenticated: Boolean(plex),
      plexReachable: plexStatus.ok
    };
  });

  registerSetupRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerPlexRoutes(app, ctx);
  registerRoomRoutes(app, ctx);
  registerStreamRoutes(app, ctx);
  registerWsRoutes(app, ctx);

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultDistDir = path.resolve(currentDir, '../../web/dist');
  const webDistDir = options.webDistDir ?? defaultDistDir;
  const shouldServeStatic = options.serveStatic ?? fs.existsSync(path.join(webDistDir, 'index.html'));

  if (shouldServeStatic && fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/'
    });

    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    await streamManager.stopAll();
    await roomManager.shutdown();
  });

  return { app, ctx, config };
}
