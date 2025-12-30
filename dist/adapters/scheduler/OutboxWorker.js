"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processOutboxBatch = exports.startOutboxWorker = void 0;
const logger_1 = require("../../infra/logger");
const startOutboxWorker = ({ outbox, notification, policy, batchSize = 10, intervalMs = 2000, }) => {
    let timer = null;
    let stopped = false;
    const tick = async () => {
        if (stopped) {
            return;
        }
        try {
            await (0, exports.processOutboxBatch)(outbox, notification, policy, batchSize);
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Outbox worker batch failed');
        }
        finally {
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
exports.startOutboxWorker = startOutboxWorker;
const processOutboxBatch = async (outbox, notification, policy, batchSize) => {
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
            }
            else {
                await notification.sendToQueue(job.payload.targetId, job.template, job.payload.data, job.id);
            }
            await outbox.markSent(job.id);
            logger_1.logger.info({ jobId: job.id, kind: job.kind, target: job.payload.targetId }, 'Outbox job delivered');
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            // Check if job has exceeded max retry attempts
            if (job.attempts >= limits.maxNotificationRetries) {
                await outbox.markPermanentlyFailed(job.id, errorMessage);
                logger_1.logger.error({ jobId: job.id, attempts: job.attempts, maxRetries: limits.maxNotificationRetries, err }, 'Outbox job permanently failed after max retries');
            }
            else {
                const delaySeconds = backoffs[Math.min(job.attempts, backoffs.length - 1)] ?? 60;
                const retryAt = new Date(Date.now() + delaySeconds * 1000);
                await outbox.markFailed(job.id, errorMessage, retryAt);
                logger_1.logger.warn({ jobId: job.id, attempts: job.attempts, err }, 'Outbox delivery failed, will retry');
            }
        }
    }
};
exports.processOutboxBatch = processOutboxBatch;
