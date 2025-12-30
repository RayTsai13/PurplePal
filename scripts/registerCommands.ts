import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { env } from '../src/infra/env';
import { logger } from '../src/infra/logger';

async function main(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Start the resident verification flow.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('verify-reset')
      .setDescription('Reset your verification flow to start over.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('verify-decision')
      .setDescription('Approve or deny a verification case by ID.')
      .addStringOption((option) =>
        option.setName('case_id').setDescription('Verification case ID').setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('decision')
          .setDescription('Approve or deny the case')
          .setRequired(true)
          .addChoices(
            { name: 'Approve', value: 'approve' },
            { name: 'Deny', value: 'deny' },
          ),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Optional reason for the decision').setRequired(false),
      )
      .toJSON(),
  ];

  const route = Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.GUILD_ID);

  logger.info({ commands: commands.length, route }, 'Registering slash commands');
  await rest.put(route, { body: commands });
  logger.info('Slash commands registered successfully');
}

main().catch((err) => {
  logger.error({ err }, 'Failed to register slash commands');
  process.exitCode = 1;
});
