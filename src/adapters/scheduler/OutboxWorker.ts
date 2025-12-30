import type { DiscordService, OutboxRepository, Config } from '../../core/ports';

// Compatibility type alias
type NotificationService = DiscordService;
type OutboxService = OutboxRepository;
import { logger } from '../../infra/logger';

export interface OutboxWorkerDeps {
  outbox: OutboxService;
  notification: NotificationService;
  policy: Config;
  batchSize?: number;
  intervalMs?: number;
}

export interface OutboxWorkerHandle {
  stop: () => Promise<void>;
}

export const startOutboxWorker = ({
  outbox,
  notification,
  policy,
  batchSize = 10,
  intervalMs = 2000,
}: OutboxWorkerDeps): OutboxWorkerHandle => {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    try {
      await processOutboxBatch(outbox, notification, policy, batchSize);
    } catch (err) {
      logger.error({ err }, 'Outbox worker batch failed');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, intervalMs);
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

export const processOutboxBatch = async (
  outbox: OutboxService,
  notification: NotificationService,
  policy: Config,
  batchSize: number,
): Promise<void> => {
  const jobs = await outbox.takeDue(batchSize);
  if (jobs.length === 0) {
    return;
  }

  const limits = policy.limits();
  const backoffs = limits.notificationBackoffSeconds;

  for (const job of jobs) {
    try {
      if (!job.payload) {
        throw new Error('Missing payload');
      }

      if (job.kind === 'dm') {
        await notification.sendDM(job.payload.targetId, job.template, job.payload.data, job.id);
      } else {
        await notification.sendToQueue(job.payload.targetId, job.template, job.payload.data, job.id);
      }

      await outbox.markSent(job.id);
      logger.info({ jobId: job.id, kind: job.kind, target: job.payload.targetId }, 'Outbox job delivered');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Check if job has exceeded max retry attempts
      if (job.attempts >= limits.maxNotificationRetries) {
        await outbox.markPermanentlyFailed(job.id, errorMessage);
        logger.error(
          { jobId: job.id, attempts: job.attempts, maxRetries: limits.maxNotificationRetries, err },
          'Outbox job permanently failed after max retries',
        );
      } else {
        const delaySeconds = backoffs[Math.min(job.attempts, backoffs.length - 1)] ?? 60;
        const retryAt = new Date(Date.now() + delaySeconds * 1000);
        await outbox.markFailed(job.id, errorMessage, retryAt);
        logger.warn({ jobId: job.id, attempts: job.attempts, err }, 'Outbox delivery failed, will retry');
      }
    }
  }
};
