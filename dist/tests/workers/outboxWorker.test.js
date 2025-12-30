"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const OutboxWorker_1 = require("../../adapters/scheduler/OutboxWorker");
const basePolicy = {
    notificationBackoffSeconds: [5, 15, 30],
    maxNotificationRetries: 5,
    roleAssignMaxRetries: 3,
    roleAssignRetryBackoffSeconds: [5],
};
(0, vitest_1.describe)('OutboxWorker', () => {
    (0, vitest_1.it)('delivers DM jobs and marks them sent', async () => {
        const job = {
            id: 'job-1',
            caseId: 'case-1',
            kind: 'dm',
            template: 'Hello {{name}}',
            payload: { targetId: 'user-123', data: { name: 'Ada' } },
            attempts: 0,
        };
        const outbox = {
            enqueueDM: vitest_1.vi.fn(),
            enqueueChannel: vitest_1.vi.fn(),
            takeDue: vitest_1.vi.fn().mockResolvedValue([job]),
            markSent: vitest_1.vi.fn().mockResolvedValue(undefined),
            markFailed: vitest_1.vi.fn(),
            markPermanentlyFailed: vitest_1.vi.fn(),
        };
        const discord = {
            validateHall: vitest_1.vi.fn(),
            normalizeRoom: vitest_1.vi.fn(),
            sendDM: vitest_1.vi.fn().mockResolvedValue(undefined),
            sendToQueue: vitest_1.vi.fn(),
            assignRoles: vitest_1.vi.fn(),
            removeRoles: vitest_1.vi.fn(),
        };
        const config = {
            currentTerm: vitest_1.vi.fn().mockReturnValue('2024-fall'),
            timeouts: vitest_1.vi.fn().mockReturnValue({}),
            limits: vitest_1.vi.fn().mockReturnValue(basePolicy),
            messaging: vitest_1.vi.fn().mockReturnValue({}),
            halls: vitest_1.vi.fn().mockReturnValue([]),
        };
        await (0, OutboxWorker_1.processOutboxBatch)(outbox, discord, config, 5);
        (0, vitest_1.expect)(outbox.takeDue).toHaveBeenCalledWith(5);
        (0, vitest_1.expect)(discord.sendDM).toHaveBeenCalledWith('user-123', 'Hello {{name}}', { name: 'Ada' }, 'job-1');
        (0, vitest_1.expect)(outbox.markSent).toHaveBeenCalledWith('job-1');
        (0, vitest_1.expect)(outbox.markFailed).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('records failures and schedules retry with backoff', async () => {
        const job = {
            id: 'job-2',
            caseId: 'case-9',
            kind: 'channel',
            template: 'Alert',
            payload: { targetId: 'channel-1', data: { foo: 'bar' } },
            attempts: 1,
        };
        const outbox = {
            enqueueDM: vitest_1.vi.fn(),
            enqueueChannel: vitest_1.vi.fn(),
            takeDue: vitest_1.vi.fn().mockResolvedValue([job]),
            markSent: vitest_1.vi.fn(),
            markFailed: vitest_1.vi.fn().mockResolvedValue(undefined),
            markPermanentlyFailed: vitest_1.vi.fn(),
        };
        const discord = {
            validateHall: vitest_1.vi.fn(),
            normalizeRoom: vitest_1.vi.fn(),
            sendDM: vitest_1.vi.fn(),
            sendToQueue: vitest_1.vi.fn().mockRejectedValue(new Error('network down')),
            assignRoles: vitest_1.vi.fn(),
            removeRoles: vitest_1.vi.fn(),
        };
        const config = {
            currentTerm: vitest_1.vi.fn().mockReturnValue('2024-fall'),
            timeouts: vitest_1.vi.fn().mockReturnValue({}),
            limits: vitest_1.vi.fn().mockReturnValue(basePolicy),
            messaging: vitest_1.vi.fn().mockReturnValue({}),
            halls: vitest_1.vi.fn().mockReturnValue([]),
        };
        await (0, OutboxWorker_1.processOutboxBatch)(outbox, discord, config, 10);
        (0, vitest_1.expect)(discord.sendToQueue).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(outbox.markSent).not.toHaveBeenCalled();
        (0, vitest_1.expect)(outbox.markFailed).toHaveBeenCalled();
        const [, , retryAt] = outbox.markFailed.mock.calls[0];
        (0, vitest_1.expect)(retryAt).toBeInstanceOf(Date);
    });
});
