# PurplePal CLI Cheat Sheet

## Getting Started

```bash
npm run cli -- interactive
# or
npm run cli -- i
```

This starts an interactive session where you can run commands directly:

```
PurplePal CLI - Interactive Mode
Type "help" for available commands or "exit" to quit

purplepal> status
purplepal> case list-pending
purplepal> case inspect clv123abc
purplepal> config show
purplepal> exit
```

## Interactive Commands

Once inside the interactive CLI, use these commands:

### System

| Command | Description |
|---------|-------------|
| `status` | System health, case counts, outbox stats |
| `help` | Show all available commands |
| `exit` | Exit the CLI |

### Case Management

| Command | Description |
|---------|-------------|
| `case list-pending` | List cases awaiting RA review |
| `case inspect <caseId>` | View case details and audit trail |
| `case force-expire <caseId> [-r reason]` | Expire an active case and DM the user |
| `case force-decide <caseId> <approve\|deny> [-r reason]` | Admin override decision (approval grants the hall role) |
| `case reset-user <userId> [-t term]` | Cancel the user's cases and revoke their hall role (audit kept) |

### Notification Queue

| Command | Description |
|---------|-------------|
| `outbox list` | List pending/failed messages |
| `outbox inspect <jobId>` | View message details and payload |
| `outbox retry <jobId>` | Retry a failed job with a fresh attempt budget |
| `outbox purge-failed` | Delete all failed messages |

### Configuration

| Command | Description |
|---------|-------------|
| `config show` | Display current configuration |
| `config halls` | List all configured halls |
| `config templates` | Show message templates |
| `config validate` | Validate `config/policy.json` (non-interactive CLI only; the bot reloads the file itself) |

## Example Session

```
purplepal> status
Database connection: OK

=== Current Term: Fall 2025 ===

Case Statistics:
┌───────────────┬───────┐
│ State         │ Count │
├───────────────┼───────┤
│ awaiting_ra   │ 3     │
│ approved      │ 42    │
└───────────────┴───────┘

purplepal> case list-pending

Found 3 pending case(s):

┌──────────────┬─────────────┬──────────┬────────┐
│ ID           │ User ID     │ Hall     │ Room   │
├──────────────┼─────────────┼──────────┼────────┤
│ clv123abc... │ 12345678... │ Allison  │ A-201  │
│ clv456def... │ 87654321... │ Bobb     │ B-312  │
└──────────────┴─────────────┴──────────┴────────┘

purplepal> case force-decide clv123abc approve
✓ Case clv123abc approved successfully

purplepal> exit
Goodbye!
```

## Running in Docker

```bash
docker exec -it purplepal-bot npm run cli -- interactive
```

## One-Off Commands (Alternative)

If you prefer running single commands without the interactive session:

```bash
npm run cli -- status
npm run cli -- case list-pending
npm run cli -- case inspect <caseId>
npm run cli -- config show
```