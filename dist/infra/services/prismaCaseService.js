"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaCaseRepository = void 0;
// States where case is still active
const ACTIVE_STATES = ['joined', 'hall_chosen', 'awaiting_ra'];
// Transform Prisma VerificationCase to port CaseRecord
// ?? converts null to undefined for optional fields
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
// Type guard: check if value is MarkExpiredFilters
// filters is Type means function narrows type to MarkExpiredFilters if true
const isMarkExpiredFilters = (filters) => typeof filters === 'object' && filters !== null && 'before' in filters;
// Prisma repository implementing CaseRepository port interface
// Uses transactions for atomicity where needed
class PrismaCaseRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Get user's active case for a term. Returns most recent if multiple exist
    // findFirst returns first match or null, orderBy: desc gets newest first
    async getActiveCase(userId, term) {
        const kase = await this.prisma.verificationCase.findFirst({
            where: { userId, term, state: { in: ACTIVE_STATES } },
            orderBy: { createdAt: 'desc' },
        });
        return kase ? toCaseRecord(kase) : null;
    }
    // Create case if none exists. Uses transaction to prevent race condition
    // $transaction ensures atomicity: either returns existing or creates new
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
    // Update case state with optimistic locking via version check
    // Throws if version mismatch (concurrent edit detected)
    // { increment: 1 } tells Prisma to add 1 to version field
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
            // Apply patch fields if provided (only if not undefined)
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
    // Mark all expired cases as expired. Returns count updated
    // { not: null, lt: before } = expiresAt is not null AND less than before date
    // Promise.all runs all updates in parallel within transaction
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
    // Get case by ID
    async findById(caseId) {
        const kase = await this.prisma.verificationCase.findUnique({ where: { id: caseId } });
        return kase ? toCaseRecord(kase) : null;
    }
    // Get all cases awaiting RA response
    async listAwaitingRA() {
        const rows = await this.prisma.verificationCase.findMany({
            where: { state: 'awaiting_ra' },
        });
        return rows.map(toCaseRecord);
    }
    // Record when reminder was sent to prevent duplicate reminders
    async markReminderSent(caseId, timestamp) {
        await this.prisma.verificationCase.update({
            where: { id: caseId },
            data: { reminderSentAt: timestamp },
        });
    }
    // Delete all cases for user in a term
    async resetCase(userId, term) {
        await this.prisma.verificationCase.deleteMany({
            where: { userId, term },
        });
    }
}
exports.PrismaCaseRepository = PrismaCaseRepository;
