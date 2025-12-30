# PurplePal
A handy dandy discord bot used to verify residents :)

## Registering Slash Commands

Slash commands must be registered with your Discord application before `/verify` or `/verify-decision` will show up in the guild.

1. Ensure `.env` contains:
   - `DISCORD_TOKEN`
   - `DISCORD_APPLICATION_ID` (the bot/application ID)
   - `GUILD_ID`
2. Run migrations if needed (`npx prisma migrate deploy`).
3. Execute:

```bash
npm run commands:sync
```

The script uses Discord's REST API to upsert the commands for the configured guild. Re-run it whenever you change command definitions.
