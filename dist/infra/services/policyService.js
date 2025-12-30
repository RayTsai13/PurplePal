"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyServiceImpl = void 0;
class PolicyServiceImpl {
    constructor(config) {
        this.config = config;
    }
    async currentTerm() {
        return this.config.term;
    }
    async timeouts() {
        return {
            awaitingRA_ttl_hours: this.config.timeouts.awaitingRA_ttl_hours,
            reminder_hours: [...this.config.timeouts.reminder_hours],
        };
    }
    async limits() {
        return {
            maxNotificationRetries: this.config.limits.maxNotificationRetries,
            notificationBackoffSeconds: [...this.config.limits.notificationBackoffSeconds],
            roleAssignMaxRetries: this.config.limits.roleAssignMaxRetries,
            roleAssignRetryBackoffSeconds: [...this.config.limits.roleAssignRetryBackoffSeconds],
        };
    }
    async messaging() {
        return {
            dm: { ...this.config.templates.dm },
            ra_queue: { ...this.config.templates.ra_queue },
        };
    }
    async halls() {
        return this.config.halls.map((hall) => ({
            name: hall.name,
            aliases: [...(hall.aliases ?? [])],
            raRoleId: hall.raRoleId,
            queueChannelId: hall.queueChannelId,
            hallRoleId: hall.hallRoleId,
            room: hall.room
                ? {
                    pattern: hall.room.pattern,
                    example: hall.room.example,
                }
                : undefined,
        }));
    }
}
exports.PolicyServiceImpl = PolicyServiceImpl;
