import type { CaseRecord, CaseRepository, OutboxRepository, Config } from '../../core/ports';

// Compatibility type aliases for clearer intent
type CaseService = CaseRepository;
type OutboxService = OutboxRepository;
import type { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';
import { logger } from '../../infra/logger';

// Dependencies for timeout worker
export interface TimeoutWorkerDeps {
  cases: CaseService;
  policy: Config;
  orchestrator: VerificationOrchestrator;
  outbox: OutboxService;
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
  outbox,
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
      await processTimeouts(cases, policy, orchestrator, outbox);
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
export const processTimeouts = async (
  cases: CaseService,
  policy: Config,
  orchestrator: VerificationOrchestrator,
  outbox: OutboxService,
): Promise<void> => {
  // Get all cases currently awaiting RA response
  const allAwaiting = await cases.listAwaitingRA();
  if (allAwaiting.length === 0) {
    return;
  }

  // Get timeout and messaging config
  const timeouts = policy.timeouts();
  const templates = policy.messaging();
  const reminderHours = timeouts.reminder_hours ?? [];
  const now = new Date();

  // Process each awaiting case for expiration and reminders
  for (const kase of allAwaiting) {
    // Check if case has expired (expiresAt timestamp has passed)
    if (kase.expiresAt && kase.expiresAt <= now) {
      // Transition case to expired state via orchestrator
      await orchestrator.expire(kase.id, `expire-${now.toISOString()}`);
      // continue skips the reminder check for this case
      continue;
    }

    // Send reminder if not already sent and enough time has elapsed
    // !kase.reminderSentAt checks if reminder hasn't been sent yet (null/undefined)
    if (!kase.reminderSentAt && shouldSendReminder(kase, reminderHours, now)) {
      // Queue reminder DM with case data (hall and room info)
      await outbox.enqueueDM(
        kase.userId,
        templates.dm.reminder_user,
        { hall: kase.hall, room: kase.room },
        // idempotencyKey prevents duplicate reminders for same case
        { caseId: kase.id, idempotencyKey: `reminder-${kase.id}` },
      );
      // Mark reminder as sent so we don't send it again next tick
      await cases.markReminderSent(kase.id, now);
    }
  }
};

// Check if enough time has passed to send reminder for this case
const shouldSendReminder = (kase: CaseRecord, reminderHours: number[], now: Date): boolean => {
  // No reminders configured or case has no update timestamp
  if (reminderHours.length === 0 || !kase.updatedAt) {
    return false;
  }

  // Calculate hours elapsed since case was last updated
  // (now - updatedAt in ms) / (1000 * 60 * 60) converts ms to hours
  const elapsedHours = (now.getTime() - kase.updatedAt.getTime()) / (1000 * 60 * 60);
  // .some() returns true if any configured reminder hour threshold has been reached
  // Example: if reminderHours = [24, 48] and elapsed = 25 hours, returns true for 24-hour reminder
  return reminderHours.some((hours) => elapsedHours >= hours);
};
