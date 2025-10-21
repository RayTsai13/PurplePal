"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const DiscordClient_1 = require("./adapters/discord/DiscordClient");
const env_1 = require("./infra/env");
const logger_1 = require("./infra/logger");
// Validate essential configuration before starting the bot
function validateConfig() {
    const halls = JSON.parse(fs_1.default.readFileSync('./config/halls.json', 'utf-8'));
    const policy = JSON.parse(fs_1.default.readFileSync('./config/policy.json', 'utf-8'));
    if (!Object.keys(halls).length)
        throw new Error('No halls defined');
    return { halls, policy };
}
let discordClient = null;
async function main() {
    logger_1.logger.info('Starting bot...');
    validateConfig();
    discordClient = new DiscordClient_1.DiscordClient();
    await discordClient.start(env_1.env.DISCORD_TOKEN);
    logger_1.logger.info({ guilds: discordClient.guildCount }, 'Bot started');
    const shutdown = (signal) => {
        logger_1.logger.info({ signal }, 'Shutting down...');
        discordClient?.shutdown();
        process.exit(0);
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((err) => {
    logger_1.logger.error({ err }, 'Failed to start bot');
    discordClient?.shutdown();
    process.exit(1);
});
