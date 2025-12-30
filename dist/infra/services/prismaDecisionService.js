"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaDecisionRepository = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ensureIdempotencyKey = (provided) => provided ?? node_crypto_1.default.randomUUID();
class PrismaDecisionRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async authorize(raUserId, kase) {
        if (!kase.hall) {
            return false;
        }
        if (raUserId === kase.userId) {
            return false;
        }
        // TODO: integrate Discord role checks once guild context is available.
        return true;
    }
    async recordDecision(caseId, raUserId, decision, reason, idempotencyKey) {
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
exports.PrismaDecisionRepository = PrismaDecisionRepository;
