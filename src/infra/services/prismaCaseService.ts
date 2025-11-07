import { Prisma, PrismaClient, CaseState as PrismaCaseState, VerificationCase } from '../../../generated/prisma';
import type { CaseRecord, CaseService, CaseState } from '../../core/application/ports';

const ACTIVE_STATES: CaseState[] = ['joined', 'hall_chosen', 'room_entered', 'awaiting_ra'];

const toCaseRecord = (kase: VerificationCase): CaseRecord => ({
  id: kase.id,
  userId: kase.userId,
  term: kase.term,
  state: kase.state as CaseState,
  hall: kase.hall ?? undefined,
  room: kase.room ?? undefined,
  raUserId: kase.raUserId ?? undefined,
  version: kase.version,
  expiresAt: kase.expiresAt ?? undefined,
});

type MarkExpiredFilters = { before?: Date };

const isMarkExpiredFilters = (filters?: unknown): filters is MarkExpiredFilters =>
  typeof filters === 'object' && filters !== null && 'before' in filters;

export class PrismaCaseService implements CaseService {
  constructor(private readonly prisma: PrismaClient) {}

  async getActiveCase(userId: string, term: string): Promise<CaseRecord | null> {
    const kase = await this.prisma.verificationCase.findFirst({
      where: { userId, term, state: { in: ACTIVE_STATES as PrismaCaseState[] } },
      orderBy: { createdAt: 'desc' },
    });

    return kase ? toCaseRecord(kase) : null;
  }

  async createIfNone(userId: string, term: string, initialState: CaseState): Promise<CaseRecord> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.verificationCase.findFirst({
        where: { userId, term, state: { in: ACTIVE_STATES as PrismaCaseState[] } },
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

  async updateState(
    caseId: string,
    expectedVersion: number,
    toState: CaseState,
    patch?: Partial<CaseRecord>,
  ): Promise<CaseRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.verificationCase.findUnique({ where: { id: caseId } });
      if (!current) {
        throw new Error(`Case ${caseId} not found`);
      }
      if (current.version !== expectedVersion) {
        throw new Error(`Case ${caseId} has version ${current.version}, expected ${expectedVersion}`);
      }

      const data: Prisma.VerificationCaseUpdateInput = {
        state: toState as PrismaCaseState,
        version: { increment: 1 },
      };

      if (patch) {
        if (patch.hall !== undefined) data.hall = patch.hall;
        if (patch.room !== undefined) data.room = patch.room;
        if (patch.raUserId !== undefined) data.raUserId = patch.raUserId;
        if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
      }

      const updated = await tx.verificationCase.update({
        where: { id: caseId },
        data,
      });

      return toCaseRecord(updated);
    });
  }

  async markExpired(filters?: unknown): Promise<number> {
    const before =
      isMarkExpiredFilters(filters) && filters.before instanceof Date ? filters.before : new Date();

    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.verificationCase.findMany({
        where: {
          state: { in: ACTIVE_STATES as PrismaCaseState[] },
          expiresAt: { not: null, lt: before },
        },
      });

      await Promise.all(
        candidates.map((kase) =>
          tx.verificationCase.update({
            where: { id: kase.id },
            data: {
              state: 'expired',
              version: { increment: 1 },
            },
          }),
        ),
      );

      return candidates.length;
    });
  }

  async findById(caseId: string): Promise<CaseRecord | null> {
    const kase = await this.prisma.verificationCase.findUnique({ where: { id: caseId } });
    return kase ? toCaseRecord(kase) : null;
  }
}
