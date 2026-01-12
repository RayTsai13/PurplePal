"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaDecisionRepository = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
// Use provided idempotency key or generate random UUID if not provided
// crypto.randomUUID() creates unique identifier
const ensureIdempotencyKey = (provided) => provided ?? node_crypto_1.default.randomUUID();
// Prisma repository implementing DecisionRepository port interface
class PrismaDecisionRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Record RA decision (approve or deny)
    // upsert: update if exists, create if doesn't (idempotency key prevents duplicates)
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
