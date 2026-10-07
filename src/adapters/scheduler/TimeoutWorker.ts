import type { CaseRecord, CaseRepository, Config } from '../../core/ports';
import type { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';
import { logger } from '../../infra/logger';

// Dependencies for timeout worker
export interface TimeoutWorkerDeps {
  cases: CaseRepository;
  policy: Config;
  orchestrator: VerificationOrchestrator;
  batchIntervalMs?: number;
}

// Handle to stop the worker
export interface TimeoutWorkerHandle {
  stop: () => Promise<void>;
}

// Start background worker that periodically expires old cases and sends reminders
// Runs every 60 seconds by default to check awaiting_ra cases
export const startTimeoutWorker = ({
  cases,
  policy,
  orchestrator,
  batchIntervalMs = 60_000,
}: TimeoutWorkerDeps): TimeoutWorkerHandle => {
  // Store timer ID to allow cancellation
  let timer: NodeJS.Timeout | null = null;
  // Flag to signal worker should stop
  let stopped = false;

  // Main tick function that processes timeouts and reminders
  const tick = async () => {
    // Exit early if stop() was called
    if (stopped) {
      return;
    }

    try {
      // Process all awaiting_ra cases for expiration and reminders
      await processTimeouts(cases, policy, orchestrator);
    } catch (err) {
      // Log error but don't crash, continue polling
      logger.error({ err }, 'Timeout worker tick failed');
    } finally {
      // Schedule next tick even if this one failed
      if (!stopped) {
        timer = setTimeout(() => {
          // void ignores the promise returned by async function
          void tick();
        }, batchIntervalMs);
      }
    }
  };

  // Start the polling loop immediately (fire and forget)
  void tick();

  return {
    async stop() {
      // Signal worker to stop
      stopped = true;
      // Cancel any pending timeout
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
};

// Process all awaiting_ra cases: expire old ones and send reminders
// Each case is handled independently so one failure doesn't block the rest
export const processTimeouts = async (
  cases: CaseRepository,
  policy: Config,
  orchestrator: VerificationOrchestrator,
): Promise<void> => {
  const allAwaiting = await cases.listAwaitingRA();
  if (allAwaiting.length === 0) {
    return;
  }

  const reminderHours = policy.timeouts().reminder_hours ?? [];
  const now = new Date();

  for (const kase of allAwaiting) {
    try {
      if (kase.expiresAt && kase.expiresAt <= now) {
        await orchestrator.expire(kase.id, `expire-${kase.id}`);
        continue;
      }

      const due = dueReminderCount(kase, reminderHours, now);
      if (due > kase.remindersSent) {
        await orchestrator.sendReminder(kase, due);
      }
    } catch (err) {
      logger.error({ err, caseId: kase.id }, 'Failed to process timeout for case');
    }
  }
};

// Number of reminder thresholds that have elapsed since the case was submitted for RA review
// Example: reminderHours = [24, 48] and 30 hours elapsed -> 1 (the 24h reminder is due)
export const dueReminderCount = (kase: CaseRecord, reminderHours: number[], now: Date): number => {
  const since = kase.submittedAt ?? kase.updatedAt;
  if (reminderHours.length === 0 || !since) {
    return 0;
  }

  const elapsedHours = (now.getTime() - since.getTime()) / (1000 * 60 * 60);
  return reminderHours.filter((hours) => elapsedHours >= hours).length;
};
