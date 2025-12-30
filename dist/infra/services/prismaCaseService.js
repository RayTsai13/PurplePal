"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaCaseRepository = void 0;
const ACTIVE_STATES = ['joined', 'hall_chosen', 'awaiting_ra'];
const toCaseRecord = (kase) => ({
    id: kase.id,
    userId: kase.userId,
    term: kase.term,
    state: kase.state,
    hall: kase.hall ?? undefined,
    room: kase.room ?? undefined,
    raUserId: kase.raUserId ?? undefined,
    version: kase.version,
    expiresAt: kase.expiresAt ?? undefined,
    reminderSentAt: kase.reminderSentAt ?? undefined,
    updatedAt: kase.updatedAt,
});
const isMarkExpiredFilters = (filters) => typeof filters === 'object' && filters !== null && 'before' in filters;
class PrismaCaseRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getActiveCase(userId, term) {
        const kase = await this.prisma.verificationCase.findFirst({
            where: { userId, term, state: { in: ACTIVE_STATES } },
            orderBy: { createdAt: 'desc' },
        });
        return kase ? toCaseRecord(kase) : null;
    }
    async createIfNone(userId, term, initialState) {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.verificationCase.findFirst({
                where: { userId, term, state: { in: ACTIVE_STATES } },
                orderBy: { createdAt: 'desc' },
            });
            if (existing) {
                return toCaseRecord(existing);
            }
            const created = await tx.verificationCase.create({
                data: { userId, term, state: initialState },
            });
            return toCaseRecord(created);
        });
    }
    async updateState(caseId, expectedVersion, toState, patch) {
        return this.prisma.$transaction(async (tx) => {
            const current = await tx.verificationCase.findUnique({ where: { id: caseId } });
            if (!current) {
                throw new Error(`Case ${caseId} not found`);
            }
            if (current.version !== expectedVersion) {
                throw new Error(`Case ${caseId} has version ${current.version}, expected ${expectedVersion}`);
            }
            const data = {
                state: toState,
                version: { increment: 1 },
            };
            if (patch) {
                if (patch.hall !== undefined)
                    data.hall = patch.hall;
                if (patch.room !== undefined)
                    data.room = patch.room;
                if (patch.raUserId !== undefined)
                    data.raUserId = patch.raUserId;
                if (patch.expiresAt !== undefined)
                    data.expiresAt = patch.expiresAt;
                if (patch.reminderSentAt !== undefined)
                    data.reminderSentAt = patch.reminderSentAt;
            }
            const updated = await tx.verificationCase.update({
                where: { id: caseId },
                data,
            });
            return toCaseRecord(updated);
        });
    }
    async markExpired(filters) {
        const before = isMarkExpiredFilters(filters) && filters.before instanceof Date ? filters.before : new Date();
        return this.prisma.$transaction(async (tx) => {
            const candidates = await tx.verificationCase.findMany({
                where: {
                    state: { in: ACTIVE_STATES },
                    expiresAt: { not: null, lt: before },
                },
            });
            await Promise.all(candidates.map((kase) => tx.verificationCase.update({
                where: { id: kase.id },
                data: {
                    state: 'expired',
                    version: { increment: 1 },
                },
            })));
            return candidates.length;
        });
    }
    async findById(caseId) {
        const kase = await this.prisma.verificationCase.findUnique({ where: { id: caseId } });
        return kase ? toCaseRecord(kase) : null;
    }
    async listAwaitingRA() {
        const rows = await this.prisma.verificationCase.findMany({
            where: { state: 'awaiting_ra' },
        });
        return rows.map(toCaseRecord);
    }
    async markReminderSent(caseId, timestamp) {
        await this.prisma.verificationCase.update({
            where: { id: caseId },
            data: { reminderSentAt: timestamp },
        });
    }
    async resetCase(userId, term) {
        await this.prisma.verificationCase.deleteMany({
            where: { userId, term },
        });
    }
}
exports.PrismaCaseRepository = PrismaCaseRepository;
