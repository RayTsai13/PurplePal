# PurplePal CLI Cheat Sheet

**Run Format:** `npm run cli -- <command>`

## Interactive Mode

```bash
npm run cli -- interactive
# or
npm run cli -- i
```

Starts an interactive REPL session where you can run multiple commands without the `npm run cli --` prefix:

```
purplepal> status
purplepal> case list-pending
purplepal> case inspect clv123abc
purplepal> config show
purplepal> exit
```

Type `help` inside the REPL to see all available commands.

## System Status & Health

```bash
npm run cli -- status
# Shows database connection, case counts by state, outbox queue stats

npm run cli -- audit <caseId>
# View complete audit trail for a specific case
```

## Case Management

```bash
# List & Inspect
npm run cli -- case list-pending
# List all cases awaiting RA review

npm run cli -- case inspect <caseId>
# View case details, audit trail, and decision info

# Admin Actions
npm run cli -- case force-expire <caseId>
# Manually expire a case (optional: -r, --reason <reason>)

npm run cli -- case force-decide <caseId> <approve|deny>
# Override RA decision (optional: -r, --reason <reason>)

npm run cli -- case reset-user <userId>
# Clear user's verification (optional: -t, --term <term>)
```

## Notification Queue (Outbox)

```bash
npm run cli -- outbox list
# List pending/failed messages (optional: -s, --status <status> -l, --limit <N>)

npm run cli -- outbox inspect <jobId>
# View full message details including payload

npm run cli -- outbox retry <jobId>
# Reset failed message for immediate retry

npm run cli -- outbox purge-failed
# Delete all permanently failed messages (add -y, --yes to skip confirmation)
```

## Configuration

```bash
npm run cli -- config show
# Display current term, timeouts, limits, and halls overview

npm run cli -- config halls
# List all configured halls with Discord IDs and room patterns

npm run cli -- config templates
# Show all DM and RA queue message templates
```

## Common Examples

```bash
# Check system health
npm run cli -- status

# Find a specific user's case
npm run cli -- case inspect clv1234abc5678def

# See what's pending
npm run cli -- case list-pending

# Manually approve a case
npm run cli -- case force-decide clv1234abc5678def approve -r "Verified in person"

# Retry a failed notification
npm run cli -- outbox retry clv9876xyz

# Check your configuration
npm run cli -- config show
```