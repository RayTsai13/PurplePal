// ==================== Domain Types ====================

// CaseState is a union type that can only be one of these exact strings
// The pipe | symbol means "or" - the state must be one of these values
// This prevents invalid state values from accidentally being used
export type CaseState =
  | "joined"
  | "hall_chosen"
  | "room_number_entered"
  | "awaiting_ra"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

// States in which a case is still in progress. The database allows at most one per user per term
export const ACTIVE_CASE_STATES: readonly CaseState[] = ["joined", "hall_chosen", "room_number_entered", "awaiting_ra"];

export interface CaseRecord {
  id: string;             // unique case ID
  userId: string;         // Discord user ID being verified
  term: string;           // academic term (like Fall 2025)
  state: CaseState;       // current state in the verification process
  hall?: string;          // which residence hall - ? means optional (might not have picked yet)
  roomNumber?: string;    // room number only (e.g., "312") - stored in intermediate state
  room?: string;          // full room (e.g., "S-312-A") - stored when complete
  raUserId?: string;      // RA who verified them - optional (might not be done yet)
  version: number;        // increments on each update for race condition prevention
  expiresAt?: Date;       // when this case expires - optional. Date is a TypeScript type for timestamps
  submittedAt?: Date;     // when the case entered awaiting_ra - reminders are measured from here
  reminderSentAt?: Date;  // when reminder was last sent - optional
  remindersSent: number;  // how many reminder_hours thresholds have already been sent
  updatedAt: Date;        // timestamp of last update - always present
}

// ==================== Configuration ====================

// Hall configuration defines settings for a specific residence hall
export interface HallConfig {
  name: string;           // display name like Dormitory A
  aliases: string[];      // [] means array - users can type these alternate names to match this hall
  raRoleId: string;       // Discord role ID for RAs who can verify this hall
  queueChannelId: string; // Discord channel where RA verification requests appear
  hallRoleId: string;     // Discord role given to users after they verify for this hall
  room?: {
    pattern: string;            // regex pattern to validate the full room (like ^A-\\d{3}-[A-D]$)
    example: string;            // example room to show users (like A-101-B)
    prefix: string;             // building prefix joined with room number and unit (like A)
    roomNumberPattern: string;  // regex the room number step must match (like ^\\d{3}$)
    roomNumberExample: string;  // example room number shown to users (like 312)
    unitPattern: string;        // regex the unit step must match, applied after uppercasing (like ^[A-D]$)
    unitExample: string;        // example unit shown to users (like A)
  };
}

// Timeout configuration for the verification process
export interface TimeoutConfig {
  awaitingRA_ttl_hours: number; // how many hours before pending cases expire
  reminder_hours: number[];     // [] array - times to send reminders (in hours from when case started)
}

// Limits for retries when things fail
export interface LimitsConfig {
  maxNotificationRetries: number;           // max attempts to send a Discord message before giving up
  notificationBackoffSeconds: number[];     // [] array - delays between retry attempts in seconds
  roleAssignMaxRetries: number;             // max attempts to assign a Discord role
  roleAssignRetryBackoffSeconds: number[];  // delays between role assignment retries
}

// DM templates sent to the user being verified. Every key the code uses is listed so a missing
// template is a startup validation error rather than a runtime failure mid-flow
export interface DmTemplates {
  welcome_joined?: string;   // used instead of ask_hall when a lobby channel is configured
  ask_hall: string;
  invalid_hall: string;
  ask_room_number: string;
  invalid_room_number: string;
  ask_unit: string;
  invalid_unit: string;
  invalid_room: string;
  await_ra_notice: string;
  reminder_user: string;
  approved: string;
  denied: string;
  expired: string;
  already_in_progress: string;
  already_verified: string;
  system_error: string;
}

// Templates posted to a hall's RA queue channel
export interface RaQueueTemplates {
  ra_verify_card_title: string;
  ra_verify_card_body: string;
  ra_reminder: string;
  unauthorized_attempt: string;
  decision_ack: string;
}

// Message templates used throughout the app
export interface MessageTemplates {
  dm: DmTemplates;
  ra_queue: RaQueueTemplates;
}

// Config interface - all methods return config without needing to await (no async)
// These are just getter functions that return cached config loaded at startup
export interface Config {
  currentTerm(): string;          // () means this is a function that takes no parameters. : string means it returns a string
  timeouts(): TimeoutConfig;      // returns TimeoutConfig interface
  limits(): LimitsConfig;         // returns LimitsConfig interface
  messaging(): MessageTemplates;  // returns MessageTemplates interface
  halls(): HallConfig[];          // [] means returns an array of HallConfig

  // Look up a hall by canonical name or alias (case-insensitive). undefined if not configured
  hall(nameOrAlias: string): HallConfig | undefined;

  // Lobby channel where unverified users can chat while awaiting verification
  lobbyChannelId(): string | undefined;

  // Role assigned to new members until they complete verification
  unverifiedRoleId(): string | undefined;

  // Reload configuration from disk without restarting the application
  // Returns Promise<void> to indicate async file read operation
  reload(): Promise<void>;
}

// ==================== Discord Operations ====================

// Result object when normalizing/validating a room number
export interface RoomNormalizationResult {
  valid: boolean;       // whether the room format is correct
  room?: string;        // the normalized room if valid (might have fixed spacing/hyphens)
  errors?: string[];    // [] array of error messages if invalid
}

// Result object when assigning or removing Discord roles
export interface RoleOperationResult {
  status: "success" | "partial" | "failure";  // | means or - one of these three string values
  details?: string;                           // optional explanation of what happened
}

// DiscordService handles Discord interactions - room normalization, messaging, and roles
// Hall lookup by name/alias lives on Config.hall()
export interface DiscordService {
  normalizeRoom(hall: string, roomRaw: string): Promise<RoomNormalizationResult>;

  // data?: Record<string, unknown> = optional object with any string keys and any values (used for template substitution)
  sendDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    idempotencyKey?: string,  // optional - prevents duplicate sends if called multiple times
  ): Promise<void>;           // Promise<void> = returns nothing, just completes

  sendToQueue(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;

  // roleIds: string[] = array of Discord role IDs ([] is array syntax)
  // These report failure via the result rather than throwing; callers must check status
  assignRoles(userId: string, roleIds: string[], idempotencyKey?: string): Promise<RoleOperationResult>;
  removeRoles(userId: string, roleIds: string[], idempotencyKey?: string): Promise<RoleOperationResult>;

  // Check if a user has the RA role for a specific hall
  // Used for authorization before processing RA decisions
  isRaForHall(userId: string, hallName: string): Promise<boolean>;
}

// ==================== Data Repositories ====================

// CaseRepository saves and retrieves verification cases from database
export interface CaseRepository {
  // | null = function might return CaseRecord OR null (if not found)
  getActiveCase(userId: string, term: string): Promise<CaseRecord | null>;

  createIfNone(userId: string, term: string, initialState: CaseState): Promise<CaseRecord>;

  // Partial<CaseRecord> = only some fields of CaseRecord (used to update only specific fields)
  // expectedVersion = we only update if version matches (prevents race conditions)
  updateState(
    caseId: string,
    expectedVersion: number,
    toState: CaseState,
    patch?: Partial<CaseRecord>,
  ): Promise<CaseRecord>;

  // The user's approved case for a term, if they are already verified
  getApprovedCase(userId: string, term: string): Promise<CaseRecord | null>;

  // All active or approved cases for a user in a term (used by admin reset)
  listOpenCases(userId: string, term: string): Promise<CaseRecord[]>;

  findById(caseId: string): Promise<CaseRecord | null>;

  // Promise<CaseRecord[]> = returns array of CaseRecord ([] is array syntax)
  listAwaitingRA(): Promise<CaseRecord[]>;

  // Record that reminders up to `remindersSent` thresholds have been sent
  markReminderSent(caseId: string, remindersSent: number, timestamp: Date): Promise<void>;
}

// DecisionRepository saves RA approve/deny decisions
export interface DecisionRepository {
  // "approve" | "deny" = must be one of these two exact string values
  recordDecision(
    caseId: string,
    raUserId: string,
    decision: "approve" | "deny",
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void>;
}

// AuditRepository logs immutable history of all actions on a case
export interface AuditRepository {
  // "user" | "ra" | "system" = one of these three string values
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

export type OutboxKind = 'dm' | 'channel' | 'role_add' | 'role_remove';

// A DM enqueued by the outbox worker only after the job carrying it succeeds
// (e.g. the "approved" DM is sent once the hall role has actually been granted)
export interface OutboxFollowUpDM {
  userId: string;
  template: string;
  data?: Record<string, unknown>;
}

// OutboxJob represents a queued side effect (stored in database for retry logic)
// dm/channel: targetId is the user/channel, template + data is the message
// role_add/role_remove: targetId is the user, data.roleIds lists the roles, template is unused
export interface OutboxJob {
  id: string;
  caseId?: string;
  kind: OutboxKind;
  template: string;
  payload?: {
    targetId: string;
    data?: Record<string, unknown>;
    followUp?: OutboxFollowUpDM;
  };
  attempts: number; // how many times we've tried to send this message
}

export interface EnqueueOptions {
  caseId?: string;
  idempotencyKey?: string;
}

// OutboxRepository implements reliable message delivery with retries
export interface OutboxRepository {
  // options?: { ... } = optional object parameter with optional fields inside
  // Enqueues are idempotent: a second enqueue with the same idempotencyKey is silently ignored
  enqueueDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: EnqueueOptions,
  ): Promise<void>;

  enqueueChannel(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    options?: EnqueueOptions,
  ): Promise<void>;

  // Queue a Discord role change, retried with the roleAssign* limits
  enqueueRoleChange(
    userId: string,
    change: 'add' | 'remove',
    roleIds: string[],
    options?: EnqueueOptions & { followUp?: OutboxFollowUpDM },
  ): Promise<void>;

  // takeDue returns array of jobs ready to send (have exceeded their retry delay)
  takeDue(batchSize: number): Promise<OutboxJob[]>;

  // mark a message as successfully sent
  markSent(jobId: string): Promise<void>;

  // mark as failed but will retry (schedules next retry time)
  markFailed(jobId: string, error: string, retryAt: Date): Promise<void>;

  // give up on this message permanently
  markPermanentlyFailed(jobId: string, error: string): Promise<void>;
}

// ==================== Transactions ====================

// Repositories bound to a single database transaction
export interface TransactionalRepositories {
  cases: CaseRepository;
  decisions: DecisionRepository;
  audit: AuditRepository;
  outbox: OutboxRepository;
}

// Runs work atomically: a state change, its audit entry, and its outbox messages commit together or not at all
export interface UnitOfWork {
  run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T>;
}

// ==================== Logging ====================

// Logger abstraction - allows different logging implementations (Pino, Winston, etc)
export interface Logger {
  // Function overloading
  // Can call info(obj, msg) or info(msg)
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
}
