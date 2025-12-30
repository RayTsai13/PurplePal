"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const TimeoutWorker_1 = require("../../adapters/scheduler/TimeoutWorker");
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
(0, vitest_1.describe)('TimeoutWorker', () => {
    let cases;
    let policy;
    let orchestrator;
    let outbox;
    (0, vitest_1.beforeEach)(() => {
        cases = createCasesMock();
        policy = createPolicyMock();
        orchestrator = { expire: vitest_1.vi.fn() };
        outbox = { enqueueDM: vitest_1.vi.fn() };
    });
    (0, vitest_1.it)('expires cases past TTL', async () => {
        const expiredCase = buildCase({
            id: 'expired',
            expiresAt: new Date(Date.now() - 60000),
        });
        cases.listAwaitingRA.mockResolvedValue([expiredCase]);
        await (0, TimeoutWorker_1.processTimeouts)(cases, policy, orchestrator, outbox);
        (0, vitest_1.expect)(orchestrator.expire).toHaveBeenCalledWith('expired', vitest_1.expect.any(String));
        (0, vitest_1.expect)(outbox.enqueueDM).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('sends reminders when threshold reached and marks reminder sent', async () => {
        const reminderCase = buildCase({
            id: 'reminder',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        });
        cases.listAwaitingRA.mockResolvedValue([reminderCase]);
        await (0, TimeoutWorker_1.processTimeouts)(cases, policy, orchestrator, outbox);
        (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-1', 'Reminder {{hall}} {{room}}', { hall: 'Summit', room: 'S-101-A' }, { caseId: 'reminder', idempotencyKey: 'reminder-reminder' });
        (0, vitest_1.expect)(cases.markReminderSent).toHaveBeenCalledWith('reminder', vitest_1.expect.any(Date));
    });
});
const buildCase = (override) => ({
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
    listAwaitingRA: vitest_1.vi.fn().mockResolvedValue([]),
    markReminderSent: vitest_1.vi.fn(),
});
const createPolicyMock = () => ({
    currentTerm: vitest_1.vi.fn().mockReturnValue('2024-fall'),
    timeouts: vitest_1.vi.fn().mockReturnValue(baseTimeouts),
    messaging: vitest_1.vi.fn().mockReturnValue(baseTemplates),
    limits: vitest_1.vi.fn().mockReturnValue({}),
    halls: vitest_1.vi.fn().mockReturnValue([]),
});
