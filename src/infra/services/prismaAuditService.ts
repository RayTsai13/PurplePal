import { Prisma, PrismaClient, CaseState as PrismaCaseState } from '../../../generated/prisma';
import type { AuditRepository } from '../../core/ports';

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
