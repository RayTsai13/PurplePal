import { User, UserStatus } from '../entities/User';

export interface UsersRepo {
  /**
   * Creates or updates a user record based on Discord ID.
   * Returns the full User object after upsert.
   */
  upsertByDiscordId(discordId: string, displayName: string): Promise<User>;

  /**
   * Retrieves a user by Discord ID, or null if not found.
   */
  getByDiscordId(discordId: string): Promise<User | null>;

  /**
   * Updates the user's verification status.
   */
  updateStatus(discordId: string, status: UserStatus): Promise<void>;
}
