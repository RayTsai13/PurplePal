export interface PolicyTimeouts {
  awaitingRA_ttl_hours: number;
  reminder_hours: number[];
}

export interface PolicyLimits {
  maxNotificationRetries: number;
  notificationBackoffSeconds: number[];
  roleAssignMaxRetries: number;
  roleAssignRetryBackoffSeconds: number[];
}

export interface PolicyTemplates {
  dm: Record<string, string>;
  ra_queue: Record<string, string>;
}

export interface PolicyService {
  currentTerm(): Promise<string>;
  timeouts(): Promise<PolicyTimeouts>;
  limits(): Promise<PolicyLimits>;
  messaging(): Promise<PolicyTemplates>;
}
