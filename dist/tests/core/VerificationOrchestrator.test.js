"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const VerificationOrchestrator_1 = require("../../core/application/orchestrator/VerificationOrchestrator");
// Helper to create mock services with vi.fn() for all methods
function createMockDiscordService() {
    return {
        validateHall: vitest_1.vi.fn(),
        normalizeRoom: vitest_1.vi.fn(),
        sendDM: vitest_1.vi.fn(),
        sendToQueue: vitest_1.vi.fn(),
        assignRoles: vitest_1.vi.fn(),
        removeRoles: vitest_1.vi.fn(),
        isRaForHall: vitest_1.vi.fn(),
    };
}
function createMockConfig() {
    return {
        currentTerm: vitest_1.vi.fn().mockReturnValue('2024-fall'),
        timeouts: vitest_1.vi.fn().mockReturnValue({
            awaitingRA_ttl_hours: 72,
            reminder_hours: [24, 48],
        }),
        limits: vitest_1.vi.fn().mockReturnValue({
            maxNotificationRetries: 5,
            notificationBackoffSeconds: [5, 15, 30],
            roleAssignMaxRetries: 3,
            roleAssignRetryBackoffSeconds: [5],
        }),
        messaging: vitest_1.vi.fn().mockReturnValue({
            dm: {
                ask_hall: 'Please enter your hall name: {{hall_list}}',
                ask_room: 'Please enter your room number for {{hall}}. Example: {{room_example}}',
                already_in_progress: 'You already have a verification in progress for {{term}}.',
                invalid_hall: 'Invalid hall "{{input}}". Available: {{hall_list}}',
                invalid_room: 'Invalid room format. Example: {{room_example}}',
                await_ra_notice: 'Your verification request for {{hall}} {{room}} is pending RA review.',
                approved: 'You have been verified for {{hall}} {{room}}.',
                denied: 'Your verification for {{hall}} {{room}} was denied. Reason: {{reason}}',
                system_error: 'A system error occurred. Please try again.',
                expired: 'Your verification request expired after {{ttl_hours}} hours. Use {{start_command}} to start again.',
            },
            ra_queue: {
                ra_verify_card_title: 'Verification Request',
                ra_verify_card_body: '{{user_tag}} requests verification for {{hall}} {{room}}',
                unauthorized_attempt: 'Unauthorized action by {{actor_tag}} on case {{case_id}}',
                decision_ack: '{{actor_tag}} {{decision}} case {{case_id}}',
            },
        }),
        halls: vitest_1.vi.fn().mockReturnValue([
            {
                name: 'North Hall',
                aliases: ['north', 'nh'],
                raRoleId: 'ra-role-north',
                queueChannelId: 'queue-channel-north',
                hallRoleId: 'hall-role-north',
                room: { pattern: '^N-\\d{3}$', example: 'N-101' },
            },
        ]),
        reload: vitest_1.vi.fn(),
    };
}
function createMockCaseRepository() {
    return {
        getActiveCase: vitest_1.vi.fn(),
        createIfNone: vitest_1.vi.fn(),
        updateState: vitest_1.vi.fn(),
        markExpired: vitest_1.vi.fn(),
        findById: vitest_1.vi.fn(),
        listAwaitingRA: vitest_1.vi.fn(),
        markReminderSent: vitest_1.vi.fn(),
        resetCase: vitest_1.vi.fn(),
    };
}
function createMockDecisionRepository() {
    return {
        recordDecision: vitest_1.vi.fn(),
    };
}
function createMockAuditRepository() {
    return {
        record: vitest_1.vi.fn(),
    };
}
function createMockOutboxRepository() {
    return {
        enqueueDM: vitest_1.vi.fn(),
        enqueueChannel: vitest_1.vi.fn(),
        takeDue: vitest_1.vi.fn(),
        markSent: vitest_1.vi.fn(),
        markFailed: vitest_1.vi.fn(),
        markPermanentlyFailed: vitest_1.vi.fn(),
    };
}
function createMockLogger() {
    return {
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
    };
}
// Helper to create a case record
function createCaseRecord(overrides = {}) {
    return {
        id: 'case-123',
        userId: 'user-456',
        term: '2024-fall',
        state: 'joined',
        version: 1,
        updatedAt: new Date(),
        ...overrides,
    };
}
(0, vitest_1.describe)('VerificationOrchestrator', () => {
    let orchestrator;
    let discord;
    let config;
    let cases;
    let decisions;
    let audit;
    let outbox;
    let logger;
    (0, vitest_1.beforeEach)(() => {
        discord = createMockDiscordService();
        config = createMockConfig();
        cases = createMockCaseRepository();
        decisions = createMockDecisionRepository();
        audit = createMockAuditRepository();
        outbox = createMockOutboxRepository();
        logger = createMockLogger();
        orchestrator = new VerificationOrchestrator_1.VerificationOrchestrator(discord, config, cases, decisions, audit, outbox, logger);
    });
    (0, vitest_1.describe)('onUserJoined', () => {
        (0, vitest_1.it)('creates a new case for a user without an existing case', async () => {
            const newCase = createCaseRecord({ id: 'new-case-1', state: 'joined' });
            cases.getActiveCase.mockResolvedValue(null);
            cases.createIfNone.mockResolvedValue(newCase);
            await orchestrator.onUserJoined('user-456', 'idem-key-1');
            (0, vitest_1.expect)(cases.getActiveCase).toHaveBeenCalledWith('user-456', '2024-fall');
            (0, vitest_1.expect)(cases.createIfNone).toHaveBeenCalledWith('user-456', '2024-fall', 'joined');
            (0, vitest_1.expect)(audit.record).toHaveBeenCalledWith('new-case-1', 'user_joined', undefined, 'joined', 'user', 'user-456', { term: '2024-fall' }, 'idem-key-1');
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('hall'), vitest_1.expect.objectContaining({ hall_list: 'North Hall' }), vitest_1.expect.objectContaining({ caseId: 'new-case-1' }));
        });
        (0, vitest_1.it)('notifies user if they already have an active case', async () => {
            const existingCase = createCaseRecord({ id: 'existing-case', state: 'hall_chosen' });
            cases.getActiveCase.mockResolvedValue(existingCase);
            await orchestrator.onUserJoined('user-456', 'idem-key-2');
            (0, vitest_1.expect)(cases.createIfNone).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('already'), { term: '2024-fall' }, vitest_1.expect.objectContaining({ caseId: 'existing-case' }));
        });
    });
    (0, vitest_1.describe)('onHallChosen', () => {
        (0, vitest_1.it)('transitions to hall_chosen state for valid hall', async () => {
            const kase = createCaseRecord({ state: 'joined' });
            const updatedCase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
            cases.getActiveCase.mockResolvedValue(kase);
            discord.validateHall.mockResolvedValue({
                valid: true,
                normalizedHall: 'North Hall',
                raRoleId: 'ra-role-north',
                queueChannelId: 'queue-channel-north',
                hallRoleId: 'hall-role-north',
            });
            cases.updateState.mockResolvedValue(updatedCase);
            await orchestrator.onHallChosen('user-456', 'north', 'idem-key-3');
            (0, vitest_1.expect)(discord.validateHall).toHaveBeenCalledWith('north');
            (0, vitest_1.expect)(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'hall_chosen', { hall: 'North Hall' });
            (0, vitest_1.expect)(audit.record).toHaveBeenCalledWith('case-123', 'hall_chosen', 'joined', 'hall_chosen', 'user', 'user-456', { hall: 'North Hall' }, 'idem-key-3');
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('room'), vitest_1.expect.objectContaining({ hall: 'North Hall' }), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('notifies user for invalid hall', async () => {
            const kase = createCaseRecord({ state: 'joined' });
            cases.getActiveCase.mockResolvedValue(kase);
            discord.validateHall.mockResolvedValue({ valid: false });
            await orchestrator.onHallChosen('user-456', 'invalid-hall', 'idem-key-4');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('Invalid'), vitest_1.expect.objectContaining({ input: 'invalid-hall' }), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('allows hall change if still in hall_chosen state', async () => {
            const kase = createCaseRecord({ state: 'hall_chosen', hall: 'Old Hall' });
            const updatedCase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
            cases.getActiveCase.mockResolvedValue(kase);
            discord.validateHall.mockResolvedValue({
                valid: true,
                normalizedHall: 'North Hall',
                raRoleId: 'ra-role-north',
                queueChannelId: 'queue-channel-north',
                hallRoleId: 'hall-role-north',
            });
            cases.updateState.mockResolvedValue(updatedCase);
            await orchestrator.onHallChosen('user-456', 'north', 'idem-key-5');
            (0, vitest_1.expect)(cases.updateState).toHaveBeenCalled();
        });
        (0, vitest_1.it)('rejects hall change if in awaiting_ra state', async () => {
            const kase = createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall' });
            cases.getActiveCase.mockResolvedValue(kase);
            await orchestrator.onHallChosen('user-456', 'south', 'idem-key-6');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('already'), vitest_1.expect.any(Object), vitest_1.expect.any(Object));
        });
    });
    (0, vitest_1.describe)('onRoomEntered', () => {
        (0, vitest_1.it)('transitions to awaiting_ra for valid room', async () => {
            const kase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
            const updatedCase = createCaseRecord({
                state: 'awaiting_ra',
                hall: 'North Hall',
                room: 'N-101',
            });
            cases.getActiveCase.mockResolvedValue(kase);
            discord.normalizeRoom.mockResolvedValue({ valid: true, room: 'N-101' });
            discord.validateHall.mockResolvedValue({
                valid: true,
                normalizedHall: 'North Hall',
                queueChannelId: 'queue-channel-north',
            });
            cases.updateState.mockResolvedValue(updatedCase);
            await orchestrator.onRoomEntered('user-456', 'n-101', 'idem-key-7');
            (0, vitest_1.expect)(discord.normalizeRoom).toHaveBeenCalledWith('North Hall', 'n-101');
            (0, vitest_1.expect)(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'awaiting_ra', vitest_1.expect.objectContaining({ room: 'N-101', expiresAt: vitest_1.expect.any(Date) }));
            (0, vitest_1.expect)(audit.record).toHaveBeenCalledWith('case-123', 'room_entered', 'hall_chosen', 'awaiting_ra', 'user', 'user-456', { room: 'N-101' }, 'idem-key-7');
        });
        (0, vitest_1.it)('notifies user for invalid room format', async () => {
            const kase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
            cases.getActiveCase.mockResolvedValue(kase);
            discord.normalizeRoom.mockResolvedValue({
                valid: false,
                errors: ['Invalid format'],
            });
            await orchestrator.onRoomEntered('user-456', 'bad-room', 'idem-key-8');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('Invalid'), vitest_1.expect.objectContaining({ room_example: 'N-101' }), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('rejects room entry if not in hall_chosen state', async () => {
            const kase = createCaseRecord({ state: 'joined' });
            cases.getActiveCase.mockResolvedValue(kase);
            await orchestrator.onRoomEntered('user-456', 'N-101', 'idem-key-9');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('already'), vitest_1.expect.any(Object), vitest_1.expect.any(Object));
        });
    });
    (0, vitest_1.describe)('onRAResponded', () => {
        (0, vitest_1.it)('approves case when authorized RA approves', async () => {
            const kase = createCaseRecord({
                state: 'awaiting_ra',
                hall: 'North Hall',
                room: 'N-101',
            });
            const approvedCase = createCaseRecord({
                ...kase,
                state: 'approved',
                raUserId: 'ra-789',
            });
            cases.findById.mockResolvedValue(kase);
            discord.isRaForHall.mockResolvedValue(true);
            discord.validateHall.mockResolvedValue({
                valid: true,
                hallRoleId: 'hall-role-north',
                queueChannelId: 'queue-channel-north',
            });
            discord.assignRoles.mockResolvedValue({ status: 'success' });
            cases.updateState.mockResolvedValue(approvedCase);
            await orchestrator.onRAResponded('case-123', 'ra-789', 'approve', undefined, 'idem-key-10');
            (0, vitest_1.expect)(discord.isRaForHall).toHaveBeenCalledWith('ra-789', 'North Hall');
            (0, vitest_1.expect)(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'approved', {});
            (0, vitest_1.expect)(decisions.recordDecision).toHaveBeenCalledWith('case-123', 'ra-789', 'approve', undefined, 'idem-key-10');
            (0, vitest_1.expect)(discord.assignRoles).toHaveBeenCalledWith('user-456', ['hall-role-north'], 'idem-key-10');
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('verified'), vitest_1.expect.objectContaining({ hall: 'North Hall', room: 'N-101' }), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('denies case when authorized RA denies', async () => {
            const kase = createCaseRecord({
                state: 'awaiting_ra',
                hall: 'North Hall',
                room: 'N-101',
            });
            const deniedCase = createCaseRecord({ ...kase, state: 'denied' });
            cases.findById.mockResolvedValue(kase);
            discord.isRaForHall.mockResolvedValue(true);
            discord.validateHall.mockResolvedValue({
                valid: true,
                queueChannelId: 'queue-channel-north',
            });
            cases.updateState.mockResolvedValue(deniedCase);
            await orchestrator.onRAResponded('case-123', 'ra-789', 'deny', 'Room does not exist', 'idem-key-11');
            (0, vitest_1.expect)(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'denied', {});
            (0, vitest_1.expect)(decisions.recordDecision).toHaveBeenCalledWith('case-123', 'ra-789', 'deny', 'Room does not exist', 'idem-key-11');
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('denied'), vitest_1.expect.objectContaining({ reason: 'Room does not exist' }), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('rejects self-verification (RA cannot verify themselves)', async () => {
            const kase = createCaseRecord({
                userId: 'ra-789', // RA is the same as user
                state: 'awaiting_ra',
                hall: 'North Hall',
            });
            cases.findById.mockResolvedValue(kase);
            discord.validateHall.mockResolvedValue({
                valid: true,
                queueChannelId: 'queue-channel-north',
            });
            await orchestrator.onRAResponded('case-123', 'ra-789', 'approve', undefined, 'idem-key-12');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(decisions.recordDecision).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueChannel).toHaveBeenCalledWith('queue-channel-north', vitest_1.expect.stringContaining('Unauthorized'), vitest_1.expect.any(Object), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('rejects unauthorized RA (wrong hall role)', async () => {
            const kase = createCaseRecord({
                state: 'awaiting_ra',
                hall: 'North Hall',
            });
            cases.findById.mockResolvedValue(kase);
            discord.isRaForHall.mockResolvedValue(false); // RA not authorized
            discord.validateHall.mockResolvedValue({
                valid: true,
                queueChannelId: 'queue-channel-north',
            });
            await orchestrator.onRAResponded('case-123', 'wrong-ra', 'approve', undefined, 'idem-key-13');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(decisions.recordDecision).not.toHaveBeenCalled();
            (0, vitest_1.expect)(outbox.enqueueChannel).toHaveBeenCalled();
        });
        (0, vitest_1.it)('ignores response if case is not in awaiting_ra state', async () => {
            const kase = createCaseRecord({ state: 'approved' });
            cases.findById.mockResolvedValue(kase);
            await orchestrator.onRAResponded('case-123', 'ra-789', 'approve', undefined, 'idem-key-14');
            (0, vitest_1.expect)(discord.isRaForHall).not.toHaveBeenCalled();
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('expire', () => {
        (0, vitest_1.it)('transitions case to expired state and notifies user', async () => {
            const kase = createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall' });
            const expiredCase = createCaseRecord({ ...kase, state: 'expired' });
            cases.findById.mockResolvedValue(kase);
            cases.updateState.mockResolvedValue(expiredCase);
            await orchestrator.expire('case-123', 'idem-key-15');
            (0, vitest_1.expect)(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'expired', {});
            (0, vitest_1.expect)(audit.record).toHaveBeenCalledWith('case-123', 'case_expired', 'awaiting_ra', 'expired', 'system', undefined, {}, 'idem-key-15');
            (0, vitest_1.expect)(outbox.enqueueDM).toHaveBeenCalledWith('user-456', vitest_1.expect.stringContaining('expired'), vitest_1.expect.objectContaining({ ttl_hours: 72 }), vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)('ignores expiration if case is not in awaiting_ra state', async () => {
            const kase = createCaseRecord({ state: 'approved' });
            cases.findById.mockResolvedValue(kase);
            await orchestrator.expire('case-123', 'idem-key-16');
            (0, vitest_1.expect)(cases.updateState).not.toHaveBeenCalled();
            (0, vitest_1.expect)(audit.record).not.toHaveBeenCalled();
        });
    });
});
