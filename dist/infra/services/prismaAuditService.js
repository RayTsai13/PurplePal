"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaAuditRepository = void 0;
const prisma_1 = require("../../../generated/prisma");
// Prisma repository implementing AuditRepository port interface
// Records immutable audit log for all actions on cases
class PrismaAuditRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Log an action to audit trail
    // All parameters get coerced to database types (undefined becomes null)
    // Prisma.JsonNull represents JSON null for payload
    async record(caseId, action, fromState, toState, actorType = 'system', actorId, payload, idempotencyKey) {
        // Convert undefined payload to null, or keep as JSON-serializable value
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
