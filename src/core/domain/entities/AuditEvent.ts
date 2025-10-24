export interface AuditEvent {
  id: number;
  actorId: number;
  caseId: number;
  action: string;
  payloadJSON: any;
  timestamp: Date;
}
