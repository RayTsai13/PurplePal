import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../../generated/prisma';
import { DiscordClient } from '../adapters/discord/DiscordClient';
import { VerificationBot } from '../adapters/discord/VerificationBot';
import { startOutboxWorker } from '../adapters/scheduler/OutboxWorker';
import { startTimeoutWorker } from '../adapters/scheduler/TimeoutWorker';
import type { VerificationOrchestrator } from '../core/application/orchestrator/VerificationOrchestrator';
import { VerificationOrchestrator as Orchestrator } from '../core/application/orchestrator/VerificationOrchestrator';
import { logger } from './logger';
import { env } from './env';
import { PolicySchema, type PolicyConfig } from './config/policySchema';
import { HallDirectory } from './services/hallDirectory';
import { DiscordServiceImpl } from './services/DiscordService';
import { ConfigImpl } from './services/Config';
import { PrismaCaseRepository } from './services/prismaCaseService';
import { PrismaDecisionRepository } from './services/prismaDecisionService';
import { PrismaAuditRepository } from './services/prismaAuditService';
import { PrismaOutboxRepository } from './services/prismaOutboxService';

import type {
  DiscordService,
  Config,
  CaseRepository,
  DecisionRepository,
  AuditRepository,
  OutboxRepository,
} from '../core/ports';

// Container returns orchestrator plus lifecycle functions
export interface AppContainer {
  orchestrator: VerificationOrchestrator;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// Dependency injection container. Builds and wires all services together
// Creates Prisma client, Discord client, loads policy config
// Instantiates all repositories, services, orchestrator, and bot
// Returns container with orchestrator and start/stop lifecycle functions
export async function buildOrchestrator(): Promise<AppContainer> {
  const { policyConfig, configPath } = loadPolicyConfig();

  const prisma = new PrismaClient();
  const discordClient = new DiscordClient();

  const hallDirectory = new HallDirectory(policyConfig.halls);
  const services = buildServices(policyConfig, configPath, hallDirectory, prisma, discordClient);

  // Wire up HallDirectory to rebuild when config is hot-reloaded
  // ConfigImpl.onReload registers a callback that will be invoked on reload()
  (services.config as ConfigImpl).onReload((newPolicy) => {
    hallDirectory.rebuild(newPolicy.halls);
    logger.info('HallDirectory rebuilt after config reload');
  });
  const orchestrator = new Orchestrator(
    services.discord,
    services.config,
    services.cases,
    services.decisions,
    services.audit,
    services.outbox,
    logger,
  );
  const verificationBot = new VerificationBot(
    discordClient,
    orchestrator,
    services.cases,
    services.config,
    services.discord,
    env.ADMINS_IDS,
    env.GUILD_ID,
  );
  verificationBot.bind();

  // Array of worker lifecycle objects that have stop() method
  const workerHandles: Array<{ stop: () => Promise<void> }> = [];

  // Start the application: connect database, start workers, login Discord bot
  const start = async (): Promise<void> => {
    logger.info("Starting application container");
    await prisma.$connect();

    // Start background workers for message and timeout processing
    workerHandles.push(
      startOutboxWorker({
        outbox: services.outbox,
        notification: services.discord,
        policy: services.config,
      }),
    );

    workerHandles.push(
      startTimeoutWorker({
        cases: services.cases,
        policy: services.config,
        orchestrator,
        outbox: services.outbox,
      }),
    );

    await discordClient.start(env.DISCORD_TOKEN);
    logger.info({ guilds: discordClient.guildCount }, "Discord client ready");
  };

  // Shutdown the application: stop workers, disconnect Discord, close database
  const stop = async (): Promise<void> => {
    logger.info("Stopping application container");
    // Promise.all runs all in parallel, map returns array of promises, await waits for all
    await Promise.all(workerHandles.map((worker) => worker.stop()));
    discordClient.shutdown();
    await prisma.$disconnect();
  };

  return { orchestrator, start, stop };
}

// Load policy.json from config directory and validate against schema
// Returns both the config and the path for hot-reload capability
function loadPolicyConfig(): { policyConfig: PolicyConfig; configPath: string } {
  const configPath = resolveFromRoot('config/policy.json');
  const raw = readJson(configPath);
  const policyConfig = PolicySchema.parse(raw);
  return { policyConfig, configPath };
}

// Convert relative path to absolute path from project root
function resolveFromRoot(relative: string): string {
  return path.resolve(process.cwd(), relative);
}

// Read and parse JSON file. Throws if file not found or JSON invalid
function readJson(targetPath: string): Record<string, unknown> {
  try {
    const fileContents = fs.readFileSync(targetPath, 'utf-8');
    return JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Failed to read configuration file at ${targetPath}: ${(error as Error).message}`);
  }
}

// Instantiate all service implementations and wire them together
// Returns object with all port interface implementations
function buildServices(
  policy: PolicyConfig,
  configPath: string,
  hallDirectory: HallDirectory,
  prisma: PrismaClient,
  discordClient: DiscordClient,
): {
  discord: DiscordService;
  config: Config;
  cases: CaseRepository;
  decisions: DecisionRepository;
  audit: AuditRepository;
  outbox: OutboxRepository;
} {
  const discord: DiscordService = new DiscordServiceImpl(discordClient, hallDirectory, env.GUILD_ID);
  const config: Config = new ConfigImpl(policy, configPath);

  const cases: CaseRepository = new PrismaCaseRepository(prisma);
  const decisions: DecisionRepository = new PrismaDecisionRepository(prisma);
  const audit: AuditRepository = new PrismaAuditRepository(prisma);
  const outbox: OutboxRepository = new PrismaOutboxRepository(prisma);

  return { discord, config, cases, decisions, audit, outbox };
}
