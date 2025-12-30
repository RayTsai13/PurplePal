"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTimeouts = exports.startTimeoutWorker = void 0;
const logger_1 = require("../../infra/logger");
const startTimeoutWorker = ({ cases, policy, orchestrator, outbox, batchIntervalMs = 60000, }) => {
    let timer = null;
    let stopped = false;
    const tick = async () => {
        if (stopped) {
            return;
        }
        try {
            await (0, exports.processTimeouts)(cases, policy, orchestrator, outbox);
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Timeout worker tick failed');
        }
        finally {
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
exports.startTimeoutWorker = startTimeoutWorker;
const processTimeouts = async (cases, policy, orchestrator, outbox) => {
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
            await outbox.enqueueDM(kase.userId, templates.dm.reminder_user, { hall: kase.hall, room: kase.room }, { caseId: kase.id, idempotencyKey: `reminder-${kase.id}` });
            await cases.markReminderSent(kase.id, now);
        }
    }
};
exports.processTimeouts = processTimeouts;
const shouldSendReminder = (kase, reminderHours, now) => {
    if (reminderHours.length === 0 || !kase.updatedAt) {
        return false;
    }
    const elapsedHours = (now.getTime() - kase.updatedAt.getTime()) / (1000 * 60 * 60);
    return reminderHours.some((hours) => elapsedHours >= hours);
};
