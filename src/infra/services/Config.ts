import type {
  Config,
  HallConfig,
  LimitsConfig,
  MessageTemplates,
  TimeoutConfig,
} from '../../core/ports';
import type { PolicyConfig } from '../config/policySchema';

// Synchronous configuration service implementing Config port interface
// Config is loaded at startup from policy.json and doesn't change
// private readonly means the policy cannot be modified after construction
export class ConfigImpl implements Config {
  constructor(private readonly policy: PolicyConfig) {}

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
}
