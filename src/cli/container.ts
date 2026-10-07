// Lightweight dependency injection container for CLI
// Loads database, config, and an orchestrator without a Discord connection or background workers.
// Discord side effects (DMs, role changes) are written to the outbox and delivered by the running bot
// Uses singleton pattern to reuse container across commands

import { PrismaClient } from '../../generated/prisma';
import { ConfigImpl } from '../infra/services/Config';
import { PrismaCaseRepository } from '../infra/services/prismaCaseService';
import { PrismaAuditRepository } from '../infra/services/prismaAuditService';
import { PrismaOutboxRepository } from '../infra/services/prismaOutboxService';
import { PrismaUnitOfWork } from '../infra/services/prismaUnitOfWork';
import { VerificationOrchestrator } from '../core/application/orchestrator/VerificationOrchestrator';
import { logger } from '../infra/logger';
import type {
  Config,
  CaseRepository,
  AuditRepository,
  OutboxRepository,
  DiscordService,
} from '../core/ports';

// Container shape for CLI commands
export interface CliContainer {
  config: Config;
  cases: CaseRepository;
  audit: AuditRepository;
  outbox: OutboxRepository;
  orchestrator: VerificationOrchestrator;
  prisma: PrismaClient;
  disconnect: () => Promise<void>;
}

// The CLI has no Discord connection. Admin paths in the orchestrator (asAdmin decisions, admin
// expire/reset) never call these; reaching one is a bug, so fail loudly
const unavailable = (operation: string) => async (): Promise<never> => {
  throw new Error(`${operation} is not available from the CLI`);
};

const offlineDiscord: DiscordService = {
  normalizeRoom: unavailable('normalizeRoom'),
  sendDM: unavailable('sendDM'),
  sendToQueue: unavailable('sendToQueue'),
  assignRoles: unavailable('assignRoles'),
  removeRoles: unavailable('removeRoles'),
  isRaForHall: unavailable('isRaForHall'),
};

// Cached container instance (singleton pattern)
let container: CliContainer | null = null;

// Get or create CLI container
// Returns cached instance if already created
// Initializes database connection and all repositories on first call
export async function getCliContainer(): Promise<CliContainer> {
  if (container) {
    return container;
  }

  const config = ConfigImpl.fromFile();
  const prisma = new PrismaClient();

  await prisma.$connect();

  const cases = new PrismaCaseRepository(prisma);
  const orchestrator = new VerificationOrchestrator({
    discord: offlineDiscord,
    config,
    cases,
    uow: new PrismaUnitOfWork(prisma),
    logger,
  });

  // disconnect function closes database and resets singleton
  const disconnect = async (): Promise<void> => {
    await prisma.$disconnect();
    container = null;
  };

  container = {
    config,
    cases,
    audit: new PrismaAuditRepository(prisma),
    outbox: new PrismaOutboxRepository(prisma),
    orchestrator,
    prisma,
    disconnect,
  };
  return container;
}
