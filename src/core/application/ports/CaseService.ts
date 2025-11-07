export type CaseState =
  | "joined"
  | "hall_chosen"
  | "room_entered"
  | "awaiting_ra"
  | "approved"
  | "denied"
  | "expired";

export interface CaseRecord {
  id: string;
  userId: string;
  term: string;
  state: CaseState;
  hall?: string;
  room?: string;
  raUserId?: string;
  version: number;
  expiresAt?: Date;
}

export interface CaseService {
  getActiveCase(userId: string, term: string): Promise<CaseRecord | null>;
  createIfNone(userId: string, term: string, initialState: CaseState): Promise<CaseRecord>;
  updateState(
    caseId: string,
    expectedVersion: number,
    toState: CaseState,
    patch?: Partial<CaseRecord>,
  ): Promise<CaseRecord>;
  markExpired(filters?: unknown): Promise<number>;
  findById(caseId: string): Promise<CaseRecord | null>;
}
