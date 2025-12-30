import { Command } from 'commander';
import { getCliContainer } from '../container';
import { printTable, printSuccess, printError, printInfo, formatDate, formatStatus } from '../utils/output';

// Register outbox (notification queue) management commands (list, inspect, retry, purge-failed)
export function registerOutboxCommands(program: Command): void {
  // Create parent 'outbox' command group for all notification queue subcommands
  const outboxCmd = program
    .command('outbox')
    .description('Notification queue management');

  // list shows pending and failed messages with filtering and pagination
  outboxCmd
    .command('list')
    .description('List outbox messages')
    // .option() adds -s or --status flag and -l or --limit flag with default value '20'
    .option('-s, --status <status>', 'Filter by status (pending, sent, failed)')
    .option('-l, --limit <limit>', 'Limit results', '20')
    .action(async (options: { status?: string; limit: string }) => {
      try {
        const { prisma, disconnect } = await getCliContainer();

        // Build where clause dynamically
        // Record<string, unknown> is a map of string keys to any value type (for flexible filtering)
        const where: Record<string, unknown> = {};
        if (options.status) {
          where.status = options.status;
        }

        // Find outbox messages matching filter, sorted by next attempt time, limited by count
        const messages = await prisma.outbox.findMany({
          where,
          orderBy: { nextAttemptAt: 'asc' },
          // parseInt converts string limit option to integer for database
          take: parseInt(options.limit, 10),
        });

        if (messages.length === 0) {
          printInfo('No messages found');
          await disconnect();
          return;
        }

        console.log(`\nFound ${messages.length} message(s):\n`);
        // .map() transforms each message into [id_truncated, kind, status, attempts, nextAttempt, lastError_truncated] row
        // .slice(0, 8) truncates ID to first 8 characters for readability
        // Ternary operator truncates error message if exists, shows "-" if null
        printTable(
          ['ID', 'Kind', 'Status', 'Attempts', 'Next Attempt', 'Last Error'],
          messages.map((m) => [
            m.id.slice(0, 8) + '...',
            m.kind,
            formatStatus(m.status),
            m.attempts.toString(),
            formatDate(m.nextAttemptAt),
            m.lastError ? m.lastError.slice(0, 30) + '...' : '-',
          ]),
        );

        await disconnect();
      } catch (error) {
        printError(`Failed to list outbox: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // inspect shows full details of a specific outbox message including payload
  outboxCmd
    .command('inspect <jobId>')
    .description('View details of a specific outbox message')
    .action(async (jobId: string) => {
      try {
        const { prisma, disconnect } = await getCliContainer();

        // Look up single message by ID
        const message = await prisma.outbox.findUnique({
          where: { id: jobId },
        });

        if (!message) {
          printError(`Message ${jobId} not found`);
          await disconnect();
          process.exit(1);
        }

        console.log('\n=== Outbox Message ===\n');
        // Display all message metadata fields
        // || operator shows "-" for optional fields (caseId, lastError, idempotencyKey)
        printTable(
          ['Field', 'Value'],
          [
            ['ID', message.id],
            ['Case ID', message.caseId || '-'],
            ['Kind', message.kind],
            ['Template', message.template],
            ['Status', formatStatus(message.status)],
            ['Attempts', message.attempts.toString()],
            ['Next Attempt', formatDate(message.nextAttemptAt)],
            ['Last Error', message.lastError || '-'],
            ['Idempotency Key', message.idempotencyKey || '-'],
          ],
        );

        // If payload exists, print it as formatted JSON
        if (message.payload) {
          console.log('\nPayload:');
          // JSON.stringify with null and 2 spaces formats JSON with 2-space indentation
          console.log(JSON.stringify(message.payload, null, 2));
        }

        await disconnect();
      } catch (error) {
        printError(`Failed to inspect message: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // retry resets a failed or pending message to retry status with immediate delivery
  outboxCmd
    .command('retry <jobId>')
    .description('Retry a failed outbox message')
    .action(async (jobId: string) => {
      try {
        const { prisma, disconnect } = await getCliContainer();

        // Look up message to check current status
        const message = await prisma.outbox.findUnique({
          where: { id: jobId },
        });

        if (!message) {
          printError(`Message ${jobId} not found`);
          await disconnect();
          process.exit(1);
        }

        // Cannot retry already-sent messages
        if (message.status === 'sent') {
          printError('Message was already sent successfully');
          await disconnect();
          process.exit(1);
        }

        // Reset message status to pending and clear error, schedule immediate retry
        // new Date() sets nextAttemptAt to now so OutboxWorker will process it immediately
        await prisma.outbox.update({
          where: { id: jobId },
          data: {
            status: 'pending',
            nextAttemptAt: new Date(),
            lastError: null,
          },
        });

        printSuccess(`Message ${jobId} queued for retry`);
        await disconnect();
      } catch (error) {
        printError(`Failed to retry message: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // purge-failed deletes all permanently failed messages (requires --yes confirmation)
  outboxCmd
    .command('purge-failed')
    .description('Delete all permanently failed messages')
    // .option() adds -y or --yes flag to skip confirmation prompt
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: { yes?: boolean }) => {
      try {
        const { prisma, disconnect } = await getCliContainer();

        // Count how many messages are in failed status
        const count = await prisma.outbox.count({
          where: { status: 'failed' },
        });

        if (count === 0) {
          printInfo('No failed messages to purge');
          await disconnect();
          return;
        }

        // If --yes flag not provided, show count and ask user to confirm
        if (!options.yes) {
          printInfo(`Found ${count} failed message(s). Use --yes to confirm deletion.`);
          await disconnect();
          return;
        }

        // Delete all failed messages from outbox table
        await prisma.outbox.deleteMany({
          where: { status: 'failed' },
        });

        printSuccess(`Purged ${count} failed message(s)`);
        await disconnect();
      } catch (error) {
        printError(`Failed to purge messages: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
