import type {
  DiscordService,
  Config,
  CaseRepository,
  CaseRecord,
  DecisionRepository,
  AuditRepository,
  OutboxRepository,
  Logger,
  HallConfig,
} from '../../ports';

// VerificationOrchestrator is the state machine that controls the entire verification workflow
// It implements the business logic and decides when to transition states and what side effects happen
// The private readonly services are injected dependencies (provided by container at startup)
export class VerificationOrchestrator {
  constructor(
    private readonly discord: DiscordService,       // handles Discord operations (validation, messaging, roles)
    private readonly config: Config,                // loads configuration from policy.json
    private readonly cases: CaseRepository,         // saves/retrieves case data from database
    private readonly decisions: DecisionRepository, // records RA approval/denial decisions
    private readonly audit: AuditRepository,        // logs all actions for audit trail
    private readonly outbox: OutboxRepository,       // queues messages to send to Discord
    private readonly logger: Logger,                // logging service
  ) {}

  // User initiated /verify command -> create their case in 'joined' state
  // Transition: none -> joined
  // If they already have an active case, just notify them instead of creating a new one
  async onUserJoined(userId: string, idempotencyKey: string): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();

    const existing = await this.cases.getActiveCase(userId, term);
    if (existing) {
      await this.outbox.enqueueDM(userId, templates.dm.already_in_progress, { term }, {
        caseId: existing.id,
        idempotencyKey,
      });
      return;
    }

    const kase = await this.cases.createIfNone(userId, term, 'joined');
    await this.audit.record(
      kase.id,
      'user_joined',
      undefined,
      'joined',
      'user',
      userId,
      { term },
      idempotencyKey,
    );

    const hallList = await this.hallNames();
    await this.outbox.enqueueDM(userId, templates.dm.ask_hall, { hall_list: hallList }, {
      caseId: kase.id,
      idempotencyKey,
    });
  }

  // User replied with hall name -> validate and transition to 'hall_chosen'
  // .includes() checks if the value is in the array
  // Allows retries if they enter an invalid hall before picking a valid one
  async onHallChosen(userId: string, hallInput: string, idempotencyKey: string): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();
    const kase = await this.requireActiveCase(userId, term);

    if (!['joined', 'hall_chosen'].includes(kase.state)) {
      await this.outbox.enqueueDM(userId, templates.dm.already_in_progress, { term }, {
        caseId: kase.id,
        idempotencyKey,
      });
      return;
    }

    const hallResult = await this.discord.validateHall(hallInput);
    if (!hallResult.valid || !hallResult.normalizedHall) {
      await this.outbox.enqueueDM(
        userId,
        templates.dm.invalid_hall,
        {
          input: hallInput,
          hall_list: await this.hallNames(),
        },
        { caseId: kase.id, idempotencyKey },
      );
      return;
    }

    const hallConfig = await this.findHallConfig(hallResult.normalizedHall);
    const updated = await this.cases.updateState(kase.id, kase.version, 'hall_chosen', {
      hall: hallResult.normalizedHall,
    });

    await this.audit.record(
      updated.id,
      'hall_chosen',
      kase.state,
      updated.state,
      'user',
      userId,
      { hall: hallResult.normalizedHall },
      idempotencyKey,
    );

    await this.outbox.enqueueDM(
      userId,
      templates.dm.ask_room,
      {
        hall: hallResult.normalizedHall,
        room_example: hallConfig?.room?.example ?? 'H-000-A',
      },
      { caseId: updated.id, idempotencyKey },
    );
  }

  // User entered their room number - validate against hall pattern and transition to 'awaiting_ra'
  // Calculates expiration time based on timeout config and notifies RA queue
  async onRoomEntered(userId: string, roomRaw: string, idempotencyKey: string): Promise<void> {
    const term = this.config.currentTerm();
    const templates = this.config.messaging();
    const kase = await this.requireActiveCase(userId, term);

    if (kase.state !== 'hall_chosen') {
      await this.outbox.enqueueDM(userId, templates.dm.already_in_progress, { term }, {
        caseId: kase.id,
        idempotencyKey,
      });
      return;
    }

    if (!kase.hall) {
      await this.outbox.enqueueDM(userId, templates.dm.system_error, {}, {
        caseId: kase.id,
        idempotencyKey,
      });
      return;
    }

    const normalizedRoom = await this.discord.normalizeRoom(kase.hall, roomRaw);
    const hallConfig = await this.findHallConfig(kase.hall);

    if (!normalizedRoom.valid || !normalizedRoom.room) {
      await this.outbox.enqueueDM(
        userId,
        templates.dm.invalid_room,
        { room_example: hallConfig?.room?.example ?? 'H-000-A' },
        { caseId: kase.id, idempotencyKey },
      );
      return;
    }

    const timeouts = this.config.timeouts();
    const expiresAt = new Date(Date.now() + timeouts.awaitingRA_ttl_hours * 60 * 60 * 1000);

    const updated = await this.cases.updateState(kase.id, kase.version, 'awaiting_ra', {
      room: normalizedRoom.room,
      expiresAt,
    });

    await this.audit.record(
      updated.id,
      'room_entered',
      kase.state,
      updated.state,
      'user',
      userId,
      { room: normalizedRoom.room },
      idempotencyKey,
    );

    await this.outbox.enqueueDM(
      userId,
      templates.dm.await_ra_notice,
      {
        hall: updated.hall,
        room: updated.room,
      },
      { caseId: updated.id, idempotencyKey },
    );

    await this.notifyRAQueue(updated, userId, idempotencyKey);
  }

  // RA responded with approve or deny decision
  // Checks if RA is authorized for this hall before recording decision
  // Race condition prevention via version check on update
  async onRAResponded(
    caseId: string,
    raUserId: string,
    decision: 'approve' | 'deny',
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    const templates = this.config.messaging();
    const kase = await this.requireCase(caseId);

    if (kase.state !== 'awaiting_ra') {
      return;
    }

    // Authorization checks:
    // 1. RA cannot verify themselves
    // 2. RA must have the appropriate role for this hall
    if (raUserId === kase.userId) {
      await this.notifyUnauthorized(kase, raUserId, idempotencyKey);
      return;
    }

    if (!kase.hall) {
      await this.notifyUnauthorized(kase, raUserId, idempotencyKey);
      return;
    }

    const isAuthorizedRa = await this.discord.isRaForHall(raUserId, kase.hall);
    if (!isAuthorizedRa) {
      await this.notifyUnauthorized(kase, raUserId, idempotencyKey);
      return;
    }

    const toState = decision === 'approve' ? 'approved' : 'denied';
    const updated = await this.cases.updateState(kase.id, kase.version, toState, {});

    await this.decisions.recordDecision(caseId, raUserId, decision, reason, idempotencyKey);
    await this.audit.record(
      kase.id,
      `ra_${decision}`,
      kase.state,
      updated.state,
      'ra',
      raUserId,
      { reason },
      idempotencyKey,
    );

    if (decision === 'approve') {
      await this.handleApproval(updated, idempotencyKey);
      await this.outbox.enqueueDM(
        updated.userId,
        templates.dm.approved,
        { hall: updated.hall, room: updated.room },
        { caseId: updated.id, idempotencyKey },
      );
    } else {
      await this.outbox.enqueueDM(
        updated.userId,
        templates.dm.denied,
        { hall: updated.hall, room: updated.room, reason: reason ?? 'No reason provided.' },
        { caseId: updated.id, idempotencyKey },
      );
    }

    await this.notifyDecisionAck(updated, raUserId, decision, idempotencyKey);
  }

  // Case has exceeded ttl without RA response. Transition to expired state and notify user
  async expire(caseId: string, idempotencyKey: string): Promise<void> {
    const templates = this.config.messaging();
    const kase = await this.requireCase(caseId);

    if (kase.state !== 'awaiting_ra') {
      return;
    }

    const updated = await this.cases.updateState(kase.id, kase.version, 'expired', {});
    await this.audit.record(
      kase.id,
      'case_expired',
      kase.state,
      updated.state,
      'system',
      undefined,
      {},
      idempotencyKey,
    );

    await this.outbox.enqueueDM(
      updated.userId,
      templates.dm.expired,
      { ttl_hours: this.config.timeouts().awaitingRA_ttl_hours, start_command: '/verify' },
      { caseId: updated.id, idempotencyKey },
    );
  }

  private async requireActiveCase(userId: string, term: string): Promise<CaseRecord> {
    const kase = await this.cases.getActiveCase(userId, term);
    if (!kase) {
      throw new Error(`No active case for ${userId} in term ${term}`);
    }
    return kase;
  }

  private async requireCase(caseId: string): Promise<CaseRecord> {
    const kase = await this.cases.findById(caseId);
    if (!kase) {
      throw new Error(`Case ${caseId} not found`);
    }
    return kase;
  }

  // Helper that gets all hall names and joins them into a comma-separated string
  // .map() transforms array of objects into array of just the names
  // .join() combines array into single string with separator
  private async hallNames(): Promise<string> {
    const halls = this.config.halls();
    return halls.map((hall) => hall.name).join(', ');
  }

  // Helper that finds a hall config by name, case-insensitive
  // .find() returns first element matching the condition, or undefined if none found
  private async findHallConfig(name: string): Promise<HallConfig | undefined> {
    const halls = this.config.halls();
    return halls.find((hall) => hall.name.toLowerCase() === name.toLowerCase());
  }

  private async notifyRAQueue(kase: CaseRecord, userId: string, idempotencyKey: string): Promise<void> {
    if (!kase.hall || !kase.room) {
      return;
    }

    const hallDetails = await this.discord.validateHall(kase.hall);
    const templates = this.config.messaging();

    if (!hallDetails.queueChannelId) {
      this.logger.warn({ caseId: kase.id, hall: kase.hall }, 'No queueChannelId configured for hall');
      return;
    }

    const payload = {
      user_tag: this.mention(userId),
      hall: kase.hall,
      room: kase.room,
      case_id: kase.id,
    };

    const title = templates.ra_queue.ra_verify_card_title ?? '';
    const body = templates.ra_queue.ra_verify_card_body ?? '';

    const content = `${title}\n${body}\nCase ID: ${kase.id}`;

    await this.outbox.enqueueChannel(
      hallDetails.queueChannelId,
      content,
      payload,
      { caseId: kase.id, idempotencyKey: `${idempotencyKey ?? ''}-queue-${kase.id}` },
    );

    this.logger.info({ caseId: kase.id, channelId: hallDetails.queueChannelId }, 'Queued RA notification');
    this.auditQueueNotification(kase.id, hallDetails.queueChannelId);
  }

  private auditQueueNotification(caseId: string, channelId: string): void {
    const logPayload = {
      caseId,
      channelId,
    };
    // using logger through audit service keeps single source of truth
    void this.audit.record(caseId, 'ra_queue_notified', undefined, undefined, 'system', undefined, logPayload);
  }

  private async handleApproval(kase: CaseRecord, idempotencyKey?: string): Promise<void> {
    if (!kase.hall) {
      return;
    }

    const hallDetails = await this.discord.validateHall(kase.hall);
    if (!hallDetails.hallRoleId) {
      return;
    }

    await this.discord.assignRoles(kase.userId, [hallDetails.hallRoleId], idempotencyKey);
  }

  private async notifyUnauthorized(
    kase: CaseRecord,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<void> {
    if (!kase.hall) {
      return;
    }

    const hallDetails = await this.discord.validateHall(kase.hall);
    const templates = this.config.messaging();
    if (!hallDetails.queueChannelId) {
      return;
    }

    await this.outbox.enqueueChannel(
      hallDetails.queueChannelId,
      templates.ra_queue.unauthorized_attempt ?? 'Unauthorized action detected.',
      { actor_tag: this.mention(actorId), case_id: kase.id },
      { caseId: kase.id, idempotencyKey: `${idempotencyKey ?? ''}-unauth-${kase.id}-${actorId}` },
    );
  }

  private async notifyDecisionAck(
    kase: CaseRecord,
    actorId: string,
    decision: 'approve' | 'deny',
    idempotencyKey?: string,
  ): Promise<void> {
    if (!kase.hall) {
      return;
    }

    const hallDetails = await this.discord.validateHall(kase.hall);
    const templates = this.config.messaging();
    if (!hallDetails.queueChannelId) {
      return;
    }

    await this.outbox.enqueueChannel(
      hallDetails.queueChannelId,
      templates.ra_queue.decision_ack ?? 'Decision recorded.',
      { actor_tag: this.mention(actorId), case_id: kase.id, decision },
      { caseId: kase.id, idempotencyKey: `${idempotencyKey ?? ''}-decision-${kase.id}` },
    );
  }

  private mention(userId: string): string {
    return `<@${userId}>`;
  }
}
