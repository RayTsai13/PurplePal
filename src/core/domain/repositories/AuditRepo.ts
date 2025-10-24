import { AuditEvent } from '../entities/AuditEvent';

export interface AuditRepo {
  /**
   * Records a new audit event.
   */
  record(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void>;
}
