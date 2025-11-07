/**
 * DI Container (wiring point) — Responsibilities:
 * 1) Load config/env (tokens, guild IDs, DB URL, policy paths).
 * 2) Construct infrastructure: logger, Prisma client, Discord client, schedulers.
 * 3) Instantiate adapters/implementations for ports:
 *    - HallService, RoomService, CaseService, DecisionService,
 *      NotificationService, RoleService, AuditService, PolicyService.
 * 4) Wire the VerificationOrchestrator with those services.
 * 5) Expose start/stop hooks for workers (OutboxWorker, TimeoutWorker).
 * 6) Provide a single factory (buildOrchestrator) used by src/index.ts.
 */

import type { VerificationOrchestrator } from "../core/application/orchestrator/VerificationOrchestrator";
import type {
  HallService, RoomService, CaseService, DecisionService,
  NotificationService, RoleService, AuditService, PolicyService
} from "../core/application/ports";

// Placeholders for future concrete implementations (adapters)
type NotWired = never;

export interface AppContainer {
  orchestrator: VerificationOrchestrator; // will be a real instance later
  // lifecycle hooks to be implemented later:
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Factory that will:
 * - Construct services/adapters
 * - Inject them into VerificationOrchestrator
 * - Return orchestrator + lifecycle hooks
 *
 * For now, it intentionally throws to prevent accidental runtime usage.
 */
export async function buildOrchestrator(): Promise<AppContainer> {
  throw new Error("DI container not wired yet (Phase 3). Add implementations, then inject here.");
}
