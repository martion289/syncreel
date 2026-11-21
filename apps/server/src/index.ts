import { buildApp } from './app.js';

async function main() {
  const { app, config } = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down SyncReel server');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({
    port: config.port,
    host: '0.0.0.0'
  });

  app.log.info(
    `SyncReel listening on http://0.0.0.0:${config.port} (Plex: ${config.plexUrl || 'via Setup Wizard'})`
  );
}

main().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
