import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function registerStreamRoutes(app: FastifyInstance, ctx: AppContext): void {
  // CORS preflight / headers required for <track crossorigin> and Google Cast receiver
  const setStreamCors = (reply: { header: (k: string, v: string) => unknown }) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Range, Content-Type');
    reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  };

  app.options('/api/stream/:streamToken/*', async (_req, reply) => {
    setStreamCors(reply);
    return reply.status(204).send();
  });

  app.get<{ Params: { streamToken: string; file: string } }>(
    '/api/stream/:streamToken/subtitles/:file',
    async (req, reply) => {
      setStreamCors(reply);
      const match = req.params.file.match(/^(\d+)\.vtt$/);
      if (!match) {
        return reply.status(400).send({ error: 'Invalid subtitle track path' });
      }
      const streamId = Number(match[1]);
      const vtt = await ctx.streamManager.fetchWebVttSubtitle(req.params.streamToken, streamId);
      if (!vtt) {
        return reply.status(404).send({ error: 'Subtitle track not found' });
      }
      reply.header('Content-Type', 'text/vtt; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      return reply.send(vtt);
    }
  );

  app.get<{ Params: { streamToken: string; '*': string } }>(
    '/api/stream/:streamToken/*',
    async (req, reply) => {
      setStreamCors(reply);
      const subPath = req.params['*'];
      const qIdx = req.raw.url?.indexOf('?') ?? -1;
      const queryString = qIdx >= 0 && req.raw.url ? req.raw.url.slice(qIdx + 1) : '';
      const rangeHeader = req.headers.range;

      const result = await ctx.streamManager.fetchUpstreamStream(
        req.params.streamToken,
        subPath,
        queryString,
        rangeHeader
      );

      reply.status(result.status);
      reply.header('Content-Type', result.contentType);
      reply.header('Cache-Control', 'no-store');
      for (const [k, v] of Object.entries(result.headers)) {
        reply.header(k, v);
      }
      return reply.send(result.body);
    }
  );
}
