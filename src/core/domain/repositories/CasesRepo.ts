import { ResidencyClaim, ResidencyState } from '../entities/ResidencyClaim';

export interface CasesRepo {
  /**
   * Creates a new claim for the given user.
   */
  create(data: Omit<ResidencyClaim, 'id' | 'createdAt' | 'updatedAt'>): Promise<ResidencyClaim>;

  /**
   * Gets the active (non-expired) claim for a user.
   */
  getActiveByUser(userId: number): Promise<ResidencyClaim | null>;

  /**
   * Updates the state (e.g. pending → approved → denied) of a claim.
   */
  updateState(caseId: number, state: ResidencyState): Promise<void>;

  /**
   * Lists all pending claims for a given hall (for RAs to review).
   */
  listPendingByHall(hall: string): Promise<ResidencyClaim[]>;
}
