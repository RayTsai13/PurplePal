import type { DiscordService, OutboxRepository, Config } from '../../core/ports';

// Compatibility type aliases for clearer intent
type NotificationService = DiscordService;
type OutboxService = OutboxRepository;
import { logger } from '../../infra/logger';

// Dependencies for outbox worker
export interface OutboxWorkerDeps {
  outbox: OutboxService;
  notification: NotificationService;
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

// Process a batch of pending outbox messages with exponential backoff retry
export const processOutboxBatch = async (
  outbox: OutboxService,
  notification: NotificationService,
  policy: Config,
  batchSize: number,
): Promise<void> => {
  // Fetch up to batchSize messages ready for sending (takeDue locks them for 60s)
  const jobs = await outbox.takeDue(batchSize);
  if (jobs.length === 0) {
    return;
  }

  // Get retry limits and backoff intervals from policy
  const limits = policy.limits();
  const backoffs = limits.notificationBackoffSeconds;

  // Process each job independently so one failure doesn't stop others
  for (const job of jobs) {
    try {
      // Payload must exist to send message (userId/channelId and template data)
      if (!job.payload) {
        throw new Error('Missing payload');
      }

      // Send message to correct destination (DM or queue channel)
      if (job.kind === 'dm') {
        await notification.sendDM(job.payload.targetId, job.template, job.payload.data, job.id);
      } else {
        await notification.sendToQueue(job.payload.targetId, job.template, job.payload.data, job.id);
      }

      // Mark as successfully sent
      await outbox.markSent(job.id);
      logger.info({ jobId: job.id, kind: job.kind, target: job.payload.targetId }, 'Outbox job delivered');
    } catch (err) {
      // Extract error message for logging and storage
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Check if we've exceeded max retry attempts
      if (job.attempts >= limits.maxNotificationRetries) {
        // Give up permanently
        await outbox.markPermanentlyFailed(job.id, errorMessage);
        logger.error(
          { jobId: job.id, attempts: job.attempts, maxRetries: limits.maxNotificationRetries, err },
          'Outbox job permanently failed after max retries',
        );
      } else {
        // Schedule retry with exponential backoff
        // Math.min ensures we don't go beyond the backoffs array length
        // ?? provides fallback to 60s if array is too short
        const delaySeconds = backoffs[Math.min(job.attempts, backoffs.length - 1)] ?? 60;
        const retryAt = new Date(Date.now() + delaySeconds * 1000);
        await outbox.markFailed(job.id, errorMessage, retryAt);
        logger.warn({ jobId: job.id, attempts: job.attempts, err }, 'Outbox delivery failed, will retry');
      }
    }
  }
};
