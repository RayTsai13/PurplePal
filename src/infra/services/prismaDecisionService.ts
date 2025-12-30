import crypto from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma';
import type { DecisionRepository } from '../../core/ports';

// Use provided idempotency key or generate random UUID if not provided
// crypto.randomUUID() creates unique identifier
const ensureIdempotencyKey = (provided?: string): string => provided ?? crypto.randomUUID();

// Prisma repository implementing DecisionRepository port interface
export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Check if RA is authorized to decide on this case
  // Currently checks: hall exists and RA is not the user applying
  // TODO: integrate Discord role checks once guild context is available
  async authorize(raUserId: string, kase: { hall?: string; userId: string }): Promise<boolean> {
    if (!kase.hall) {
      return false;
    }

    if (raUserId === kase.userId) {
      return false;
    }

    return true;
  }

  // Record RA decision (approve or deny)
  // upsert: update if exists, create if doesn't (idempotency key prevents duplicates)
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
