import type { AppContainer } from './infra/container';
import { buildOrchestrator } from './infra/container';
import { logger } from './infra/logger';

let app: AppContainer | null = null;

async function main() {
  logger.info('Starting bot...');

  app = await buildOrchestrator();
  await app.start();
  logger.info('Application container started');

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down...');
    try {
      await app?.stop();
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start bot');
  if (app) {
    app
      .stop()
      .catch((stopErr) => logger.error({ err: stopErr }, 'Failed to stop app container after crash'))
      .finally(() => process.exit(1));
    return;
  }
  process.exit(1);
});
