import crypto from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma';
import type { DecisionService } from '../../core/application/ports';

const ensureIdempotencyKey = (provided?: string): string => provided ?? crypto.randomUUID();

export class PrismaDecisionService implements DecisionService {
  constructor(private readonly prisma: PrismaClient) {}

  async authorize(raUserId: string, kase: { hall?: string; userId: string }): Promise<boolean> {
    if (!kase.hall) {
      return false;
    }

    if (raUserId === kase.userId) {
      return false;
    }

    // TODO: integrate Discord role checks once guild context is available.
    return true;
  }

  async recordDecision(
    caseId: string,
    raUserId: string,
    decision: 'approve' | 'deny',
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    const key = ensureIdempotencyKey(idempotencyKey);

    await this.prisma.decision.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        caseId,
        raUserId,
        decision,
        reason: reason ?? null,
        idempotencyKey: key,
      },
    });
  }
}
