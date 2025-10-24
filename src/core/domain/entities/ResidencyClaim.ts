export type ResidencyState = 'DRAFT' | 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
export type SourceType = 'MANUAL';

export interface ResidencyClaim {
  id: number;
  userId: number;
  hall: string;
  room: string;
  term: string;
  source: SourceType;
  state: ResidencyState;
  submittedAt?: Date;
  decidedAt?: Date;
  decidedBy?: number;
  denialReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
