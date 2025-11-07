import fs from 'fs';
import { DiscordClient } from './adapters/discord/DiscordClient';
import { env } from './infra/env';
import { logger } from './infra/logger';

// Validate essential configuration before starting the bot
function validateConfig() {
    const halls = JSON.parse(fs.readFileSync('./config/halls.json', 'utf-8'));
    const policy = JSON.parse(fs.readFileSync('./config/policy.json', 'utf-8'));

    if (!Object.keys(halls).length){
        throw new Error('No halls defined');
    }
    return { halls, policy };
}

let discordClient: DiscordClient | null = null;

async function main() {
    logger.info('Starting bot...');

    validateConfig();

    discordClient = new DiscordClient();
    await discordClient.start(env.DISCORD_TOKEN);

    logger.info({ guilds: discordClient.guildCount }, 'Bot started');

    const shutdown = (signal: NodeJS.Signals) => {
        logger.info({ signal }, 'Shutting down...');
        discordClient?.shutdown();
        process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {

logger.error({ err }, 'Failed to start bot');

discordClient?.shutdown();
process.exit(1);
});
