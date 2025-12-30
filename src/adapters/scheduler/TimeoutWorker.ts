import type { CaseRecord, CaseRepository, OutboxRepository, Config } from '../../core/ports';

// Compatibility type aliases
type CaseService = CaseRepository;
type OutboxService = OutboxRepository;
import type { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';
import { logger } from '../../infra/logger';

export interface TimeoutWorkerDeps {
  cases: CaseService;
  policy: Config;
  orchestrator: VerificationOrchestrator;
  outbox: OutboxService;
  batchIntervalMs?: number;
}

export interface TimeoutWorkerHandle {
  stop: () => Promise<void>;
}

export const startTimeoutWorker = ({
  cases,
  policy,
  orchestrator,
  outbox,
  batchIntervalMs = 60_000,
}: TimeoutWorkerDeps): TimeoutWorkerHandle => {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      await processTimeouts(cases, policy, orchestrator, outbox);
    } catch (err) {
      logger.error({ err }, 'Timeout worker tick failed');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, batchIntervalMs);
      }
    }
  };

  void tick();

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
};

export const processTimeouts = async (
  cases: CaseService,
  policy: Config,
  orchestrator: VerificationOrchestrator,
  outbox: OutboxService,
): Promise<void> => {
  const allAwaiting = await cases.listAwaitingRA();
  if (allAwaiting.length === 0) {
    return;
  }

  const timeouts = policy.timeouts();
  const templates = policy.messaging();
  const reminderHours = timeouts.reminder_hours ?? [];
  const now = new Date();

  for (const kase of allAwaiting) {
    if (kase.expiresAt && kase.expiresAt <= now) {
      await orchestrator.expire(kase.id, `expire-${now.toISOString()}`);
      continue;
    }

    if (!kase.reminderSentAt && shouldSendReminder(kase, reminderHours, now)) {
      await outbox.enqueueDM(
        kase.userId,
        templates.dm.reminder_user,
        { hall: kase.hall, room: kase.room },
        { caseId: kase.id, idempotencyKey: `reminder-${kase.id}` },
      );
      await cases.markReminderSent(kase.id, now);
    }
  }
};

const shouldSendReminder = (kase: CaseRecord, reminderHours: number[], now: Date): boolean => {
  if (reminderHours.length === 0 || !kase.updatedAt) {
    return false;
  }

  const elapsedHours = (now.getTime() - kase.updatedAt.getTime()) / (1000 * 60 * 60);
  return reminderHours.some((hours) => elapsedHours >= hours);
};
