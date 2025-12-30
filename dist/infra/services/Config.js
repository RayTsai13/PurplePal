"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigImpl = void 0;
/**
 * Synchronous configuration service.
 * Config is loaded at startup and doesn't change, so no async needed.
 */
class ConfigImpl {
    constructor(policy) {
        this.policy = policy;
    }
    currentTerm() {
        return this.policy.term;
    }
    timeouts() {
        return {
            awaitingRA_ttl_hours: this.policy.timeouts.awaitingRA_ttl_hours,
            reminder_hours: this.policy.timeouts.reminder_hours,
        };
    }
    limits() {
        return {
            maxNotificationRetries: this.policy.limits.maxNotificationRetries,
            notificationBackoffSeconds: this.policy.limits.notificationBackoffSeconds,
            roleAssignMaxRetries: this.policy.limits.roleAssignMaxRetries,
            roleAssignRetryBackoffSeconds: this.policy.limits.roleAssignRetryBackoffSeconds,
        };
    }
    messaging() {
        return {
            dm: this.policy.templates.dm,
            ra_queue: this.policy.templates.ra_queue,
        };
    }
    halls() {
        return this.policy.halls.map((hall) => ({
            name: hall.name,
            aliases: hall.aliases ?? [],
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
exports.ConfigImpl = ConfigImpl;
