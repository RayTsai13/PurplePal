"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordClient = void 0;
const discord_js_1 = require("discord.js");
const logger_1 = require("../../infra/logger");
// Wrapper around discord.js Client for lifecycle management and event logging
// Handles authentication, ready state, and lifecycle events
class DiscordClient {
    constructor() {
        // Create discord.js Client with configured intents and partials
        // Intents control which events the bot receives (guilds, members, messages, reactions, DMs)
        // Partials allow handling of partial/cached objects if needed
        this.client = new discord_js_1.Client({
            intents: [
                discord_js_1.GatewayIntentBits.Guilds,
                discord_js_1.GatewayIntentBits.GuildMembers,
                discord_js_1.GatewayIntentBits.GuildMessages,
                discord_js_1.GatewayIntentBits.GuildMessageReactions,
                discord_js_1.GatewayIntentBits.DirectMessages,
            ],
            partials: [discord_js_1.Partials.Channel, discord_js_1.Partials.Message, discord_js_1.Partials.Reaction],
        });
        // Store promise that resolves when ClientReady event fires
        // .once() listens for event one time then removes listener
        // Promise constructor with resolve callback allows waiting for async event
        this.ready = new Promise((resolve) => {
            this.client.once(discord_js_1.Events.ClientReady, (readyClient) => {
                logger_1.logger.info({
                    user: readyClient.user.tag,
                    guilds: readyClient.guilds.cache.size,
                }, 'Discord client ready');
                resolve();
            });
        });
        // Log when guild members join
        this.client.on(discord_js_1.Events.GuildMemberAdd, (member) => {
            logger_1.logger.info({
                memberId: member.id,
                guildId: member.guild.id,
            }, 'Member joined guild');
        });
        // Log all interactions (slash commands, buttons, modals) for debugging
        this.client.on(discord_js_1.Events.InteractionCreate, (interaction) => {
            logger_1.logger.debug({ interactionId: interaction.id, type: interaction.type }, 'Interaction received');
        });
        // Log any errors from Discord client
        this.client.on(discord_js_1.Events.Error, (err) => {
            logger_1.logger.error({ err }, 'Discord client error');
        });
    }
    // Connect to Discord with bot token and wait for ready state
    async start(token) {
        await this.client.login(token);
        // Wait for ClientReady event before returning
        await this.ready;
    }
    // Destroy client connection and cleanup resources
    shutdown() {
        this.client.destroy();
    }
    // Read-only getter for number of guilds the bot is in
    get guildCount() {
        return this.client.guilds.cache.size;
    }
    // Expose raw discord.js Client for event binding and API calls
    get sdk() {
        return this.client;
    }
}
exports.DiscordClient = DiscordClient;
