// Lightweight dependency injection container for CLI
// Only loads database and config services, no Discord client or background workers
// Uses singleton pattern to reuse container across commands

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../../generated/prisma';
import { PolicySchema, type PolicyConfig } from '../infra/config/policySchema';
import { ConfigImpl } from '../infra/services/Config';
import { PrismaCaseRepository } from '../infra/services/prismaCaseService';
import { PrismaAuditRepository } from '../infra/services/prismaAuditService';
import { PrismaOutboxRepository } from '../infra/services/prismaOutboxService';
import type { Config, CaseRepository, AuditRepository, OutboxRepository } from '../core/ports';

// Container shape for CLI commands
// Includes configImpl for direct access to reload functionality
export interface CliContainer {
  config: Config;
  configImpl: ConfigImpl;
  cases: CaseRepository;
  audit: AuditRepository;
  outbox: OutboxRepository;
  prisma: PrismaClient;
  disconnect: () => Promise<void>;
}

// Cached container instance (singleton pattern)
let container: CliContainer | null = null;

// Get or create CLI container
// Returns cached instance if already created
// Initializes database connection and all repositories on first call
export async function getCliContainer(): Promise<CliContainer> {
  if (container) {
    return container;
  }

  const { policyConfig, configPath } = loadPolicyConfig();
  const prisma = new PrismaClient();

  await prisma.$connect();

  const configImpl = new ConfigImpl(policyConfig, configPath);
  const config: Config = configImpl;
  const cases: CaseRepository = new PrismaCaseRepository(prisma);
  const audit: AuditRepository = new PrismaAuditRepository(prisma);
  const outbox: OutboxRepository = new PrismaOutboxRepository(prisma);

  // disconnect function closes database and resets singleton
  const disconnect = async (): Promise<void> => {
    await prisma.$disconnect();
    container = null;
  };

  container = { config, configImpl, cases, audit, outbox, prisma, disconnect };
  return container;
}

// Load and validate policy config from JSON file
// Returns both the config and the path for hot-reload capability
// Throws if file not found or validation fails
function loadPolicyConfig(): { policyConfig: PolicyConfig; configPath: string } {
  const configPath = path.resolve(process.cwd(), 'config/policy.json');
  try {
    const fileContents = fs.readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(fileContents);
    const policyConfig = PolicySchema.parse(raw);
    return { policyConfig, configPath };
  } catch (error) {
    throw new Error(`Failed to read configuration file at ${configPath}: ${(error as Error).message}`);
  }
}
