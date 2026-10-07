import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '../../../generated/prisma';
import { PrismaCaseRepository } from '../../infra/services/prismaCaseService';
import { PrismaOutboxRepository } from '../../infra/services/prismaOutboxService';
import { PrismaUnitOfWork } from '../../infra/services/prismaUnitOfWork';
import { ConcurrencyError } from '../../core/errors';

// Runs against a real, migrated PostgreSQL database (these behaviours can't be mocked meaningfully):
//   TEST_DATABASE_URL=postgresql://purplepal:purplepal@localhost:5432/purplepal npm test
// Each run uses its own term so it never touches other data, and cleans up after itself
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Prisma repositories (integration)', () => {
  const term = `itest-${randomUUID()}`;
  let prisma: PrismaClient;
  let cases: PrismaCaseRepository;
  let outbox: PrismaOutboxRepository;
  let uow: PrismaUnitOfWork;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    cases = new PrismaCaseRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    uow = new PrismaUnitOfWork(prisma);
  });

  afterAll(async () => {
    const ids = (await prisma.verificationCase.findMany({ where: { term }, select: { id: true } })).map((c) => c.id);
    await prisma.outbox.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.decision.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.verificationCase.deleteMany({ where: { term } });
    await prisma.$disconnect();
  });

  const newUser = () => `user-${randomUUID()}`;

  it('lets exactly one of two concurrent updates with the same version win', async () => {
    const kase = await cases.createIfNone(newUser(), term, 'awaiting_ra');

    const results = await Promise.allSettled([
      uow.run((r) => r.cases.updateState(kase.id, kase.version, 'approved', { raUserId: 'ra-1' })),
      uow.run((r) => r.cases.updateState(kase.id, kase.version, 'denied', { raUserId: 'ra-2' })),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConcurrencyError);

    const final = await cases.findById(kase.id);
    expect(final?.version).toBe(kase.version + 1);
  });

  it('allows only one active case per user and term under concurrent creates', async () => {
    const userId = newUser();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => uow.run((r) => r.cases.createIfNone(userId, term, 'joined'))),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ConcurrencyError);
      }
    }
    const active = await prisma.verificationCase.count({ where: { userId, term, state: 'joined' } });
    expect(active).toBe(1);
  });

  it('permits a new active case once the previous one is finished', async () => {
    const userId = newUser();
    const first = await cases.createIfNone(userId, term, 'joined');
    await cases.updateState(first.id, first.version, 'cancelled');

    const second = await cases.createIfNone(userId, term, 'joined');

    expect(second.id).not.toBe(first.id);
  });

  it('rolls back state, audit, and outbox writes together when a transaction fails', async () => {
    const kase = await cases.createIfNone(newUser(), term, 'awaiting_ra');

    await expect(
      uow.run(async (r) => {
        await r.cases.updateState(kase.id, kase.version, 'approved');
        await r.audit.record(kase.id, 'ra_approve', 'awaiting_ra', 'approved', 'ra', 'ra-1');
        await r.outbox.enqueueDM('someone', `${term}-dm`, {}, { caseId: kase.id });
        throw new Error('crash mid-transition');
      }),
    ).rejects.toThrow('crash mid-transition');

    const after = await cases.findById(kase.id);
    expect(after?.state).toBe('awaiting_ra');
    expect(after?.version).toBe(kase.version);
    expect(await prisma.auditLog.count({ where: { caseId: kase.id } })).toBe(0);
    expect(await prisma.outbox.count({ where: { caseId: kase.id } })).toBe(0);
  });

  it('ignores a duplicate idempotency key without aborting the surrounding transaction', async () => {
    const kase = await cases.createIfNone(newUser(), term, 'awaiting_ra');
    const key = `${term}-dup-${randomUUID()}`;

    await uow.run(async (r) => {
      await r.outbox.enqueueDM('someone', `${term}-dm`, {}, { caseId: kase.id, idempotencyKey: key });
      await r.outbox.enqueueDM('someone', `${term}-dm`, {}, { caseId: kase.id, idempotencyKey: key });
      // Would fail with "current transaction is aborted" if the duplicate had raised a unique violation
      await r.cases.updateState(kase.id, kase.version, 'approved');
    });

    expect(await prisma.outbox.count({ where: { idempotencyKey: key } })).toBe(1);
    expect((await cases.findById(kase.id))?.state).toBe('approved');
  });

  it('claims due jobs once and leases them away from the next poll', async () => {
    const kase = await cases.createIfNone(newUser(), term, 'approved');
    const template = `${term}-claim-${randomUUID()}`;
    await outbox.enqueueRoleChange('user-x', 'add', ['role-1'], {
      caseId: kase.id,
      followUp: { userId: 'user-x', template: 'approved' },
    });
    await outbox.enqueueDM('user-x', template, { a: 1 }, { caseId: kase.id });

    const claimed = (await outbox.takeDue(100)).filter((j) => j.caseId === kase.id);
    const dm = claimed.find((j) => j.kind === 'dm');
    expect(dm?.payload).toEqual({ targetId: 'user-x', data: { a: 1 }, followUp: undefined });
    const role = claimed.find((j) => j.kind === 'role_add');
    expect(role?.payload?.data).toEqual({ roleIds: ['role-1'] });
    expect(role?.payload?.followUp).toEqual({ userId: 'user-x', template: 'approved' });

    const again = await outbox.takeDue(100);
    expect(again.find((j) => j.id === dm?.id)).toBeUndefined();

    // The lease is stored as UTC like every other DateTime, regardless of the session timezone
    const leased = await prisma.outbox.findUniqueOrThrow({ where: { id: dm!.id } });
    const leaseMs = leased.nextAttemptAt!.getTime() - Date.now();
    expect(leaseMs).toBeGreaterThan(50_000);
    expect(leaseMs).toBeLessThan(70_000);
  });

  it('refuses to delete a case that has audit history', async () => {
    const kase = await cases.createIfNone(newUser(), term, 'joined');
    await uow.run((r) => r.audit.record(kase.id, 'user_joined', undefined, 'joined', 'user', 'u'));

    await expect(prisma.verificationCase.delete({ where: { id: kase.id } })).rejects.toThrow();
  });
});
