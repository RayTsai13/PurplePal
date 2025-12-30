import { Command } from 'commander';
import { getCliContainer } from '../container';
import { printTable, printError } from '../utils/output';

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Configuration viewing');

  configCmd
    .command('show')
    .description('Display current configuration')
    .action(async () => {
      try {
        const { config, disconnect } = await getCliContainer();

        console.log('\n=== Current Configuration ===\n');

        console.log(`Term: ${config.currentTerm()}\n`);

        // Timeouts
        const timeouts = config.timeouts();
        console.log('Timeouts:');
        printTable(
          ['Setting', 'Value'],
          [
            ['Awaiting RA TTL', `${timeouts.awaitingRA_ttl_hours} hours`],
            ['Reminder Hours', timeouts.reminder_hours.join(', ')],
          ],
        );

        // Limits
        const limits = config.limits();
        console.log('\nLimits:');
        printTable(
          ['Setting', 'Value'],
          [
            ['Max Notification Retries', limits.maxNotificationRetries.toString()],
            ['Notification Backoff (sec)', limits.notificationBackoffSeconds.join(', ')],
            ['Role Assign Max Retries', limits.roleAssignMaxRetries.toString()],
            ['Role Assign Backoff (sec)', limits.roleAssignRetryBackoffSeconds.join(', ')],
          ],
        );

        // Halls
        const halls = config.halls();
        console.log('\nConfigured Halls:');
        printTable(
          ['Name', 'Aliases', 'Queue Channel', 'Hall Role'],
          halls.map((h) => [
            h.name,
            h.aliases.join(', ') || '-',
            h.queueChannelId.slice(0, 10) + '...',
            h.hallRoleId.slice(0, 10) + '...',
          ]),
        );

        await disconnect();
      } catch (error) {
        printError(`Failed to show config: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  configCmd
    .command('halls')
    .description('List all configured halls with details')
    .action(async () => {
      try {
        const { config, disconnect } = await getCliContainer();

        const halls = config.halls();

        console.log('\n=== Hall Configuration ===\n');

        for (const hall of halls) {
          console.log(`\n${hall.name}`);
          console.log('-'.repeat(hall.name.length));
          printTable(
            ['Field', 'Value'],
            [
              ['Aliases', hall.aliases.join(', ') || 'None'],
              ['RA Role ID', hall.raRoleId],
              ['Queue Channel ID', hall.queueChannelId],
              ['Hall Role ID', hall.hallRoleId],
              ['Room Pattern', hall.room?.pattern || 'Any'],
              ['Room Example', hall.room?.example || '-'],
            ],
          );
        }

        await disconnect();
      } catch (error) {
        printError(`Failed to show halls: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  configCmd
    .command('templates')
    .description('Show message templates')
    .action(async () => {
      try {
        const { config, disconnect } = await getCliContainer();

        const messaging = config.messaging();

        console.log('\n=== DM Templates ===\n');
        for (const [name, template] of Object.entries(messaging.dm)) {
          console.log(`${name}:`);
          console.log(`  "${template}"\n`);
        }

        console.log('\n=== RA Queue Templates ===\n');
        for (const [name, template] of Object.entries(messaging.ra_queue)) {
          console.log(`${name}:`);
          console.log(`  "${template}"\n`);
        }

        await disconnect();
      } catch (error) {
        printError(`Failed to show templates: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
