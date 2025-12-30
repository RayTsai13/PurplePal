"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordNotificationService = void 0;
const template_1 = require("../utils/template");
class DiscordNotificationService {
    constructor(discord) {
        this.discord = discord;
    }
    async sendDM(userId, template, data, _idempotencyKey) {
        const content = (0, template_1.renderTemplate)(template, data);
        const user = await this.discord.sdk.users.fetch(userId);
        await user.send({ content });
    }
    async sendToQueue(channelId, template, data, _idempotencyKey) {
        const content = (0, template_1.renderTemplate)(template, data);
        const channel = await this.discord.sdk.channels.fetch(channelId);
        if (!isSendableChannel(channel)) {
            throw new Error(`Channel ${channelId} is not text-based or not found`);
        }
        await channel.send({ content });
    }
}
exports.DiscordNotificationService = DiscordNotificationService;
const isSendableChannel = (channel) => {
    if (!channel) {
        return false;
    }
    const candidate = channel;
    return typeof candidate === 'object' && !!candidate && typeof candidate.send === 'function';
};
