import type { HallService } from '../../core/application/ports';
import { HallDirectory } from './hallDirectory';

export class HallServiceImpl implements HallService {
  constructor(private readonly directory: HallDirectory) {}

  async validate(hall: string) {
    const match = this.directory.resolve(hall);

    if (!match) {
      return { valid: false };
    }

    return {
      valid: true,
      normalizedHall: match.name,
      raRoleId: match.raRoleId,
      queueChannelId: match.queueChannelId,
      hallRoleId: match.hallRoleId,
    };
  }
}
