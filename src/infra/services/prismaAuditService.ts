import { Prisma, PrismaClient, CaseState as PrismaCaseState } from '../../../generated/prisma';
import type { AuditRepository } from '../../core/ports';

// Prisma repository implementing AuditRepository port interface
// Records immutable audit log for all actions on cases
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Log an action to audit trail
  // All parameters get coerced to database types (undefined becomes null)
  // Prisma.JsonNull represents JSON null for payload
  async record(
    caseId: string,
    action: string,
    fromState?: string,
    toState?: string,
    actorType: 'user' | 'ra' | 'system' = 'system',
    actorId?: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void> {
    // Convert undefined payload to null, or keep as JSON-serializable value
    const payloadValue =
      payload === undefined ? undefined : ((payload ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull);

    await this.prisma.auditLog.create({
      data: {
        caseId,
        action,
        fromState: (fromState as PrismaCaseState | undefined) ?? null,
        toState: (toState as PrismaCaseState | undefined) ?? null,
        actorType,
        actorId: actorId ?? null,
        payload: payloadValue,
        idempotencyKey: idempotencyKey ?? null,
      },
    });
  }
}
