export type UserStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'DENIED';
export type UserRole = 'STUDENT' | 'RA' | 'ADMIN';

export interface User {
  id: number;
  discordId: string;
  displayName: string;
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}
