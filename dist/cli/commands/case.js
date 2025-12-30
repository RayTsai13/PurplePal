"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCaseCommands = registerCaseCommands;
const container_1 = require("../container");
const output_1 = require("../utils/output");
function registerCaseCommands(program) {
    const caseCmd = program
        .command('case')
        .description('Case management commands');
    caseCmd
        .command('inspect <caseId>')
        .description('View detailed information about a case')
        .action(async (caseId) => {
        try {
            const { cases, prisma, disconnect } = await (0, container_1.getCliContainer)();
            const kase = await cases.findById(caseId);
            if (!kase) {
                (0, output_1.printError)(`Case ${caseId} not found`);
                await disconnect();
                process.exit(1);
            }
            console.log('\n=== Case Details ===\n');
            (0, output_1.printTable)(['Field', 'Value'], [
                ['ID', kase.id],
                ['User ID', kase.userId],
                ['Term', kase.term],
                ['State', (0, output_1.formatState)(kase.state)],
                ['Hall', kase.hall || '-'],
                ['Room', kase.room || '-'],
                ['RA User ID', kase.raUserId || '-'],
                ['Version', kase.version.toString()],
                ['Expires At', (0, output_1.formatDate)(kase.expiresAt)],
                ['Reminder Sent', (0, output_1.formatDate)(kase.reminderSentAt)],
                ['Updated At', (0, output_1.formatDate)(kase.updatedAt)],
            ]);
            // Fetch audit logs for this case
            const auditLogs = await prisma.auditLog.findMany({
                where: { caseId },
                orderBy: { timestamp: 'asc' },
            });
            if (auditLogs.length > 0) {
                console.log('\n=== Audit Trail ===\n');
                (0, output_1.printTable)(['Timestamp', 'Action', 'From', 'To', 'Actor'], auditLogs.map((log) => [
                    (0, output_1.formatDate)(log.timestamp),
                    log.action,
                    log.fromState || '-',
                    log.toState || '-',
                    log.actorId ? `${log.actorType}:${log.actorId}` : log.actorType || '-',
                ]));
            }
            // Fetch decision if exists
            const decision = await prisma.decision.findUnique({
                where: { caseId },
            });
            if (decision) {
                console.log('\n=== Decision ===\n');
                (0, output_1.printTable)(['Field', 'Value'], [
                    ['Decision', decision.decision],
                    ['RA User ID', decision.raUserId],
                    ['Reason', decision.reason || '-'],
                    ['Decided At', (0, output_1.formatDate)(decision.decidedAt)],
                ]);
            }
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to inspect case: ${error.message}`);
            process.exit(1);
        }
    });
    caseCmd
        .command('list-pending')
        .description('List all cases awaiting RA review')
        .action(async () => {
        try {
            const { cases, disconnect } = await (0, container_1.getCliContainer)();
            const pending = await cases.listAwaitingRA();
            if (pending.length === 0) {
                (0, output_1.printInfo)('No pending cases');
                await disconnect();
                return;
            }
            console.log(`\nFound ${pending.length} pending case(s):\n`);
            (0, output_1.printTable)(['ID', 'User ID', 'Hall', 'Room', 'Expires At', 'Updated At'], pending.map((c) => [
                c.id,
                c.userId,
                c.hall || '-',
                c.room || '-',
                (0, output_1.formatDate)(c.expiresAt),
                (0, output_1.formatDate)(c.updatedAt),
            ]));
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to list pending cases: ${error.message}`);
            process.exit(1);
        }
    });
    caseCmd
        .command('force-expire <caseId>')
        .description('Manually expire a case')
        .option('-r, --reason <reason>', 'Reason for expiration')
        .action(async (caseId, options) => {
        try {
            const { cases, audit, disconnect } = await (0, container_1.getCliContainer)();
            const kase = await cases.findById(caseId);
            if (!kase) {
                (0, output_1.printError)(`Case ${caseId} not found`);
                await disconnect();
                process.exit(1);
            }
            if (kase.state === 'approved' || kase.state === 'denied' || kase.state === 'expired') {
                (0, output_1.printError)(`Case is already in terminal state: ${kase.state}`);
                await disconnect();
                process.exit(1);
            }
            await cases.updateState(caseId, kase.version, 'expired');
            await audit.record(caseId, 'cli_force_expire', kase.state, 'expired', 'system', 'cli', { reason: options.reason || 'Manual expiration via CLI' });
            (0, output_1.printSuccess)(`Case ${caseId} expired successfully`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to expire case: ${error.message}`);
            process.exit(1);
        }
    });
    caseCmd
        .command('force-decide <caseId> <decision>')
        .description('Admin override to approve or deny a case')
        .option('-r, --reason <reason>', 'Reason for decision')
        .action(async (caseId, decision, options) => {
        try {
            if (decision !== 'approve' && decision !== 'deny') {
                (0, output_1.printError)('Decision must be "approve" or "deny"');
                process.exit(1);
            }
            const { cases, audit, prisma, disconnect } = await (0, container_1.getCliContainer)();
            const kase = await cases.findById(caseId);
            if (!kase) {
                (0, output_1.printError)(`Case ${caseId} not found`);
                await disconnect();
                process.exit(1);
            }
            if (kase.state !== 'awaiting_ra') {
                (0, output_1.printError)(`Case is not awaiting RA review (current state: ${kase.state})`);
                await disconnect();
                process.exit(1);
            }
            const newState = decision === 'approve' ? 'approved' : 'denied';
            await cases.updateState(caseId, kase.version, newState, {
                raUserId: 'cli-admin',
            });
            // Record decision
            await prisma.decision.create({
                data: {
                    caseId,
                    raUserId: 'cli-admin',
                    decision: decision,
                    reason: options.reason,
                    idempotencyKey: `cli-${caseId}-${Date.now()}`,
                },
            });
            await audit.record(caseId, `cli_force_${decision}`, 'awaiting_ra', newState, 'system', 'cli', { reason: options.reason || `Admin override via CLI` });
            (0, output_1.printSuccess)(`Case ${caseId} ${decision}d successfully`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to decide case: ${error.message}`);
            process.exit(1);
        }
    });
    caseCmd
        .command('reset-user <userId>')
        .description('Reset verification for a user')
        .option('-t, --term <term>', 'Specific term (defaults to current)')
        .action(async (userId, options) => {
        try {
            const { cases, config, disconnect } = await (0, container_1.getCliContainer)();
            const term = options.term || config.currentTerm();
            await cases.resetCase(userId, term);
            (0, output_1.printSuccess)(`Reset verification for user ${userId} in term ${term}`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to reset user: ${error.message}`);
            process.exit(1);
        }
    });
}
