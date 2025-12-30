import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processTimeouts } from '../../adapters/scheduler/TimeoutWorker';
import type {
  CaseRecord,
  CaseRepository,
  OutboxRepository,
  Config,
} from '../../core/ports';
import type { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';

const baseTimeouts = {
  awaitingRA_ttl_hours: 72,
  reminder_hours: [1],
};

const baseTemplates = {
  dm: {
    reminder_user: 'Reminder {{hall}} {{room}}',
    expired: 'expired',
  },
  ra_queue: {},
};

describe('TimeoutWorker', () => {
  let cases: ReturnType<typeof createCasesMock>;
  let policy: ReturnType<typeof createPolicyMock>;
  let orchestrator: { expire: ReturnType<typeof vi.fn> };
  let outbox: { enqueueDM: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cases = createCasesMock();
    policy = createPolicyMock();
    orchestrator = { expire: vi.fn() };
    outbox = { enqueueDM: vi.fn() };
  });

  it('expires cases past TTL', async () => {
    const expiredCase = buildCase({
      id: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    cases.listAwaitingRA.mockResolvedValue([expiredCase]);

    await processTimeouts(
      cases as unknown as CaseRepository,
      policy as unknown as Config,
      orchestrator as unknown as VerificationOrchestrator,
      outbox as unknown as OutboxRepository,
    );

    expect(orchestrator.expire).toHaveBeenCalledWith('expired', expect.any(String));
    expect(outbox.enqueueDM).not.toHaveBeenCalled();
  });

  it('sends reminders when threshold reached and marks reminder sent', async () => {
    const reminderCase = buildCase({
      id: 'reminder',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    cases.listAwaitingRA.mockResolvedValue([reminderCase]);

    await processTimeouts(
      cases as unknown as CaseRepository,
      policy as unknown as Config,
      orchestrator as unknown as VerificationOrchestrator,
      outbox as unknown as OutboxRepository,
    );

    expect(outbox.enqueueDM).toHaveBeenCalledWith(
      'user-1',
      'Reminder {{hall}} {{room}}',
      { hall: 'Summit', room: 'S-101-A' },
      { caseId: 'reminder', idempotencyKey: 'reminder-reminder' },
    );
    expect(cases.markReminderSent).toHaveBeenCalledWith('reminder', expect.any(Date));
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
  updatedAt: new Date(),
  ...override,
  id: override.id ?? 'case-id',
});

const createCasesMock = () => ({
  listAwaitingRA: vi.fn().mockResolvedValue([]),
  markReminderSent: vi.fn(),
});

const createPolicyMock = () => ({
  currentTerm: vi.fn().mockReturnValue('2024-fall'),
  timeouts: vi.fn().mockReturnValue(baseTimeouts),
  messaging: vi.fn().mockReturnValue(baseTemplates),
  limits: vi.fn().mockReturnValue({}),
  halls: vi.fn().mockReturnValue([]),
});
