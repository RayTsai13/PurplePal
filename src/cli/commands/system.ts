import { Command } from 'commander';
import { getCliContainer } from '../container';
import { printTable, printSuccess, printError, printInfo, formatDate } from '../utils/output';

// Register system health and audit commands (status, audit)
export function registerSystemCommands(program: Command): void {
  // status command shows database health, case counts by state, and outbox queue status
  program
    .command('status')
    .description('Show system health and statistics')
    .action(async () => {
      try {
        const { cases, prisma, config, disconnect } = await getCliContainer();

        // Test database connectivity with raw SQL query
        try {
          await prisma.$queryRaw`SELECT 1`;
          printSuccess('Database connection: OK');
        } catch {
          printError('Database connection: FAILED');
        }

        // Get case statistics for current term
        const pending = await cases.listAwaitingRA();
        const term = config.currentTerm();

        // groupBy aggregates verificationCase table and counts rows grouped by state
        // _count.state gives count of cases in each state (joined, hall_chosen, awaiting_ra, etc)
        const stats = await prisma.verificationCase.groupBy({
          by: ['state'],
          _count: { state: true },
        });

        console.log(`\n=== Current Term: ${term} ===\n`);

        console.log('Case Statistics:');
        // .map() transforms each stat group into [state, count] row
        printTable(
          ['State', 'Count'],
          stats.map((s) => [s.state, s._count.state.toString()]),
        );

        // Similar groupBy for outbox table to count messages by status (pending, sent, failed)
        const outboxStats = await prisma.outbox.groupBy({
          by: ['status'],
          _count: { status: true },
        });

        console.log('\nOutbox Statistics:');
        // Transform outbox stats into [status, count] rows for table display
        printTable(
          ['Status', 'Count'],
          outboxStats.map((s) => [s.status, s._count.status.toString()]),
        );

        // Show summary of pending cases
        if (pending.length > 0) {
          printInfo(`\n${pending.length} case(s) awaiting RA review`);
        } else {
          printInfo('\nNo cases awaiting RA review');
        }

        await disconnect();
      } catch (error) {
        printError(`Failed to get status: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // audit command shows complete audit trail for a specific case (all state transitions)
  program
    .command('audit <caseId>')
    .description('View full audit log for a case')
    .action(async (caseId: string) => {
      try {
        const { prisma, disconnect } = await getCliContainer();

        // Find all audit logs for this case ordered by timestamp
        const auditLogs = await prisma.auditLog.findMany({
          where: { caseId },
          orderBy: { timestamp: 'asc' },
        });

        if (auditLogs.length === 0) {
          printInfo(`No audit logs found for case ${caseId}`);
          await disconnect();
          return;
        }

        console.log(`\nAudit trail for case ${caseId}:\n`);
        // Transform each log entry into table row with timestamp, action, state transitions, and actor info
        printTable(
          ['Timestamp', 'Action', 'From State', 'To State', 'Actor Type', 'Actor ID'],
          auditLogs.map((log) => [
            formatDate(log.timestamp),
            log.action,
            log.fromState || '-',
            log.toState || '-',
            log.actorType || '-',
            log.actorId || '-',
          ]),
        );

        await disconnect();
      } catch (error) {
        printError(`Failed to get audit log: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
