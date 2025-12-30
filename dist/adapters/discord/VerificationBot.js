"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationBot = void 0;
const discord_js_1 = require("discord.js");
const logger_1 = require("../../infra/logger");
class VerificationBot {
    constructor(discord, orchestrator, cases, config, hallService, moderatorIds, guildId) {
        this.discord = discord;
        this.orchestrator = orchestrator;
        this.cases = cases;
        this.config = config;
        this.hallService = hallService;
        this.guildId = guildId;
        this.moderators = new Set(moderatorIds);
    }
    bind() {
        const client = this.discord.sdk;
        client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
            try {
                await this.handleInteraction(interaction);
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Failed to handle interaction');
            }
        });
        client.on(discord_js_1.Events.MessageCreate, async (message) => {
            try {
                await this.handleMessage(message);
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Failed to handle DM message');
            }
        });
        client.on(discord_js_1.Events.MessageReactionAdd, async (reaction, user) => {
            try {
                await this.handleReaction(reaction, user);
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Failed to handle reaction');
            }
        });
    }
    async handleInteraction(interaction) {
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
    async startVerification(interaction) {
        await interaction.deferReply({ ephemeral: true });
        await this.orchestrator.onUserJoined(interaction.user.id, interaction.id);
        await interaction.editReply('Check your DMs to continue verification.');
    }
    async handleDecision(interaction) {
        const caseId = interaction.options.getString('case_id', true);
        const decisionRaw = interaction.options.getString('decision', true).toLowerCase();
        const reason = interaction.options.getString('reason') ?? undefined;
        if (decisionRaw !== 'approve' && decisionRaw !== 'deny') {
            await interaction.reply({ ephemeral: true, content: 'Decision must be either approve or deny.' });
            return;
        }
        const decision = decisionRaw;
        const kase = await this.cases.findById(caseId);
        if (!kase) {
            await interaction.reply({ ephemeral: true, content: `Case ${caseId} not found.` });
            return;
        }
        const authorized = await this.isAuthorized(interaction.user.id, kase);
        if (!authorized) {
            await interaction.reply({ ephemeral: true, content: 'You are not authorized to decide this case.' });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            await this.orchestrator.onRAResponded(caseId, interaction.user.id, decision, reason, interaction.id);
            await interaction.editReply(`Recorded ${decision} for case ${caseId}.`);
        }
        catch (err) {
            logger_1.logger.error({ err, caseId }, 'Failed to record decision');
            await interaction.editReply('Failed to record decision. Please try again or contact an admin.');
        }
    }
    async handleMessage(message) {
        if (message.author.bot) {
            return;
        }
        if (message.channel.type !== discord_js_1.ChannelType.DM) {
            return;
        }
        const content = message.content.trim();
        if (!content) {
            return;
        }
        const term = this.config.currentTerm();
        const kase = await this.cases.getActiveCase(message.author.id, term);
        if (!kase) {
            await message.channel.send('Start verification by running /verify inside the server.');
            return;
        }
        if (kase.state === 'joined') {
            await this.orchestrator.onHallChosen(message.author.id, content, message.id);
            return;
        }
        if (kase.state === 'hall_chosen') {
            await this.orchestrator.onRoomEntered(message.author.id, content, message.id);
            return;
        }
        if (kase.state === 'awaiting_ra') {
            await message.channel.send('Thanks! Your request is already awaiting RA review.');
            return;
        }
        await message.channel.send('Your case has already been decided. Re-run /verify to start a new request.');
    }
    async handleReset(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const term = this.config.currentTerm();
        await this.cases.resetCase(interaction.user.id, term);
        await interaction.editReply('Your verification flow has been reset. Run /verify to start again.');
    }
    isModerator(userId) {
        return this.moderators.has(userId);
    }
    async isAuthorized(userId, kase) {
        if (this.isModerator(userId)) {
            return true;
        }
        if (!kase.hall) {
            return false;
        }
        const hallDetails = await this.hallService.validateHall(kase.hall);
        if (!hallDetails.valid || !hallDetails.raRoleId) {
            return false;
        }
        const guild = await this.discord.sdk.guilds.fetch(this.guildId);
        const member = await guild.members.fetch(userId);
        return member.roles.cache.has(hallDetails.raRoleId);
    }
    async handleReaction(reaction, user) {
        if (user.partial) {
            user = await user.fetch();
        }
        if (user.bot) {
            return;
        }
        if (reaction.partial) {
            reaction = await reaction.fetch();
        }
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
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
        const kase = await this.cases.findById(caseId);
        if (!kase || kase.state !== 'awaiting_ra') {
            return;
        }
        const authorized = await this.isAuthorized(user.id, kase);
        if (!authorized) {
            await reaction.users.remove(user.id);
            return;
        }
        try {
            await this.orchestrator.onRAResponded(caseId, user.id, decision, undefined, `reaction-${reaction.emoji.name}-${caseId}-${user.id}`);
            await reaction.users.remove(user.id);
        }
        catch (err) {
            // Handle optimistic locking conflicts (concurrent RA responses)
            if (err instanceof Error && err.message.includes('version')) {
                logger_1.logger.info({ caseId, userId: user.id }, 'Case already processed by another RA');
                await reaction.users.remove(user.id);
                return;
            }
            // Re-throw other errors to be caught by the outer handler
            throw err;
        }
    }
    decisionFromEmoji(emojiName) {
        const normalized = emojiName.toLowerCase();
        if (normalized === '✅' || normalized === '👍' || normalized === 'white_check_mark') {
            return 'approve';
        }
        if (normalized === '❌' || normalized === '👎' || normalized === 'x' || normalized === 'cross_mark') {
            return 'deny';
        }
        return null;
    }
    extractCaseId(content) {
        const match = content.match(/case\s*id[:\s]+([a-z0-9-]+)/i);
        return match ? match[1] : null;
    }
}
exports.VerificationBot = VerificationBot;
