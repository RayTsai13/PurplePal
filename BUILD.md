# Build & Development Guide

Complete reference for all npm scripts, build processes, and development workflows for PurplePal.

## Quick Reference: All Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| **Development** | | |
| dev                | `npm run dev`                  | Start bot with hot reload (watches for changes) 
| start              | `npm start`                    | Build and run bot in production mode 
| build              | `npm run build`                | Compile TypeScript to JavaScript in `dist/` 
| lint               | `npm run lint`                 | Type-check TypeScript without emitting files 
| test               | `npm test`                     | Run Vitest test suite 
| health              `npm run health`                | Run health check script 
| **Discord Setup**
| commands:sync      | `npm run commands:sync`        | Register `/verify`, `/verify-decision`, `/verify-reset` slash commands with Discord 
| **Database** 
| db:start           | `npm run db:start`             | Start PostgreSQL 16 container via Docker Compose 
| db:stop            | `npm run db:stop`              | Stop PostgreSQL container 
| db:reset           | `npm run db:reset`             | **DESTRUCTIVE** - Delete all data and reinitialize database 
| db:migrate         | `npm run db:migrate`           | Apply pending Prisma migrations to database 
| db:studio          | `npm run db:studio`            | Open Prisma Studio GUI (visual database browser) 
| **CLI**
| cli                | `npm run cli -- <command>`     | Run admin CLI (case mgmt, config, outbox, system info) 
| sanity:active-case | `npm run sanity:active-case`   | Sanity check for cases in `awaiting_ra` state          
| **Docker**
| docker:build       | `npm run docker:build`         | Build Docker image for bot + database 
| docker:up          | `npm run docker:up`            | Start bot + database containers in background 
| docker:down        | `npm run docker:down`          | Stop all containers 
| docker:logs        | `npm run docker:logs`          | View bot container logs (follow mode) 

---

## Build Workflows

### 1. Development Setup (Local with Docker Database)

Use this for daily development. Your code runs locally with hot reload, database runs in Docker.

```bash
# One-time setup
npm install                    # Install all dependencies
npm run db:start              # Start PostgreSQL container
npm run db:migrate            # Apply migrations
npx prisma generate           # Generate Prisma client to generated/prisma/
npm run commands:sync         # Register Discord commands (requires .env)

# Start developing
npm run dev                   # Watch mode with hot reload - stops on TypeScript errors
```

**Hot Reload Behavior:**
- Automatically restarts bot when you save files
- Stops immediately if TypeScript errors are introduced
- Ctrl+C to stop the dev server

**When Done:**
```bash
npm run db:stop              # Stop the database container
```

---

### 2. Production Build & Run

Use this to test the exact production build locally.

```bash
# Build
npm run build                 # Compile src/ → dist/
npm run lint                  # Verify no TypeScript errors
npm test                      # Run full test suite

# Run
npm start                     # Runs 'npm run build' then 'node dist/index.js'
```

**Check Build Artifacts:**
```bash
ls -la dist/                  # View compiled JavaScript
```

---

### 3. Docker (Full Production Setup)

Use this to run bot + database entirely in containers (what CI/CD does).

```bash
# Build images
npm run docker:build

# Start containers
npm run docker:up

# View logs
npm run docker:logs           # Follow bot logs (Ctrl+C to exit)

# Run CLI in Docker
docker exec -it purplepal-bot npm run cli -- status
docker exec -it purplepal-bot npm run cli -- case list-pending

# Stop everything
npm run docker:down
```

**Check Container Status:**
```bash
docker compose ps             # List running containers
docker compose logs           # View all logs
```

---

### 4. Troubleshooting Builds

#### TypeScript Compilation Fails
```bash
npm run lint                  # Check for type errors in detail
npx tsc --pretty false        # Show detailed error messages
```

#### Tests Fail
```bash
npm test                      # Run full suite
npx vitest run src/tests/core/VerificationOrchestrator.test.ts  # Run specific test file
```

#### Database Connection Error
```bash
npm run db:start             # Make sure database container is running
npm run db:migrate           # Ensure migrations are applied
```

#### Prisma Client Not Found
```bash
npx prisma generate          # Regenerate Prisma client
npx prisma db push           # Sync schema with database
```

#### Discord Commands Not Working
```bash
npm run commands:sync        # Re-register slash commands
# Ensure .env has: DISCORD_TOKEN, DISCORD_APPLICATION_ID, GUILD_ID
```

---

## Development Lifecycle

### Making Changes

1. **Start Dev Server**
   ```bash
   npm run dev
   ```

2. **Edit Code** in `src/` - bot auto-reloads
   - If TypeScript error: fix it, dev server resumes automatically

3. **Run Tests** (in another terminal)
   ```bash
   npm test
   ```

4. **Type Check** (optional, dev server does this)
   ```bash
   npm run lint
   ```

### Before Committing

1. **Run Full Test Suite**
   ```bash
   npm test
   ```

2. **Check Types**
   ```bash
   npm run lint
   ```

3. **Build for Production**
   ```bash
   npm run build
   npm start  # Quick smoke test
   ```

4. **Commit** (see CLAUDE.md for examples)

---

## Environment Setup

Create `.env` file in project root (never commit this):

```bash
# Discord Bot
DISCORD_TOKEN=your_bot_token_here
DISCORD_APPLICATION_ID=your_app_id_here
GUILD_ID=your_server_id_here

# Database (defaults to local PostgreSQL)
DATABASE_URL=postgresql://purplepal:purplepal@localhost:5432/purplepal

# Optional
NODE_ENV=development
ADMINS_IDS=user_id_1,user_id_2
```

See `.env.example` for template.

---

## Configuration

Configuration lives in `config/policy.json` (validated by `policySchema.ts`):

```bash
# View current config
npm run cli -- config show

# View hall configs
npm run cli -- config halls
```

Reload config without restart:
```bash
npm run cli -- config reload
```

See `config/policy.example.json` for all available options.

---

## Codebase Structure

```
src/
  core/                  # Business logic (state machine, rules)
    application/
      orchestrator/VerificationOrchestrator.ts  # Main state machine
    ports.ts            # Interface definitions
  infra/                 # Infrastructure (database, config, Discord SDK)
    services/            # Port implementations
    config/              # Configuration loading & validation
  adapters/              # External integrations
    discord/             # Discord.js bindings
    scheduler/           # Background workers
  cli/                   # Admin command-line interface
  tests/                 # Test suite
dist/                    # Compiled JavaScript (created by `npm run build`)
generated/               # Generated code
  prisma/                # Prisma Client (created by `npx prisma generate`)
prisma/                  # Database schema & migrations
config/                  # Runtime configuration files
```

---

## Testing

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npx vitest run src/tests/core/VerificationOrchestrator.test.ts
```

### Watch Mode (re-run on changes)
```bash
npx vitest watch
```

### Test Coverage
```bash
npx vitest run --coverage
```

---

## Performance Tips

- **Incremental Compilation**: TypeScript caches intermediate builds; changes compile faster after first build
- **Test Filtering**: Run specific tests instead of full suite while developing
- **Database**: Use `npm run db:studio` to inspect data during development
- **Logs**: Set `DEBUG=*` environment variable for verbose logging

---

## Deployment Checklist

Before deploying to production:

- [ ] All tests pass: `npm test`
- [ ] No lint errors: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] `.env` configured with production Discord credentials
- [ ] Database migrations applied: `npm run db:migrate`
- [ ] Slash commands registered: `npm run commands:sync`
- [ ] Configuration in `config/policy.json` validated
- [ ] Bot started: `npm start`

---

## Getting Help

- **Build Issues**: Check "Troubleshooting Builds" section above
- **Commands**: See [CLAUDE.md](./CLAUDE.md) for development commands
- **CLI Reference**: See [CLI_CHEATSHEET.md](./CLI_CHEATSHEET.md) for admin CLI
- **Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md) for design overview
- **Setup Details**: See [SETUP.md](./SETUP.md) for deployment guide
