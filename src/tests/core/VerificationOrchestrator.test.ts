import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';
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
} from '../../core/ports';

// Mock types with Vitest mock methods
type MockedDiscordService = {
  [K in keyof DiscordService]: Mock;
};

type MockedConfig = {
  [K in keyof Config]: Mock;
};

type MockedCaseRepository = {
  [K in keyof CaseRepository]: Mock;
};

type MockedDecisionRepository = {
  [K in keyof DecisionRepository]: Mock;
};

type MockedAuditRepository = {
  [K in keyof AuditRepository]: Mock;
};

type MockedOutboxRepository = {
  [K in keyof OutboxRepository]: Mock;
};

type MockedLogger = {
  [K in keyof Logger]: Mock;
};

// Helper to create mock services with vi.fn() for all methods
function createMockDiscordService(): MockedDiscordService {
  return {
    validateHall: vi.fn(),
    normalizeRoom: vi.fn(),
    sendDM: vi.fn(),
    sendToQueue: vi.fn(),
    assignRoles: vi.fn(),
    removeRoles: vi.fn(),
    isRaForHall: vi.fn(),
  };
}

function createMockConfig(): MockedConfig {
  return {
    currentTerm: vi.fn().mockReturnValue('2024-fall'),
    timeouts: vi.fn().mockReturnValue({
      awaitingRA_ttl_hours: 72,
      reminder_hours: [24, 48],
    }),
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
    halls: vi.fn().mockReturnValue([
      {
        name: 'North Hall',
        aliases: ['north', 'nh'],
        raRoleId: 'ra-role-north',
        queueChannelId: 'queue-channel-north',
        hallRoleId: 'hall-role-north',
        room: { pattern: '^N-\\d{3}$', example: 'N-101' },
      },
    ] as HallConfig[]),
    lobbyChannelId: vi.fn().mockReturnValue('lobby-channel-123'),
    unverifiedRoleId: vi.fn().mockReturnValue('unverified-role-456'),
    reload: vi.fn(),
  };
}

function createMockCaseRepository(): MockedCaseRepository {
  return {
    getActiveCase: vi.fn(),
    createIfNone: vi.fn(),
    updateState: vi.fn(),
    markExpired: vi.fn(),
    findById: vi.fn(),
    listAwaitingRA: vi.fn(),
    markReminderSent: vi.fn(),
    resetCase: vi.fn(),
  };
}

function createMockDecisionRepository(): MockedDecisionRepository {
  return {
    recordDecision: vi.fn(),
  };
}

function createMockAuditRepository(): MockedAuditRepository {
  return {
    record: vi.fn(),
  };
}

function createMockOutboxRepository(): MockedOutboxRepository {
  return {
    enqueueDM: vi.fn(),
    enqueueChannel: vi.fn(),
    takeDue: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    markPermanentlyFailed: vi.fn(),
  };
}

function createMockLogger(): MockedLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('VerificationOrchestrator', () => {
  let orchestrator: VerificationOrchestrator;
  let discord: MockedDiscordService;
  let config: MockedConfig;
  let cases: MockedCaseRepository;
  let decisions: MockedDecisionRepository;
  let audit: MockedAuditRepository;
  let outbox: MockedOutboxRepository;
  let logger: MockedLogger;

  beforeEach(() => {
    discord = createMockDiscordService();
    config = createMockConfig();
    cases = createMockCaseRepository();
    decisions = createMockDecisionRepository();
    audit = createMockAuditRepository();
    outbox = createMockOutboxRepository();
    logger = createMockLogger();

    orchestrator = new VerificationOrchestrator(
      discord as unknown as DiscordService,
      config as unknown as Config,
      cases as unknown as CaseRepository,
      decisions as unknown as DecisionRepository,
      audit as unknown as AuditRepository,
      outbox as unknown as OutboxRepository,
      logger as unknown as Logger,
    );
  });

  describe('onUserJoined', () => {
    it('creates a new case for a user without an existing case', async () => {
      const newCase = createCaseRecord({ id: 'new-case-1', state: 'joined' });
      cases.getActiveCase.mockResolvedValue(null);
      cases.createIfNone.mockResolvedValue(newCase);

      await orchestrator.onUserJoined('user-456', 'idem-key-1');

      expect(cases.getActiveCase).toHaveBeenCalledWith('user-456', '2024-fall');
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
        expect.stringContaining('hall'),
        expect.objectContaining({ hall_list: 'North Hall' }),
        expect.objectContaining({ caseId: 'new-case-1' }),
      );
    });

    it('notifies user if they already have an active case', async () => {
      const existingCase = createCaseRecord({ id: 'existing-case', state: 'hall_chosen' });
      cases.getActiveCase.mockResolvedValue(existingCase);

      await orchestrator.onUserJoined('user-456', 'idem-key-2');

      expect(cases.createIfNone).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already'),
        { term: '2024-fall' },
        expect.objectContaining({ caseId: 'existing-case' }),
      );
    });
  });

  describe('onHallChosen', () => {
    it('transitions to hall_chosen state for valid hall', async () => {
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

      expect(discord.validateHall).toHaveBeenCalledWith('north');
      expect(cases.updateState).toHaveBeenCalledWith(
        'case-123',
        1,
        'hall_chosen',
        { hall: 'North Hall' },
      );
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
        expect.objectContaining({ hall: 'North Hall' }),
        expect.any(Object),
      );
    });

    it('notifies user for invalid hall', async () => {
      const kase = createCaseRecord({ state: 'joined' });
      cases.getActiveCase.mockResolvedValue(kase);
      discord.validateHall.mockResolvedValue({ valid: false });

      await orchestrator.onHallChosen('user-456', 'invalid-hall', 'idem-key-4');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('Invalid'),
        expect.objectContaining({ input: 'invalid-hall' }),
        expect.any(Object),
      );
    });

    it('allows hall change if still in hall_chosen state', async () => {
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

      expect(cases.updateState).toHaveBeenCalled();
    });

    it('rejects hall change if in awaiting_ra state', async () => {
      const kase = createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall' });
      cases.getActiveCase.mockResolvedValue(kase);

      await orchestrator.onHallChosen('user-456', 'south', 'idem-key-6');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('already'),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('onRoomEntered', () => {
    it('transitions to awaiting_ra for valid room', async () => {
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

      expect(discord.normalizeRoom).toHaveBeenCalledWith('North Hall', 'n-101');
      expect(cases.updateState).toHaveBeenCalledWith(
        'case-123',
        1,
        'awaiting_ra',
        expect.objectContaining({ room: 'N-101', expiresAt: expect.any(Date) }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'room_entered',
        'hall_chosen',
        'awaiting_ra',
        'user',
        'user-456',
        { room: 'N-101' },
        'idem-key-7',
      );
    });

    it('notifies user for invalid room format', async () => {
      const kase = createCaseRecord({ state: 'hall_chosen', hall: 'North Hall' });
      cases.getActiveCase.mockResolvedValue(kase);
      discord.normalizeRoom.mockResolvedValue({
        valid: false,
        errors: ['Invalid format'],
      });

      await orchestrator.onRoomEntered('user-456', 'bad-room', 'idem-key-8');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('Invalid'),
        expect.objectContaining({ room_example: 'N-101' }),
        expect.any(Object),
      );
    });

    it('rejects room entry if not in hall_chosen state', async () => {
      const kase = createCaseRecord({ state: 'joined' });
      cases.getActiveCase.mockResolvedValue(kase);

      await orchestrator.onRoomEntered('user-456', 'N-101', 'idem-key-9');

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
    it('approves case when authorized RA approves', async () => {
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

      expect(discord.isRaForHall).toHaveBeenCalledWith('ra-789', 'North Hall');
      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'approved', {});
      expect(decisions.recordDecision).toHaveBeenCalledWith(
        'case-123',
        'ra-789',
        'approve',
        undefined,
        'idem-key-10',
      );
      expect(discord.assignRoles).toHaveBeenCalledWith(
        'user-456',
        ['hall-role-north'],
        'idem-key-10',
      );
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('verified'),
        expect.objectContaining({ hall: 'North Hall', room: 'N-101' }),
        expect.any(Object),
      );
    });

    it('denies case when authorized RA denies', async () => {
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

      await orchestrator.onRAResponded(
        'case-123',
        'ra-789',
        'deny',
        'Room does not exist',
        'idem-key-11',
      );

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'denied', {});
      expect(decisions.recordDecision).toHaveBeenCalledWith(
        'case-123',
        'ra-789',
        'deny',
        'Room does not exist',
        'idem-key-11',
      );
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('denied'),
        expect.objectContaining({ reason: 'Room does not exist' }),
        expect.any(Object),
      );
    });

    it('rejects self-verification (RA cannot verify themselves)', async () => {
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

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(decisions.recordDecision).not.toHaveBeenCalled();
      expect(outbox.enqueueChannel).toHaveBeenCalledWith(
        'queue-channel-north',
        expect.stringContaining('Unauthorized'),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('rejects unauthorized RA (wrong hall role)', async () => {
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

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(decisions.recordDecision).not.toHaveBeenCalled();
      expect(outbox.enqueueChannel).toHaveBeenCalled();
    });

    it('ignores response if case is not in awaiting_ra state', async () => {
      const kase = createCaseRecord({ state: 'approved' });
      cases.findById.mockResolvedValue(kase);

      await orchestrator.onRAResponded('case-123', 'ra-789', 'approve', undefined, 'idem-key-14');

      expect(discord.isRaForHall).not.toHaveBeenCalled();
      expect(cases.updateState).not.toHaveBeenCalled();
    });
  });

  describe('expire', () => {
    it('transitions case to expired state and notifies user', async () => {
      const kase = createCaseRecord({ state: 'awaiting_ra', hall: 'North Hall' });
      const expiredCase = createCaseRecord({ ...kase, state: 'expired' });

      cases.findById.mockResolvedValue(kase);
      cases.updateState.mockResolvedValue(expiredCase);

      await orchestrator.expire('case-123', 'idem-key-15');

      expect(cases.updateState).toHaveBeenCalledWith('case-123', 1, 'expired', {});
      expect(audit.record).toHaveBeenCalledWith(
        'case-123',
        'case_expired',
        'awaiting_ra',
        'expired',
        'system',
        undefined,
        {},
        'idem-key-15',
      );
      expect(outbox.enqueueDM).toHaveBeenCalledWith(
        'user-456',
        expect.stringContaining('expired'),
        expect.objectContaining({ ttl_hours: 72 }),
        expect.any(Object),
      );
    });

    it('ignores expiration if case is not in awaiting_ra state', async () => {
      const kase = createCaseRecord({ state: 'approved' });
      cases.findById.mockResolvedValue(kase);

      await orchestrator.expire('case-123', 'idem-key-16');

      expect(cases.updateState).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
