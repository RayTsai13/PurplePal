"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordClient = void 0;
const discord_js_1 = require("discord.js");
const logger_1 = require("../../infra/logger");
class DiscordClient {
    constructor() {
        this.client = new discord_js_1.Client({
            intents: [
                discord_js_1.GatewayIntentBits.Guilds,
                discord_js_1.GatewayIntentBits.GuildMembers,
                discord_js_1.GatewayIntentBits.GuildMessages,
            ],
        });
        this.ready = new Promise((resolve) => {
            this.client.once(discord_js_1.Events.ClientReady, (readyClient) => {
                logger_1.logger.info({
                    user: readyClient.user.tag,
                    guilds: readyClient.guilds.cache.size,
                }, 'Discord client ready');
                resolve();
            });
        });
        this.client.on(discord_js_1.Events.GuildMemberAdd, (member) => {
            logger_1.logger.info({
                memberId: member.id,
                guildId: member.guild.id,
            }, 'Member joined guild');
        });
        this.client.on(discord_js_1.Events.InteractionCreate, (interaction) => {
            logger_1.logger.debug({ interactionId: interaction.id, type: interaction.type }, 'Interaction received');
        });
        this.client.on(discord_js_1.Events.Error, (err) => {
            logger_1.logger.error({ err }, 'Discord client error');
        });
    }
    async start(token) {
        await this.client.login(token);
        await this.ready;
    }
    shutdown() {
        this.client.destroy();
    }
    get guildCount() {
        return this.client.guilds.cache.size;
    }
}
exports.DiscordClient = DiscordClient;
