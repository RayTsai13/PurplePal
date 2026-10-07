import { PrismaClient } from '../../generated/prisma';
import { DiscordClient } from '../adapters/discord/DiscordClient';
import { VerificationBot } from '../adapters/discord/VerificationBot';
import { startOutboxWorker } from '../adapters/scheduler/OutboxWorker';
import { startTimeoutWorker } from '../adapters/scheduler/TimeoutWorker';
import { VerificationOrchestrator } from '../core/application/orchestrator/VerificationOrchestrator';
import { logger } from './logger';
import { env } from './env';
import { DiscordServiceImpl } from './services/DiscordService';
import { ConfigImpl } from './services/Config';
import { PrismaCaseRepository } from './services/prismaCaseService';
import { PrismaOutboxRepository } from './services/prismaOutboxService';
import { PrismaUnitOfWork } from './services/prismaUnitOfWork';

// Container returns orchestrator plus lifecycle functions
export interface AppContainer {
  orchestrator: VerificationOrchestrator;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// Dependency injection container. Builds and wires all services together
// Creates Prisma client, Discord client, loads policy config
// Returns container with orchestrator and start/stop lifecycle functions
export async function buildOrchestrator(): Promise<AppContainer> {
  const config = ConfigImpl.fromFile();

  const prisma = new PrismaClient();
  const discordClient = new DiscordClient();

  const discord = new DiscordServiceImpl(discordClient, config.hallDirectory, env.GUILD_ID);
  const cases = new PrismaCaseRepository(prisma);
  const outbox = new PrismaOutboxRepository(prisma);

  const orchestrator = new VerificationOrchestrator({
    discord,
    config,
    cases,
    uow: new PrismaUnitOfWork(prisma),
    logger,
    moderatorIds: env.ADMINS_IDS,
  });
  new VerificationBot(discordClient, orchestrator).bind();

  // Array of worker lifecycle objects that have stop() method
  const workerHandles: Array<{ stop: () => Promise<void> }> = [];
  let stopWatchingConfig: (() => void) | null = null;

  // Reload policy.json; on failure keep the current config and log why
  const reloadConfig = (trigger: string) => {
    config.reload().then(
      () => logger.info({ trigger }, 'Configuration reloaded'),
      (err) => logger.error({ err, trigger }, 'Configuration reload failed; keeping previous configuration'),
    );
  };
  const onSighup = () => reloadConfig('SIGHUP');

  // Start the application: connect database, login Discord bot, then start workers
  const start = async (): Promise<void> => {
    logger.info('Starting application container');
    await prisma.$connect();

    // Workers send through Discord, so wait for the client to be ready before draining the outbox
    await discordClient.start(env.DISCORD_TOKEN);
    logger.info({ guilds: discordClient.guildCount }, 'Discord client ready');

    workerHandles.push(startOutboxWorker({ outbox, notification: discord, policy: config }));
    workerHandles.push(startTimeoutWorker({ cases, policy: config, orchestrator }));

    // Hot reload: on policy.json change, or `kill -HUP <pid>` / `docker compose kill -s HUP bot`
    stopWatchingConfig = config.watch({
      onReloaded: () => logger.info({ trigger: 'file change' }, 'Configuration reloaded'),
      onError: (err) => logger.error({ err, trigger: 'file change' }, 'Configuration reload failed; keeping previous configuration'),
    });
    process.on('SIGHUP', onSighup);
  };

  // Shutdown the application: stop workers, disconnect Discord, close database
  const stop = async (): Promise<void> => {
    logger.info('Stopping application container');
    process.off('SIGHUP', onSighup);
    stopWatchingConfig?.();
    await Promise.all(workerHandles.map((worker) => worker.stop()));
    discordClient.shutdown();
    await prisma.$disconnect();
  };

  return { orchestrator, start, stop };
}
