import { Prisma, Outbox as PrismaOutbox } from '../../../generated/prisma';
import type {
  EnqueueOptions,
  OutboxFollowUpDM,
  OutboxJob,
  OutboxKind,
  OutboxRepository,
} from '../../core/ports';

// How long a claimed job stays invisible to other takeDue calls before it can be retried
const CLAIM_LEASE_MS = 60 * 1000;

// Shape of payload stored in database
type OutboxPayload = {
  targetId: string;
  data?: Record<string, unknown>;
  followUp?: OutboxFollowUpDM;
};

// Transform Prisma Outbox row to port OutboxJob
const toJob = (row: PrismaOutbox): OutboxJob => {
  const payloadRaw = row.payload as {
    targetId: string;
    data?: Record<string, unknown> | null;
    followUp?: OutboxFollowUpDM | null;
  } | null;
  const payload = payloadRaw
    ? {
        targetId: payloadRaw.targetId,
        data: payloadRaw.data ?? undefined,
        followUp: payloadRaw.followUp ?? undefined,
      }
    : undefined;

  return {
    id: row.id,
    caseId: row.caseId ?? undefined,
    kind: row.kind as OutboxKind,
    template: row.template,
    payload,
    attempts: row.attempts,
  };
};

// Prisma repository implementing OutboxRepository port interface
// Accepts either the root client or a transaction client (see PrismaUnitOfWork)
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  // Queue a direct message to user
  async enqueueDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: EnqueueOptions,
  ): Promise<void> {
    await this.enqueue('dm', template, { targetId: userId, data }, options);
  }

  // Queue a message to a channel
  async enqueueChannel(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: EnqueueOptions,
  ): Promise<void> {
    await this.enqueue('channel', template, { targetId: channelId, data }, options);
  }

  // Queue a role change for a guild member
  async enqueueRoleChange(
    userId: string,
    change: 'add' | 'remove',
    roleIds: string[],
    options?: EnqueueOptions & { followUp?: OutboxFollowUpDM },
  ): Promise<void> {
    await this.enqueue(
      change === 'add' ? 'role_add' : 'role_remove',
      '',
      { targetId: userId, data: { roleIds }, followUp: options?.followUp },
      options,
    );
  }

  // Internal method to queue a job
  // skipDuplicates turns a repeated idempotency key into a no-op (INSERT ... ON CONFLICT DO NOTHING)
  // rather than a unique violation, which would abort an enclosing transaction
  private async enqueue(
    kind: OutboxKind,
    template: string,
    payload: OutboxPayload,
    options?: EnqueueOptions,
  ): Promise<void> {
    const storedPayload = {
      targetId: payload.targetId,
      data: payload.data ?? null,
      ...(payload.followUp ? { followUp: payload.followUp } : {}),
    } as unknown as Prisma.InputJsonValue;

    await this.prisma.outbox.createMany({
      data: [
        {
          caseId: options?.caseId ?? null,
          kind,
          template,
          payload: storedPayload,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          idempotencyKey: options?.idempotencyKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }

  // Claim up to batchSize pending jobs that are due, pushing their nextAttemptAt forward by a lease
  // so they aren't picked up again while being processed. FOR UPDATE SKIP LOCKED makes this safe
  // if more than one worker ever polls the same table.
  // Prisma stores DateTime as UTC in "timestamp without time zone" columns, so raw Date parameters
  // (sent as timestamptz) are converted with AT TIME ZONE 'UTC'; otherwise the comparison would
  // depend on the database session's timezone
  async takeDue(batchSize: number): Promise<OutboxJob[]> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);

    const rows = await this.prisma.$queryRaw<PrismaOutbox[]>`
      UPDATE "outbox" SET "nextAttemptAt" = (${leaseUntil}::timestamptz AT TIME ZONE 'UTC')
      WHERE "id" IN (
        SELECT "id" FROM "outbox"
        WHERE "status" = 'pending'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC'))
        ORDER BY "nextAttemptAt" ASC NULLS FIRST
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    return rows.map(toJob);
  }

  // Mark message as successfully sent
  async markSent(jobId: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: jobId },
      data: {
        status: 'sent',
        attempts: { increment: 1 },
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
