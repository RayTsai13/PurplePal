import { Client, Events, GatewayIntentBits } from 'discord.js';
import { logger } from '../../infra/logger';

export class DiscordClient {
  private readonly client: Client;
  private readonly ready: Promise<void>;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
      ],
    });

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

    this.client.on(Events.GuildMemberAdd, (member) => {
      logger.info(
        {
          memberId: member.id,
          guildId: member.guild.id,
        },
        'Member joined guild',
      );
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      logger.debug(
        { interactionId: interaction.id, type: interaction.type },
        'Interaction received',
      );
    });

    this.client.on(Events.Error, (err) => {
      logger.error({ err }, 'Discord client error');
    });
  }

  async start(token: string): Promise<void> {
    await this.client.login(token);
    await this.ready;
  }

  shutdown(): void {
    this.client.destroy();
  }

  get guildCount(): number {
    return this.client.guilds.cache.size;
  }
}
