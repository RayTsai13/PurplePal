"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSystemCommands = registerSystemCommands;
const container_1 = require("../container");
const output_1 = require("../utils/output");
function registerSystemCommands(program) {
    program
        .command('status')
        .description('Show system health and statistics')
        .action(async () => {
        try {
            const { cases, prisma, config, disconnect } = await (0, container_1.getCliContainer)();
            // Database connection check
            try {
                await prisma.$queryRaw `SELECT 1`;
                (0, output_1.printSuccess)('Database connection: OK');
            }
            catch {
                (0, output_1.printError)('Database connection: FAILED');
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
            (0, output_1.printTable)(['State', 'Count'], stats.map((s) => [s.state, s._count.state.toString()]));
            // Outbox statistics
            const outboxStats = await prisma.outbox.groupBy({
                by: ['status'],
                _count: { status: true },
            });
            console.log('\nOutbox Statistics:');
            (0, output_1.printTable)(['Status', 'Count'], outboxStats.map((s) => [s.status, s._count.status.toString()]));
            // Pending cases summary
            if (pending.length > 0) {
                (0, output_1.printInfo)(`\n${pending.length} case(s) awaiting RA review`);
            }
            else {
                (0, output_1.printInfo)('\nNo cases awaiting RA review');
            }
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to get status: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('audit <caseId>')
        .description('View full audit log for a case')
        .action(async (caseId) => {
        try {
            const { prisma, disconnect } = await (0, container_1.getCliContainer)();
            const auditLogs = await prisma.auditLog.findMany({
                where: { caseId },
                orderBy: { timestamp: 'asc' },
            });
            if (auditLogs.length === 0) {
                (0, output_1.printInfo)(`No audit logs found for case ${caseId}`);
                await disconnect();
                return;
            }
            console.log(`\nAudit trail for case ${caseId}:\n`);
            (0, output_1.printTable)(['Timestamp', 'Action', 'From State', 'To State', 'Actor Type', 'Actor ID'], auditLogs.map((log) => [
                (0, output_1.formatDate)(log.timestamp),
                log.action,
                log.fromState || '-',
                log.toState || '-',
                log.actorType || '-',
                log.actorId || '-',
            ]));
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to get audit log: ${error.message}`);
            process.exit(1);
        }
    });
}
