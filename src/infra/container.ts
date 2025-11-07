import fs from "fs";
import path from "path";
import { PrismaClient } from "../../generated/prisma";
import { DiscordClient } from "../adapters/discord/DiscordClient";
import { startOutboxWorker } from "../adapters/scheduler/OutboxWorker";
import { startTimeoutWorker } from "../adapters/scheduler/TimeoutWorker";
import type { VerificationOrchestrator } from "../core/application/orchestrator/VerificationOrchestrator";
import { VerificationOrchestrator as Orchestrator } from "../core/application/orchestrator/VerificationOrchestrator";
import type {
  HallService,
  RoomService,
  CaseService,
  DecisionService,
  NotificationService,
  RoleService,
  AuditService,
  PolicyService,
} from "../core/application/ports";
import { logger } from "./logger";
import { env } from "./env";

type JsonValue = Record<string, unknown>;

export interface AppContainer {
  orchestrator: VerificationOrchestrator;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function buildOrchestrator(): Promise<AppContainer> {
  const config = loadConfiguration();
  const prisma = new PrismaClient();
  const discordClient = new DiscordClient();

  const services = buildServices(config);
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

function loadConfiguration(): { halls: JsonValue; policy: JsonValue } {
  const hallsPath = resolveFromRoot("config/halls.json");
  const policyPath = resolveFromRoot("config/policy.json");

  const halls = readJson(hallsPath);
  const policy = readJson(policyPath);

  if (!Object.keys(halls).length) {
    throw new Error("Configuration error: halls.json contains no halls");
  }

  return { halls, policy };
}

function resolveFromRoot(relative: string): string {
  return path.resolve(process.cwd(), relative);
}

function readJson(targetPath: string): JsonValue {
  try {
    const fileContents = fs.readFileSync(targetPath, "utf-8");
    return JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Failed to read configuration file at ${targetPath}: ${(error as Error).message}`);
  }
}

function buildServices(config: { halls: JsonValue; policy: JsonValue }): {
  hall: HallService;
  room: RoomService;
  cases: CaseService;
  decision: DecisionService;
  notification: NotificationService;
  roles: RoleService;
  audit: AuditService;
  policy: PolicyService;
} {
  const hall: HallService = {
    async validate() {
      throw notImplemented("HallService.validate");
    },
  };

  const room: RoomService = {
    async normalize() {
      throw notImplemented("RoomService.normalize");
    },
  };

  const cases: CaseService = {
    async getActiveCase() {
      throw notImplemented("CaseService.getActiveCase");
    },
    async createIfNone() {
      throw notImplemented("CaseService.createIfNone");
    },
    async updateState() {
      throw notImplemented("CaseService.updateState");
    },
    async markExpired() {
      throw notImplemented("CaseService.markExpired");
    },
    async findById() {
      throw notImplemented("CaseService.findById");
    },
  };

  const decision: DecisionService = {
    async authorize() {
      throw notImplemented("DecisionService.authorize");
    },
    async recordDecision() {
      throw notImplemented("DecisionService.recordDecision");
    },
  };

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

  const audit: AuditService = {
    async record() {
      throw notImplemented("AuditService.record");
    },
  };

  const policy: PolicyService = {
    async currentTerm() {
      const term = config.policy.term;
      if (typeof term !== "string") {
        throw new Error("Policy configuration missing 'term'");
      }
      return term;
    },
    async timeouts() {
      const timeouts = config.policy.timeouts as JsonValue;
      if (!timeouts) {
        throw new Error("Policy configuration missing 'timeouts'");
      }
      return {
        awaitingRA_ttl_hours: Number(timeouts.awaitingRA_ttl_hours ?? 0),
        reminder_hours: Array.isArray(timeouts.reminder_hours) ? (timeouts.reminder_hours as number[]) : [],
      };
    },
    async limits() {
      throw notImplemented("PolicyService.limits");
    },
    async messaging() {
      throw notImplemented("PolicyService.messaging");
    },
  };

  return { hall, room, cases, decision, notification, roles, audit, policy };
}

function notImplemented(method: string): Error {
  return new Error(`${method} not implemented yet`);
}
