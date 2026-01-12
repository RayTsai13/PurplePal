import fs from 'fs';
import path from 'path';
import type {
  Config,
  HallConfig,
  LimitsConfig,
  MessageTemplates,
  TimeoutConfig,
} from '../../core/ports';
import { PolicySchema, type PolicyConfig } from '../config/policySchema';

// Callback type for reload notifications
// Allows dependent services (like HallDirectory) to be notified when config changes
export type ConfigReloadListener = (newConfig: PolicyConfig) => void;

// Synchronous configuration service implementing Config port interface
// Supports hot reload via reload() method
export class ConfigImpl implements Config {
  private policy: PolicyConfig;
  private readonly configPath: string;
  private readonly listeners: ConfigReloadListener[] = [];

  constructor(initialPolicy: PolicyConfig, configPath?: string) {
    this.policy = initialPolicy;
    // Default path resolves to config/policy.json from project root
    this.configPath = configPath ?? path.resolve(process.cwd(), 'config/policy.json');
  }

  // Register a listener to be called when configuration reloads
  onReload(listener: ConfigReloadListener): void {
    this.listeners.push(listener);
  }

  // Return current academic term
  currentTerm(): string {
    return this.policy.term;
  }

  // Return timeout configuration for verification process
  timeouts(): TimeoutConfig {
    return {
      awaitingRA_ttl_hours: this.policy.timeouts.awaitingRA_ttl_hours,
      reminder_hours: this.policy.timeouts.reminder_hours,
    };
  }

  // Return retry and backoff limits for operations
  limits(): LimitsConfig {
    return {
      maxNotificationRetries: this.policy.limits.maxNotificationRetries,
      notificationBackoffSeconds: this.policy.limits.notificationBackoffSeconds,
      roleAssignMaxRetries: this.policy.limits.roleAssignMaxRetries,
      roleAssignRetryBackoffSeconds: this.policy.limits.roleAssignRetryBackoffSeconds,
    };
  }

  // Return all message templates for DMs and RA queue
  messaging(): MessageTemplates {
    return {
      dm: this.policy.templates.dm,
      ra_queue: this.policy.templates.ra_queue,
    };
  }

  // Return all halls with port interface shape (excludes normalize config)
  // .map() transforms PolicyConfig hall objects into port HallConfig objects
  // ?? provides fallback value if undefined
  halls(): HallConfig[] {
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
  async reload(): Promise<void> {
    const fileContents = await fs.promises.readFile(this.configPath, 'utf-8');
    const raw = JSON.parse(fileContents);
    const newPolicy = PolicySchema.parse(raw);

    this.policy = newPolicy;

    // Notify all listeners about the configuration change
    for (const listener of this.listeners) {
      listener(newPolicy);
    }
  }
}
