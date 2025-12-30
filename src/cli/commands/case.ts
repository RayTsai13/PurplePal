import { Command } from 'commander';
import { getCliContainer } from '../container';
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
            ['Reminder Sent', formatDate(kase.reminderSentAt)],
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

  // force-expire transitions a case to expired state manually (for admin intervention)
  caseCmd
    .command('force-expire <caseId>')
    .description('Manually expire a case')
    // .option() adds optional flags like -r or --reason for extra parameters
    .option('-r, --reason <reason>', 'Reason for expiration')
    .action(async (caseId: string, options: { reason?: string }) => {
      try {
        const { cases, audit, disconnect } = await getCliContainer();
        // Look up case to get current state and version for update
        const kase = await cases.findById(caseId);

        if (!kase) {
          printError(`Case ${caseId} not found`);
          await disconnect();
          process.exit(1);
        }

        // Check that case is not already in terminal state (no double expiration)
        if (kase.state === 'approved' || kase.state === 'denied' || kase.state === 'expired') {
          printError(`Case is already in terminal state: ${kase.state}`);
          await disconnect();
          process.exit(1);
        }

        // Transition case from current state to expired with optimistic locking via version
        await cases.updateState(caseId, kase.version, 'expired');
        // Record action in audit log with reason if provided
        await audit.record(
          caseId,
          'cli_force_expire',
          kase.state,
          'expired',
          'system',
          'cli',
          { reason: options.reason || 'Manual expiration via CLI' },
        );

        printSuccess(`Case ${caseId} expired successfully`);
        await disconnect();
      } catch (error) {
        printError(`Failed to expire case: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // force-decide allows admin to override and approve or deny a case (bypasses RA review)
  caseCmd
    .command('force-decide <caseId> <decision>')
    .description('Admin override to approve or deny a case')
    .option('-r, --reason <reason>', 'Reason for decision')
    .action(async (caseId: string, decision: string, options: { reason?: string }) => {
      try {
        // Validate decision parameter is one of the allowed values
        if (decision !== 'approve' && decision !== 'deny') {
          printError('Decision must be "approve" or "deny"');
          process.exit(1);
        }

        const { cases, audit, prisma, disconnect } = await getCliContainer();
        // Look up case to get current state and version
        const kase = await cases.findById(caseId);

        if (!kase) {
          printError(`Case ${caseId} not found`);
          await disconnect();
          process.exit(1);
        }

        // Only allow force-decide on cases waiting for RA (protect terminal states)
        if (kase.state !== 'awaiting_ra') {
          printError(`Case is not awaiting RA review (current state: ${kase.state})`);
          await disconnect();
          process.exit(1);
        }

        // Convert decision string to correct state name (approve -> approved, deny -> denied)
        const newState = decision === 'approve' ? 'approved' : 'denied';
        // Update case state with RA user ID set to cli-admin for audit trail
        await cases.updateState(caseId, kase.version, newState as 'approved' | 'denied', {
          raUserId: 'cli-admin',
        });

        // Create decision record with idempotency key to prevent duplicates
        // Date.now() makes each key unique if command runs multiple times
        await prisma.decision.create({
          data: {
            caseId,
            raUserId: 'cli-admin',
            decision: decision as 'approve' | 'deny',
            reason: options.reason,
            idempotencyKey: `cli-${caseId}-${Date.now()}`,
          },
        });

        // Log action in audit trail with reason if provided
        await audit.record(
          caseId,
          `cli_force_${decision}`,
          'awaiting_ra',
          newState,
          'system',
          'cli',
          { reason: options.reason || `Admin override via CLI` },
        );

        // Success message uses template literal to show which action succeeded
        printSuccess(`Case ${caseId} ${decision}d successfully`);
        await disconnect();
      } catch (error) {
        printError(`Failed to decide case: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // reset-user clears a user's verification state for a given term
  caseCmd
    .command('reset-user <userId>')
    .description('Reset verification for a user')
    // .option() adds -t or --term flag for optional term parameter
    .option('-t, --term <term>', 'Specific term (defaults to current)')
    .action(async (userId: string, options: { term?: string }) => {
      try {
        const { cases, config, disconnect } = await getCliContainer();
        // Use provided term or fall back to current term from config
        const term = options.term || config.currentTerm();

        // Delete all case records for this user in this term
        await cases.resetCase(userId, term);
        printSuccess(`Reset verification for user ${userId} in term ${term}`);
        await disconnect();
      } catch (error) {
        printError(`Failed to reset user: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
