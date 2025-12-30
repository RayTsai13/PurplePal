import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { logger } from '../../infra/logger';

// Wrapper around discord.js Client for lifecycle management and event logging
// Handles authentication, ready state, and lifecycle events
export class DiscordClient {
  private readonly client: Client;
  // Promise that resolves when Discord client is fully ready
  private readonly ready: Promise<void>;

  constructor() {
    // Create discord.js Client with configured intents and partials
    // Intents control which events the bot receives (guilds, members, messages, reactions, DMs)
    // Partials allow handling of partial/cached objects if needed
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });

    // Store promise that resolves when ClientReady event fires
    // .once() listens for event one time then removes listener
    // Promise constructor with resolve callback allows waiting for async event
    this.ready = new Promise<void>((resolve) => {
      this.client.once(Events.ClientReady, (readyClient) => {
        logger.info(
          {
            user: readyClient.user.tag,
            guilds: readyClient.guilds.cache.size,
          },
          'Discord client ready',
        );
        resolve();
      });
    });

    // Log when guild members join
    this.client.on(Events.GuildMemberAdd, (member) => {
      logger.info(
        {
          memberId: member.id,
          guildId: member.guild.id,
        },
        'Member joined guild',
      );
    });

    // Log all interactions (slash commands, buttons, modals) for debugging
    this.client.on(Events.InteractionCreate, (interaction) => {
      logger.debug(
        { interactionId: interaction.id, type: interaction.type },
        'Interaction received',
      );
    });

    // Log any errors from Discord client
    this.client.on(Events.Error, (err) => {
      logger.error({ err }, 'Discord client error');
    });
  }

  // Connect to Discord with bot token and wait for ready state
  async start(token: string): Promise<void> {
    await this.client.login(token);
    // Wait for ClientReady event before returning
    await this.ready;
  }

  // Destroy client connection and cleanup resources
  shutdown(): void {
    this.client.destroy();
  }

  // Read-only getter for number of guilds the bot is in
  get guildCount(): number {
    return this.client.guilds.cache.size;
  }

  // Expose raw discord.js Client for event binding and API calls
  get sdk(): Client {
    return this.client;
  }
}
