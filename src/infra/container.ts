import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../../generated/prisma';
import { DiscordClient } from '../adapters/discord/DiscordClient';
import { startOutboxWorker } from '../adapters/scheduler/OutboxWorker';
import { startTimeoutWorker } from '../adapters/scheduler/TimeoutWorker';
import type { VerificationOrchestrator } from '../core/application/orchestrator/VerificationOrchestrator';
import { VerificationOrchestrator as Orchestrator } from '../core/application/orchestrator/VerificationOrchestrator';
import type {
  HallService,
  RoomService,
  CaseService,
  DecisionService,
  NotificationService,
  RoleService,
  AuditService,
  PolicyService,
} from '../core/application/ports';
import { logger } from './logger';
import { env } from './env';
import { PolicySchema, type PolicyConfig } from './config/policySchema';
import { HallDirectory } from './services/hallDirectory';
import { RoomServiceImpl } from './services/roomService';
import { PolicyServiceImpl } from './services/policyService';
import { HallServiceImpl } from './services/hallService';
import { PrismaCaseService } from './services/prismaCaseService';
import { PrismaDecisionService } from './services/prismaDecisionService';
import { PrismaAuditService } from './services/prismaAuditService';

export interface AppContainer {
  orchestrator: VerificationOrchestrator;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function buildOrchestrator(): Promise<AppContainer> {
  const policyConfig = loadPolicyConfig();
  ensureLegacyHallsConfig();

  const prisma = new PrismaClient();
  const discordClient = new DiscordClient();

  const hallDirectory = new HallDirectory(policyConfig.halls);
  const services = buildServices(policyConfig, hallDirectory, prisma);
  const orchestrator = new Orchestrator(
    services.hall,
    services.room,
    services.cases,
    services.decision,
    services.notification,
    services.roles,
    services.audit,
    services.policy,
  );

  const start = async (): Promise<void> => {
    logger.info("Starting application container");
    await prisma.$connect();
    startOutboxWorker();
    startTimeoutWorker();
    await discordClient.start(env.DISCORD_TOKEN);
    logger.info({ guilds: discordClient.guildCount }, "Discord client ready");
  };

  const stop = async (): Promise<void> => {
    logger.info("Stopping application container");
    discordClient.shutdown();
    await prisma.$disconnect();
  };

  return { orchestrator, start, stop };
}

function loadPolicyConfig(): PolicyConfig {
  const policyPath = resolveFromRoot('config/policy.json');
  const raw = readJson(policyPath);
  return PolicySchema.parse(raw);
}

function ensureLegacyHallsConfig(): void {
  const hallsPath = resolveFromRoot('config/halls.json');
  const halls = readJson(hallsPath);
  if (!Object.keys(halls).length) {
    throw new Error('Configuration error: halls.json contains no halls');
  }
}

function resolveFromRoot(relative: string): string {
  return path.resolve(process.cwd(), relative);
}

function readJson(targetPath: string): Record<string, unknown> {
  try {
    const fileContents = fs.readFileSync(targetPath, 'utf-8');
    return JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Failed to read configuration file at ${targetPath}: ${(error as Error).message}`);
  }
}

function buildServices(policy: PolicyConfig, hallDirectory: HallDirectory, prisma: PrismaClient): {
  hall: HallService;
  room: RoomService;
  cases: CaseService;
  decision: DecisionService;
  notification: NotificationService;
  roles: RoleService;
  audit: AuditService;
  policy: PolicyService;
} {
  const hall = new HallServiceImpl(hallDirectory);
  const room = new RoomServiceImpl(hallDirectory);

  const cases: CaseService = new PrismaCaseService(prisma);
  const decision: DecisionService = new PrismaDecisionService(prisma);

  const notification: NotificationService = {
    async sendDM() {
      throw notImplemented("NotificationService.sendDM");
    },
    async sendToQueue() {
      throw notImplemented("NotificationService.sendToQueue");
    },
  };

  const roles: RoleService = {
    async assign() {
      throw notImplemented("RoleService.assign");
    },
    async remove() {
      throw notImplemented("RoleService.remove");
    },
  };

  const audit: AuditService = new PrismaAuditService(prisma);

  const policyService = new PolicyServiceImpl(policy);

  return { hall, room, cases, decision, notification, roles, audit, policy: policyService };
}

function notImplemented(method: string): Error {
  return new Error(`${method} not implemented yet`);
}
