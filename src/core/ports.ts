/**
 * Consolidated port interfaces for the verification system.
 * Organized into logical groupings to reduce complexity.
 */

// ==================== Domain Types ====================

export type CaseState =
  | "joined"
  | "hall_chosen"
  | "awaiting_ra"
  | "approved"
  | "denied"
  | "expired";

export interface CaseRecord {
  id: string;
  userId: string;
  term: string;
  state: CaseState;
  hall?: string;
  room?: string;
  raUserId?: string;
  version: number;
  expiresAt?: Date;
  reminderSentAt?: Date;
  updatedAt: Date;
}

// ==================== Configuration ====================

export interface HallConfig {
  name: string;
  aliases: string[];
  raRoleId: string;
  queueChannelId: string;
  hallRoleId: string;
  room?: {
    pattern: string;
    example: string;
  };
}

export interface TimeoutConfig {
  awaitingRA_ttl_hours: number;
  reminder_hours: number[];
}

export interface LimitsConfig {
  maxNotificationRetries: number;
  notificationBackoffSeconds: number[];
  roleAssignMaxRetries: number;
  roleAssignRetryBackoffSeconds: number[];
}

export interface MessageTemplates {
  dm: Record<string, string>;
  ra_queue: Record<string, string>;
}

/**
 * Synchronous configuration service.
 * No async needed - config is loaded at startup and doesn't change.
 */
export interface Config {
  currentTerm(): string;
  timeouts(): TimeoutConfig;
  limits(): LimitsConfig;
  messaging(): MessageTemplates;
  halls(): HallConfig[];
}

// ==================== Discord Operations ====================

export interface HallValidationResult {
  valid: boolean;
  normalizedHall?: string;
  raRoleId?: string;
  queueChannelId?: string;
  hallRoleId?: string;
}

export interface RoomNormalizationResult {
  valid: boolean;
  room?: string;
  errors?: string[];
}

export interface RoleOperationResult {
  status: "success" | "partial" | "failure";
  details?: string;
}

/**
 * Unified Discord service combining hall/room validation,
 * notifications, and role management.
 */
export interface DiscordService {
  // Hall validation
  validateHall(hall: string): Promise<HallValidationResult>;

  // Room normalization
  normalizeRoom(hall: string, roomRaw: string): Promise<RoomNormalizationResult>;

  // Notifications
  sendDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;

  sendToQueue(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;

  // Role management
  assignRoles(userId: string, roleIds: string[], idempotencyKey?: string): Promise<RoleOperationResult>;
  removeRoles(userId: string, roleIds: string[], idempotencyKey?: string): Promise<RoleOperationResult>;
}

// ==================== Data Repositories ====================

/**
 * Case repository for verification case persistence.
 */
export interface CaseRepository {
  getActiveCase(userId: string, term: string): Promise<CaseRecord | null>;
  createIfNone(userId: string, term: string, initialState: CaseState): Promise<CaseRecord>;
  updateState(
    caseId: string,
    expectedVersion: number,
    toState: CaseState,
    patch?: Partial<CaseRecord>,
  ): Promise<CaseRecord>;
  markExpired(filters?: unknown): Promise<number>;
  findById(caseId: string): Promise<CaseRecord | null>;
  listAwaitingRA(): Promise<CaseRecord[]>;
  markReminderSent(caseId: string, timestamp: Date): Promise<void>;
  resetCase(userId: string, term: string): Promise<void>;
}

/**
 * Decision repository for RA decisions.
 */
export interface DecisionRepository {
  authorize(raUserId: string, kase: { hall?: string; userId: string }): Promise<boolean>;
  recordDecision(
    caseId: string,
    raUserId: string,
    decision: "approve" | "deny",
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void>;
}

/**
 * Audit repository for audit trail logging.
 */
export interface AuditRepository {
  record(
    caseId: string,
    action: string,
    fromState?: string,
    toState?: string,
    actorType?: "user" | "ra" | "system",
    actorId?: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;
}

/**
 * Outbox repository for reliable message delivery.
 */
export interface OutboxJob {
  id: string;
  caseId?: string;
  kind: 'dm' | 'channel';
  template: string;
  payload?: {
    targetId: string;
    data?: Record<string, unknown>;
  };
  attempts: number;
}

export interface OutboxRepository {
  enqueueDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: { caseId?: string; idempotencyKey?: string },
  ): Promise<void>;

  enqueueChannel(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: { caseId?: string; idempotencyKey?: string },
  ): Promise<void>;

  takeDue(batchSize: number): Promise<OutboxJob[]>;
  markSent(jobId: string): Promise<void>;
  markFailed(jobId: string, error: string, retryAt: Date): Promise<void>;
  markPermanentlyFailed(jobId: string, error: string): Promise<void>;
}

// ==================== Logging ====================

/**
 * Logger abstraction for infrastructure-independent logging.
 */
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
}
