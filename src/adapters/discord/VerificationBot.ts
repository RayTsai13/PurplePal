import {
  ChannelType,
  Events,
  GuildMember,
  Interaction,
  ChatInputCommandInteraction,
  Message,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from 'discord.js';
import { logger } from '../../infra/logger';
import type {
  DecisionResult,
  VerificationOrchestrator,
} from '../../core/application/orchestrator/VerificationOrchestrator';
import { DiscordClient } from './DiscordClient';

// Ephemeral replies for each /verify-decision outcome
const DECISION_REPLIES: Record<Exclude<DecisionResult, { ok: true }>['reason'], (caseId: string) => string> = {
  not_found: (caseId) => `Case ${caseId} not found.`,
  not_pending: (caseId) => `Case ${caseId} is not awaiting review (it may already be decided or expired).`,
  unauthorized: () => 'You are not authorized to decide this case.',
  conflict: (caseId) => `Case ${caseId} was just decided by someone else.`,
};

// Binds Discord events to verification orchestrator
// Handles /verify, /verify-decision, /verify-reset slash commands, DMs, and emoji reactions
// All workflow and authorization rules live in the orchestrator; this class only translates events
export class VerificationBot {
  constructor(
    private readonly discord: DiscordClient,
    private readonly orchestrator: VerificationOrchestrator,
  ) {}

  // Register Discord event handlers for verification workflow
  bind(): void {
    const client = this.discord.sdk;

    // Handle slash command interactions (/verify, /verify-decision, /verify-reset)
    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        await this.handleInteraction(interaction);
      } catch (err) {
        logger.error({ err }, 'Failed to handle interaction');
        await this.replyWithError(interaction);
      }
    });

    // Handle DMs for hall and room selection during verification
    client.on(Events.MessageCreate, async (message) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        logger.error({ err }, 'Failed to handle DM message');
      }
    });

    // Handle emoji reactions on RA approval queue messages
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      try {
        await this.handleReaction(reaction, user);
      } catch (err) {
        logger.error({ err }, 'Failed to handle reaction');
      }
    });

    // Handle new members joining the server - auto-trigger verification
    client.on(Events.GuildMemberAdd, async (member) => {
      try {
        await this.handleMemberJoin(member);
      } catch (err) {
        logger.error({ err, memberId: member.id }, 'Failed to handle member join');
      }
    });
  }

  // Route slash command to appropriate handler based on command name
  private async handleInteraction(interaction: Interaction): Promise<void> {
    // Type guard to check if interaction is a chat input command (slash command)
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === 'verify') {
      await this.startVerification(interaction);
      return;
    }

    if (interaction.commandName === 'verify-decision') {
      await this.handleDecision(interaction);
      return;
    }

    if (interaction.commandName === 'verify-reset') {
      await this.handleReset(interaction);
    }
  }

  // Don't leave the user staring at "thinking..." if a handler threw after deferring
  private async replyWithError(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const content = 'Something went wrong. Please try again or contact an admin.';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(content);
      } else {
        await interaction.reply({ ephemeral: true, content });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to send error reply');
    }
  }

  // /verify command starts new verification case
  private async startVerification(interaction: ChatInputCommandInteraction): Promise<void> {
    // deferReply with ephemeral: true makes reply only visible to user who ran command
    await interaction.deferReply({ ephemeral: true });
    await this.orchestrator.onUserJoined(interaction.user.id, interaction.id);
    await interaction.editReply('Check your DMs to continue verification.');
  }

  // /verify-decision command for RAs and moderators to approve or deny a case
  private async handleDecision(interaction: ChatInputCommandInteraction): Promise<void> {
    const caseId = interaction.options.getString('case_id', true).trim();
    const decisionRaw = interaction.options.getString('decision', true).toLowerCase();
    const reason = interaction.options.getString('reason') ?? undefined;

    if (decisionRaw !== 'approve' && decisionRaw !== 'deny') {
      await interaction.reply({ ephemeral: true, content: 'Decision must be either approve or deny.' });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const result = await this.orchestrator.onRAResponded(
      caseId,
      interaction.user.id,
      decisionRaw,
      reason,
      interaction.id,
    );

    await interaction.editReply(
      result.ok ? `Recorded ${decisionRaw} for case ${caseId}.` : DECISION_REPLIES[result.reason](caseId),
    );
  }

  // Handle DMs for hall and room selection during verification
  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot || message.channel.type !== ChannelType.DM) {
      return;
    }

    const content = message.content.trim();
    if (!content) {
      return;
    }

    const result = await this.orchestrator.onDirectMessage(message.author.id, content, message.id);
    if (result.handled) {
      return;
    }

    if (result.reason === 'no_case') {
      await message.channel.send('Start verification by running /verify inside the server.');
    } else {
      await message.channel.send('Thanks! Your request is already awaiting RA review.');
    }
  }

  // /verify-reset command to cancel the user's in-progress verification
  private async handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const result = await this.orchestrator.onUserReset(interaction.user.id, interaction.id);
    if (result.ok) {
      await interaction.editReply('Your verification flow has been reset. Run /verify to start again.');
    } else if (result.reason === 'pending_review') {
      await interaction.editReply('Your request is already awaiting RA review and can no longer be reset.');
    } else {
      await interaction.editReply('You have no verification in progress to reset.');
    }
  }

  // Handle new member joining the server - auto-trigger verification
  private async handleMemberJoin(member: GuildMember): Promise<void> {
    // Skip bots - they don't need verification
    if (member.user.bot) {
      return;
    }

    logger.info({ memberId: member.id, guildId: member.guild.id }, 'Auto-triggering verification for new member');
    // Each join is a distinct event, so the key includes the join time
    const joinedAt = member.joinedTimestamp ?? Date.now();
    await this.orchestrator.onMemberJoined(member.id, `join-${member.id}-${joinedAt}`);
  }

  // Handle emoji reactions on RA queue approval messages
  private async handleReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    // Partial objects are lazy-loaded placeholders, fetch full object from API
    if (user.partial) {
      user = await user.fetch();
    }

    // Ignore bot reactions
    if (user.bot) {
      return;
    }

    // Partial reactions must also be fetched before accessing data
    if (reaction.partial) {
      reaction = await reaction.fetch();
    }

    // Fetch partial message if needed
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    // Only process reactions on bot's own messages in guild channels
    if (!message.guildId || message.author?.id !== this.discord.sdk.user?.id) {
      return;
    }

    const decision = this.decisionFromEmoji(reaction.emoji.name ?? '');
    if (!decision) {
      return;
    }

    const caseId = this.extractCaseId(message.content);
    if (!caseId) {
      return;
    }

    // Silently drop reactions from people who can't decide, instead of posting an
    // unauthorized-attempt notice for every stray emoji
    if (!(await this.orchestrator.canDecide(caseId, user.id))) {
      await reaction.users.remove(user.id);
      return;
    }

    const result = await this.orchestrator.onRAResponded(
      caseId,
      user.id,
      decision,
      undefined,
      `reaction-${reaction.emoji.name}-${caseId}-${user.id}`,
    );
    if (!result.ok) {
      logger.info({ caseId, userId: user.id, reason: result.reason }, 'Reaction decision not applied');
    }

    // Remove the reaction either way: applied, or the case was already decided
    await reaction.users.remove(user.id);
  }

  // Convert emoji to decision approval action
  private decisionFromEmoji(emojiName: string): 'approve' | 'deny' | null {
    // Normalize to lowercase to handle both emoji names and unicode
    const normalized = emojiName.toLowerCase();
    // Check for approve emojis (checkmark or thumbs up)
    if (normalized === '✅' || normalized === '👍' || normalized === 'white_check_mark') {
      return 'approve';
    }
    // Check for deny emojis (X or thumbs down)
    if (normalized === '❌' || normalized === '👎' || normalized === 'x' || normalized === 'cross_mark') {
      return 'deny';
    }
    // Unknown emoji
    return null;
  }

  // Extract case ID from message content using regex pattern matching
  private extractCaseId(content: string): string | null {
    // Regex matches "case id:" or "case id " followed by alphanumeric and hyphens
    // /i flag makes match case-insensitive
    // match[1] is the captured group (the case ID itself)
    const match = content.match(/case\s*id[:\s]+([a-z0-9-]+)/i);
    return match ? match[1] : null;
  }
}
