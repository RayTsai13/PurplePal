export interface AuditService {
  record(
    caseId: string,
    action: string,
    fromState?: string,
    toState?: string,
    actorType?: "user" | "ra" | "system",
    actorId?: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;
}
