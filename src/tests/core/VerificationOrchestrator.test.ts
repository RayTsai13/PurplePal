import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';
import { ConcurrencyError } from '../../core/errors';
import type {
  DiscordService,
  Config,
  CaseRepository,
  DecisionRepository,
  AuditRepository,
  OutboxRepository,
  Logger,
  CaseRecord,
  HallConfig,
  UnitOfWork,
} from '../../core/ports';

// Mock types with Vitest mock methods
type Mocked<T> = { [K in keyof T]: Mock };

const HALLS: HallConfig[] = [
  {
    name: 'North Hall',
    aliases: ['north', 'nh'],
    raRoleId: 'ra-role-north',
    queueChannelId: 'queue-channel-north',
    hallRoleId: 'hall-role-north',
    room: {
      pattern: '^N-\\d{3}-[A-D]$',
      example: 'N-101-A',
      prefix: 'N',
      roomNumberPattern: '^\\d{3}$',
      roomNumberExample: '101',
      unitPattern: '^[A-D]$',
      unitExample: 'A',
    },
  },
];

function createMockDiscordService(): Mocked<DiscordService> {
  return {
    normalizeRoom: vi.fn(),
    sendDM: vi.fn(),
    sendToQueue: vi.fn(),
    assignRoles: vi.fn(),
    removeRoles: vi.fn(),
    isRaForHall: vi.fn(),
  };
}

function createMockConfig(): Mocked<Config> {
  return {
    currentTerm: vi.fn().mockReturnValue('2024-fall'),
    timeouts: vi.fn().mockReturnValue({ awaitingRA_ttl_hours: 72, reminder_hours: [24, 48] }),
    limits: vi.fn().mockReturnValue({
      maxNotificationRetries: 5,
      notificationBackoffSeconds: [5, 15, 30],
      roleAssignMaxRetries: 3,
      roleAssignRetryBackoffSeconds: [5],
    }),
    messaging: vi.fn().mockReturnValue({
      dm: {
        welcome_joined: 'Welcome! Chat in <#{{lobby_channel_id}}> while you verify. Hall: {{hall_list}}',
        ask_hall: 'Please enter your hall name: {{hall_list}}',
        ask_room_number: 'What is your room number? (e.g., {{example}})',
        invalid_room_number: 'Invalid room number. Expected {{example}}.',
        ask_unit: 'What is your unit? (e.g., {{example}})',
        invalid_unit: 'Invalid unit. Expected {{example}}.',
        already_in_progress: 'You already have a verification in progress for {{term}}.',
        already_verified: 'You are already verified for {{hall}}.',
        invalid_hall: 'Invalid hall "{{input}}". Available: {{hall_list}}',
        invalid_room: 'Invalid room format. Example: {{room_example}}',
        await_ra_notice: 'Your verification request for {{hall}} {{room}} is pending RA review.',
        reminder_user: 'Still pending: {{hall}} {{room}}',
        approved: 'You have been verified for {{hall}} {{room}}.',
        denied: 'Your verification for {{hall}} {{room}} was denied. Reason: {{reason}}',
        system_error: 'A system error occurred. Please try again.',
        expired: 'Your verification request expired after {{ttl_hours}} hours. Use {{start_command}} to start again.',
      },
      ra_queue: {
        ra_verify_card_title: 'Verification Request',
        ra_verify_card_body: '{{user_tag}} requests verification for {{hall}} {{room}}',
        ra_reminder: 'Reminder: {{user_tag}} {{hall}} {{room}}',
        unauthorized_attempt: 'Unauthorized action by {{actor_tag}} on case {{case_id}}',
        decision_ack: '{{actor_tag}} {{decision}} case {{case_id}}',
      },
    }),
    halls: vi.fn().mockReturnValue(HALLS),
    hall: vi.fn((input: string) => {
      const key = input.trim().toLowerCase();
      return HALLS.find((h) => h.name.toLowerCase() === key || h.aliases.includes(key));
    }),
    lobbyChannelId: vi.fn().mockReturnValue('lobby-channel-123'),
    unverifiedRoleId: vi.fn().mockReturnValue('unverified-role-456'),
    reload: vi.fn(),
  };
}

function createMockCaseRepository(): Mocked<CaseRepository> {
  return {
    getActiveCase: vi.fn().mockResolvedValue(null),
    getApprovedCase: vi.fn().mockResolvedValue(null),
    listOpenCases: vi.fn().mockResolvedValue([]),
    createIfNone: vi.fn(),
    updateState: vi.fn(),
    findById: vi.fn(),
    listAwaitingRA: vi.fn(),
    markReminderSent: vi.fn(),
  };
}

function createMockOutboxRepository(): Mocked<OutboxRepository> {
  return {
    enqueueDM: vi.fn(),
    enqueueChannel: vi.fn(),
    enqueueRoleChange: vi.fn(),
    takeDue: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    markPermanentlyFailed: vi.fn(),
  };
}

// Helper to create a case record
function createCaseRecord(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'case-123',
    userId: 'user-456',
    term: '2024-fall',
    state: 'joined',
    version: 1,
    remindersSent: 0,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('VerificationOrchestrator', () => {
  let orchestrator: VerificationOrchestrator;
  let discord: Mocked<DiscordService>;
  let config: Mocked<Config>;
  let cases: Mocked<CaseRepository>;
  let decisions: Mocked<DecisionRepository>;
  let audit: Mocked<AuditRepository>;
  let outbox: Mocked<OutboxRepository>;
  let uow: { run: Mock };
  let logger: Mocked<Logger>;

  beforeEach(() => {
    discord = createMockDiscordService();
    config = createMockConfig();
    cases = createMockCaseRepository();
    decisions = { recordDecision: vi.fn() };
    audit = { record: vi.fn() };
    outbox = createMockOutboxRepository();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // Transactions hand the work the same mocks, so assertions see every write
    uow = { run: vi.fn((work) => work({ cases, decisions, audit, outbox })) };

    orchestrator = new VerificationOrchestrator({
      discord: discord as unknown as DiscordService,
      config: config as unknown as Config,
      cases: cases as unknown as CaseRepository,
      uow: uow as unknown as UnitOfWork,
      logger: logger as unknown as Logger,
      moderatorIds: ['mod-1'],
    });
  });

  describe('onUserJoined', () => {
    it('creates a new case for a user without an existing case', async () => {
      const newCase = createCaseRecord({ id: 'new-case-1', state: 'joined' });
      cases.createIfNone.mockResolvedValue(newCase);

      await orchestrator.onUserJoined('user-456', 'idem-key-1');

      expect(cases.createIfNone).toHaveBeenCalledWith('user-456', '2024-fall', 'joined');
      expect(audit.record).toHaveBeenCalledWith(
        'new-case-1',
        'user_joined',
        undefined,
        'joined',
        'user',
        'user-456',
        { term: '2024-fall' },
        'idem-key-1',
      );
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('Welcome'),
        expect.objectContaining({ hall_list: 'North Hall', lobby_channel_id: 'lobby-channel-123' }),
        expect.objectContaining({ caseId: 'new-case-1' }),
      );
      // /verify by an existing member doesn't touch roles
      expect(outbox.enqueueRoleChange).not.toHaveBeenCalled();
    });

    it('notifies user if they already have an active case', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ id: 'existing-case', state: 'hall_chosen' }));

      await orchestrator.onUserJoined('user-456', 'idem-key-2');

      expect(cases.createIfNone).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already'),
        { term: '2024-fall' },
        expect.objectContaining({ caseId: 'existing-case' }),
      );
    });

    it('refuses to start a new case for a user already approved this term', async () => {
      cases.getApprovedCase.mockResolvedValue(
        createCaseRecord({ id: 'approved-case', state: 'approved', hall: 'North Hall', room: 'N-101-A' }),
      );

      await orchestrator.onUserJoined('user-456', 'idem-key-3');

      expect(cases.createIfNone).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already verified'),
        expect.objectContaining({ hall: 'North Hall' }),
        expect.objectContaining({ caseId: 'approved-case' }),
      );
      expect(outbox.enqueueRoleChange).not.toHaveBeenCalled();
    });

    it('retries once when a concurrent request created the case first', async () => {
      cases.getActiveCase
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createCaseRecord({ id: 'raced-case' }));
      cases.createIfNone.mockRejectedValueOnce(new ConcurrencyError('duplicate'));

      await orchestrator.onUserJoined('user-456', 'idem-key-4');

      expect(uow.run).toHaveBeenCalledTimes(2);
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already'),
        { term: '2024-fall' },
        expect.objectContaining({ caseId: 'raced-case' }),
      );
    });
  });

  describe('onMemberJoined', () => {
    it('assigns the unverified role in the same transaction that creates the case', async () => {
      cases.createIfNone.mockResolvedValue(createCaseRecord({ id: 'new-case' }));

      await orchestrator.onMemberJoined('user-456', 'join-1');

      expect(uow.run).toHaveBeenCalledTimes(1);
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'add', ['unverified-role-456'], {
        caseId: 'new-case',
        idempotencyKey: 'join-1-unverified-role',
      });
    });

    it('restores the hall role for a verified member who rejoins', async () => {
      cases.getApprovedCase.mockResolvedValue(
        createCaseRecord({ id: 'approved-case', state: 'approved', hall: 'North Hall' }),
      );

      await orchestrator.onMemberJoined('user-456', 'join-2');

      expect(cases.createIfNone).not.toHaveBeenCalled();
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'add', ['hall-role-north'], {
        caseId: 'approved-case',
        idempotencyKey: 'join-2-restore-hall-role',
      });
    });
  });

  describe('onDirectMessage', () => {
    it('reports no_case when the user has no active case', async () => {
      await expect(orchestrator.onDirectMessage('user-456', 'north', 'msg-1')).resolves.toEqual({
        handled: false,
        reason: 'no_case',
      });
    });

    it('treats a hall name in hall_chosen state as a hall correction', async () => {
      const kase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
      cases.getActiveCase.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue({ ...kase, version: 2 });

      await orchestrator.onDirectMessage('user-456', 'nh', 'msg-2');

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'hall_chosen', { hall: 'North Hall' });
    });

    it('treats other text in hall_chosen state as the room number', async () => {
      const kase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
      cases.getActiveCase.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue({ ...kase, state: 'room_number_entered' });

      await orchestrator.onDirectMessage('user-456', '312', 'msg-3');

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'room_number_entered', { roomNumber: '312' });
    });

    it('reports awaiting_ra once the case is with an RA', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'awaiting_ra' }));

      await expect(orchestrator.onDirectMessage('user-456', 'hello', 'msg-4')).resolves.toEqual({
        handled: false,
        reason: 'awaiting_ra',
      });
    });
  });

  describe('onHallChosen', () => {
    it('transitions to hall_chosen state for valid hall', async () => {
      const kase = createCaseRecord({ state: 'joined' });
      cases.getActiveCase.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue(createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' }));

      await orchestrator.onHallChosen('user-456', 'north', 'idem-key-3');

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'hall_chosen', { hall: 'North Hall' });
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'hall_chosen',
        'joined',
        'hall_chosen',
        'user',
        'user-456',
        { hall: 'North Hall' },
        'idem-key-3',
      );
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('room'),
        { hall: 'North Hall', example: '101' },
        expect.any(Object),
      );
    });

    it('notifies user for invalid hall', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'joined' }));

      await orchestrator.onHallChosen('user-456', 'invalid-hall', 'idem-key-4');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('Invalid'),
        expect.objectContaining({ input: 'invalid-hall' }),
        expect.any(Object),
      );
    });

    it('rejects hall change if in awaiting_ra state', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall' }));

      await orchestrator.onHallChosen('user-456', 'north', 'idem-key-6');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already'),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('onRoomNumberEntered', () => {
    it('stores a room number matching the hall pattern and asks for the unit', async () => {
      const kase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
      cases.getActiveCase.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue({ ...kase, state: 'room_number_entered', roomNumber: '312' });

      await orchestrator.onRoomNumberEntered('user-456', ' 312 ', 'idem-key-10');

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'room_number_entered', { roomNumber: '312' });
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('unit'),
        { room_number: '312', example: 'A' },
        expect.any(Object),
      );
    });

    it('rejects a room number that does not match the hall pattern', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' }));

      await orchestrator.onRoomNumberEntered('user-456', '12', 'idem-key-11');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('Invalid room number'),
        { example: '101' },
        expect.any(Object),
      );
    });

    it('sends a system error when the hall is no longer configured', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'hall_chosen', hall: 'Removed Hall' }));

      await orchestrator.onRoomNumberEntered('user-456', '312', 'idem-key-12');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('system error'),
        {},
        expect.any(Object),
      );
    });
  });

  describe('onRoomEntered', () => {
    it('transitions to awaiting_ra and notifies the RA queue in one transaction', async () => {
      const kase = createCaseRecord({ state: 'room_number_entered', hall: 'North Hall', roomNumber: '101' });
      cases.getActiveCase.mockResolvedValue(kase);
      discord.normalizeRoom.mockResolvedValue({ valid: true, room: 'N-101-A' });
      cases.updateState.mockResolvedValue({ ...kase, state: 'awaiting_ra', room: 'N-101-A' });

      await orchestrator.onRoomEntered('user-456', 'a', 'idem-key-7');

      expect(discord.normalizeRoom).toHaveBeenCalledWith('North Hall', 'N-101-A');
      expect(cases.updateState).toHaveBeenCalledWith(
        'case-123',
        1,
        'awaiting_ra',
        expect.objectContaining({ room: 'N-101-A', expiresAt: expect.any(Date), submittedAt: expect.any(Date) }),
      );
      expect(outbox.enqueueChannel).toHaveBeenCalledWith(
        'queue-channel-north',
        expect.stringContaining('Case ID: case-123'),
        expect.objectContaining({ case_id: 'case-123', user_tag: 'user-456' }),
        { caseId: 'case-123', idempotencyKey: 'idem-key-7-queue-case-123' },
      );
      expect(audit.record).toHaveBeenCalledWith('case-123', 'ra_queue_notified', undefined, undefined, 'system', undefined, {
        caseId: 'case-123',
        channelId: 'queue-channel-north',
      });
      expect(uow.run).toHaveBeenCalledTimes(1);
    });

    it('notifies user for invalid unit', async () => {
      cases.getActiveCase.mockResolvedValue(
        createCaseRecord({ state: 'room_number_entered', hall: 'North Hall', roomNumber: '101' }),
      );

      await orchestrator.onRoomEntered('user-456', 'Z', 'idem-key-8');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('Invalid'),
        { example: 'A' },
        expect.any(Object),
      );
    });

    it('rejects room entry if not in room_number_entered state', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'joined' }));

      await orchestrator.onRoomEntered('user-456', 'A', 'idem-key-9');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already'),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('onRAResponded', () => {
    const pending = () => createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall', room: 'N-101-A' });

    beforeEach(() => {
      cases.findById.mockResolvedValue(pending());
      cases.updateState.mockImplementation(async (_id, _v, state, patch) => ({ ...pending(), ...patch, state }));
    });

    it('approves: grants the hall role (approved DM follows it) and removes the unverified role', async () => {
      discord.isRaForHall.mockResolvedValue(true);

      const result = await orchestrator.onRAResponded('case-123', 'ra-789', 'approve', undefined, 'key-1');

      expect(result).toEqual({ ok: true, state: 'approved' });
      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'approved', { raUserId: 'ra-789' });
      expect(decisions.recordDecision).toHaveBeenCalledWith('case-123', 'ra-789', 'approve', undefined, 'key-1');
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'ra_approve',
        'awaiting_ra',
        'approved',
        'ra',
        'ra-789',
        { reason: undefined },
        'key-1',
      );
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'add', ['hall-role-north'], {
        caseId: 'case-123',
        idempotencyKey: 'key-1-hall-role',
        followUp: {
          userId: 'user-456',
          template: expect.stringContaining('verified'),
          data: { hall: 'North Hall', room: 'N-101-A' },
        },
      });
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'remove', ['unverified-role-456'], {
        caseId: 'case-123',
        idempotencyKey: 'key-1-unverified-role',
      });
      // The approved DM is only sent as the role job's follow-up
      expect(outbox.enqueueDM).not.toHaveBeenCalled();
      expect(outbox.enqueueChannel).toHaveBeenCalledWith(
        'queue-channel-north',
        expect.any(String),
        expect.objectContaining({ decision: 'approve' }),
        expect.any(Object),
      );
    });

    it('denies: sends the denial DM with the reason', async () => {
      discord.isRaForHall.mockResolvedValue(true);

      const result = await orchestrator.onRAResponded('case-123', 'ra-789', 'deny', 'Wrong hall', 'key-2');

      expect(result).toEqual({ ok: true, state: 'denied' });
      expect(outbox.enqueueRoleChange).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('denied'),
        expect.objectContaining({ reason: 'Wrong hall' }),
        expect.any(Object),
      );
    });

    it('lets a moderator decide without the hall RA role', async () => {
      const result = await orchestrator.onRAResponded('case-123', 'mod-1', 'approve', undefined, 'key-3');

      expect(result).toEqual({ ok: true, state: 'approved' });
      expect(discord.isRaForHall).not.toHaveBeenCalled();
    });

    it('rejects self-verification, even by a moderator', async () => {
      cases.findById.mockResolvedValue({ ...pending(), userId: 'mod-1' });

      const result = await orchestrator.onRAResponded('case-123', 'mod-1', 'approve', undefined, 'key-4');

      expect(result).toEqual({ ok: false, reason: 'unauthorized' });
      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueChannel).toHaveBeenCalledWith(
        'queue-channel-north',
        expect.stringContaining('Unauthorized'),
        expect.objectContaining({ actor_tag: 'mod-1' }),
        expect.any(Object),
      );
    });

    it('rejects a user without the hall RA role', async () => {
      discord.isRaForHall.mockResolvedValue(false);

      const result = await orchestrator.onRAResponded('case-123', 'random-user', 'approve', undefined, 'key-5');

      expect(result).toEqual({ ok: false, reason: 'unauthorized' });
      expect(cases.updateState).not.toHaveBeenCalled();
      expect(decisions.recordDecision).not.toHaveBeenCalled();
    });

    it('returns not_pending if the case is no longer awaiting RA', async () => {
      cases.findById.mockResolvedValue(createCaseRecord({ state: 'approved' }));

      const result = await orchestrator.onRAResponded('case-123', 'ra-789', 'approve');

      expect(result).toEqual({ ok: false, reason: 'not_pending' });
      expect(cases.updateState).not.toHaveBeenCalled();
    });

    it('returns not_found for an unknown case', async () => {
      cases.findById.mockResolvedValue(null);

      await expect(orchestrator.onRAResponded('nope', 'ra-789', 'approve')).resolves.toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('returns conflict when another decision wins the race', async () => {
      discord.isRaForHall.mockResolvedValue(true);
      cases.updateState.mockRejectedValue(new ConcurrencyError('version mismatch'));

      const result = await orchestrator.onRAResponded('case-123', 'ra-789', 'approve', undefined, 'key-6');

      expect(result).toEqual({ ok: false, reason: 'conflict' });
    });

    it('lets the admin CLI decide without authorization checks', async () => {
      const result = await orchestrator.onRAResponded('case-123', 'cli-admin', 'approve', 'override', 'key-7', {
        asAdmin: true,
      });

      expect(result).toEqual({ ok: true, state: 'approved' });
      expect(discord.isRaForHall).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'admin_approve',
        'awaiting_ra',
        'approved',
        'system',
        'cli-admin',
        { reason: 'override' },
        'key-7',
      );
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'add', ['hall-role-north'], expect.any(Object));
    });
  });

  describe('expire', () => {
    it('transitions case to expired state and notifies user', async () => {
      const kase = createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall' });
      cases.findById.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue({ ...kase, state: 'expired' });

      await expect(orchestrator.expire('case-123', 'expire-key')).resolves.toBe(true);

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'expired', {});
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'case_expired',
        'awaiting_ra',
        'expired',
        'system',
        undefined,
        {},
        'expire-key',
      );
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('expired'),
        { ttl_hours: 72, start_command: '/verify' },
        expect.any(Object),
      );
    });

    it('ignores expiration if case is not in awaiting_ra state', async () => {
      cases.findById.mockResolvedValue(createCaseRecord({ state: 'joined' }));

      await expect(orchestrator.expire('case-123', 'expire-key')).resolves.toBe(false);
      expect(cases.updateState).not.toHaveBeenCalled();
    });

    it('lets an admin expire a case in any active state', async () => {
      const kase = createCaseRecord({ state: 'joined' });
      cases.findById.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue({ ...kase, state: 'expired' });

      await expect(
        orchestrator.expire('case-123', 'k', { admin: { actorId: 'cli-admin', reason: 'stale' } }),
      ).resolves.toBe(true);
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'admin_force_expire',
        'joined',
        'expired',
        'system',
        'cli-admin',
        { reason: 'stale' },
        'k',
      );
    });

    it('returns false when the case changed concurrently', async () => {
      cases.findById.mockResolvedValue(createCaseRecord({ state: 'awaiting_ra' }));
      cases.updateState.mockRejectedValue(new ConcurrencyError('version mismatch'));

      await expect(orchestrator.expire('case-123', 'k')).resolves.toBe(false);
    });
  });

  describe('sendReminder', () => {
    it('reminds the user and the RA queue, then records the reminder count', async () => {
      const kase = createCaseRecord({ userId: '123456789012345678', state: 'awaiting_ra', hall: 'North Hall', room: 'N-101-A' });

      await orchestrator.sendReminder(kase, 2);

      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        '123456789012345678',
        expect.any(String),
        { hall: 'North Hall', room: 'N-101-A' },
        { caseId: 'case-123', idempotencyKey: 'reminder-case-123-2' },
      );
      expect(outbox.enqueueChannel).toHaveBeenCalledWith(
        'queue-channel-north',
        expect.stringContaining('Case ID: case-123'),
        // Real Discord IDs render as mentions
        expect.objectContaining({ user_tag: '<@123456789012345678>' }),
        { caseId: 'case-123', idempotencyKey: 'reminder-ra-case-123-2' },
      );
      expect(cases.markReminderSent).toHaveBeenCalledWith('case-123', 2, expect.any(Date));
    });
  });

  describe('onUserReset', () => {
    it('cancels an in-progress case', async () => {
      const kase = createCaseRecord({ state: 'hall_chosen' });
      cases.getActiveCase.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue({ ...kase, state: 'cancelled' });

      await expect(orchestrator.onUserReset('user-456', 'reset-1')).resolves.toEqual({ ok: true });
      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'cancelled', {});
    });

    it('refuses once the case is awaiting RA review', async () => {
      cases.getActiveCase.mockResolvedValue(createCaseRecord({ state: 'awaiting_ra' }));

      await expect(orchestrator.onUserReset('user-456', 'reset-2')).resolves.toEqual({
        ok: false,
        reason: 'pending_review',
      });
      expect(cases.updateState).not.toHaveBeenCalled();
    });

    it('reports no_case when there is nothing to reset', async () => {
      await expect(orchestrator.onUserReset('user-456', 'reset-3')).resolves.toEqual({ ok: false, reason: 'no_case' });
    });
  });

  describe('adminResetUser', () => {
    it('cancels an approved case and revokes the hall role', async () => {
      const kase = createCaseRecord({ id: 'approved-case', state: 'approved', hall: 'North Hall', version: 4 });
      cases.listOpenCases.mockResolvedValue([kase]);
      cases.updateState.mockResolvedValue({ ...kase, state: 'cancelled' });

      await expect(orchestrator.adminResetUser('user-456', '2024-fall', 'cli-admin')).resolves.toBe(1);

      expect(cases.updateState).toHaveBeenCalledWith('approved-case', 4, 'cancelled', {});
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'remove', ['hall-role-north'], expect.any(Object));
      expect(outbox.enqueueRoleChange).toHaveBeenCalledWith('user-456', 'add', ['unverified-role-456'], expect.any(Object));
    });
  });
});
