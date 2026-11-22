import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SoloDeckCategorySchema } from '@syncreel/shared';
import { getGuestSession, getHostAuthSession, type AppContext } from '../context.js';
import { PlexClient } from '../plex/client.js';

export function registerPlexRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireHostPlex = async (
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<PlexClient | undefined> => {
    const host = getHostAuthSession(req, ctx);
    if (!host) {
      const guest = getGuestSession(req, ctx);
      if (guest || req.headers['x-syncreel-role'] === 'guest') {
        reply.status(403).send({ error: 'Guests cannot browse media libraries' });
        return undefined;
      }
      reply.status(401).send({ error: 'Host sign-in required' });
      return undefined;
    }

    const baseUrl = ctx.getPlexUrl();
    if (!baseUrl) {
      reply.status(503).send({ error: 'Media server URL not configured' });
      return undefined;
    }

    return new PlexClient({
      baseUrl,
      token: host.plexToken,
      clientId: ctx.config.clientIdentifier,
      fetchFn: ctx.fetchFn
    });
  };

  app.get('/api/plex/libraries', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    return { sections: await plex.getLibraries() };
  });

  app.get<{ Querystring: { filter?: string } }>('/api/plex/genres', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    return { genres: await plex.getGenres(req.query.filter || 'all') };
  });

  app.get<{ Querystring: { filter?: string; genre?: string; count?: string } }>(
    '/api/plex/random',
    async (req, reply) => {
      const plex = await requireHostPlex(req, reply);
      if (!plex) return;
      const count = Math.min(12, Math.max(2, Number(req.query.count ?? 4) || 4));
      const items = await plex.getRandomDeckCandidates({
        libraryFilter: req.query.filter || 'all',
        genre: req.query.genre || null,
        unwatchedOnly: false,
        deckSize: count
      });
      return { items };
    }
  );

  app.get<{
    Querystring: {
      category?: string;
      filter?: string;
      genre?: string;
      unwatchedOnly?: string;
      count?: string;
    };
  }>('/api/plex/discover', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;

    const rawCategory = req.query.category || 'unwatched';
    const parsedCategory = SoloDeckCategorySchema.safeParse(rawCategory);
    if (!parsedCategory.success) {
      return reply.status(400).send({ error: 'Invalid discovery category' });
    }

    const deckSize = Math.min(50, Math.max(4, Number(req.query.count ?? 20) || 20));
    const unwatchedOnly =
      req.query.unwatchedOnly === '1' || req.query.unwatchedOnly === 'true';

    const items = await plex.getCuratedDeckCandidates({
      category: parsedCategory.data,
      libraryFilter: req.query.filter || 'all',
      genre: req.query.genre || null,
      unwatchedOnly,
      deckSize
    });

    const owner = ctx.storage.getOwnerAuth(ctx.config.plexUrl);
    return {
      items,
      serverMachineId: owner?.serverMachineId,
      serverName: owner?.serverName
    };
  });

  app.get('/api/plex/continue-watching', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    return { items: await plex.getContinueWatching() };
  });

  app.get('/api/plex/recently-added', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    return { items: await plex.getRecentlyAdded(24) };
  });

  app.get<{
    Params: { id: string };
    Querystring: { start?: string; size?: string; sort?: string };
  }>('/api/plex/sections/:id', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    const start = Math.max(0, Number(req.query.start ?? 0) || 0);
    const size = Math.min(100, Math.max(1, Number(req.query.size ?? 48) || 48));
    return plex.getSectionItems(req.params.id, {
      start,
      size,
      sort: req.query.sort
    });
  });

  app.get<{ Params: { key: string } }>('/api/plex/metadata/:key', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    return { item: await plex.getMediaDetails(req.params.key) };
  });

  app.get<{ Params: { key: string } }>('/api/plex/children/:key', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    return { items: await plex.getChildren(req.params.key) };
  });

  app.get<{ Querystring: { q?: string } }>('/api/plex/search', async (req, reply) => {
    const plex = await requireHostPlex(req, reply);
    if (!plex) return;
    const query = (req.query.q ?? '').trim();
    if (!query) return { items: [] };
    return { items: await plex.search(query) };
  });

  app.get<{ Querystring: { path?: string; w?: string; h?: string } }>(
    '/api/plex/artwork',
    async (req, reply) => {
      const plex = await requireHostPlex(req, reply);
      if (!plex) return;
      const artPath = req.query.path;
      if (!artPath || !artPath.startsWith('/')) {
        return reply.status(400).send({ error: 'Invalid artwork path' });
      }
      const w = Math.min(1920, Math.max(80, Number(req.query.w ?? 500) || 500));
      const h = Math.min(1080, Math.max(80, Number(req.query.h ?? 750) || 750));

      const img = await plex.fetchArtwork(artPath, w, h);
      if (!img) return reply.status(404).send({ error: 'Artwork not found' });

      reply.header('Content-Type', img.contentType);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(img.buffer);
    }
  );
}
