# PurplePal

PurplePal is a Discord bot that checks whether people in a residence hall server actually live there.

Dorm Discord servers tend to fill up with people who don't belong: friends of friends, students from other buildings, the occasional stranger who found an invite link. Checking everyone by hand means RAs end up asking each new member for their room over DMs and keeping track of who they've already confirmed. PurplePal does the asking and the bookkeeping. The RA only has to click approve or deny.

## What it looks like

Someone joins the server. They're given an "unverified" role that hides most channels, and the bot sends them a DM:

> **PurplePal:** Welcome to the server! While you complete verification, you can chat in #lobby.
> Please reply with your residence hall from: Elm, Oak.
>
> **Student:** elm
>
> **PurplePal:** Got it, Elm. What's your room number? (Just the 3 digits, like 312.)
>
> **Student:** 214
>
> **PurplePal:** Thanks! What's your unit letter? (A, B, C, or D)
>
> **Student:** c
>
> **PurplePal:** Thanks! We've pinged the Elm RA to verify E-214-C. We'll update you here.

Meanwhile, a card shows up in Elm's private RA queue channel:

> **Verify jordan#0420 — Elm • E-214-C**
> User: jordan#0420 · Hall: Elm · Room: E-214-C
> Choose Approve or Deny below. Your action is logged.

The RA checks their roster and reacts with ✅ or ❌ (or runs `/verify-decision` if they want to give a reason). On approval the bot gives the student the Elm role, takes away the unverified role, and DMs them a confirmation. If nobody responds, the bot reminds the RA queue on a schedule you set, and the request eventually expires so it doesn't sit in limbo forever.

Every message above comes from `config/policy.json`, so you can reword all of it without touching code.

## Features

- **Starts on join.** New members get the DM automatically. Members who were already in the server can run `/verify`.
- **Lockdown until approved.** An optional unverified role keeps new members out of everything except a lobby channel.
- **Per-hall RA queues.** Each hall has its own queue channel and RA role. Only that hall's RAs (or server admins listed in `ADMINS_IDS`) can decide its cases, and nobody can approve themselves.
- **Room validation.** Each hall defines its own room format with regexes, so a bad room number or unit letter gets bounced back to the student before an RA ever sees it.
- **Reminders and expiry.** Pending requests ping the RA queue at configurable intervals and expire after a TTL.
- **Audit log.** Every state change, decision, and blocked attempt is recorded. Cases are cancelled, never deleted, so the history stays intact.
- **Admin CLI.** Inspect cases, force a decision, reset a user, or retry a stuck notification from the terminal.
- **Config hot reload.** Edit `policy.json` while the bot is running and it picks up the change. If the new file is invalid, the bot logs why and keeps the old one.

## How it holds up

A bot that hands out roles needs to get them right even when Discord is flaky or two RAs click at once. A few things in the design exist for that:

- **Outbox for side effects.** DMs, queue posts, and role changes are written to an outbox table in the same database transaction as the state change, then delivered by a background worker with retries and backoff. If the bot crashes halfway through approving someone, the role grant is still waiting in the queue when it comes back up.
- **The "approved" DM waits for the role.** The confirmation is only sent after the role grant succeeds, so nobody is told they're verified while still locked out.
- **Optimistic locking.** If two RAs decide the same case at the same moment, one wins and the other is told the case was already handled.
- **One active case per person per term**, enforced by a partial unique index in PostgreSQL, not just application code.

The core is a state machine (`joined → hall_chosen → room_number_entered → awaiting_ra → approved / denied / expired`, plus `cancelled`) with Discord, Postgres, and the config file plugged in behind interfaces. [ARCHITECTURE.md](./ARCHITECTURE.md) goes into more detail.

## Getting started

You'll need Node.js 20+, Docker (for PostgreSQL), and a Discord server where you're an admin.

```bash
git clone https://github.com/RayTsai13/PurplePal.git
cd PurplePal
npm install

cp .env.example .env
cp config/policy.example.json config/policy.json
# fill in .env and policy.json (see below)

npm run db:start          # PostgreSQL in Docker
npm run db:migrate
npx prisma generate
npm run commands:sync     # register /verify, /verify-decision, /verify-reset
npm run dev
```

[BUILD.md](./BUILD.md) covers development workflow and troubleshooting in more depth.

### 1. Create the Discord application

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create a new application and add a bot.
2. Under **Privileged Gateway Intents**, turn on **Server Members Intent** and **Message Content Intent**.
3. Reset the token and copy it.
4. Under OAuth2 → URL Generator, select the `bot` and `applications.commands` scopes and these permissions: Send Messages, Embed Links, Add Reactions, Manage Roles, Read Message History. Open the generated URL to invite the bot.

In your server's role list, drag the bot's role **above** the hall roles and the unverified role. Discord won't let a bot assign roles higher than its own.

### 2. Set up the server

For each hall, create:

- a private RA queue channel
- an RA role (or share one across halls)
- a resident role that verified members receive

Optionally add an unverified role and a lobby channel that role can see.

To copy IDs, turn on Developer Mode (User Settings → Advanced), then right-click a server, channel, or role and choose **Copy ID**.

### 3. Fill in `.env`

```env
DISCORD_TOKEN=your_bot_token
DISCORD_APPLICATION_ID=your_application_id
GUILD_ID=your_server_id
DATABASE_URL=postgresql://purplepal:purplepal@localhost:5432/purplepal
ADMINS_IDS=your_user_id            # comma-separated; these users can decide any case
NODE_ENV=development
```

### 4. Describe your halls in `policy.json`

```json
{
  "term": "Fall 2025",
  "unverifiedRoleId": "…",
  "lobbyChannelId": "…",
  "halls": [
    {
      "name": "Elm",
      "aliases": ["elm hall", "elm"],
      "raRoleId": "…",
      "queueChannelId": "…",
      "hallRoleId": "…",
      "room": {
        "pattern": "^E-\\d{3}-[A-D]$",
        "example": "E-312-A",
        "prefix": "E"
      }
    }
  ]
}
```

That's an excerpt. `config/policy.example.json` has the full file, including timeouts, retry limits, and every message template.

| Field | What it does |
|-------|--------------|
| `name` / `aliases` | What students can type to pick the hall (case and surrounding spaces are ignored) |
| `raRoleId` | Members with this role can decide the hall's cases |
| `queueChannelId` | Where verification cards are posted |
| `hallRoleId` | Granted on approval |
| `room.prefix` | Combined with the room number and unit: `E` + `214` + `C` → `E-214-C` |
| `room.pattern` | Regex the assembled room must match |
| `room.roomNumberPattern` / `room.unitPattern` | Regexes for each DM step (default `^\d{3}$` and `^[A-D]$`) |
| `unverifiedRoleId` | Optional. Given on join, removed on approval |
| `lobbyChannelId` | Optional. Mentioned in the welcome DM |
| `timeouts.awaitingRA_ttl_hours` | How long a request waits before expiring |
| `timeouts.reminder_hours` | When to nudge the RA queue, e.g. `[24, 48]` |

The bot validates this file on startup and on every reload, and lists each problem it finds: a missing template, an ID that isn't a Discord snowflake, a regex that doesn't compile. You can check a file yourself with `npm run cli -- config validate`.

## Running in production

```bash
npm start                 # build and run
# or
npm run docker:up         # bot + PostgreSQL in containers
npm run docker:logs
npm run docker:down
```

## Admin CLI

The CLI talks to the same database as the bot. Anything that needs Discord (DMs, role changes) goes into the outbox, and the running bot delivers it.

```bash
npm run cli -- status                          # health and counts
npm run cli -- case list-pending               # who's waiting on an RA
npm run cli -- case inspect <caseId>           # case details and audit trail
npm run cli -- case force-decide <caseId> approve
npm run cli -- case force-expire <caseId>
npm run cli -- case reset-user <userId>        # cancel their cases, revoke the hall role
npm run cli -- outbox list -s failed           # stuck DMs or role changes
npm run cli -- outbox retry <jobId>
npm run cli -- config halls
npm run cli -- i                               # interactive shell
```

The full list is in [CLI_CHEATSHEET.md](./CLI_CHEATSHEET.md).

## When something goes wrong

**Slash commands don't show up.** Run `npm run commands:sync`, and check that `GUILD_ID` and `DISCORD_APPLICATION_ID` are right.

**Students say they were approved but have no role.** The bot's role is probably below the hall role. Fix the ordering, then find the failed job with `outbox list -s failed` and retry it. The approval DM won't go out until the role grant works, so the student won't get a premature confirmation in the meantime.

**Cards never appear in the RA queue.** Check `queueChannelId` and that the bot can send messages in that channel.

**"Isn't a recognized hall."** Add the spelling students actually use to `aliases`. The bot reloads the file on its own.

**Database connection errors.** Make sure the container is up (`npm run db:start`) and migrations have run (`npm run db:migrate`).

## Project layout

```
src/
├── core/        state machine, port interfaces, domain types
├── adapters/    Discord event handling, outbox and timeout workers
├── infra/       Prisma repositories, config loading, logging, wiring
├── cli/         admin CLI
└── tests/       Vitest unit tests and Postgres integration tests
```

Run the tests with `npm test`. The database integration tests run when `TEST_DATABASE_URL` is set:

```bash
npm run db:start && npm run db:migrate
TEST_DATABASE_URL=postgresql://purplepal:purplepal@localhost:5432/purplepal npm test
```

## Questions and bugs

Open an issue on [GitHub](https://github.com/RayTsai13/PurplePal/issues).
