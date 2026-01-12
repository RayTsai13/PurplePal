"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordServiceImpl = void 0;
const template_1 = require("../utils/template");
// Unified Discord service implementing DiscordService port interface
// Handles hall validation, room normalization, notifications, and role management
class DiscordServiceImpl {
    constructor(client, hallDirectory, guildId) {
        this.client = client;
        this.hallDirectory = hallDirectory;
        this.guildId = guildId;
    }
    // ==================== Hall Validation ====================
    // Validate hall input and return normalized name with Discord IDs
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
    // Validate and normalize room number against hall pattern
    // Applies normalization rules (uppercase, trim, fix hyphens, etc)
    // Returns valid: true with normalized room or valid: false with error messages
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
        // .test() checks if regex matches string
        if (!pattern.test(normalized)) {
            return {
                valid: false,
                errors: [`Room must match format ${hallConfig.room.example}`],
            };
        }
        return { valid: true, room: normalized };
    }
    // Compile regex pattern string. Throws if pattern is invalid
    compilePattern(pattern) {
        try {
            return new RegExp(pattern);
        }
        catch (error) {
            throw new Error(`Invalid room pattern "${pattern}": ${error.message}`);
        }
    }
    // Apply normalization rules to room string based on configuration
    // .replace(regex, string) replaces all matches
    applyNormalization(roomRaw, hallConfig) {
        const rules = hallConfig.room?.normalize ?? {};
        let current = roomRaw;
        if (rules.trimSpaces) {
            current = current.trim();
        }
        if (rules.uppercase) {
            current = current.toUpperCase();
        }
        // /[-_\s]+/g matches one or more hyphens, underscores, or spaces
        if (rules.collapseDelimiters) {
            current = current.replace(/[-_\s]+/g, '-');
        }
        // /\s*-\s*/g matches hyphen with optional spaces around it
        if (rules.fixHyphens) {
            current = current.replace(/\s*-\s*/g, '-');
        }
        // /[-\s]+/ matches delimiters, split creates array, join reconstructs with hyphens
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
    // Send direct message to user
    async sendDM(userId, template, data, _idempotencyKey) {
        const content = (0, template_1.renderTemplate)(template, data);
        const user = await this.client.sdk.users.fetch(userId);
        await user.send({ content });
    }
    // Send message to Discord channel
    async sendToQueue(channelId, template, data, _idempotencyKey) {
        const content = (0, template_1.renderTemplate)(template, data);
        const channel = await this.client.sdk.channels.fetch(channelId);
        if (!this.isSendableChannel(channel)) {
            throw new Error(`Channel ${channelId} is not text-based or not found`);
        }
        await channel.send({ content });
    }
    // Type guard: check if channel is text-based and has send method
    // as Partial<T> treats value as incomplete version of T for type checking
    isSendableChannel(channel) {
        if (!channel) {
            return false;
        }
        const candidate = channel;
        return typeof candidate === 'object' && !!candidate && typeof candidate.send === 'function';
    }
    // ==================== Role Management ====================
    // Add Discord roles to user
    // Catches errors and returns failure result instead of throwing
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
    // Remove Discord roles from user
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
    // Fetch guild member by user ID
    async fetchMember(userId) {
        const guild = await this.client.sdk.guilds.fetch(this.guildId);
        return guild.members.fetch(userId);
    }
    // Convert error to string message
    // instanceof checks if value is an instance of class
    formatError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return 'Unknown Discord error';
    }
    // ==================== Authorization ====================
    // Check if user has the RA role for a specific hall
    // Used for authorization before processing RA decisions
    async isRaForHall(userId, hallName) {
        const hallConfig = this.hallDirectory.getByName(hallName) ?? this.hallDirectory.resolve(hallName);
        if (!hallConfig) {
            return false;
        }
        try {
            const member = await this.fetchMember(userId);
            // member.roles.cache is a Collection of roles, .has() checks if role ID exists
            return member.roles.cache.has(hallConfig.raRoleId);
        }
        catch {
            // Member not found or other Discord error - deny authorization
            return false;
        }
    }
}
exports.DiscordServiceImpl = DiscordServiceImpl;
