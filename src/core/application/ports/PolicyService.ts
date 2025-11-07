export interface PolicyService {
  currentTerm(): Promise<string>;
  timeouts(): Promise<{ awaitingRA_ttl_hours: number; reminder_hours: number[] }>;
  limits(): Promise<{ maxNotificationRetries: number; roleRetryBackoffSec: number }>;
  messaging(): Promise<Record<string, string>>;
}
