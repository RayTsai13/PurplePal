import { Prisma, PrismaClient, Outbox as PrismaOutbox } from '../../../generated/prisma';
import type { OutboxJob, OutboxRepository } from '../../core/ports';

// Shape of payload stored in database
type OutboxPayload = {
  targetId: string;
  data?: Record<string, unknown>;
};

// Transform Prisma Outbox row to port OutboxJob
const toJob = (row: PrismaOutbox): OutboxJob => {
  const payloadRaw = row.payload as { targetId: string; data?: Record<string, unknown> | null } | null;
  const payload = payloadRaw
    ? {
        targetId: payloadRaw.targetId,
        data: payloadRaw.data ?? undefined,
      }
    : undefined;

  return {
    id: row.id,
    caseId: row.caseId ?? undefined,
    kind: row.kind as OutboxJob['kind'],
    template: row.template,
    payload,
    attempts: row.attempts,
  };
};

// Prisma repository implementing OutboxRepository port interface
// Implements reliable message delivery with exponential backoff retries
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Queue a direct message to user
  async enqueueDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: { caseId?: string; idempotencyKey?: string },
  ): Promise<void> {
    await this.enqueue('dm', template, { targetId: userId, data }, options);
  }

  // Queue a message to a channel
  async enqueueChannel(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: { caseId?: string; idempotencyKey?: string },
  ): Promise<void> {
    await this.enqueue('channel', template, { targetId: channelId, data }, options);
  }

  // Internal method to queue a message
  // Idempotency key prevents duplicate enqueuing
  // Catches unique constraint violation (P2002) if message already queued
  private async enqueue(
    kind: 'dm' | 'channel',
    template: string,
    payload: OutboxPayload,
    options?: { caseId?: string; idempotencyKey?: string },
  ): Promise<void> {
    const storedPayload = {
      targetId: payload.targetId,
      data: payload.data ?? null,
    } as unknown as Prisma.InputJsonValue;

    try {
      await this.prisma.outbox.create({
        data: {
          caseId: options?.caseId ?? null,
          kind,
          template,
          payload: storedPayload,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          idempotencyKey: options?.idempotencyKey ?? null,
        },
      });
    } catch (error) {
      // P2002 is unique constraint violation (duplicate idempotency key)
      if (
        options?.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  // Get pending messages ready to send
  // OR: [nextAttemptAt: null] (first attempt) OR nextAttemptAt <= now (retry time reached)
  // Updates nextAttemptAt to delay future attempts (prevents hammering)
  // Transaction ensures atomicity: fetch and update in one operation
  async takeDue(batchSize: number): Promise<OutboxJob[]> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.outbox.findMany({
        where: {
          status: 'pending',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: batchSize,
      });

      if (rows.length === 0) {
        return [];
      }

      // Lock these messages for 60 seconds by setting nextAttemptAt to future time
      await tx.outbox.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { nextAttemptAt: new Date(Date.now() + 60 * 1000) },
      });

      return rows.map(toJob);
    });
  }

  // Mark message as successfully sent
  async markSent(jobId: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: jobId },
      data: {
        status: 'sent',
        lastError: null,
        nextAttemptAt: null,
      },
    });
  }

  // Mark message as failed but will retry
  // Increments attempt counter and schedules next retry
  async markFailed(jobId: string, error: string, retryAt: Date): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: jobId },
      data: {
        status: 'pending',
        attempts: { increment: 1 },
        lastError: error,
        nextAttemptAt: retryAt,
      },
    });
  }

  // Give up on message permanently (exceeded max retries)
  async markPermanentlyFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
        lastError: error,
        nextAttemptAt: null,
      },
    });
  }
}
