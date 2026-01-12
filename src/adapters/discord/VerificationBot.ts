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
import type { VerificationOrchestrator } from '../../core/application/orchestrator/VerificationOrchestrator';
import type { CaseRecord, CaseRepository, Config, DiscordService } from '../../core/ports';
import { DiscordClient } from './DiscordClient';

// Binds Discord events to verification orchestrator
// Handles /verify, /verify-decision, /verify-reset slash commands, DMs, and emoji reactions
export class VerificationBot {
  // Set of Discord user IDs with moderator permissions (can approve any case)
  private readonly moderators: Set<string>;

  constructor(
    private readonly discord: DiscordClient,
    private readonly orchestrator: VerificationOrchestrator,
    private readonly cases: CaseRepository,
    private readonly config: Config,
    private readonly hallService: DiscordService,
    moderatorIds: string[],
    private readonly guildId: string,
  ) {
    // Create Set from moderator IDs for fast lookups with .has()
    this.moderators = new Set(moderatorIds);
  }

  // Register Discord event handlers for verification workflow
  bind(): void {
    const client = this.discord.sdk;

    // Handle slash command interactions (/verify, /verify-decision, /verify-reset)
    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        await this.handleInteraction(interaction);
      } catch (err) {
        logger.error({ err }, 'Failed to handle interaction');
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

  // /verify command starts new verification case
  private async startVerification(interaction: ChatInputCommandInteraction): Promise<void> {
    // deferReply with ephemeral: true makes reply only visible to user who ran command
    await interaction.deferReply({ ephemeral: true });
    // Create case in joined state and prompt user to DM hall selection
    await this.orchestrator.onUserJoined(interaction.user.id, interaction.id);
    // editReply sends the deferred response
    await interaction.editReply('Check your DMs to continue verification.');
  }

  // /verify-decision command for RAs to approve or deny a case
  private async handleDecision(interaction: ChatInputCommandInteraction): Promise<void> {
    // .getString(name, required) gets string option from command parameters
    const caseId = interaction.options.getString('case_id', true);
    // .toLowerCase() ensures "APPROVE" and "Approve" both become "approve"
    const decisionRaw = interaction.options.getString('decision', true).toLowerCase();
    // ?? operator provides fallback to undefined if reason not provided
    const reason = interaction.options.getString('reason') ?? undefined;

    // Validate decision is one of allowed values
    if (decisionRaw !== 'approve' && decisionRaw !== 'deny') {
      await interaction.reply({ ephemeral: true, content: 'Decision must be either approve or deny.' });
      return;
    }

    // Type cast string to union type after validation
    const decision = decisionRaw as 'approve' | 'deny';
    // Look up case to verify it exists and get state info
    const kase = await this.cases.findById(caseId);

    if (!kase) {
      await interaction.reply({ ephemeral: true, content: `Case ${caseId} not found.` });
      return;
    }

    // Check if user is authorized to decide this case (RA for hall or moderator)
    const authorized = await this.isAuthorized(interaction.user.id, kase);
    if (!authorized) {
      await interaction.reply({ ephemeral: true, content: 'You are not authorized to decide this case.' });
      return;
    }

    // Defer reply before long operation
    await interaction.deferReply({ ephemeral: true });

    try {
      // Update case state to approved or denied
      await this.orchestrator.onRAResponded(
        caseId,
        interaction.user.id,
        decision,
        reason,
        interaction.id,
      );
      await interaction.editReply(`Recorded ${decision} for case ${caseId}.`);
    } catch (err) {
      logger.error({ err, caseId }, 'Failed to record decision');
      await interaction.editReply('Failed to record decision. Please try again or contact an admin.');
    }
  }

  // Handle DMs for hall and room selection during verification
  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) {
      return;
    }

    // Only process direct messages, not server messages
    if (message.channel.type !== ChannelType.DM) {
      return;
    }

    // Ignore empty messages
    const content = message.content.trim();
    if (!content) {
      return;
    }

    // Get user's active case for current term
    const term = this.config.currentTerm();
    const kase = await this.cases.getActiveCase(message.author.id, term);

    if (!kase) {
      await message.channel.send('Start verification by running /verify inside the server.');
      return;
    }

    // Route based on case state (joined -> hall_chosen -> room_number_entered -> awaiting_ra -> decided)
    if (kase.state === 'joined') {
      // User sends hall name
      await this.orchestrator.onHallChosen(message.author.id, content, message.id);
      return;
    }

    if (kase.state === 'hall_chosen') {
      // User sends room number (step 2 of 3)
      await this.orchestrator.onRoomNumberEntered(message.author.id, content, message.id);
      return;
    }

    if (kase.state === 'room_number_entered') {
      // User sends unit letter (step 3 of 3)
      await this.orchestrator.onRoomEntered(message.author.id, content, message.id);
      return;
    }

    if (kase.state === 'awaiting_ra') {
      // Case is waiting for RA response, user should not send more messages
      await message.channel.send('Thanks! Your request is already awaiting RA review.');
      return;
    }

    // For any other state (approved, denied, expired) offer to restart
    await message.channel.send('Your case has already been decided. Re-run /verify to start a new request.');
  }

  // /verify-reset command to clear user's verification state
  private async handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    // Delete all cases for this user in current term
    const term = this.config.currentTerm();
    await this.cases.resetCase(interaction.user.id, term);

    await interaction.editReply('Your verification flow has been reset. Run /verify to start again.');
  }

  // Handle new member joining the server - auto-trigger verification
  private async handleMemberJoin(member: GuildMember): Promise<void> {
    // Skip bots - they don't need verification
    if (member.user.bot) {
      return;
    }

    logger.info({ memberId: member.id, guildId: member.guild.id }, 'Auto-triggering verification for new member');

    // Assign unverified role if configured (restricts channel access until verified)
    const unverifiedRoleId = this.config.unverifiedRoleId();
    if (unverifiedRoleId) {
      try {
        await this.hallService.assignRoles(member.id, [unverifiedRoleId], `join-${member.id}`);
        logger.info({ memberId: member.id, roleId: unverifiedRoleId }, 'Assigned unverified role to new member');
      } catch (err) {
        logger.error({ err, memberId: member.id }, 'Failed to assign unverified role');
        // Continue with verification even if role assignment fails
      }
    }

    // Trigger verification workflow - creates case and sends DM asking for hall
    await this.orchestrator.onUserJoined(member.id, `join-${member.id}-${Date.now()}`);
  }

  // Check if user is moderator (has full permissions regardless of hall)
  private isModerator(userId: string): boolean {
    // .has() checks if Set contains the user ID
    return this.moderators.has(userId);
  }

  // Check if user can approve a specific case
  // Moderators can approve any case, RAs can approve only their hall cases
  private async isAuthorized(userId: string, kase: CaseRecord): Promise<boolean> {
    // Moderators always authorized
    if (this.isModerator(userId)) {
      return true;
    }

    // Must have hall assigned to check RA role
    if (!kase.hall) {
      return false;
    }

    // Get hall configuration to find RA role ID
    const hallDetails = await this.hallService.validateHall(kase.hall);
    if (!hallDetails.valid || !hallDetails.raRoleId) {
      return false;
    }

    // Fetch guild and member to check if user has RA role for this hall
    const guild = await this.discord.sdk.guilds.fetch(this.guildId);
    const member = await guild.members.fetch(userId);
    // .cache.has() checks if user has the role in their role list
    return member.roles.cache.has(hallDetails.raRoleId);
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

    // Convert emoji to approve or deny decision
    const decision = this.decisionFromEmoji(reaction.emoji.name ?? '');
    if (!decision) {
      return;
    }

    // Extract case ID from message content using regex
    const caseId = this.extractCaseId(message.content);
    if (!caseId) {
      return;
    }

    // Verify case exists and is waiting for RA response
    const kase = await this.cases.findById(caseId);
    if (!kase || kase.state !== 'awaiting_ra') {
      return;
    }

    // Check if reactor is authorized RA for this case
    const authorized = await this.isAuthorized(user.id, kase);
    if (!authorized) {
      // Remove unauthorized reaction
      await reaction.users.remove(user.id);
      return;
    }

    try {
      // Process the decision via orchestrator
      // Idempotency key includes emoji, case, and user to prevent duplicates
      await this.orchestrator.onRAResponded(
        caseId,
        user.id,
        decision,
        undefined,
        `reaction-${reaction.emoji.name}-${caseId}-${user.id}`,
      );
      // Remove reaction after processing to indicate it was handled
      await reaction.users.remove(user.id);
    } catch (err) {
      // Handle optimistic locking conflicts when multiple RAs react simultaneously
      // version error means another RA already processed this case
      if (err instanceof Error && err.message.includes('version')) {
        logger.info({ caseId, userId: user.id }, 'Case already processed by another RA');
        await reaction.users.remove(user.id);
        return;
      }
      // Re-throw other errors to be caught by outer try-catch in bind()
      throw err;
    }
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
