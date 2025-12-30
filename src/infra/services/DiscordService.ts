import type {
  DiscordService,
  HallValidationResult,
  RoomNormalizationResult,
  RoleOperationResult,
} from '../../core/ports';
import { DiscordClient } from '../../adapters/discord/DiscordClient';
import { HallDirectory } from './hallDirectory';
import type { HallConfig, RoomConfig } from '../config/policySchema';
import { renderTemplate } from '../utils/template';
import type { TextBasedChannel } from 'discord.js';

interface NormalizeOptions extends NonNullable<RoomConfig['normalize']> {}

/**
 * Unified Discord service combining hall/room validation,
 * notifications, and role management.
 */
export class DiscordServiceImpl implements DiscordService {
  constructor(
    private readonly client: DiscordClient,
    private readonly hallDirectory: HallDirectory,
    private readonly guildId: string,
  ) {}

  // ==================== Hall Validation ====================

  async validateHall(hall: string): Promise<HallValidationResult> {
    const match = this.hallDirectory.resolve(hall);

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

  // ==================== Room Normalization ====================

  async normalizeRoom(hall: string, roomRaw: string): Promise<RoomNormalizationResult> {
    const hallConfig = this.hallDirectory.getByName(hall) ?? this.hallDirectory.resolve(hall);
    if (!hallConfig) {
      return { valid: false, errors: [`Unknown hall "${hall}"`] };
    }

    if (!hallConfig.room) {
      return { valid: false, errors: [`Room configuration missing for hall "${hallConfig.name}"`] };
    }

    const normalized = this.applyNormalization(roomRaw, hallConfig);

    const pattern = this.compilePattern(hallConfig.room.pattern);
    if (!pattern.test(normalized)) {
      return {
        valid: false,
        errors: [`Room must match format ${hallConfig.room.example}`],
      };
    }

    return { valid: true, room: normalized };
  }

  private compilePattern(pattern: string): RegExp {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`Invalid room pattern "${pattern}": ${(error as Error).message}`);
    }
  }

  private applyNormalization(roomRaw: string, hallConfig: HallConfig): string {
    const rules: NormalizeOptions = hallConfig.room?.normalize ?? {};
    let current = roomRaw;

    if (rules.trimSpaces) {
      current = current.trim();
    }

    if (rules.uppercase) {
      current = current.toUpperCase();
    }

    if (rules.collapseDelimiters) {
      current = current.replace(/[-_\s]+/g, '-');
    }

    if (rules.fixHyphens) {
      current = current.replace(/\s*-\s*/g, '-');
    }

    if (rules.allowMissingHyphens) {
      const parts = current.split(/[-\s]+/);
      if (parts.length > 1) {
        current = parts.join('-');
      }
    }

    if (rules.uppercase) {
      current = current.toUpperCase();
    }

    return current;
  }

  // ==================== Notifications ====================

  async sendDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    _idempotencyKey?: string,
  ): Promise<void> {
    const content = renderTemplate(template, data);
    const user = await this.client.sdk.users.fetch(userId);
    await user.send({ content });
  }

  async sendToQueue(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    _idempotencyKey?: string,
  ): Promise<void> {
    const content = renderTemplate(template, data);
    const channel = await this.client.sdk.channels.fetch(channelId);
    if (!this.isSendableChannel(channel)) {
      throw new Error(`Channel ${channelId} is not text-based or not found`);
    }

    await channel.send({ content });
  }

  private isSendableChannel(channel: unknown): channel is TextBasedChannel & { send: (options: { content: string }) => Promise<unknown> } {
    if (!channel) {
      return false;
    }

    const candidate = channel as Partial<TextBasedChannel>;
    return typeof candidate === 'object' && !!candidate && typeof (candidate as any).send === 'function';
  }

  // ==================== Role Management ====================

  async assignRoles(userId: string, roleIds: string[], _idempotencyKey?: string): Promise<RoleOperationResult> {
    try {
      const member = await this.fetchMember(userId);
      await member.roles.add(roleIds);
      return { status: 'success' };
    } catch (error) {
      return { status: 'failure', details: this.formatError(error) };
    }
  }

  async removeRoles(userId: string, roleIds: string[], _idempotencyKey?: string): Promise<RoleOperationResult> {
    try {
      const member = await this.fetchMember(userId);
      await member.roles.remove(roleIds);
      return { status: 'success' };
    } catch (error) {
      return { status: 'failure', details: this.formatError(error) };
    }
  }

  private async fetchMember(userId: string) {
    const guild = await this.client.sdk.guilds.fetch(this.guildId);
    return guild.members.fetch(userId);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown Discord error';
  }
}
