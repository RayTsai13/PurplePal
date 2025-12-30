import { Command } from 'commander';
import { getCliContainer } from '../container';
import { printTable, printSuccess, printError, printInfo, formatDate } from '../utils/output';

export function registerSystemCommands(program: Command): void {
  program
    .command('status')
    .description('Show system health and statistics')
    .action(async () => {
      try {
        const { cases, prisma, config, disconnect } = await getCliContainer();

        // Database connection check
        try {
          await prisma.$queryRaw`SELECT 1`;
          printSuccess('Database connection: OK');
        } catch {
          printError('Database connection: FAILED');
        }

        // Get case statistics
        const pending = await cases.listAwaitingRA();
        const term = config.currentTerm();

        // Count cases by state
        const stats = await prisma.verificationCase.groupBy({
          by: ['state'],
          _count: { state: true },
        });

        console.log(`\n=== Current Term: ${term} ===\n`);

        console.log('Case Statistics:');
        printTable(
          ['State', 'Count'],
          stats.map((s) => [s.state, s._count.state.toString()]),
        );

        // Outbox statistics
        const outboxStats = await prisma.outbox.groupBy({
          by: ['status'],
          _count: { status: true },
        });

        console.log('\nOutbox Statistics:');
        printTable(
          ['Status', 'Count'],
          outboxStats.map((s) => [s.status, s._count.status.toString()]),
        );

        // Pending cases summary
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

  program
    .command('audit <caseId>')
    .description('View full audit log for a case')
    .action(async (caseId: string) => {
      try {
        const { prisma, disconnect } = await getCliContainer();

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
