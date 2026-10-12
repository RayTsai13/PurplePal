import * as readline from 'readline';
import chalk from 'chalk';
import { getCliContainer, type CliContainer } from './container';
import { forceDecide, forceExpire, resetUser, type ActionResult } from './actions/case';
import { printTable, printError, printInfo } from './utils/output';

type Container = CliContainer;

// Value following a flag like "-r", if present
const flagValue = (args: string[], flag: string): string | undefined =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;

const printResult = (result: ActionResult): void => {
  if (result.ok) {
    printInfo(`✓ ${result.message}`);
  } else {
    printError(result.message);
  }
};

// Command handler interface
interface CommandHandler {
  (args: string[], container: Container): Promise<void>;
}

// Handler functions for each command
const handlers: Record<string, CommandHandler> = {
  'case:inspect': async (args, { cases, prisma, disconnect }) => {
    if (args.length < 1) {
      printError('Usage: case inspect <caseId>');
      return;
    }
    const caseId = args[0];
    const kase = await cases.findById(caseId);
    if (!kase) {
      printError(`Case ${caseId} not found`);
      return;
    }
    console.log('\n=== Case Details ===\n');
    printTable(
      ['Field', 'Value'],
      [
        ['ID', kase.id],
        ['User ID', kase.userId],
        ['Term', kase.term],
        ['State', kase.state],
        ['Hall', kase.hall || '-'],
        ['Room', kase.room || '-'],
        ['RA User ID', kase.raUserId || '-'],
        ['Version', kase.version.toString()],
        ['Expires At', kase.expiresAt?.toLocaleString() || '-'],
        ['Submitted At', kase.submittedAt?.toLocaleString() || '-'],
        ['Reminders Sent', kase.remindersSent.toString()],
        ['Updated At', kase.updatedAt?.toLocaleString() || '-'],
      ],
    );

    const auditLogs = await prisma.auditLog.findMany({
      where: { caseId },
      orderBy: { timestamp: 'asc' },
    });

    if (auditLogs.length > 0) {
      console.log('\n=== Audit Trail ===\n');
      printTable(
        ['Timestamp', 'Action', 'From', 'To', 'Actor'],
        auditLogs.map((log: any) => [
          log.timestamp.toLocaleString(),
          log.action,
          log.fromState || '-',
          log.toState || '-',
          log.actorId ? `${log.actorType}:${log.actorId}` : log.actorType || '-',
        ]),
      );
    }

    const decision = await prisma.decision.findUnique({
      where: { caseId },
    });

    if (decision) {
      console.log('\n=== Decision ===\n');
      printTable(
        ['Field', 'Value'],
        [
          ['Decision', decision.decision],
          ['RA User ID', decision.raUserId],
          ['Reason', decision.reason || '-'],
          ['Decided At', decision.decidedAt?.toLocaleString() || '-'],
        ],
      );
    }
  },

  'case:list-pending': async (args, { cases }) => {
    const pending = await cases.listAwaitingRA();
    if (pending.length === 0) {
      printInfo('No pending cases');
      return;
    }
    console.log(`\nFound ${pending.length} pending case(s):\n`);
    printTable(
      ['ID', 'User ID', 'Hall', 'Room', 'Expires At', 'Updated At'],
      pending.map((c: any) => [
        c.id,
        c.userId,
        c.hall || '-',
        c.room || '-',
        c.expiresAt?.toLocaleString() || '-',
        c.updatedAt?.toLocaleString() || '-',
      ]),
    );
  },

  'case:force-expire': async (args, container) => {
    if (args.length < 1) {
      printError('Usage: case force-expire <caseId> [-r reason]');
      return;
    }
    printResult(await forceExpire(container, args[0], flagValue(args, '-r')));
  },

  'case:force-decide': async (args, container) => {
    if (args.length < 2) {
      printError('Usage: case force-decide <caseId> <approve|deny> [-r reason]');
      return;
    }
    printResult(await forceDecide(container, args[0], args[1], flagValue(args, '-r')));
  },

  'case:reset-user': async (args, container) => {
    if (args.length < 1) {
      printError('Usage: case reset-user <userId> [-t term] [-r reason]');
      return;
    }
    printResult(await resetUser(container, args[0], flagValue(args, '-t'), flagValue(args, '-r')));
  },

  status: async (args, { cases, prisma, config }) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      printInfo('Database connection: OK');
    } catch {
      printError('Database connection: FAILED');
    }

    const pending = await cases.listAwaitingRA();
    const term = config.currentTerm();

    const stats = await prisma.verificationCase.groupBy({
      by: ['state'],
      _count: { state: true },
    });

    console.log(`\n=== Current Term: ${term} ===\n`);
    console.log('Case Statistics:');
    printTable(
      ['State', 'Count'],
      stats.map((s: any) => [s.state, s._count.state.toString()]),
    );

    const outboxStats = await prisma.outbox.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    console.log('\nOutbox Statistics:');
    printTable(
      ['Status', 'Count'],
      outboxStats.map((s: any) => [s.status, s._count.status.toString()]),
    );

    if (pending.length > 0) {
      printInfo(`\n${pending.length} case(s) awaiting RA review`);
    } else {
      printInfo('\nNo cases awaiting RA review');
    }
  },

  'config:show': async (args, { config }) => {
    console.log('\n=== Current Configuration ===\n');
    console.log(`Term: ${config.currentTerm()}\n`);

    const timeouts = config.timeouts();
    console.log('Timeouts:');
    printTable(
      ['Setting', 'Value'],
      [
        ['Awaiting RA TTL', `${timeouts.awaitingRA_ttl_hours} hours`],
        ['Reminder Hours', timeouts.reminder_hours.join(', ')],
      ],
    );

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

    const halls = config.halls();
    console.log('\nConfigured Halls:');
    printTable(
      ['Name', 'Aliases', 'Queue Channel', 'Hall Role'],
      halls.map((h: any) => [
        h.name,
        h.aliases.join(', ') || '-',
        h.queueChannelId.slice(0, 10) + '...',
        h.hallRoleId.slice(0, 10) + '...',
      ]),
    );
  },

  'config:halls': async (args, { config }) => {
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
  },

  'config:templates': async (args, { config }) => {
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
  },
};

function printHelp(): void {
  console.log(`
${chalk.cyan('PurplePal CLI Interactive Mode')}

${chalk.yellow('Case Commands:')}
  case inspect <caseId>           - View case details and audit trail
  case list-pending               - List cases awaiting RA review
  case force-expire <caseId>      - Manually expire an active case
  case force-decide <caseId> <approve|deny> - Override RA decision
  case reset-user <userId>        - Cancel user's cases and revoke hall role

${chalk.yellow('System Commands:')}
  status                          - Show system health and statistics
  audit <caseId>                  - View complete audit trail

${chalk.yellow('Configuration Commands:')}
  config show                     - Display current configuration
  config halls                    - List all configured halls
  config templates                - Show message templates

${chalk.yellow('Other Commands:')}
  help                            - Show this help message
  exit                            - Exit the CLI
  `);
}

export async function startREPL(): Promise<void> {
  const container = await getCliContainer();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('purplepal> '),
  });

  console.log(chalk.cyan('\nPurplePal CLI - Interactive Mode'));
  console.log(chalk.dim('Type "help" for available commands or "exit" to quit\n'));

  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log(chalk.dim('Goodbye!'));
      await container.disconnect();
      rl.close();
      process.exit(0);
    }

    if (trimmed === 'help') {
      printHelp();
      rl.prompt();
      return;
    }

    try {
      const parts = trimmed.split(/\s+/);
      const command = parts[0];
      const subcommand = parts[1];
      const args = parts.slice(2);

      // Convert command format (e.g., "case inspect" -> "case:inspect")
      const handlerKey = subcommand ? `${command}:${subcommand}` : command;

      if (handlers[handlerKey]) {
        await handlers[handlerKey](args, container);
      } else {
        printError(`Unknown command: ${trimmed}`);
        console.log(chalk.dim('Type "help" for available commands'));
      }
    } catch (error) {
      printError(`Error: ${(error as Error).message}`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await container.disconnect();
    process.exit(0);
  });
}
