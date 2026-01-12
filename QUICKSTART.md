# PurplePal Quick Start

A quick reference for running PurplePal. For detailed setup instructions, see [SETUP.md](./SETUP.md).

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Discord bot credentials configured in `.env`

## Option 1: Local Development

```bash
# Install dependencies
npm install

# Start the database
npm run db:start

# Run migrations (first time only)
npm run db:migrate

# Generate Prisma client (first time only)
npx prisma generate

# Register slash commands (first time only)
npm run commands:sync

# Start the bot with hot reload
npm run dev
```

### Stopping

```bash
# Stop the database
npm run db:stop
```

## Option 2: Docker (Production)

```bash
# Build and start everything (bot + database)
npm run docker:up

# View bot logs
npm run docker:logs

# Stop everything
npm run docker:down
```

### Running CLI in Docker

```bash
# Run any CLI command in the container
docker exec -it purplepal-bot npm run cli -- <command>

# Examples:
docker exec -it purplepal-bot npm run cli -- status
docker exec -it purplepal-bot npm run cli -- case list-pending
docker exec -it purplepal-bot npm run cli -- interactive
```

## Option 3: Database in Docker, Bot Local

```bash
# Start only the database
npm run db:start

# Run the bot locally
npm run dev

# Or run the CLI locally
npm run cli -- interactive
```

## Admin CLI

```bash
# One-off commands
npm run cli -- status
npm run cli -- case list-pending
npm run cli -- config show

# Interactive mode (no prefix needed)
npm run cli -- interactive
# Then type commands directly:
#   purplepal> status
#   purplepal> case list-pending
#   purplepal> exit
```

See [CLI_CHEATSHEET.md](./CLI_CHEATSHEET.md) for all CLI commands.

## Database Commands

```bash
npm run db:start      # Start PostgreSQL container
npm run db:stop       # Stop PostgreSQL container
npm run db:reset      # Reset database (deletes all data!)
npm run db:migrate    # Apply pending migrations
npm run db:studio     # Open Prisma Studio GUI
```

## Build & Test

```bash
npm run build         # Compile TypeScript
npm run lint          # Type-check without emitting
npm test              # Run test suite
```

## Common Issues

| Problem | Solution |
|---------|----------|
| Database connection error | Run `npm run db:start` |
| Commands not working | Run `npm run commands:sync` |
| Prisma client error | Run `npx prisma generate` |
| Docker container issues | Run `npm run docker:down && npm run docker:up` |