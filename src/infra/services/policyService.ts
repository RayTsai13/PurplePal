import type {
  PolicyService,
  PolicyLimits,
  PolicyTemplates,
  PolicyTimeouts,
} from '../../core/application/ports/PolicyService';
import type { PolicyConfig } from '../config/policySchema';

export class PolicyServiceImpl implements PolicyService {
  constructor(private readonly config: PolicyConfig) {}

  async currentTerm(): Promise<string> {
    return this.config.term;
  }

  async timeouts(): Promise<PolicyTimeouts> {
    return {
      awaitingRA_ttl_hours: this.config.timeouts.awaitingRA_ttl_hours,
      reminder_hours: [...this.config.timeouts.reminder_hours],
    };
  }

  async limits(): Promise<PolicyLimits> {
    return {
      maxNotificationRetries: this.config.limits.maxNotificationRetries,
      notificationBackoffSeconds: [...this.config.limits.notificationBackoffSeconds],
      roleAssignMaxRetries: this.config.limits.roleAssignMaxRetries,
      roleAssignRetryBackoffSeconds: [...this.config.limits.roleAssignRetryBackoffSeconds],
    };
  }

  async messaging(): Promise<PolicyTemplates> {
    return {
      dm: { ...this.config.templates.dm },
      ra_queue: { ...this.config.templates.ra_queue },
    };
  }
}
