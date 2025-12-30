"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordServiceImpl = void 0;
const template_1 = require("../utils/template");
/**
 * Unified Discord service combining hall/room validation,
 * notifications, and role management.
 */
class DiscordServiceImpl {
    constructor(client, hallDirectory, guildId) {
        this.client = client;
        this.hallDirectory = hallDirectory;
        this.guildId = guildId;
    }
    // ==================== Hall Validation ====================
    async validateHall(hall) {
        const match = this.hallDirectory.resolve(hall);
        if (!match) {
            return { valid: false };
        }
        return {
            valid: true,
            normalizedHall: match.name,
            raRoleId: match.raRoleId,
            queueChannelId: match.queueChannelId,
            hallRoleId: match.hallRoleId,
        };
    }
    // ==================== Room Normalization ====================
    async normalizeRoom(hall, roomRaw) {
        const hallConfig = this.hallDirectory.getByName(hall) ?? this.hallDirectory.resolve(hall);
        if (!hallConfig) {
            return { valid: false, errors: [`Unknown hall "${hall}"`] };
        }
        if (!hallConfig.room) {
            return { valid: false, errors: [`Room configuration missing for hall "${hallConfig.name}"`] };
        }
        const normalized = this.applyNormalization(roomRaw, hallConfig);
        const pattern = this.compilePattern(hallConfig.room.pattern);
        if (!pattern.test(normalized)) {
            return {
                valid: false,
                errors: [`Room must match format ${hallConfig.room.example}`],
            };
        }
        return { valid: true, room: normalized };
    }
    compilePattern(pattern) {
        try {
            return new RegExp(pattern);
        }
        catch (error) {
            throw new Error(`Invalid room pattern "${pattern}": ${error.message}`);
        }
    }
    applyNormalization(roomRaw, hallConfig) {
        const rules = hallConfig.room?.normalize ?? {};
        let current = roomRaw;
        if (rules.trimSpaces) {
            current = current.trim();
        }
        if (rules.uppercase) {
            current = current.toUpperCase();
        }
        if (rules.collapseDelimiters) {
            current = current.replace(/[-_\s]+/g, '-');
        }
        if (rules.fixHyphens) {
            current = current.replace(/\s*-\s*/g, '-');
        }
        if (rules.allowMissingHyphens) {
            const parts = current.split(/[-\s]+/);
            if (parts.length > 1) {
                current = parts.join('-');
            }
        }
        if (rules.uppercase) {
            current = current.toUpperCase();
        }
        return current;
    }
    // ==================== Notifications ====================
    async sendDM(userId, template, data, _idempotencyKey) {
        const content = (0, template_1.renderTemplate)(template, data);
        const user = await this.client.sdk.users.fetch(userId);
        await user.send({ content });
    }
    async sendToQueue(channelId, template, data, _idempotencyKey) {
        const content = (0, template_1.renderTemplate)(template, data);
        const channel = await this.client.sdk.channels.fetch(channelId);
        if (!this.isSendableChannel(channel)) {
            throw new Error(`Channel ${channelId} is not text-based or not found`);
        }
        await channel.send({ content });
    }
    isSendableChannel(channel) {
        if (!channel) {
            return false;
        }
        const candidate = channel;
        return typeof candidate === 'object' && !!candidate && typeof candidate.send === 'function';
    }
    // ==================== Role Management ====================
    async assignRoles(userId, roleIds, _idempotencyKey) {
        try {
            const member = await this.fetchMember(userId);
            await member.roles.add(roleIds);
            return { status: 'success' };
        }
        catch (error) {
            return { status: 'failure', details: this.formatError(error) };
        }
    }
    async removeRoles(userId, roleIds, _idempotencyKey) {
        try {
            const member = await this.fetchMember(userId);
            await member.roles.remove(roleIds);
            return { status: 'success' };
        }
        catch (error) {
            return { status: 'failure', details: this.formatError(error) };
        }
    }
    async fetchMember(userId) {
        const guild = await this.client.sdk.guilds.fetch(this.guildId);
        return guild.members.fetch(userId);
    }
    formatError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return 'Unknown Discord error';
    }
}
exports.DiscordServiceImpl = DiscordServiceImpl;
