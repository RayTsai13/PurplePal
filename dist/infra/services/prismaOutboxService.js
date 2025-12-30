"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaOutboxRepository = void 0;
const prisma_1 = require("../../../generated/prisma");
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
class PrismaOutboxRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async enqueueDM(userId, template, data, options) {
        await this.enqueue('dm', template, { targetId: userId, data }, options);
    }
    async enqueueChannel(channelId, template, data, options) {
        await this.enqueue('channel', template, { targetId: channelId, data }, options);
    }
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
            if (options?.idempotencyKey &&
                error instanceof prisma_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                return;
            }
            throw error;
        }
    }
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
            await tx.outbox.updateMany({
                where: { id: { in: rows.map((row) => row.id) } },
                data: { nextAttemptAt: new Date(Date.now() + 60 * 1000) },
            });
            return rows.map(toJob);
        });
    }
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
