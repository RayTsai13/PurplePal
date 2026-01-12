"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaOutboxRepository = void 0;
const prisma_1 = require("../../../generated/prisma");
// Transform Prisma Outbox row to port OutboxJob
const toJob = (row) => {
    const payloadRaw = row.payload;
    const payload = payloadRaw
        ? {
            targetId: payloadRaw.targetId,
            data: payloadRaw.data ?? undefined,
        }
        : undefined;
    return {
        id: row.id,
        caseId: row.caseId ?? undefined,
        kind: row.kind,
        template: row.template,
        payload,
        attempts: row.attempts,
    };
};
// Prisma repository implementing OutboxRepository port interface
// Implements reliable message delivery with exponential backoff retries
class PrismaOutboxRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Queue a direct message to user
    async enqueueDM(userId, template, data, options) {
        await this.enqueue('dm', template, { targetId: userId, data }, options);
    }
    // Queue a message to a channel
    async enqueueChannel(channelId, template, data, options) {
        await this.enqueue('channel', template, { targetId: channelId, data }, options);
    }
    // Internal method to queue a message
    // Idempotency key prevents duplicate enqueuing
    // Catches unique constraint violation (P2002) if message already queued
    async enqueue(kind, template, payload, options) {
        const storedPayload = {
            targetId: payload.targetId,
            data: payload.data ?? null,
        };
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
        }
        catch (error) {
            // P2002 is unique constraint violation (duplicate idempotency key)
            if (options?.idempotencyKey &&
                error instanceof prisma_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                return;
            }
            throw error;
        }
    }
    // Get pending messages ready to send
    // OR: [nextAttemptAt: null] (first attempt) OR nextAttemptAt <= now (retry time reached)
    // Updates nextAttemptAt to delay future attempts (prevents hammering)
    // Transaction ensures atomicity: fetch and update in one operation
    async takeDue(batchSize) {
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
    async markSent(jobId) {
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
    async markFailed(jobId, error, retryAt) {
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
    async markPermanentlyFailed(jobId, error) {
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
exports.PrismaOutboxRepository = PrismaOutboxRepository;
