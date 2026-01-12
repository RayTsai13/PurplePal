// ==================== Domain Types ====================

// CaseState is a union type that can only be one of these exact strings
// The pipe | symbol means "or" - the state must be one of these values
// This prevents invalid state values from accidentally being used
export type CaseState =
  | "joined"
  | "hall_chosen"
  | "awaiting_ra"
  | "approved"
  | "denied"
  | "expired";

export interface CaseRecord {
  id: string;             // unique case ID
  userId: string;         // Discord user ID being verified
  term: string;           // academic term (like Fall 2025)
  state: CaseState;       // current state in the verification process
  hall?: string;          // which residence hall - ? means optional (might not have picked yet)
  room?: string;          // room number - optional
  raUserId?: string;      // RA who verified them - optional (might not be done yet)
  version: number;        // increments on each update for race condition prevention
  expiresAt?: Date;       // when this case expires - optional. Date is a TypeScript type for timestamps
  reminderSentAt?: Date;  // when reminder was last sent - optional
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
    pattern: string;      // regex pattern to validate room numbers (like ^A-\\d{3}-[A-D]$)
    example: string;      // example room to show users (like A-101-B)
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

// Message templates used throughout the app
export interface MessageTemplates {
  dm: Record<string, string>;         // Record<string, string> means object with string keys and string values - all DM templates
  ra_queue: Record<string, string>;   // all RA queue notification templates
}

// Config interface - all methods return config without needing to await (no async)
// These are just getter functions that return cached config loaded at startup
export interface Config {
  currentTerm(): string;          // () means this is a function that takes no parameters. : string means it returns a string
  timeouts(): TimeoutConfig;      // returns TimeoutConfig interface
  limits(): LimitsConfig;         // returns LimitsConfig interface
  messaging(): MessageTemplates;  // returns MessageTemplates interface
  halls(): HallConfig[];          // [] means returns an array of HallConfig

  // Lobby channel where unverified users can chat while awaiting verification
  lobbyChannelId(): string | undefined;

  // Role assigned to new members until they complete verification
  unverifiedRoleId(): string | undefined;

  // Reload configuration from disk without restarting the application
  // Returns Promise<void> to indicate async file read operation
  reload(): Promise<void>;
}

// ==================== Discord Operations ====================

// Result object returned when validating a hall name
export interface HallValidationResult {
  valid: boolean;           // whether the hall name was recognized
  normalizedHall?: string;  // the actual hall name if valid (normalized to official name)
  raRoleId?: string;        // Discord role ID for RAs if found
  queueChannelId?: string;  // Discord channel ID for RA queue if found
  hallRoleId?: string;      // Discord role ID to give verified residents if found
}

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

// DiscordService handles all Discord interactions - validation, messaging, and roles
export interface DiscordService {
  validateHall(hall: string): Promise<HallValidationResult>; // Promise<T> = async function returning T, use await

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

  // Promise<number> = returns how many cases were updated
  markExpired(filters?: unknown): Promise<number>;

  findById(caseId: string): Promise<CaseRecord | null>;

  // Promise<CaseRecord[]> = returns array of CaseRecord ([] is array syntax)
  listAwaitingRA(): Promise<CaseRecord[]>;

  markReminderSent(caseId: string, timestamp: Date): Promise<void>;

  resetCase(userId: string, term: string): Promise<void>;
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

// OutboxJob represents a message queued to be sent (stores in database for retry logic)
export interface OutboxJob {
  id: string;
  caseId?: string;
  kind: 'dm' | 'channel'; // | = or, must be one of these two strings
  template: string;
  payload?: {
    targetId: string;
    data?: Record<string, unknown>;
  };
  attempts: number; // how many times we've tried to send this message
}

// OutboxRepository implements reliable message delivery with retries
export interface OutboxRepository {
  // options?: { ... } = optional object parameter with optional fields inside
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

  // takeDue returns array of jobs ready to send (have exceeded their retry delay)
  takeDue(batchSize: number): Promise<OutboxJob[]>;

  // mark a message as successfully sent
  markSent(jobId: string): Promise<void>;

  // mark as failed but will retry (schedules next retry time)
  markFailed(jobId: string, error: string, retryAt: Date): Promise<void>;

  // give up on this message permanently
  markPermanentlyFailed(jobId: string, error: string): Promise<void>;
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
