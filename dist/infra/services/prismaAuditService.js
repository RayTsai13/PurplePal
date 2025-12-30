"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaAuditRepository = void 0;
const prisma_1 = require("../../../generated/prisma");
class PrismaAuditRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async record(caseId, action, fromState, toState, actorType = 'system', actorId, payload, idempotencyKey) {
        const payloadValue = payload === undefined ? undefined : (payload ?? prisma_1.Prisma.JsonNull);
        await this.prisma.auditLog.create({
            data: {
                caseId,
                action,
                fromState: fromState ?? null,
                toState: toState ?? null,
                actorType,
                actorId: actorId ?? null,
                payload: payloadValue,
                idempotencyKey: idempotencyKey ?? null,
            },
        });
    }
}
exports.PrismaAuditRepository = PrismaAuditRepository;
