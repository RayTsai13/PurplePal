export interface HallService {
  validate(
    hall: string,
  ): Promise<{
    valid: boolean;
    normalizedHall?: string;
    raRoleId?: string;
    queueChannelId?: string;
    hallRoleId?: string;
  }>;
}
