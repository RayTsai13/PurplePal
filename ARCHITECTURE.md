# PurplePal Architecture

## Overview

PurplePal is a Discord bot for resident verification in university housing. Users verify their residency by providing their hall and room via DMs, then an RA (Resident Assistant) approves or denies the request. The bot uses a state machine to coordinate the verification workflow with reliable message delivery and background task processing.

## Design Pattern: Hexagonal Architecture

The codebase follows hexagonal architecture (ports and adapters pattern) to separate core business logic from infrastructure and external integrations.

```
┌─────────────────────────────────────────────────────┐
│                  External World                     │
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
hall_chosen  ←─ (a hall name sent here changes the hall)
  ↓ (user provides room number via DM)
room_number_entered
  ↓ (user provides unit via DM)
awaiting_ra
  ├→ (RA/moderator approves) → approved
  ├→ (RA/moderator denies)   → denied
  └→ (expires after timeout) → expired

joined / hall_chosen / room_number_entered ──(/verify-reset)──→ cancelled
any active state ──(CLI force-expire)──→ expired
active or approved ──(CLI reset-user)──→ cancelled
```

The database allows at most one *active* case (`joined`, `hall_chosen`, `room_number_entered`, `awaiting_ra`) per user per term, enforced by a partial unique index. A user with an `approved` case for the term cannot start another one.

**Key Methods:**

- `onMemberJoined(userId, key)` - New guild member: assigns the unverified role and starts verification, or restores the hall role if already verified this term
- `onUserJoined(userId, key)` - `/verify`: creates a case in `joined` (or reports the existing/approved one)
- `onDirectMessage(userId, content, key)` - Routes a DM to the hall, room number, or unit step based on case state
- `onHallChosen` / `onRoomNumberEntered` / `onRoomEntered` - The three DM steps. Room number and unit are validated against the hall's `roomNumberPattern` / `unitPattern`, joined as `{prefix}-{number}-{unit}`, then checked against the hall's full `pattern`
- `canDecide(caseId, userId)` - Whether a user may decide a case (moderator or hall RA, never the case owner)
- `onRAResponded(caseId, actorId, decision, reason?, key?, { asAdmin? })` - Records a decision and returns a typed result: `{ ok: true, state }` or `{ ok: false, reason: 'not_found' | 'not_pending' | 'unauthorized' | 'conflict' }`
- `expire(caseId, key, { admin? })` - Expires a pending case (any active case for admins)
- `sendReminder(case, n)` - Sends the nth reminder to the user and the hall's RA queue
- `onUserReset(userId, key)` / `adminResetUser(userId, term, actorId)` - Cancel cases; admin reset also revokes the hall role

**Transactions:**

Every transition runs inside one database transaction via the `UnitOfWork` port: the state change, decision record, audit entry, and outbox messages commit together or not at all. Discord reads (RA role checks) happen before the transaction starts.

**Optimistic Locking:**

`updateState` includes the expected version in the `UPDATE ... WHERE` clause, so when two RAs respond at once exactly one update succeeds. The loser gets a `ConcurrencyError`, which `onRAResponded` reports as `{ ok: false, reason: 'conflict' }`.

**Side effects go through the outbox:**

DMs, queue-channel posts, and Discord role changes are all queued in the outbox with idempotency keys and delivered by `OutboxWorker`. On approval the hall role is granted first; the "approved" DM is attached as a follow-up and only sent once the role change succeeds.

#### Ports Interface

File: `src/core/ports.ts`

Ports define contracts between the core domain and external systems. They're implemented by the infrastructure layer.

**Core Ports:**

1. **Config** - Synchronous configuration access
   - `currentTerm()`, `timeouts()`, `limits()`, `messaging()`, `halls()`
   - `hall(nameOrAlias)` - Look up a hall by name or alias (case-insensitive)
   - `lobbyChannelId()`, `unverifiedRoleId()`, `reload()`

2. **CaseRepository** - Persistence for verification cases
   - `getActiveCase(userId, term)` / `getApprovedCase(userId, term)` / `listOpenCases(userId, term)`
   - `createIfNone(userId, term, state)` - Create unless an active case exists (throws `ConcurrencyError` on a concurrent create)
   - `updateState(caseId, version, newState, patch)` - Update with optimistic locking (throws `ConcurrencyError` on version mismatch)
   - `findById(caseId)`, `listAwaitingRA()`
   - `markReminderSent(caseId, remindersSent, timestamp)` - Track how many reminder thresholds were sent

3. **DiscordService** - Discord operations
   - `normalizeRoom(hallName, roomInput)` - Normalize and validate room format
   - `sendDM(userId, template, data)` / `sendToQueue(channelId, template, data)`
   - `assignRoles(userId, roleIds)` / `removeRoles(userId, roleIds)` - Return a status instead of throwing
   - `isRaForHall(userId, hallName)` - Check the hall's RA role

4. **DecisionRepository** - RA approval/denial records
   - `recordDecision(caseId, raUserId, decision, reason, key)` - Store decision

5. **AuditRepository** - Immutable audit trail (cases with audit history can't be deleted)
   - `record(caseId, action, fromState, toState, actorType, actorId, payload, key)` - Log action

6. **OutboxRepository** - Reliable side-effect queue
   - `enqueueDM`, `enqueueChannel`, `enqueueRoleChange(userId, 'add' | 'remove', roleIds, { followUp? })` - Idempotent: a repeated key is ignored
   - `takeDue(batchSize)` - Claim due jobs (`FOR UPDATE SKIP LOCKED`, 60s lease)
   - `markSent`, `markFailed(jobId, error, retryAt)`, `markPermanentlyFailed`

7. **UnitOfWork** - `run(work)` executes `work` with transaction-bound repositories

**Domain Types:**

- `CaseState` - Union type of all valid case states
- `CaseRecord` - Case data with user ID, state, hall, room, version, timestamps
- `OutboxJob` - Message in queue with retry metadata

## Infrastructure Layer: Implementations

### Location: `src/infra/`

Infrastructure provides concrete implementations of all ports.

#### Configuration System

File: `src/infra/config/policySchema.ts` and `src/infra/services/Config.ts`

Configuration is loaded from `config/policy.json` and validated with Zod at startup. Validation catches problems before they can fail a user's verification midway:

- Every template the code sends must be present (`already_verified` has a built-in default)
- Discord IDs must be numeric snowflakes, so unreplaced placeholders are rejected
- Room regexes must compile

`ConfigImpl` owns the `HallDirectory` used for name/alias lookups and rebuilds it on reload.

**Example hall entry:**

```json
{
  "name": "Summit",
  "aliases": ["summit"],
  "raRoleId": "1430120010969383008",
  "queueChannelId": "1430120254985601034",
  "hallRoleId": "1430118304600555531",
  "room": {
    "pattern": "^S-\\d{3}-[A-D]$",
    "example": "S-312-A",
    "prefix": "S",
    "roomNumberPattern": "^\\d{3}$",
    "roomNumberExample": "312",
    "unitPattern": "^[A-D]$",
    "unitExample": "A",
    "normalize": { "uppercase": true, "trimSpaces": true }
  }
}
```

`roomNumberPattern`, `roomNumberExample`, `unitPattern`, and `unitExample` default to the values shown. See `config/policy.example.json` for a complete file, including every template.

**Hot reload:** the running bot watches `config/policy.json` and also reloads on `SIGHUP`. An invalid file is logged and ignored, so the previous configuration stays in effect. `npm run cli -- config validate` checks a file before you save it into place.

#### Database Access

File: `src/infra/services/prisma*Service.ts`, `src/infra/services/prismaUnitOfWork.ts`

Prisma handles all database access. Repositories accept either the root client or a transaction client, so `PrismaUnitOfWork` can hand the orchestrator transaction-bound instances.

**Database Schema Overview:**

```sql
VerificationCase
  id (CUID primary key)
  userId, term
  state (enum: joined, hall_chosen, room_number_entered, awaiting_ra, approved, denied, expired, cancelled)
  hall, roomNumber, room (nullable)
  raUserId (who decided, nullable)
  version (optimistic lock version)
  expiresAt, submittedAt (when it entered awaiting_ra)
  reminderSentAt, remindersSent (reminder thresholds already sent)
  createdAt, updatedAt
  Partial unique index: (userId, term) WHERE state is active, i.e. one active case per user per term

Decision
  id, caseId (unique), raUserId, decision (approve | deny), reason, idempotencyKey, decidedAt

AuditLog
  id, caseId (ON DELETE RESTRICT: cases with history can't be deleted)
  action, fromState, toState, actorType (system | user | ra), actorId, payload, idempotencyKey, timestamp

Outbox
  id, caseId (nullable)
  kind (enum: dm, channel, role_add, role_remove)
  template (message text; unused for role jobs)
  payload (JSON: targetId, data, optional followUp DM)
  status (pending | sent | failed), attempts, nextAttemptAt, lastError
  idempotencyKey (unique)
```

The partial unique index is created by raw SQL in migration `20261006000000_integrity_fixes`, because Prisma's schema language can't express it.

**Optimistic Locking Implementation:**

```typescript
const { count } = await prisma.verificationCase.updateMany({
  where: { id: caseId, version: expectedVersion },
  data: { state: newState, version: { increment: 1 } },
});
if (count === 0) throw new ConcurrencyError(...);
```

Because the version check is part of the `UPDATE`, Postgres serializes concurrent writers on the row lock and only the first one matches.

#### Discord Service

File: `src/infra/services/DiscordService.ts`

Implements the `DiscordService` port with discord.js.

- Room normalization applies the hall's `normalize` rules (uppercase, trim, fix hyphens) and checks the full `pattern`
- `sendDM` / `sendToQueue` render templates and post them
- `assignRoles` / `removeRoles` return `{ status: 'failure' }` instead of throwing; the outbox worker turns that into a retry
- `isRaForHall` checks the member's roles for the hall's RA role

#### Outbox Pattern

File: `src/infra/services/prismaOutboxService.ts`

All Discord side effects are written to the outbox in the same transaction as the state change that causes them, then delivered by a background worker. A crash can never leave a case approved without its DM and role change queued.

**How it works:**

1. The orchestrator enqueues jobs (`dm`, `channel`, `role_add`, `role_remove`) inside its transaction. A repeated idempotency key is a no-op (`ON CONFLICT DO NOTHING`), so it never aborts the transaction
2. `OutboxWorker` claims due jobs every 2 seconds with `FOR UPDATE SKIP LOCKED`, leasing each one for 60s
3. It performs the job. A role change reporting failure counts as an error
4. On success the job is marked `sent`, and any `followUp` DM is enqueued (keyed on the job ID)
5. On failure it is rescheduled with backoff (`notificationBackoffSeconds` or `roleAssignRetryBackoffSeconds`)
6. After `maxNotificationRetries` / `roleAssignMaxRetries` total attempts it is marked `failed`

**Benefits:**

- Side effects survive bot restarts and network blips
- State and side effects can't diverge
- Users are told they're approved only after they actually have the role
- CLI can inspect and retry failed jobs (`outbox retry` resets the attempt budget)

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

**VerificationBot** translates Discord events into orchestrator calls. It holds no workflow or authorization rules itself:

- **Member join** → `onMemberJoined`
- **/verify** → `onUserJoined`; **/verify-reset** → `onUserReset`
- **/verify-decision** → `onRAResponded`, replying with a message for each result (`not_found`, `not_pending`, `unauthorized`, `conflict`)
- **Direct Messages** → `onDirectMessage`
- **Reactions** → `canDecide` check (silently removes reactions from non-RAs), then `onRAResponded`

If a handler throws after deferring a reply, the bot edits the reply with an error, so users aren't left on "thinking...".

**Authorization** (in the orchestrator):
1. The case owner can never decide their own case
2. Moderators (`ADMINS_IDS`) can decide any case
3. Otherwise the user must have the hall's RA role

The admin CLI passes `asAdmin`, which skips these checks.

**Partial Object Handling:**

Discord events sometimes provide "partial" objects (lazy-loaded placeholders). The bot fetches full objects before processing:

```typescript
if (user.partial) user = await user.fetch()
if (reaction.partial) reaction = await reaction.fetch()
```

#### Background Workers

Files: `src/adapters/scheduler/OutboxWorker.ts` and `src/adapters/scheduler/TimeoutWorker.ts`

Both start only after the Discord client is ready.

**OutboxWorker** (runs every 2 seconds): see [Outbox Pattern](#outbox-pattern). One failed job doesn't stop the others.

**TimeoutWorker** (runs every 60 seconds), for each `awaiting_ra` case:
- If `expiresAt <= now`: `orchestrator.expire()`
- Otherwise, count the `reminder_hours` thresholds elapsed since `submittedAt`. If that's more than `remindersSent`, call `orchestrator.sendReminder()`. It DMs the user, posts `ra_reminder` to the hall queue (with a `Case ID:` line RAs can react to), and records the count
- Errors are logged per case, so one bad case doesn't block the rest

## Data Flow: Complete Verification Journey

### User Initiates Verification

1. A member joins (or runs `/verify`)
2. `onMemberJoined` / `onUserJoined`, in one transaction:
   - creates the case in `joined`
   - queues the unverified role (join only)
   - queues the welcome DM
3. Already verified this term? The user is told so instead; on rejoin the hall role is re-granted

### User Provides Hall, Room Number, Unit

1. The user DMs the bot; `onDirectMessage` routes on case state
2. `joined`: the hall is resolved by name/alias → `hall_chosen`, then the bot asks for the room number
3. `hall_chosen`: a hall name changes the hall; otherwise the text is validated as the room number → `room_number_entered`
4. `room_number_entered`: the unit is validated, `{prefix}-{number}-{unit}` is checked against the hall pattern → `awaiting_ra`. In the same transaction:
   - set `expiresAt` / `submittedAt`
   - queue the user notice
   - queue the RA queue card (ending in `Case ID: …`)

### RA Approves/Denies

Via `/verify-decision case_id decision [reason]`, or by reacting ✅/❌ on the queue card:

1. The orchestrator checks the case exists and is `awaiting_ra`, then authorizes the actor
2. In one transaction it:
   - updates the state (version-checked)
   - records the decision and audit entry
   - queues side effects: on approval, a `role_add` for the hall role carrying the "approved" DM as a follow-up, plus a `role_remove` for the unverified role; on denial, the denial DM
   - queues a decision ack to the queue channel
3. If another RA won the race, the result is `conflict` and nothing is written

### Timeout, Expiration, and Reminders

See TimeoutWorker above. Expired users get the `expired` DM and can run `/verify` again.

### Resets

- `/verify-reset` cancels a case that hasn't reached RA review yet. After that, the user has to wait for the RA or the timeout
- `npm run cli -- case reset-user <id>` cancels active and approved cases, queues removal of the hall role, and re-adds the unverified role

Cases are never deleted, so the audit trail is preserved.

## Message Reliability

**Scenario: Bot crashes mid-transition**

The transaction rolls back. Nothing was written, and the user's next message (or the RA's next click) retries cleanly.

**Scenario: Bot crashes while sending**

The job is still `pending` (its lease expires after 60s), so it is retried. Delivery is at-least-once, so a crash in the narrow window between Discord accepting a message and `markSent` can produce a duplicate.

**Scenario: Max attempts exceeded**

1. The job is marked `failed`
2. View failed jobs: `npm run cli -- outbox list -s failed`
3. Retry: `npm run cli -- outbox retry <jobId>` resets it to pending with a fresh attempt budget

## Concurrency and Race Conditions

### Case State Updates

1. RA1 and RA2 both read the case at version 5
2. RA1's `UPDATE ... WHERE version = 5` succeeds (now 6)
3. RA2's update matches 0 rows → `ConcurrencyError`, and its transaction (decision, audit, outbox) rolls back
4. RA2 gets "Case was just decided by someone else" (slash command) or has their reaction removed

### Duplicate Cases

A member join and a `/verify` arriving together both try to create a case. The partial unique index rejects the second insert, and the orchestrator retries once, taking the "already in progress" path.

### Message Duplication

Each enqueue carries an idempotency key derived from the triggering event (interaction ID, message ID, case ID + reminder number, …). Re-processing the same event enqueues nothing new.

## Dependency Injection

File: `src/infra/container.ts` (bot) and `src/cli/container.ts` (CLI)

The bot container:

1. Loads and validates `config/policy.json` (`ConfigImpl.fromFile()`)
2. Creates the Prisma client, repositories, `PrismaUnitOfWork`, `DiscordServiceImpl`
3. Creates the `VerificationOrchestrator` (with `ADMINS_IDS` as moderators) and binds `VerificationBot`
4. `start()`:
   - connects the database
   - logs in to Discord and waits for ready
   - starts the workers
   - starts watching `policy.json` and listening for SIGHUP

The CLI container builds the same orchestrator with an offline `DiscordService`. Admin actions only write to the database and outbox, and the running bot delivers them.

## Scaling Considerations

### Current Limitations

- Single bot instance assumed (outbox claiming is already safe for more than one worker, but the TimeoutWorker isn't coordinated)
- In-memory hall directory (small number of halls)
- No database connection pooling configuration

### For Scaling Up

1. **Multiple Bot Instances**: Coordinate the TimeoutWorker (e.g., Postgres advisory lock); idempotency keys already make duplicate expiry or reminder attempts harmless
2. **High Volume**: Increase outbox batchSize and worker interval based on message throughput
3. **Database**: Enable Prisma connection pooling (PgBouncer) for PostgreSQL
4. **Monitoring**: Add metrics for case throughput, message delivery latency, error rates

## Security Considerations

1. **Environment Variables**: Sensitive data (.env) stored locally, never committed
2. **Discord Tokens**: Logged with redaction in logger, never exposed in errors
3. **Authorization**: Centralized in the orchestrator, using Discord roles plus the `ADMINS_IDS` moderator list; self-verification is always refused
4. **SQL Injection**: Prisma prevents via prepared statements (the one raw query is a tagged template with bound parameters)
5. **Idempotency Keys**: Prevent replay attacks and double-submissions
6. **Error Messages**: Avoid leaking internal IDs or database errors to users

## Testing Strategy

1. **Unit Tests** (`src/tests/core`, `src/tests/workers`): Orchestrator and workers with mocked ports. The mocked `UnitOfWork` hands the work the same repository mocks
2. **Integration Tests** (`src/tests/repositories`): Run against a real migrated PostgreSQL when `TEST_DATABASE_URL` is set (CI sets it). They cover:
   - concurrent version-checked updates
   - the one-active-case index
   - transaction rollback
   - idempotent enqueue inside a transaction
   - outbox claiming and the timezone handling of its lease
   - audit-protected deletes
3. **Manual E2E**: Run the bot against a test Discord server

```typescript
const uow = { run: vi.fn((work) => work({ cases, decisions, audit, outbox })) };
const orchestrator = new VerificationOrchestrator({ discord, config, cases, uow, logger, moderatorIds: ['mod-1'] });
await expect(orchestrator.onRAResponded('case-1', 'mod-1', 'approve')).resolves.toEqual({ ok: true, state: 'approved' });
```

## Summary

PurplePal uses hexagonal architecture to clearly separate concerns:

- **Core Domain**: State machine and business rules (framework-agnostic)
- **Ports**: Contracts between core and infrastructure
- **Infrastructure**: Database, Discord API, configuration
- **Adapters**: Discord bot and background workers

This design enables reliable message delivery (outbox pattern), safe concurrent operations (optimistic locking), and flexible deployment (CLI, bot, workers can run separately).
