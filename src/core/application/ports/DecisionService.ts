export interface DecisionService {
  authorize(raUserId: string, kase: { hall?: string; userId: string }): Promise<boolean>;
  recordDecision(
    caseId: string,
    raUserId: string,
    decision: "approve" | "deny",
    reason?: string,
    idempotencyKey?: string,
  ): Promise<void>;
}
