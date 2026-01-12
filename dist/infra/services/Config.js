"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigImpl = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policySchema_1 = require("../config/policySchema");
// Synchronous configuration service implementing Config port interface
// Supports hot reload via reload() method
class ConfigImpl {
    constructor(initialPolicy, configPath) {
        this.listeners = [];
        this.policy = initialPolicy;
        // Default path resolves to config/policy.json from project root
        this.configPath = configPath ?? path_1.default.resolve(process.cwd(), 'config/policy.json');
    }
    // Register a listener to be called when configuration reloads
    onReload(listener) {
        this.listeners.push(listener);
    }
    // Return current academic term
    currentTerm() {
        return this.policy.term;
    }
    // Return timeout configuration for verification process
    timeouts() {
        return {
            awaitingRA_ttl_hours: this.policy.timeouts.awaitingRA_ttl_hours,
            reminder_hours: this.policy.timeouts.reminder_hours,
        };
    }
    // Return retry and backoff limits for operations
    limits() {
        return {
            maxNotificationRetries: this.policy.limits.maxNotificationRetries,
            notificationBackoffSeconds: this.policy.limits.notificationBackoffSeconds,
            roleAssignMaxRetries: this.policy.limits.roleAssignMaxRetries,
            roleAssignRetryBackoffSeconds: this.policy.limits.roleAssignRetryBackoffSeconds,
        };
    }
    // Return all message templates for DMs and RA queue
    messaging() {
        return {
            dm: this.policy.templates.dm,
            ra_queue: this.policy.templates.ra_queue,
        };
    }
    // Return all halls with port interface shape (excludes normalize config)
    // .map() transforms PolicyConfig hall objects into port HallConfig objects
    // ?? provides fallback value if undefined
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
    // Reload configuration from disk without restarting the application
    // Re-reads and validates policy.json, then notifies all registered listeners
    async reload() {
        const fileContents = await fs_1.default.promises.readFile(this.configPath, 'utf-8');
        const raw = JSON.parse(fileContents);
        const newPolicy = policySchema_1.PolicySchema.parse(raw);
        this.policy = newPolicy;
        // Notify all listeners about the configuration change
        for (const listener of this.listeners) {
            listener(newPolicy);
        }
    }
}
exports.ConfigImpl = ConfigImpl;
