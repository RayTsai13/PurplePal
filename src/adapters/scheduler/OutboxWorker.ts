import type { DiscordService, OutboxRepository, OutboxJob, Config } from '../../core/ports';
import { logger } from '../../infra/logger';

// Dependencies for outbox worker
export interface OutboxWorkerDeps {
  outbox: OutboxRepository;
  notification: DiscordService;
  policy: Config;
  batchSize?: number;
  intervalMs?: number;
}

// Handle to stop the worker
export interface OutboxWorkerHandle {
  stop: () => Promise<void>;
}

// Start background worker that periodically drains outbox queue and sends notifications
// Returns handle to gracefully stop the worker
export const startOutboxWorker = ({
  outbox,
  notification,
  policy,
  batchSize = 10,
  intervalMs = 2000,
}: OutboxWorkerDeps): OutboxWorkerHandle => {
  // Store timer ID to allow cancellation
  let timer: NodeJS.Timeout | null = null;
  // Flag to signal worker should stop
  let stopped = false;

  // Main tick function that processes batches repeatedly
  const tick = async (): Promise<void> => {
    // Exit early if stop() was called
    if (stopped) {
      return;
    }

    try {
      // Process up to batchSize pending messages
      await processOutboxBatch(outbox, notification, policy, batchSize);
    } catch (err) {
      // Log error but don't crash, continue polling
      logger.error({ err }, 'Outbox worker batch failed');
    } finally {
      // Schedule next tick even if this one failed
      if (!stopped) {
        // setTimeout returns a timer ID that can be cleared with clearTimeout
        timer = setTimeout(() => {
          // void ignores the promise returned by async function
          void tick();
        }, intervalMs);
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

// Process a batch of pending outbox jobs with exponential backoff retry
export const processOutboxBatch = async (
  outbox: OutboxRepository,
  notification: DiscordService,
  policy: Config,
  batchSize: number,
): Promise<void> => {
  // Claim up to batchSize jobs ready for processing (takeDue leases them for 60s)
  const jobs = await outbox.takeDue(batchSize);
  if (jobs.length === 0) {
    return;
  }

  const limits = policy.limits();

  // Process each job independently so one failure doesn't stop others
  for (const job of jobs) {
    // Role changes and messages have separate retry budgets
    const isRoleJob = job.kind === 'role_add' || job.kind === 'role_remove';
    const maxAttempts = isRoleJob ? limits.roleAssignMaxRetries : limits.maxNotificationRetries;
    const backoffs = isRoleJob ? limits.roleAssignRetryBackoffSeconds : limits.notificationBackoffSeconds;

    try {
      await executeJob(job, notification);

      await outbox.markSent(job.id);
      logger.info({ jobId: job.id, kind: job.kind, target: job.payload?.targetId }, 'Outbox job delivered');

      // Chained DM (e.g. "approved" after the hall role is granted). Keyed on the job ID so a crash
      // between markSent and here can't produce a duplicate on a later retry
      const followUp = job.payload?.followUp;
      if (followUp) {
        await outbox.enqueueDM(followUp.userId, followUp.template, followUp.data, {
          caseId: job.caseId,
          idempotencyKey: `${job.id}-followup`,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      // job.attempts counts previous attempts; this failure is attempt number attempts + 1
      const attemptNumber = job.attempts + 1;

      if (attemptNumber >= maxAttempts) {
        await outbox.markPermanentlyFailed(job.id, errorMessage);
        logger.error(
          { jobId: job.id, kind: job.kind, attempts: attemptNumber, maxAttempts, err },
          'Outbox job permanently failed after max attempts',
        );
      } else {
        // Schedule retry with backoff; reuse the last interval if the array is shorter than maxAttempts
        const delaySeconds = backoffs[Math.min(job.attempts, backoffs.length - 1)] ?? 60;
        const retryAt = new Date(Date.now() + delaySeconds * 1000);
        await outbox.markFailed(job.id, errorMessage, retryAt);
        logger.warn({ jobId: job.id, kind: job.kind, attempts: attemptNumber, err }, 'Outbox job failed, will retry');
      }
    }
  }
};

// Perform one job's side effect. Throws on failure so the caller can schedule a retry
const executeJob = async (job: OutboxJob, notification: DiscordService): Promise<void> => {
  if (!job.payload) {
    throw new Error('Missing payload');
  }
  const { targetId, data } = job.payload;

  switch (job.kind) {
    case 'dm':
      await notification.sendDM(targetId, job.template, data, job.id);
      return;
    case 'channel':
      await notification.sendToQueue(targetId, job.template, data, job.id);
      return;
    case 'role_add':
    case 'role_remove': {
      const roleIds = Array.isArray(data?.roleIds) ? (data.roleIds as string[]) : [];
      if (roleIds.length === 0) {
        throw new Error('Role job has no roleIds');
      }
      const result = job.kind === 'role_add'
        ? await notification.assignRoles(targetId, roleIds, job.id)
        : await notification.removeRoles(targetId, roleIds, job.id);
      if (result.status !== 'success') {
        throw new Error(result.details ?? `Role change ${result.status}`);
      }
      return;
    }
  }
};
