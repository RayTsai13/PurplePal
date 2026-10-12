import { randomUUID } from 'node:crypto';
import { ACTIVE_CASE_STATES } from '../../ports';
import type {
  DiscordService,
  Config,
  CaseRepository,
  CaseRecord,
  CaseState,
  HallConfig,
  Logger,
  TransactionalRepositories,
  UnitOfWork,
} from '../../ports';
import { ConcurrencyError } from '../../errors';

export interface OrchestratorDeps {
  discord: DiscordService;  // Discord operations (room normalization, RA role checks)
  config: Config;           // policy.json configuration
  cases: CaseRepository;    // reads outside of transactions
  uow: UnitOfWork;          // every write goes through a transaction (state + audit + outbox together)
  logger: Logger;
  moderatorIds?: string[];  // users who may decide any case (ADMINS_IDS)
}

export type DecisionResult =
  | { ok: true; state: 'approved' | 'denied' }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'unauthorized' | 'conflict' };

export type ResetResult = { ok: true } | { ok: false; reason: 'no_case' | 'pending_review' };

export type DirectMessageResult = { handled: true } | { handled: false; reason: 'no_case' | 'awaiting_ra' };

// States a user may cancel on their own with /verify-reset
const USER_RESETTABLE_STATES: CaseState[] = ['joined', 'hall_chosen', 'room_number_entered'];

// VerificationOrchestrator is the state machine that controls the entire verification workflow
// It implements the business logic and decides when to transition states and what side effects happen
// Discord reads (role checks) happen before a transaction; all writes for a transition happen inside one
export class VerificationOrchestrator {
  private readonly discord: DiscordService;
  private readonly config: Config;
  private readonly cases: CaseRepository;
  private readonly uow: UnitOfWork;
  private readonly logger: Logger;
  private readonly moderators: Set<string>;

  constructor(deps: OrchestratorDeps) {
    this.discord = deps.discord;
    this.config = deps.config;
    this.cases = deps.cases;
    this.uow = deps.uow;
    this.logger = deps.logger;
    this.moderators = new Set(deps.moderatorIds ?? []);
  }

  // New guild member: restore access if they were already verified this term, otherwise assign the
  // unverified role and start verification
  async onMemberJoined(userId: string, idempotencyKey: string): Promise<void> {
    if (await this.handleAlreadyVerified(userId, idempotencyKey, { restoreRole: true })) {
      return;
    }

    const unverifiedRoleId = this.config.unverifiedRoleId();
    await this.startVerification(userId, idempotencyKey, async (repos, kase) => {
      if (unverifiedRoleId) {
        await repos.outbox.enqueueRoleChange(userId, 'add', [unverifiedRoleId], {
          caseId: kase.id,
          idempotencyKey: `${idempotencyKey}-unverified-role`,
        });
      }
    });
  }

  // User ran /verify -> create their case in 'joined' state
  // Transition: none -> joined
  // If they already have an active case, or are already verified this term, just notify them
  async onUserJoined(userId: string, idempotencyKey: string): Promise<void> {
    if (await this.handleAlreadyVerified(userId, idempotencyKey, { restoreRole: false })) {
      return;
    }
    await this.startVerification(userId, idempotencyKey);
  }

  // Route a DM to the step the user's case is on
  async onDirectMessage(userId: string, content: string, idempotencyKey: string): Promise<DirectMessageResult> {
    const kase = await this.cases.getActiveCase(userId, this.config.currentTerm());
    if (!kase) {
      return { handled: false, reason: 'no_case' };
    }

    switch (kase.state) {
      case 'joined':
        await this.onHallChosen(userId, content, idempotencyKey);
        return { handled: true };
      case 'hall_chosen':
        // A hall name here means the user is correcting their hall; anything else is the room number
        if (this.config.hall(content)) {
          await this.onHallChosen(userId, content, idempotencyKey);
        } else {
          await this.onRoomNumberEntered(userId, content, idempotencyKey);
        }
        return { handled: true };
      case 'room_number_entered':
        await this.onRoomEntered(userId, content, idempotencyKey);
        return { handled: true };
      default:
        return { handled: false, reason: 'awaiting_ra' };
    }
  }

  // User replied with hall name -> validate and transition to 'hall_chosen'
  // Allows retries if they enter an invalid hall before picking a valid one
  async onHallChosen(userId: string, hallInput: string, idempotencyKey: string): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();
    const kase = await this.requireActiveCase(userId, term);

    if (!['joined', 'hall_chosen'].includes(kase.state)) {
      await this.dm(userId, templates.dm.already_in_progress, { term }, kase.id, idempotencyKey);
      return;
    }

    const hall = this.config.hall(hallInput);
    if (!hall) {
      await this.dm(
        userId,
        templates.dm.invalid_hall,
        { input: hallInput, hall_list: this.hallNames() },
        kase.id,
        idempotencyKey,
      );
      return;
    }

    await this.uow.run(async (repos) => {
      const updated = await repos.cases.updateState(kase.id, kase.version, 'hall_chosen', { hall: hall.name });

      await repos.audit.record(
        updated.id,
        'hall_chosen',
        kase.state,
        updated.state,
        'user',
        userId,
        { hall: hall.name },
        idempotencyKey,
      );

      await repos.outbox.enqueueDM(
        userId,
        templates.dm.ask_room_number,
        { hall: hall.name, example: hall.room?.roomNumberExample ?? '' },
        { caseId: updated.id, idempotencyKey },
      );
    });
  }

  // User entered room number (step 2 of 3) - validate and transition to 'room_number_entered'
  async onRoomNumberEntered(userId: string, roomNumberRaw: string, idempotencyKey: string): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();
    const kase = await this.requireActiveCase(userId, term);

    // State guard: only accept from 'hall_chosen' or 'room_number_entered' (allows retries)
    if (!['hall_chosen', 'room_number_entered'].includes(kase.state)) {
      await this.dm(userId, templates.dm.already_in_progress, { term }, kase.id, idempotencyKey);
      return;
    }

    const room = kase.hall ? this.config.hall(kase.hall)?.room : undefined;
    if (!room) {
      this.logger.error({ caseId: kase.id, hall: kase.hall }, 'Hall or room configuration missing for case');
      await this.dm(userId, templates.dm.system_error, {}, kase.id, idempotencyKey);
      return;
    }

    const trimmed = roomNumberRaw.trim();
    if (!new RegExp(room.roomNumberPattern).test(trimmed)) {
      await this.dm(
        userId,
        templates.dm.invalid_room_number,
        { example: room.roomNumberExample },
        kase.id,
        idempotencyKey,
      );
      return;
    }

    await this.uow.run(async (repos) => {
      const updated = await repos.cases.updateState(kase.id, kase.version, 'room_number_entered', {
        roomNumber: trimmed,
      });

      await repos.audit.record(
        updated.id,
        'room_number_entered',
        kase.state,
        updated.state,
        'user',
        userId,
        { roomNumber: trimmed },
        idempotencyKey,
      );

      await repos.outbox.enqueueDM(
        userId,
        templates.dm.ask_unit,
        { room_number: trimmed, example: room.unitExample },
        { caseId: updated.id, idempotencyKey },
      );
    });
  }

  // User entered unit (step 3 of 3) - combine with prefix and room number, transition to 'awaiting_ra'
  // Calculates expiration time based on timeout config and notifies RA queue
  async onRoomEntered(userId: string, unitRaw: string, idempotencyKey: string): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();
    const kase = await this.requireActiveCase(userId, term);

    // State guard: ONLY accept from 'room_number_entered' (strict)
    if (kase.state !== 'room_number_entered') {
      await this.dm(userId, templates.dm.already_in_progress, { term }, kase.id, idempotencyKey);
      return;
    }

    const hall = kase.hall ? this.config.hall(kase.hall) : undefined;
    if (!hall?.room || !kase.roomNumber) {
      this.logger.error({ caseId: kase.id, hall: kase.hall }, 'Hall, room configuration, or room number missing for case');
      await this.dm(userId, templates.dm.system_error, {}, kase.id, idempotencyKey);
      return;
    }

    const unit = unitRaw.trim().toUpperCase();
    if (!new RegExp(hall.room.unitPattern).test(unit)) {
      await this.dm(userId, templates.dm.invalid_unit, { example: hall.room.unitExample }, kase.id, idempotencyKey);
      return;
    }

    // Validate the assembled room (e.g. "S-312-A") against the hall's full pattern
    const fullRoom = `${hall.room.prefix}-${kase.roomNumber}-${unit}`;
    const normalizedRoom = await this.discord.normalizeRoom(hall.name, fullRoom);

    if (!normalizedRoom.valid || !normalizedRoom.room) {
      await this.dm(userId, templates.dm.invalid_room, { room_example: hall.room.example }, kase.id, idempotencyKey);
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.timeouts().awaitingRA_ttl_hours * 60 * 60 * 1000);

    await this.uow.run(async (repos) => {
      const updated = await repos.cases.updateState(kase.id, kase.version, 'awaiting_ra', {
        room: normalizedRoom.room,
        expiresAt,
        submittedAt: now,
      });

      await repos.audit.record(
        updated.id,
        'room_entered',
        kase.state,
        updated.state,
        'user',
        userId,
        { room: normalizedRoom.room },
        idempotencyKey,
      );

      await repos.outbox.enqueueDM(
        userId,
        templates.dm.await_ra_notice,
        { hall: updated.hall, room: updated.room },
        { caseId: updated.id, idempotencyKey },
      );

      await this.notifyRAQueue(repos, updated, hall, idempotencyKey);
    });
  }

  // Whether a user may approve or deny this case: moderators and the hall's RAs, never the case owner
  async canDecide(caseId: string, userId: string): Promise<boolean> {
    const kase = await this.cases.findById(caseId);
    return kase ? this.isAuthorized(kase, userId) : false;
  }

  // RA (or moderator) responded with approve or deny decision
  // asAdmin skips authorization for trusted callers such as the admin CLI
  // Concurrent decisions are resolved by the version check: exactly one wins, the rest get 'conflict'
  async onRAResponded(
    caseId: string,
    actorId: string,
    decision: 'approve' | 'deny',
    reason?: string,
    idempotencyKey: string = randomUUID(),
    options: { asAdmin?: boolean } = {},
  ): Promise<DecisionResult> {
    const templates = this.config.messaging();
    const kase = await this.cases.findById(caseId);

    if (!kase) {
      return { ok: false, reason: 'not_found' };
    }
    if (kase.state !== 'awaiting_ra') {
      return { ok: false, reason: 'not_pending' };
    }

    if (!options.asAdmin && !(await this.isAuthorized(kase, actorId))) {
      await this.notifyUnauthorized(kase, actorId, idempotencyKey);
      return { ok: false, reason: 'unauthorized' };
    }

    const toState = decision === 'approve' ? 'approved' : 'denied';
    const hall = kase.hall ? this.config.hall(kase.hall) : undefined;

    try {
      await this.uow.run(async (repos) => {
        const updated = await repos.cases.updateState(kase.id, kase.version, toState, { raUserId: actorId });

        await repos.decisions.recordDecision(caseId, actorId, decision, reason, idempotencyKey);
        await repos.audit.record(
          kase.id,
          options.asAdmin ? `admin_${decision}` : `ra_${decision}`,
          kase.state,
          updated.state,
          options.asAdmin ? 'system' : 'ra',
          actorId,
          { reason },
          idempotencyKey,
        );

        if (decision === 'approve') {
          await this.enqueueApproval(repos, updated, hall, idempotencyKey);
        } else {
          await repos.outbox.enqueueDM(
            updated.userId,
            templates.dm.denied,
            { hall: updated.hall, room: updated.room, reason: reason ?? 'No reason provided.' },
            { caseId: updated.id, idempotencyKey },
          );
        }

        if (hall) {
          await repos.outbox.enqueueChannel(
            hall.queueChannelId,
            templates.ra_queue.decision_ack,
            { actor_tag: this.mention(actorId), case_id: kase.id, decision },
            { caseId: kase.id, idempotencyKey: `${idempotencyKey}-decision-${kase.id}` },
          );
        }
      });
    } catch (error) {
      if (error instanceof ConcurrencyError) {
        this.logger.info({ caseId, actorId }, 'Decision lost race; case already changed');
        return { ok: false, reason: 'conflict' };
      }
      throw error;
    }

    return { ok: true, state: toState };
  }

  // Case has exceeded ttl without RA response. Transition to expired state and notify user
  // admin allows expiring a case in any active state (CLI force-expire)
  // Returns whether the case was expired
  async expire(
    caseId: string,
    idempotencyKey: string,
    options: { admin?: { actorId: string; reason?: string } } = {},
  ): Promise<boolean> {
    const templates = this.config.messaging();
    const kase = await this.cases.findById(caseId);
    if (!kase) {
      return false;
    }

    const allowed: readonly CaseState[] = options.admin ? ACTIVE_CASE_STATES : ['awaiting_ra'];
    if (!allowed.includes(kase.state)) {
      return false;
    }

    try {
      await this.uow.run(async (repos) => {
        const updated = await repos.cases.updateState(kase.id, kase.version, 'expired', {});
        await repos.audit.record(
          kase.id,
          options.admin ? 'admin_force_expire' : 'case_expired',
          kase.state,
          updated.state,
          'system',
          options.admin?.actorId,
          options.admin ? { reason: options.admin.reason ?? 'Manual expiration' } : {},
          idempotencyKey,
        );

        await repos.outbox.enqueueDM(
          updated.userId,
          templates.dm.expired,
          { ttl_hours: this.config.timeouts().awaitingRA_ttl_hours, start_command: '/verify' },
          { caseId: updated.id, idempotencyKey },
        );
      });
    } catch (error) {
      if (error instanceof ConcurrencyError) {
        this.logger.info({ caseId }, 'Expiration skipped; case changed concurrently');
        return false;
      }
      throw error;
    }
    return true;
  }

  // Send the nth reminder for a pending case to both the user and the hall's RA queue
  // Idempotency keys include the reminder number so each threshold is delivered once
  async sendReminder(kase: CaseRecord, reminderNumber: number): Promise<void> {
    const templates = this.config.messaging();
    const hall = kase.hall ? this.config.hall(kase.hall) : undefined;

    await this.uow.run(async (repos) => {
      await repos.outbox.enqueueDM(
        kase.userId,
        templates.dm.reminder_user,
        { hall: kase.hall, room: kase.room },
        { caseId: kase.id, idempotencyKey: `reminder-${kase.id}-${reminderNumber}` },
      );

      if (hall) {
        // Include the case ID line so RAs can react to the reminder just like the original card
        await repos.outbox.enqueueChannel(
          hall.queueChannelId,
          `${templates.ra_queue.ra_reminder}\nCase ID: ${kase.id}`,
          { user_tag: this.mention(kase.userId), hall: kase.hall, room: kase.room, case_id: kase.id },
          { caseId: kase.id, idempotencyKey: `reminder-ra-${kase.id}-${reminderNumber}` },
        );
      }

      await repos.cases.markReminderSent(kase.id, reminderNumber, new Date());
    });
  }

  // User ran /verify-reset: cancel their in-progress case so they can start over
  // Not allowed once the case is awaiting RA review; approved users need an admin reset
  async onUserReset(userId: string, idempotencyKey: string): Promise<ResetResult> {
    const kase = await this.cases.getActiveCase(userId, this.config.currentTerm());
    if (!kase) {
      return { ok: false, reason: 'no_case' };
    }
    if (!USER_RESETTABLE_STATES.includes(kase.state)) {
      return { ok: false, reason: 'pending_review' };
    }

    await this.uow.run(async (repos) => {
      const updated = await repos.cases.updateState(kase.id, kase.version, 'cancelled', {});
      await repos.audit.record(kase.id, 'user_reset', kase.state, updated.state, 'user', userId, {}, idempotencyKey);
    });
    return { ok: true };
  }

  // Admin reset: cancel every active or approved case for the user in a term and revoke the hall role
  // granted by an approval. The audit trail is kept. Returns the number of cases cancelled
  async adminResetUser(userId: string, term: string, actorId: string, reason?: string): Promise<number> {
    const open = await this.cases.listOpenCases(userId, term);
    const unverifiedRoleId = this.config.unverifiedRoleId();

    for (const kase of open) {
      const key = `admin-reset-${kase.id}-${kase.version}`;
      await this.uow.run(async (repos) => {
        const updated = await repos.cases.updateState(kase.id, kase.version, 'cancelled', {});
        await repos.audit.record(
          kase.id,
          'admin_reset',
          kase.state,
          updated.state,
          'system',
          actorId,
          { reason: reason ?? 'Admin reset' },
          key,
        );

        if (kase.state === 'approved') {
          const hall = kase.hall ? this.config.hall(kase.hall) : undefined;
          if (hall) {
            await repos.outbox.enqueueRoleChange(userId, 'remove', [hall.hallRoleId], {
              caseId: kase.id,
              idempotencyKey: `${key}-remove-hall-role`,
            });
          }
          if (unverifiedRoleId) {
            await repos.outbox.enqueueRoleChange(userId, 'add', [unverifiedRoleId], {
              caseId: kase.id,
              idempotencyKey: `${key}-unverified-role`,
            });
          }
        }
      });
    }
    return open.length;
  }

  // Create the case (or report the existing one) and send the first prompt, all in one transaction
  // `extra` adds more writes to the same transaction (e.g. assigning the unverified role)
  private async startVerification(
    userId: string,
    idempotencyKey: string,
    extra?: (repos: TransactionalRepositories, kase: CaseRecord) => Promise<void>,
  ): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();

    const attempt = () =>
      this.uow.run(async (repos) => {
        const existing = await repos.cases.getActiveCase(userId, term);
        if (existing) {
          await extra?.(repos, existing);
          await repos.outbox.enqueueDM(userId, templates.dm.already_in_progress, { term }, {
            caseId: existing.id,
            idempotencyKey,
          });
          return;
        }

        const kase = await repos.cases.createIfNone(userId, term, 'joined');
        await repos.audit.record(kase.id, 'user_joined', undefined, 'joined', 'user', userId, { term }, idempotencyKey);
        await extra?.(repos, kase);

        // Use welcome_joined template if lobby channel is configured (includes lobby channel mention)
        // Otherwise fall back to standard ask_hall template
        const lobbyChannelId = this.config.lobbyChannelId();
        const template = lobbyChannelId && templates.dm.welcome_joined
          ? templates.dm.welcome_joined
          : templates.dm.ask_hall;

        await repos.outbox.enqueueDM(
          userId,
          template,
          { hall_list: this.hallNames(), lobby_channel_id: lobbyChannelId ?? '' },
          { caseId: kase.id, idempotencyKey },
        );
      });

    try {
      await attempt();
    } catch (error) {
      // A concurrent join + /verify both tried to create the case; retry once to take the "existing" path
      if (!(error instanceof ConcurrencyError)) {
        throw error;
      }
      await attempt();
    }
  }

  // If the user already has an approved case this term, tell them (and optionally re-grant the hall
  // role, since leaving the server drops roles). Returns true if handled
  private async handleAlreadyVerified(
    userId: string,
    idempotencyKey: string,
    options: { restoreRole: boolean },
  ): Promise<boolean> {
    const term = this.config.currentTerm();
    const approved = await this.cases.getApprovedCase(userId, term);
    if (!approved) {
      return false;
    }

    const templates = this.config.messaging();
    const hall = approved.hall ? this.config.hall(approved.hall) : undefined;

    await this.uow.run(async (repos) => {
      if (options.restoreRole && hall) {
        await repos.outbox.enqueueRoleChange(userId, 'add', [hall.hallRoleId], {
          caseId: approved.id,
          idempotencyKey: `${idempotencyKey}-restore-hall-role`,
        });
      }
      await repos.outbox.enqueueDM(
        userId,
        templates.dm.already_verified,
        { hall: approved.hall, room: approved.room, term },
        { caseId: approved.id, idempotencyKey },
      );
    });
    return true;
  }

  // Grant the hall role, then DM the user once it has actually been granted (outbox follow-up),
  // and remove the unverified role
  private async enqueueApproval(
    repos: TransactionalRepositories,
    kase: CaseRecord,
    hall: HallConfig | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    const templates = this.config.messaging();
    const approvedDm = {
      userId: kase.userId,
      template: templates.dm.approved,
      data: { hall: kase.hall, room: kase.room },
    };

    if (!hall) {
      // Hall was removed from config after the case was opened; nothing to grant
      this.logger.warn({ caseId: kase.id, hall: kase.hall }, 'Approved case has no configured hall; no role granted');
      await repos.outbox.enqueueDM(approvedDm.userId, approvedDm.template, approvedDm.data, {
        caseId: kase.id,
        idempotencyKey,
      });
      return;
    }

    await repos.outbox.enqueueRoleChange(kase.userId, 'add', [hall.hallRoleId], {
      caseId: kase.id,
      idempotencyKey: `${idempotencyKey}-hall-role`,
      followUp: approvedDm,
    });

    const unverifiedRoleId = this.config.unverifiedRoleId();
    if (unverifiedRoleId) {
      await repos.outbox.enqueueRoleChange(kase.userId, 'remove', [unverifiedRoleId], {
        caseId: kase.id,
        idempotencyKey: `${idempotencyKey}-unverified-role`,
      });
    }
  }

  private async isAuthorized(kase: CaseRecord, userId: string): Promise<boolean> {
    if (userId === kase.userId) {
      return false; // nobody verifies themselves, moderators included
    }
    if (this.moderators.has(userId)) {
      return true;
    }
    if (!kase.hall) {
      return false;
    }
    return this.discord.isRaForHall(userId, kase.hall);
  }

  private async requireActiveCase(userId: string, term: string): Promise<CaseRecord> {
    const kase = await this.cases.getActiveCase(userId, term);
    if (!kase) {
      throw new Error(`No active case for ${userId} in term ${term}`);
    }
    return kase;
  }

  // Single DM that isn't part of a state transition (prompts to retry, errors)
  private async dm(
    userId: string,
    template: string,
    data: Record<string, unknown>,
    caseId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.uow.run((repos) => repos.outbox.enqueueDM(userId, template, data, { caseId, idempotencyKey }));
  }

  // Comma-separated list of hall names for prompts
  private hallNames(): string {
    return this.config.halls().map((hall) => hall.name).join(', ');
  }

  private async notifyRAQueue(
    repos: TransactionalRepositories,
    kase: CaseRecord,
    hall: HallConfig,
    idempotencyKey: string,
  ): Promise<void> {
    const templates = this.config.messaging();
    const payload = {
      user_tag: this.mention(kase.userId),
      hall: kase.hall,
      room: kase.room,
      case_id: kase.id,
    };

    // The "Case ID:" line is what VerificationBot parses when an RA reacts to the card
    const content = `${templates.ra_queue.ra_verify_card_title}\n${templates.ra_queue.ra_verify_card_body}\nCase ID: ${kase.id}`;

    await repos.outbox.enqueueChannel(hall.queueChannelId, content, payload, {
      caseId: kase.id,
      idempotencyKey: `${idempotencyKey}-queue-${kase.id}`,
    });
    await repos.audit.record(kase.id, 'ra_queue_notified', undefined, undefined, 'system', undefined, {
      caseId: kase.id,
      channelId: hall.queueChannelId,
    });

    this.logger.info({ caseId: kase.id, channelId: hall.queueChannelId }, 'Queued RA notification');
  }

  private async notifyUnauthorized(kase: CaseRecord, actorId: string, idempotencyKey: string): Promise<void> {
    const hall = kase.hall ? this.config.hall(kase.hall) : undefined;
    if (!hall) {
      return;
    }

    const templates = this.config.messaging();
    await this.uow.run((repos) =>
      repos.outbox.enqueueChannel(
        hall.queueChannelId,
        templates.ra_queue.unauthorized_attempt,
        { actor_tag: this.mention(actorId), case_id: kase.id },
        { caseId: kase.id, idempotencyKey: `${idempotencyKey}-unauth-${kase.id}-${actorId}` },
      ),
    );
  }

  // Discord mention for real user IDs; non-Discord actors (e.g. "cli-admin") are shown as-is
  private mention(userId: string): string {
    return /^\d+$/.test(userId) ? `<@${userId}>` : userId;
  }
}
