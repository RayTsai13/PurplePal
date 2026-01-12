import crypto from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma';
import type { DecisionRepository } from '../../core/ports';

// Use provided idempotency key or generate random UUID if not provided
// crypto.randomUUID() creates unique identifier
const ensureIdempotencyKey = (provided?: string): string => provided ?? crypto.randomUUID();

// Prisma repository implementing DecisionRepository port interface
export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
