import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processTimeouts, dueReminderCount } from '../../adapters/scheduler/TimeoutWorker';
import type { CaseRecord, CaseRepository, Config } from '../../core/ports';
import type { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';

const HOUR = 60 * 60 * 1000;

describe('TimeoutWorker', () => {
  let cases: { listAwaitingRA: ReturnType<typeof vi.fn> };
  let policy: { timeouts: ReturnType<typeof vi.fn> };
  let orchestrator: { expire: ReturnType<typeof vi.fn>; sendReminder: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cases = { listAwaitingRA: vi.fn().mockResolvedValue([]) };
    policy = { timeouts: vi.fn().mockReturnValue({ awaitingRA_ttl_hours: 72, reminder_hours: [1, 3] }) };
    orchestrator = { expire: vi.fn(), sendReminder: vi.fn() };
  });

  const run = () =>
    processTimeouts(
      cases as unknown as CaseRepository,
      policy as unknown as Config,
      orchestrator as unknown as VerificationOrchestrator,
    );

  it('expires cases past TTL', async () => {
    cases.listAwaitingRA.mockResolvedValue([buildCase({ id: 'expired', expiresAt: new Date(Date.now() - 60_000) })]);

    await run();

    expect(orchestrator.expire).toHaveBeenCalledWith('expired', 'expire-expired');
    expect(orchestrator.sendReminder).not.toHaveBeenCalled();
  });

  it('sends the next reminder when a threshold is reached', async () => {
    const kase = buildCase({ id: 'r1', submittedAt: new Date(Date.now() - 2 * HOUR) });
    cases.listAwaitingRA.mockResolvedValue([kase]);

    await run();

    expect(orchestrator.sendReminder).toHaveBeenCalledWith(kase, 1);
  });

  it('sends a second reminder at the second threshold', async () => {
    const kase = buildCase({ id: 'r2', submittedAt: new Date(Date.now() - 4 * HOUR), remindersSent: 1 });
    cases.listAwaitingRA.mockResolvedValue([kase]);

    await run();

    expect(orchestrator.sendReminder).toHaveBeenCalledWith(kase, 2);
  });

  it('does not resend a reminder already sent', async () => {
    cases.listAwaitingRA.mockResolvedValue([
      buildCase({ id: 'r3', submittedAt: new Date(Date.now() - 2 * HOUR), remindersSent: 1 }),
    ]);

    await run();

    expect(orchestrator.sendReminder).not.toHaveBeenCalled();
  });

  it('keeps processing other cases when one fails', async () => {
    orchestrator.expire.mockRejectedValueOnce(new Error('db down'));
    const second = buildCase({ id: 'r4', submittedAt: new Date(Date.now() - 2 * HOUR) });
    cases.listAwaitingRA.mockResolvedValue([
      buildCase({ id: 'broken', expiresAt: new Date(Date.now() - 1000) }),
      second,
    ]);

    await run();

    expect(orchestrator.sendReminder).toHaveBeenCalledWith(second, 1);
  });

  it('measures reminders from submission, falling back to updatedAt', () => {
    const now = new Date();
    expect(dueReminderCount(buildCase({ id: 'a', submittedAt: new Date(now.getTime() - 30 * HOUR) }), [24, 48], now)).toBe(1);
    expect(dueReminderCount(buildCase({ id: 'b', updatedAt: new Date(now.getTime() - 50 * HOUR) }), [24, 48], now)).toBe(2);
    expect(dueReminderCount(buildCase({ id: 'c' }), [], now)).toBe(0);
  });
});

type PartialCase = Partial<CaseRecord> & { id: string };

const buildCase = (override: PartialCase): CaseRecord => ({
  userId: 'user-1',
  term: 'Fall 2025',
  state: 'awaiting_ra',
  hall: 'Summit',
  room: 'S-101-A',
  version: 1,
  remindersSent: 0,
  updatedAt: new Date(),
  expiresAt: new Date(Date.now() + 48 * HOUR),
  ...override,
});
