import type {
  Config,
  HallConfig,
  LimitsConfig,
  MessageTemplates,
  TimeoutConfig,
} from '../../core/ports';
import type { PolicyConfig } from '../config/policySchema';

/**
 * Synchronous configuration service.
 * Config is loaded at startup and doesn't change, so no async needed.
 */
export class ConfigImpl implements Config {
  constructor(private readonly policy: PolicyConfig) {}

  currentTerm(): string {
    return this.policy.term;
  }

  timeouts(): TimeoutConfig {
    return {
      awaitingRA_ttl_hours: this.policy.timeouts.awaitingRA_ttl_hours,
      reminder_hours: this.policy.timeouts.reminder_hours,
    };
  }

  limits(): LimitsConfig {
    return {
      maxNotificationRetries: this.policy.limits.maxNotificationRetries,
      notificationBackoffSeconds: this.policy.limits.notificationBackoffSeconds,
      roleAssignMaxRetries: this.policy.limits.roleAssignMaxRetries,
      roleAssignRetryBackoffSeconds: this.policy.limits.roleAssignRetryBackoffSeconds,
    };
  }

  messaging(): MessageTemplates {
    return {
      dm: this.policy.templates.dm,
      ra_queue: this.policy.templates.ra_queue,
    };
  }

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
