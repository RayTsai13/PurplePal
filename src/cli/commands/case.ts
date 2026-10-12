import { Command } from 'commander';
import { getCliContainer, type CliContainer } from '../container';
import { forceDecide, forceExpire, resetUser, type ActionResult } from '../actions/case';
import { printTable, printSuccess, printError, printInfo, formatDate, formatState } from '../utils/output';

// Register case management commands (inspect, list-pending, force-expire, force-decide, reset-user)
export function registerCaseCommands(program: Command): void {
  // Create parent 'case' command group that all subcommands will attach to
  const caseCmd = program
    .command('case')
    .description('Case management commands');

  // inspect <caseId> shows case details, audit trail, and decision info
  caseCmd
    .command('inspect <caseId>')
    .description('View detailed information about a case')
    .action(async (caseId: string) => {
      try {
        // Get services and database connection from lightweight CLI container
        const { cases, prisma, disconnect } = await getCliContainer();
        // Look up case by ID
        const kase = await cases.findById(caseId);

        if (!kase) {
          printError(`Case ${caseId} not found`);
          await disconnect();
          // Exit with error code so scripts can detect failure
          process.exit(1);
        }

        console.log('\n=== Case Details ===\n');
        // Transform case fields into [label, value] pairs for table display
        // || operator provides fallback "-" for optional fields that are null/undefined
        printTable(
          ['Field', 'Value'],
          [
            ['ID', kase.id],
            ['User ID', kase.userId],
            ['Term', kase.term],
            ['State', formatState(kase.state)],
            ['Hall', kase.hall || '-'],
            ['Room', kase.room || '-'],
            ['RA User ID', kase.raUserId || '-'],
            ['Version', kase.version.toString()],
            ['Expires At', formatDate(kase.expiresAt)],
            ['Submitted At', formatDate(kase.submittedAt)],
            ['Reminders Sent', kase.remindersSent.toString()],
            ['Updated At', formatDate(kase.updatedAt)],
          ],
        );

        // Fetch all audit logs for this case, ordered chronologically
        const auditLogs = await prisma.auditLog.findMany({
          where: { caseId },
          orderBy: { timestamp: 'asc' },
        });

        if (auditLogs.length > 0) {
          console.log('\n=== Audit Trail ===\n');
          // .map() transforms each audit log into a [timestamp, action, from, to, actor] row
          // Template literal backticks allow embedding expressions like ${log.actorType}:${log.actorId}
          printTable(
            ['Timestamp', 'Action', 'From', 'To', 'Actor'],
            auditLogs.map((log) => [
              formatDate(log.timestamp),
              log.action,
              log.fromState || '-',
              log.toState || '-',
              // Conditional check: if actorId exists show "actorType:actorId", else just actorType or "-"
              log.actorId ? `${log.actorType}:${log.actorId}` : log.actorType || '-',
            ]),
          );
        }

        // Attempt to find decision record for this case (unique lookup by caseId)
        const decision = await prisma.decision.findUnique({
          where: { caseId },
        });

        // Only show decision table if decision exists
        if (decision) {
          console.log('\n=== Decision ===\n');
          printTable(
            ['Field', 'Value'],
            [
              ['Decision', decision.decision],
              ['RA User ID', decision.raUserId],
              ['Reason', decision.reason || '-'],
              ['Decided At', formatDate(decision.decidedAt)],
            ],
          );
        }

        // Close database connection and cleanup
        await disconnect();
      } catch (error) {
        // Type cast error to Error to access .message property
        printError(`Failed to inspect case: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // list-pending retrieves all cases currently in awaiting_ra state
  caseCmd
    .command('list-pending')
    .description('List all cases awaiting RA review')
    .action(async () => {
      try {
        const { cases, disconnect } = await getCliContainer();
        // Get all cases awaiting RA response
        const pending = await cases.listAwaitingRA();

        if (pending.length === 0) {
          printInfo('No pending cases');
          await disconnect();
          return;
        }

        // Print count and table of pending cases
        console.log(`\nFound ${pending.length} pending case(s):\n`);
        // .map() transforms each case into a table row
        printTable(
          ['ID', 'User ID', 'Hall', 'Room', 'Expires At', 'Updated At'],
          pending.map((c) => [
            c.id,
            c.userId,
            c.hall || '-',
            c.room || '-',
            formatDate(c.expiresAt),
            formatDate(c.updatedAt),
          ]),
        );

        await disconnect();
      } catch (error) {
        printError(`Failed to list pending cases: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // force-expire transitions an active case to expired (admin intervention) and DMs the user
  caseCmd
    .command('force-expire <caseId>')
    .description('Manually expire an active case')
    .option('-r, --reason <reason>', 'Reason for expiration')
    .action(async (caseId: string, options: { reason?: string }) => {
      await runAction(async (c) => forceExpire(c, caseId, options.reason), 'Failed to expire case');
    });

  // force-decide lets an admin approve or deny a pending case; approval grants the hall role
  caseCmd
    .command('force-decide <caseId> <decision>')
    .description('Admin override to approve or deny a case')
    .option('-r, --reason <reason>', 'Reason for decision')
    .action(async (caseId: string, decision: string, options: { reason?: string }) => {
      await runAction(async (c) => forceDecide(c, caseId, decision, options.reason), 'Failed to decide case');
    });

  // reset-user cancels a user's active/approved cases (audit trail kept) and revokes the hall role
  caseCmd
    .command('reset-user <userId>')
    .description('Reset verification for a user (cancels cases and revokes the hall role)')
    .option('-t, --term <term>', 'Specific term (defaults to current)')
    .option('-r, --reason <reason>', 'Reason for reset')
    .action(async (userId: string, options: { term?: string; reason?: string }) => {
      await runAction(async (c) => resetUser(c, userId, options.term, options.reason), 'Failed to reset user');
    });
}

// Run a shared action, print its outcome, and exit non-zero on failure
async function runAction(
  action: (c: CliContainer) => Promise<ActionResult>,
  failurePrefix: string,
): Promise<void> {
  try {
    const c = await getCliContainer();
    const result = await action(c);
    await c.disconnect();
    if (!result.ok) {
      printError(result.message);
      process.exit(1);
    }
    printSuccess(result.message);
  } catch (error) {
    printError(`${failurePrefix}: ${(error as Error).message}`);
    process.exit(1);
  }
}
