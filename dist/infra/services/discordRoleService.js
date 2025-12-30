"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordRoleService = void 0;
const success = { status: 'success' };
class DiscordRoleService {
    constructor(discord, guildId) {
        this.discord = discord;
        this.guildId = guildId;
    }
    async assign(userId, roleIds, _idempotencyKey) {
        try {
            const member = await this.fetchMember(userId);
            await member.roles.add(roleIds);
            return success;
        }
        catch (error) {
            return { status: 'failure', details: formatError(error) };
        }
    }
    async remove(userId, roleIds, _idempotencyKey) {
        try {
            const member = await this.fetchMember(userId);
            await member.roles.remove(roleIds);
            return success;
        }
        catch (error) {
            return { status: 'failure', details: formatError(error) };
        }
    }
    async fetchMember(userId) {
        const guild = await this.discord.sdk.guilds.fetch(this.guildId);
        return guild.members.fetch(userId);
    }
}
exports.DiscordRoleService = DiscordRoleService;
const formatError = (error) => {
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unknown Discord error';
};
