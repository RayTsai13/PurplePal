import { Prisma, CaseState as PrismaCaseState, VerificationCase } from '../../../generated/prisma';
import { ACTIVE_CASE_STATES } from '../../core/ports';
import type { CaseRecord, CaseRepository, CaseState } from '../../core/ports';
import { ConcurrencyError } from '../../core/errors';

const ACTIVE_STATES = ACTIVE_CASE_STATES as PrismaCaseState[];

// Transform Prisma VerificationCase to port CaseRecord
// ?? converts null to undefined for optional fields
const toCaseRecord = (kase: VerificationCase): CaseRecord => ({
  id: kase.id,
  userId: kase.userId,
  term: kase.term,
  state: kase.state as CaseState,
  hall: kase.hall ?? undefined,
  roomNumber: kase.roomNumber ?? undefined,
  room: kase.room ?? undefined,
  raUserId: kase.raUserId ?? undefined,
  version: kase.version,
  expiresAt: kase.expiresAt ?? undefined,
  submittedAt: kase.submittedAt ?? undefined,
  reminderSentAt: kase.reminderSentAt ?? undefined,
  remindersSent: kase.remindersSent,
  updatedAt: kase.updatedAt,
});

// Prisma repository implementing CaseRepository port interface
// Accepts either the root client or a transaction client (see PrismaUnitOfWork)
export class PrismaCaseRepository implements CaseRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  // Get user's active case for a term. The partial unique index guarantees at most one
  async getActiveCase(userId: string, term: string): Promise<CaseRecord | null> {
    const kase = await this.prisma.verificationCase.findFirst({
      where: { userId, term, state: { in: ACTIVE_STATES } },
      orderBy: { createdAt: 'desc' },
    });

    return kase ? toCaseRecord(kase) : null;
  }

  async getApprovedCase(userId: string, term: string): Promise<CaseRecord | null> {
    const kase = await this.prisma.verificationCase.findFirst({
      where: { userId, term, state: 'approved' },
      orderBy: { createdAt: 'desc' },
    });

    return kase ? toCaseRecord(kase) : null;
  }

  async listOpenCases(userId: string, term: string): Promise<CaseRecord[]> {
    const rows = await this.prisma.verificationCase.findMany({
      where: { userId, term, state: { in: [...ACTIVE_STATES, 'approved'] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCaseRecord);
  }

  // Return the active case or create one. A concurrent create for the same user/term trips the
  // partial unique index (P2002), which is surfaced as ConcurrencyError so the caller can re-read
  async createIfNone(userId: string, term: string, initialState: CaseState): Promise<CaseRecord> {
    const existing = await this.getActiveCase(userId, term);
    if (existing) {
      return existing;
    }

    try {
      const created = await this.prisma.verificationCase.create({
        data: { userId, term, state: initialState as PrismaCaseState },
      });
      return toCaseRecord(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConcurrencyError(`User ${userId} already has an active case in term ${term}`);
      }
      throw error;
    }
  }

  // Update case state with optimistic locking. The version check is part of the UPDATE's WHERE
  // clause, so two concurrent writers holding the same version can't both succeed
  async updateState(
    caseId: string,
    expectedVersion: number,
    toState: CaseState,
    patch?: Partial<CaseRecord>,
  ): Promise<CaseRecord> {
    const data: Prisma.VerificationCaseUpdateManyMutationInput = {
      state: toState as PrismaCaseState,
      version: { increment: 1 },
    };

    // Apply patch fields if provided (only if not undefined)
    if (patch) {
      if (patch.hall !== undefined) data.hall = patch.hall;
      if (patch.roomNumber !== undefined) data.roomNumber = patch.roomNumber;
      if (patch.room !== undefined) data.room = patch.room;
      if (patch.raUserId !== undefined) data.raUserId = patch.raUserId;
      if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
      if (patch.submittedAt !== undefined) data.submittedAt = patch.submittedAt;
      if (patch.reminderSentAt !== undefined) data.reminderSentAt = patch.reminderSentAt;
    }

    const { count } = await this.prisma.verificationCase.updateMany({
      where: { id: caseId, version: expectedVersion },
      data,
    });

    if (count === 0) {
      const current = await this.prisma.verificationCase.findUnique({ where: { id: caseId } });
      if (!current) {
        throw new Error(`Case ${caseId} not found`);
      }
      throw new ConcurrencyError(`Case ${caseId} has version ${current.version}, expected ${expectedVersion}`);
    }

    const updated = await this.prisma.verificationCase.findUniqueOrThrow({ where: { id: caseId } });
    return toCaseRecord(updated);
  }

  // Get case by ID
  async findById(caseId: string): Promise<CaseRecord | null> {
    const kase = await this.prisma.verificationCase.findUnique({ where: { id: caseId } });
    return kase ? toCaseRecord(kase) : null;
  }

  // Get all cases awaiting RA response
  async listAwaitingRA(): Promise<CaseRecord[]> {
    const rows = await this.prisma.verificationCase.findMany({
      where: { state: 'awaiting_ra' },
    });
    return rows.map(toCaseRecord);
  }

  // Record how many reminder thresholds have been sent to prevent duplicate reminders
  async markReminderSent(caseId: string, remindersSent: number, timestamp: Date): Promise<void> {
    await this.prisma.verificationCase.update({
      where: { id: caseId },
      data: { remindersSent, reminderSentAt: timestamp },
    });
  }
}
