import { Command } from 'commander';
import { getCliContainer } from '../container';
import { printTable, printError, printSuccess } from '../utils/output';

// Register configuration viewing commands (show, halls, templates, reload)
export function registerConfigCommands(program: Command): void {
  // Create parent 'config' command group for all configuration subcommands
  const configCmd = program
    .command('config')
    .description('Configuration viewing and management');

  // show displays main configuration settings (timeouts, limits, halls overview)
  configCmd
    .command('show')
    .description('Display current configuration')
    .action(async () => {
      try {
        const { config, disconnect } = await getCliContainer();

        console.log('\n=== Current Configuration ===\n');

        // Get and display current term
        console.log(`Term: ${config.currentTerm()}\n`);

        // Fetch timeout settings from config
        const timeouts = config.timeouts();
        console.log('Timeouts:');
        printTable(
          ['Setting', 'Value'],
          [
            ['Awaiting RA TTL', `${timeouts.awaitingRA_ttl_hours} hours`],
            // .join(', ') combines array elements into comma-separated string for display
            ['Reminder Hours', timeouts.reminder_hours.join(', ')],
          ],
        );

        // Fetch retry/backoff limits from config
        const limits = config.limits();
        console.log('\nLimits:');
        printTable(
          ['Setting', 'Value'],
          [
            ['Max Notification Retries', limits.maxNotificationRetries.toString()],
            // .join(', ') displays array of backoff intervals as readable string
            ['Notification Backoff (sec)', limits.notificationBackoffSeconds.join(', ')],
            ['Role Assign Max Retries', limits.roleAssignMaxRetries.toString()],
            ['Role Assign Backoff (sec)', limits.roleAssignRetryBackoffSeconds.join(', ')],
          ],
        );

        // Fetch list of configured halls
        const halls = config.halls();
        console.log('\nConfigured Halls:');
        // .map() transforms each hall into [name, aliases, queueChannelId_truncated, hallRoleId_truncated] row
        // .slice(0, 10) truncates Discord IDs to first 10 chars for readability
        // || operator shows "-" for empty aliases array
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

  // halls shows detailed information for each configured hall (aliases, Discord IDs, room validation)
  configCmd
    .command('halls')
    .description('List all configured halls with details')
    .action(async () => {
      try {
        const { config, disconnect } = await getCliContainer();

        // Get all hall configurations
        const halls = config.halls();

        console.log('\n=== Hall Configuration ===\n');

        // Loop through each hall and print detailed info
        for (const hall of halls) {
          console.log(`\n${hall.name}`);
          // '-'.repeat() creates a line of dashes equal to hall name length for visual separation
          console.log('-'.repeat(hall.name.length));
          printTable(
            ['Field', 'Value'],
            [
              // .join(', ') combines aliases array into comma-separated list, || shows "None" if empty
              ['Aliases', hall.aliases.join(', ') || 'None'],
              ['RA Role ID', hall.raRoleId],
              ['Queue Channel ID', hall.queueChannelId],
              ['Hall Role ID', hall.hallRoleId],
              // hall.room?.pattern uses optional chaining to safely access nested property
              // Shows "Any" if no room pattern defined, or "-" if room object doesn't exist
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

  // templates displays all DM and RA queue message templates from config
  configCmd
    .command('templates')
    .description('Show message templates')
    .action(async () => {
      try {
        const { config, disconnect } = await getCliContainer();

        // Get all messaging templates (DM and RA queue)
        const messaging = config.messaging();

        console.log('\n=== DM Templates ===\n');
        // Object.entries() converts object to [key, value] pairs for iteration
        // Destructure each pair as [name, template]
        for (const [name, template] of Object.entries(messaging.dm)) {
          console.log(`${name}:`);
          // Print template with indentation for readability
          console.log(`  "${template}"\n`);
        }

        console.log('\n=== RA Queue Templates ===\n');
        // Same pattern for RA queue templates (messages posted to queue channel)
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

  // reload reloads configuration from disk without restarting the application
  // Note: This only reloads the CLI's view of config. The running bot process
  // must call reload() on its own ConfigImpl instance to pick up changes.
  configCmd
    .command('reload')
    .description('Reload configuration from disk (validates policy.json)')
    .action(async () => {
      try {
        const { configImpl, disconnect } = await getCliContainer();

        console.log('Reloading configuration from disk...\n');

        // Store old values for comparison
        const oldTerm = configImpl.currentTerm();
        const oldHallCount = configImpl.halls().length;

        // Trigger reload - this re-reads and validates policy.json
        await configImpl.reload();

        // Display new configuration summary
        const newTerm = configImpl.currentTerm();
        const newHalls = configImpl.halls();

        printSuccess('Configuration reloaded successfully');
        console.log();

        printTable(
          ['Setting', 'Before', 'After'],
          [
            ['Term', oldTerm, newTerm],
            ['Hall Count', oldHallCount.toString(), newHalls.length.toString()],
          ],
        );

        console.log('\nConfigured Halls:');
        printTable(
          ['Name', 'Aliases'],
          newHalls.map((h) => [h.name, h.aliases.join(', ') || '-']),
        );

        await disconnect();
      } catch (error) {
        printError(`Failed to reload config: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
