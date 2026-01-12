# PurplePal Setup Guide

This guide walks you through setting up PurplePal, a Discord bot for resident verification in university housing.

## Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **Docker & Docker Compose** - [Download](https://docs.docker.com/get-docker/)
- **Discord Account** - With access to create applications
- **A Discord Server** - Where you have admin permissions

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-username/PurplePal.git
cd PurplePal

# 2. Install dependencies
npm install

# 3. Copy example configs
cp .env.example .env
cp config/policy.example.json config/policy.json

# 4. Edit .env with your Discord credentials (see below)

# 5. Start the database
npm run db:start

# 6. Run database migrations
npm run db:migrate

# 7. Generate Prisma client
npx prisma generate

# 8. Register Discord slash commands
npm run commands:sync

# 9. Start the bot
npm run dev
```

## Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** and give it a name (e.g., "PurplePal")
3. Go to **"Bot"** in the left sidebar
4. Click **"Add Bot"**
5. Under **"Privileged Gateway Intents"**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
6. Click **"Reset Token"** and copy your bot token

## Step 2: Get Discord IDs

Enable **Developer Mode** in Discord:
- User Settings → Advanced → Developer Mode → On

### Required IDs:

| ID | How to Get It |
|----|---------------|
| **Application ID** | Developer Portal → Your App → General Information → Application ID |
| **Guild ID** | Right-click your server → Copy Server ID |
| **Channel IDs** | Right-click any channel → Copy Channel ID |
| **Role IDs** | Server Settings → Roles → Right-click role → Copy Role ID |

## Step 3: Configure Environment

Edit `.env` with your values:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_APPLICATION_ID=your_application_id_here
GUILD_ID=your_guild_id_here
DATABASE_URL=postgresql://purplepal:purplepal@localhost:5432/purplepal
ADMINS_IDS=your_user_id_here
NODE_ENV=development
```

## Step 4: Configure Halls

Edit `config/policy.json` to match your residence halls:

```json
{
  "term": "Fall 2025",
  "halls": [
    {
      "name": "YourHallName",
      "aliases": ["yourhallname", "YOURHALLNAME"],
      "raRoleId": "ROLE_ID_FOR_RAS_OF_THIS_HALL",
      "queueChannelId": "CHANNEL_ID_FOR_RA_QUEUE",
      "hallRoleId": "ROLE_ID_GIVEN_TO_VERIFIED_RESIDENTS",
      "room": {
        "pattern": "^Y-\\d{3}-[A-D]$",
        "example": "Y-312-A"
      }
    }
  ]
}
```

### Hall Configuration Fields:

| Field | Description |
|-------|-------------|
| `name` | Display name for the hall |
| `aliases` | Alternative names users can type |
| `raRoleId` | Discord role ID for RAs who can verify this hall |
| `queueChannelId` | Channel where verification requests are posted |
| `hallRoleId` | Role granted to verified residents |
| `room.pattern` | Regex pattern for valid room numbers |
| `room.example` | Example shown to users |

## Step 5: Invite the Bot

1. Go to Developer Portal → Your App → OAuth2 → URL Generator
2. Select scopes: `bot`, `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Embed Links
   - Add Reactions
   - Manage Roles
   - Read Message History
4. Copy the generated URL and open it to invite the bot

## Step 6: Set Up Discord Server

Create the following in your Discord server:

1. **RA Queue Channels** - One per hall (private to RAs)
2. **RA Roles** - One per hall or a shared RA role
3. **Hall Roles** - Granted to verified residents

## Running the Bot

### Development (with hot reload)
```bash
npm run dev
```

### Production (local)
```bash
npm start
```

### Production (Docker)
```bash
# Build and start all services
npm run docker:up

# View logs
npm run docker:logs

# Stop services
npm run docker:down
```

## CLI Commands

PurplePal includes admin CLI tools:

```bash
# Using npm script
npm run cli -- <command>

# Examples:
npm run cli -- status              # System health
npm run cli -- case list-pending   # Show pending cases
npm run cli -- case inspect <id>   # View case details
npm run cli -- outbox list         # Check notification queue
npm run cli -- config show         # Display configuration

# Interactive mode (run multiple commands without repeating prefix)
npm run cli -- interactive
# or
npm run cli -- i
```

### Interactive Mode

Start an interactive session where you can run commands directly:

```
$ npm run cli -- interactive

PurplePal CLI - Interactive Mode
Type "help" for available commands or "exit" to quit

purplepal> status
purplepal> case list-pending
purplepal> config show
purplepal> exit
```

### Available Commands:

| Command | Description |
|---------|-------------|
| `status` | System health and statistics |
| `audit <caseId>` | View audit trail for a case |
| `case inspect <caseId>` | View case details |
| `case list-pending` | List cases awaiting RA review |
| `case force-expire <caseId>` | Manually expire a case |
| `case force-decide <caseId> <approve\|deny>` | Admin override |
| `case reset-user <userId>` | Clear user's verification |
| `outbox list` | List notification queue |
| `outbox retry <jobId>` | Retry a failed notification |
| `config show` | Display current configuration |
| `config halls` | List hall configurations |
| `config templates` | Show message templates |

## Database Management

```bash
# Start PostgreSQL
npm run db:start

# Stop PostgreSQL
npm run db:stop

# Reset database (deletes all data!)
npm run db:reset

# Run migrations
npm run db:migrate

# Open Prisma Studio (database GUI)
npm run db:studio
```

## Troubleshooting

### Bot doesn't respond to commands
- Check that slash commands are registered: `npm run commands:sync`
- Verify bot has proper permissions in the server
- Check bot token is correct in `.env`

### Database connection errors
- Ensure PostgreSQL is running: `npm run db:start`
- Check `DATABASE_URL` in `.env`
- Run migrations: `npm run db:migrate`

### Verification requests not appearing in RA queue
- Check `queueChannelId` in `config/policy.json`
- Verify bot has permission to send messages in the channel

### Role assignment fails
- Ensure bot role is higher than roles it's trying to assign
- Check `hallRoleId` in `config/policy.json`

### "Invalid hall" errors
- Check `aliases` in `config/policy.json` include common misspellings
- Aliases are case-sensitive

## Architecture Overview

```
src/
├── adapters/          # External integrations
│   ├── discord/       # Discord bot and commands
│   └── scheduler/     # Background workers
├── cli/               # Admin CLI tools
├── core/              # Business logic
│   ├── application/   # Orchestrator and state machine
│   └── ports.ts       # Interface definitions
└── infra/             # Infrastructure implementations
    └── services/      # Repository implementations
```

### Key Concepts:

- **Cases** - Track verification requests through states: `joined` → `hall_chosen` → `awaiting_ra` → `approved`/`denied`/`expired`
- **Outbox** - Reliable message delivery with retry logic
- **Audit Log** - Immutable record of all state transitions
- **Orchestrator** - State machine managing the verification flow

## Support

For issues or questions, please open an issue on GitHub.
