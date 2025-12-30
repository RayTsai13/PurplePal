# PurplePal Architecture

## Overview

PurplePal is a Discord bot for resident verification in university housing. Users verify their residency by providing their hall and room via DMs, then an RA (Resident Assistant) approves or denies the request. The bot uses a state machine to coordinate the verification workflow with reliable message delivery and background task processing.

## Design Pattern: Hexagonal Architecture

The codebase follows hexagonal architecture (ports and adapters pattern) to separate core business logic from infrastructure and external integrations.

```
┌─────────────────────────────────────────────────────┐
│                  External World                      │
│  (Discord API, Database, File System)               │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────┐
│              Adapters Layer                         │
│  (Discord events, Scheduled workers)                │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────┐
│              Ports (Interfaces)                     │
│  (CaseRepository, DiscordService, Config, etc)      │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────┐
│            Core Application Layer                   │
│  (VerificationOrchestrator, State Machine)          │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────┐
│           Infrastructure Layer                      │
│  (Prisma repositories, Discord service impl)        │
└─────────────────────────────────────────────────────┘
```

Benefits of this architecture:

- **Testability**: Core logic can be tested without Discord or database
- **Flexibility**: Easy to swap implementations (SQLite to PostgreSQL, add new adapters)
- **Maintainability**: Clear separation of concerns, each layer has one job
- **Domain Focus**: Business rules live in core, infrastructure details stay separate

## Core Layer: Business Logic

### Location: `src/core/`

The core layer contains all verification workflow logic and domain models. It has no external dependencies except type definitions.

#### VerificationOrchestrator

File: `src/core/application/orchestrator/VerificationOrchestrator.ts`

The orchestrator is a state machine that coordinates the entire verification flow. It receives user actions and transitions cases through defined states.

**State Transitions:**

```
joined
  ↓ (user provides hall via DM)
hall_chosen
  ↓ (user provides room via DM)
awaiting_ra
  ├→ (RA approves) → approved
  ├→ (RA denies) → denied
  └→ (expires after timeout) → expired
```

**Key Methods:**

- `onUserJoined(userId, idempotencyKey)` - Creates new case in joined state
- `onHallChosen(userId, hallName, idempotencyKey)` - Validates hall, transitions to hall_chosen
- `onRoomEntered(userId, roomNumber, idempotencyKey)` - Validates room, transitions to awaiting_ra, queues RA notification
- `onRAResponded(caseId, raUserId, decision, reason, idempotencyKey)` - Processes RA approval/denial with optimistic locking
- `expire(caseId, idempotencyKey)` - Marks case as expired, queues expiration message

**Optimistic Locking:**

Cases use version-based optimistic locking to prevent race conditions when multiple RAs respond simultaneously. The orchestrator checks that the case version matches before allowing state transitions. If versions don't match, it throws an error indicating another RA already processed the case.

**Notifications:**

All user-facing messages are queued via the outbox repository using idempotency keys. This ensures reliable delivery and prevents duplicate messages if the orchestrator is interrupted.

#### Ports Interface

File: `src/core/ports.ts`

Ports define contracts between the core domain and external systems. They're implemented by the infrastructure layer.

**Six Core Ports:**

1. **Config** - Synchronous configuration access
   - `currentTerm()` - Get current academic term
   - `timeouts()` - Get case TTL and reminder intervals
   - `limits()` - Get retry limits and backoff intervals
   - `halls()` - Get hall configurations
   - `messaging()` - Get message templates

2. **CaseRepository** - Persistence for verification cases
   - `getActiveCase(userId, term)` - Get user's case for term
   - `createIfNone(userId, term)` - Atomic create-if-not-exists
   - `updateState(caseId, version, newState)` - Update with optimistic locking
   - `findById(caseId)` - Look up case by ID
   - `listAwaitingRA()` - Get all cases pending RA review
   - `markReminderSent(caseId, timestamp)` - Track reminder delivery
   - `resetCase(userId, term)` - Clear user's verification state
   - `markExpired(caseIds)` - Batch expire multiple cases

3. **DiscordService** - All Discord operations
   - `validateHall(hallName)` - Check if hall exists and get configuration
   - `normalizeRoom(hallName, roomInput)` - Normalize and validate room format
   - `sendDM(userId, template, data)` - Send direct message
   - `sendToQueue(channelId, template, data)` - Send to RA approval queue
   - `assignRoles(userId, roleIds)` - Assign Discord roles to user
   - `removeRoles(userId, roleIds)` - Remove Discord roles from user

4. **DecisionRepository** - RA approval/denial records
   - `authorize(userId, caseRecord)` - Check if user can approve case
   - `recordDecision(caseId, raUserId, decision, reason)` - Store decision

5. **AuditRepository** - Immutable audit trail
   - `record(caseId, action, fromState, toState, actorType, actorId, payload)` - Log action

6. **OutboxRepository** - Reliable message queue
   - `enqueueDM(userId, template, data, options)` - Queue DM message
   - `enqueueChannel(channelId, template, data, options)` - Queue channel message
   - `takeDue(batchSize)` - Get messages ready to send
   - `markSent(jobId)` - Mark message as successfully sent
   - `markFailed(jobId, error, retryAt)` - Schedule retry with backoff
   - `markPermanentlyFailed(jobId, error)` - Give up on message

**Domain Types:**

- `CaseState` - Union type of all valid case states
- `CaseRecord` - Case data with user ID, state, hall, room, version, timestamps
- `OutboxJob` - Message in queue with retry metadata

## Infrastructure Layer: Implementations

### Location: `src/infra/`

Infrastructure provides concrete implementations of all ports.

#### Configuration System

File: `src/infra/config/policySchema.ts` and `src/infra/services/Config.ts`

Configuration is loaded from `config/policy.json` and validated with Zod schemas. The Config service provides synchronous access to settings.

**Example policy.json structure:**

```json
{
  "term": "2024-fall",
  "halls": [
    {
      "name": "North Hall",
      "aliases": ["north", "n"],
      "raRoleId": "123456789",
      "queueChannelId": "987654321",
      "hallRoleId": "111111111",
      "room": {
        "pattern": "^[A-Z]\\d{3}$",
        "example": "A101"
      }
    }
  ],
  "timeouts": {
    "awaitingRA_ttl_hours": 72,
    "reminder_hours": [24, 48]
  },
  "limits": {
    "maxNotificationRetries": 5,
    "notificationBackoffSeconds": [5, 30, 120, 600, 3600],
    "roleAssignMaxRetries": 3,
    "roleAssignRetryBackoffSeconds": [1, 5, 30]
  },
  "messaging": {
    "dm": {
      "welcome": "Welcome! Please tell me which hall you live in.",
      "hall_confirmation": "Thanks for {{hall}}. Which room?",
      "room_confirmation": "Got it. {{hall}} {{room}} submitted for approval.",
      "reminder_user": "Your verification request is still pending. Hall: {{hall}}, Room: {{room}}"
    },
    "ra_queue": {
      "new_request": "Case ID: {{caseId}}\nUser: {{userId}}\nHall: {{hall}}\nRoom: {{room}}\nReact with ✅ to approve or ❌ to deny"
    }
  }
}
```

Hall configurations support room validation with regex patterns (e.g., North Hall rooms must be in format A101, B204, etc).

#### Database Access

File: `src/infra/services/prisma*Service.ts`

Prisma handles all database access with prepared statements. Each repository corresponds to a database table.

**Database Schema Overview:**

```sql
VerificationCase
  id (CUID primary key)
  userId (Discord user ID)
  term (academic term)
  state (enum: joined, hall_chosen, awaiting_ra, approved, denied, expired)
  hall (hall name, nullable)
  room (room number/name, nullable)
  raUserId (RA who approved, nullable)
  version (optimistic lock version)
  expiresAt (expiration timestamp)
  reminderSentAt (last reminder timestamp)
  createdAt, updatedAt
  Unique: (userId, term) - only one active case per term

Decision
  id (CUID)
  caseId (foreign key)
  raUserId (RA who made decision)
  decision (enum: approve, deny)
  reason (optional text)
  idempotencyKey (prevents duplicates)
  decidedAt (timestamp)

AuditLog
  id (CUID)
  caseId (foreign key)
  action (what happened)
  fromState, toState (state transition)
  actorType (system, user, ra)
  actorId (who did it)
  payload (JSON metadata)
  idempotencyKey (prevents duplicates)
  timestamp

Outbox
  id (CUID)
  caseId (foreign key, nullable)
  kind (enum: dm, channel)
  template (message template name)
  payload (JSON: targetId, data)
  status (enum: pending, sent, failed)
  attempts (retry count)
  nextAttemptAt (when to retry)
  lastError (error message from last attempt)
  idempotencyKey (prevents duplicate queuing)
```

**Optimistic Locking Implementation:**

When updating a case state, Prisma checks the version field:

```typescript
await prisma.verificationCase.update({
  where: { id: caseId, version: currentVersion },
  data: {
    state: newState,
    version: { increment: 1 }
  }
})
```

If the version doesn't match (another process updated it), Prisma throws an error. The orchestrator catches this and knows another RA already processed the case.

#### Discord Service

File: `src/infra/services/DiscordService.ts`

Implements all Discord operations. Uses discord.js to send messages, manage roles, and validate hall configurations.

**Key Implementation Details:**

- Hall validation uses HallDirectory (in-memory Map for fast lookups)
- Room normalization applies transformations (uppercase, trim whitespace, fix hyphens)
- Room validation uses regex patterns from policy.json
- DM sending uses Discord API to fetch user and send message
- Queue sending posts to configured hall channel with case details
- Role assignment retries on failure with exponential backoff
- All operations are idempotent (can be safely retried)

#### Outbox Pattern

File: `src/infra/services/prismaOutboxService.ts`

The outbox pattern ensures reliable message delivery even if the bot crashes. Instead of sending messages directly, operations queue them in the database. A background worker periodically drains the queue.

**How it works:**

1. Orchestrator queues message via `outbox.enqueueDM()` instead of sending directly
2. Message stored with `status: pending` and idempotency key
3. OutboxWorker polls database every 2 seconds
4. For each pending message, worker calls `sendDM()` or `sendToQueue()`
5. If send succeeds, message marked `status: sent`
6. If send fails, message marked `status: pending` with next retry time
7. Retries use exponential backoff: [5s, 30s, 2m, 10m, 1h]
8. After max retries (default 5), message marked `status: failed` permanently

**Benefits:**

- Messages survive bot restarts
- No message loss if network blips occur
- Idempotency keys prevent duplicates if worker crashes mid-send
- CLI can inspect and retry failed messages
- Database is single source of truth for messages

## Adapters Layer: External Integrations

### Location: `src/adapters/`

Adapters connect the core domain to Discord and background jobs.

#### Discord Bot

File: `src/adapters/discord/DiscordClient.ts` and `src/adapters/discord/VerificationBot.ts`

**DiscordClient** manages the discord.js client lifecycle:
- Configures intents (which events to receive)
- Listens for ClientReady event
- Provides start() and shutdown() methods
- Exposes raw SDK for event binding

**VerificationBot** binds Discord events to orchestrator:

- **Slash Commands**: Routes /verify, /verify-decision, /verify-reset
- **Direct Messages**: Handles hall and room selection
- **Reactions**: Processes emoji approvals on queue messages

**Authorization:**

RAs can only approve cases from their hall. Check order:
1. Is user a moderator? → Yes, can approve anything
2. Does case have a hall? → No, reject
3. Get hall configuration and RA role ID
4. Fetch user's roles from Discord
5. Does user have the RA role? → Yes, authorized

**Partial Object Handling:**

Discord events sometimes provide "partial" objects (lazy-loaded placeholders). The bot fetches full objects before processing:

```typescript
if (user.partial) user = await user.fetch()
if (reaction.partial) reaction = await reaction.fetch()
```

**Race Condition Protection:**

When multiple RAs react simultaneously, optimistic locking prevents double-approval. If another RA wins the race, the orchestrator throws a version error. The bot catches this, removes the reaction, and logs that the case was already processed.

#### Background Workers

Files: `src/adapters/scheduler/OutboxWorker.ts` and `src/adapters/scheduler/TimeoutWorker.ts`

**OutboxWorker** (runs every 2 seconds):

1. Get up to 10 pending messages via `takeDue(batchSize)`
2. For each message:
   - Try to send via Discord
   - If success: mark sent
   - If failure:
     - If max retries exceeded: mark permanently failed
     - Else: schedule retry with exponential backoff
3. Reschedule next tick in 2 seconds

Error handling: One failed message doesn't stop processing others. Each message processed independently.

**TimeoutWorker** (runs every 60 seconds):

1. Get all cases in awaiting_ra state
2. For each case:
   - If expired (expiresAt <= now): call orchestrator.expire()
   - If reminder not sent and elapsed time matches reminder hour:
     - Queue reminder DM
     - Mark reminder sent to prevent duplicates
3. Reschedule next tick in 60 seconds

Reminders work with idempotency keys to prevent duplicate DMs if the worker crashes mid-operation.

## Data Flow: Complete Verification Journey

### User Initiates Verification

1. User runs `/verify` in Discord
2. DiscordBot.startVerification() handles command
3. Orchestrator.onUserJoined() is called
   - Creates case in database (state: joined)
   - Queues welcome DM via outbox
4. User sees "Check your DMs"

### User Selects Hall

1. User DMs "North" to bot
2. DiscordBot.handleMessage() receives DM
3. Gets user's active case from database
4. Case state is "joined", so calls orchestrator.onHallChosen(userId, "North")
5. Orchestrator:
   - Validates hall via DiscordService
   - Updates case to "hall_chosen" state
   - Queues confirmation message via outbox
6. OutboxWorker picks up message and sends it
7. User sees "Thanks for North Hall. Which room?"

### User Selects Room

1. User DMs "A101" to bot
2. DiscordBot.handleMessage() receives DM
3. Case state is "hall_chosen", so calls orchestrator.onRoomEntered(userId, "A101")
4. Orchestrator:
   - Normalizes room (uppercase, trim)
   - Validates against hall's room pattern
   - Updates case to "awaiting_ra" state
   - Sets expiration timer (e.g., 72 hours from now)
   - Queues message to RA queue channel with case details
5. OutboxWorker sends queue message with case ID and approval buttons
6. RAs see: "Case ID: clx123...\nUser: user123\nHall: North\nRoom: A101"

### RA Approves/Denies

**Via Slash Command:**

1. RA runs `/verify-decision case-id approve`
2. DiscordBot.handleDecision() validates:
   - Case exists and is in awaiting_ra
   - RA is authorized (has RA role or is moderator)
3. Calls orchestrator.onRAResponded(caseId, raUserId, "approve", reason)
4. Orchestrator:
   - Checks version matches (optimistic locking)
   - Updates case to "approved" state
   - Assigns hall role to user
   - Queues approval message via outbox
   - Records decision in Decision table
   - Logs action in AuditLog
5. OutboxWorker sends approval message to user

**Via Emoji Reaction:**

1. RA reacts with ✅ on queue message
2. DiscordBot.handleReaction() processes reaction:
   - Fetches partial objects (user, reaction, message)
   - Validates it's a bot message in the guild
   - Extracts case ID from message content via regex
   - Checks if case exists and is awaiting_ra
   - Verifies RA is authorized
3. Calls orchestrator.onRAResponded() same as above
4. Removes reaction to indicate it was processed

### Timeout and Expiration

1. TimeoutWorker checks awaiting_ra cases every 60 seconds
2. If case.expiresAt <= now:
   - Calls orchestrator.expire()
   - Updates case to "expired" state
   - Queues expiration message via outbox
3. User receives: "Your verification request has expired. Run /verify to try again"

### Reminders

1. TimeoutWorker checks awaiting_ra cases every 60 seconds
2. If case.reminderSentAt is null and enough time has elapsed:
   - Calculates hours since case.updatedAt
   - Checks if hours >= any configured reminder hour
   - Queues reminder DM with hall and room info
   - Marks reminderSentAt to prevent duplicates
3. User receives: "Your verification is still pending. Hall: North, Room: A101"

## Message Reliability

The outbox pattern ensures messages are delivered at least once:

**Scenario: Bot crashes while sending message**

1. Message queued with status: pending, nextAttemptAt: now
2. OutboxWorker fetches it
3. Sends to Discord
4. Bot crashes before marking sent
5. On restart, OutboxWorker sees pending message
6. Tries to send again (idempotency key prevents duplicate in Discord)
7. Marks sent

**Scenario: Network error**

1. Message queued, status: pending
2. OutboxWorker tries to send
3. Network error thrown
4. Message marked: status: pending, nextAttemptAt: now + 5 seconds
5. OutboxWorker retries in 5 seconds
6. Success, marks sent

**Scenario: Max retries exceeded**

1. Message fails 5 times
2. OutboxWorker marks: status: failed
3. Admin can view failed messages: `npm run cli -- outbox list -s failed`
4. Admin can retry: `npm run cli -- outbox retry job-id`
5. Message reset to pending, processed again

## Concurrency and Race Conditions

### Case State Updates

Multiple RAs might respond to the same case simultaneously. The orchestrator uses optimistic locking:

1. RA1 fetches case, version: 5
2. RA2 fetches case, version: 5
3. RA1 updates case WHERE version = 5, increments to 6 ✓
4. RA2 updates case WHERE version = 5 ✗ (now version 6)
5. RA2's update fails, orchestrator throws error
6. DiscordBot catches error, logs "case already processed"
7. RA2's reaction removed to indicate conflict

### Message Duplication

Idempotency keys prevent duplicate messages if operations are retried:

1. Orchestrator queues DM with idempotencyKey: "room-entry-user123"
2. Message inserted into database
3. OutboxWorker processes it
4. Send succeeds but database update fails (crash)
5. Bot restarts, OutboxWorker fetches same message again
6. Sends again, but Discord deduplicates based on content
7. Idempotency key in database prevents duplicate database record

### Worker Crashes

Workers use timeouts with proper cleanup:

1. OutboxWorker starts tick() at 2s interval
2. Tick processes batch and schedules next tick
3. If error occurs, catch block logs it and reschedules
4. If bot crashes mid-tick, database state is preserved
5. On restart, workers resume from database state

## Dependency Injection

File: `src/infra/container.ts`

The container wires all dependencies together at startup:

1. Load environment variables and validate with Zod
2. Initialize Prisma client and connect to database
3. Initialize logger with redaction for sensitive fields
4. Create Config service from policy.json
5. Create repository implementations (Prisma-based)
6. Create DiscordService
7. Create VerificationOrchestrator with all dependencies
8. Create DiscordClient and VerificationBot
9. Start background workers
10. Connect Discord bot to Discord

This allows swapping implementations (e.g., mock repositories for testing) by changing the container.

## Scaling Considerations

### Current Limitations

- Single instance deployment (no distributed worker coordination)
- In-memory hall directory (small number of halls)
- No database connection pooling configuration
- Outbox worker processes one batch at a time

### For Scaling Up

1. **Multiple Bot Instances**: Use database lock on outbox worker to ensure only one instance processes messages at a time
2. **High Volume**: Increase outbox batchSize and worker interval based on message throughput
3. **Database**: Enable Prisma connection pooling (PgBouncer) for PostgreSQL
4. **Caching**: Add Redis for hall directory caching across instances
5. **Monitoring**: Add metrics for case throughput, message delivery latency, error rates

## Security Considerations

1. **Environment Variables**: Sensitive data (.env) stored locally, never committed
2. **Discord Tokens**: Logged with redaction in logger, never exposed in errors
3. **Authorization**: All RA operations checked against Discord roles
4. **SQL Injection**: Prisma prevents via prepared statements
5. **Idempotency Keys**: Prevent replay attacks and double-submissions
6. **Error Messages**: Avoid leaking internal IDs or database errors to users

## Testing Strategy

The hexagonal architecture enables comprehensive testing:

1. **Unit Tests**: Test orchestrator with mock repositories (no database needed)
2. **Integration Tests**: Test with real Prisma SQLite in-memory database
3. **E2E Tests**: Run full bot against test Discord server

Example test of orchestrator without database:

```typescript
const mockCaseRepo = {
  getActiveCase: vi.fn().mockResolvedValue(null),
  createIfNone: vi.fn().mockResolvedValue({ id: 'case1', state: 'joined' })
}
const orchestrator = new VerificationOrchestrator(mockCaseRepo, ...)
await orchestrator.onUserJoined('user1', 'msg1')
expect(mockCaseRepo.createIfNone).toHaveBeenCalledWith('user1', 'term')
```

## Summary

PurplePal uses hexagonal architecture to clearly separate concerns:

- **Core Domain**: State machine and business rules (framework-agnostic)
- **Ports**: Contracts between core and infrastructure
- **Infrastructure**: Database, Discord API, configuration
- **Adapters**: Discord bot and background workers

This design enables reliable message delivery (outbox pattern), safe concurrent operations (optimistic locking), and flexible deployment (CLI, bot, workers can run separately).
