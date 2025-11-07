## Tech Demo Integration Next Steps

1. **Persistence adapters**
   - Implement Prisma-backed `CaseService`, `DecisionService`, and `AuditService` that operate on the `cases`, `decisions`, and `audit_logs` tables.
   - Add transactional helpers for optimistic concurrency (`version` column) and map audit payloads to JSON.
   - Create an `OutboxRepository` abstraction for workers to enqueue DM/queue notifications instead of sending synchronously.

2. **Discord interaction layer**
   - Register a slash command (e.g. `/verify`) that boots the verification flow by calling `VerificationOrchestrator.onUserJoined`.
   - Add DM component handlers to capture hall + room responses and forward them to `onHallChosen` / `onRoomEntered`.
   - Build RA action buttons (Approve / Deny) that surface `onRAResponded` with proper idempotency keys and authorization checks.

3. **Notification + role services**
   - Implement `NotificationService` using discord.js DM + channel APIs and respect retry limits from `PolicyService.limits`.
   - Wire `RoleService` to grant hall + resident roles when the orchestrator marks a case approved; include retry/backoff support.

4. **Workers + scheduling**
   - Flesh out `OutboxWorker` to drain pending notifications, update attempt counts, and reschedule failures.
   - Implement `TimeoutWorker` to send reminders at `reminder_hours` and expire cases after `awaitingRA_ttl_hours`, delegating to orchestrator `expire`.

5. **Orchestrator logic + tests**
   - Replace the TODO stubs in `VerificationOrchestrator` with the state machine (joined → awaiting_ra → approved/denied/expired).
   - Add Vitest suites for the new services/orchestrator plus integration tests that mock discord + Prisma.
   - Update CI to run prisma format/check and ensure the tech demo path is exercised via automated tests.
