"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCaseCommands = registerCaseCommands;
const container_1 = require("../container");
const output_1 = require("../utils/output");
// Register case management commands (inspect, list-pending, force-expire, force-decide, reset-user)
function registerCaseCommands(program) {
    // Create parent 'case' command group that all subcommands will attach to
    const caseCmd = program
        .command('case')
        .description('Case management commands');
    // inspect <caseId> shows case details, audit trail, and decision info
    caseCmd
        .command('inspect <caseId>')
        .description('View detailed information about a case')
        .action(async (caseId) => {
        try {
            // Get services and database connection from lightweight CLI container
            const { cases, prisma, disconnect } = await (0, container_1.getCliContainer)();
            // Look up case by ID
            const kase = await cases.findById(caseId);
            if (!kase) {
                (0, output_1.printError)(`Case ${caseId} not found`);
                await disconnect();
                // Exit with error code so scripts can detect failure
                process.exit(1);
            }
            console.log('\n=== Case Details ===\n');
            // Transform case fields into [label, value] pairs for table display
            // || operator provides fallback "-" for optional fields that are null/undefined
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
            // Fetch all audit logs for this case, ordered chronologically
            const auditLogs = await prisma.auditLog.findMany({
                where: { caseId },
                orderBy: { timestamp: 'asc' },
            });
            if (auditLogs.length > 0) {
                console.log('\n=== Audit Trail ===\n');
                // .map() transforms each audit log into a [timestamp, action, from, to, actor] row
                // Template literal backticks allow embedding expressions like ${log.actorType}:${log.actorId}
                (0, output_1.printTable)(['Timestamp', 'Action', 'From', 'To', 'Actor'], auditLogs.map((log) => [
                    (0, output_1.formatDate)(log.timestamp),
                    log.action,
                    log.fromState || '-',
                    log.toState || '-',
                    // Conditional check: if actorId exists show "actorType:actorId", else just actorType or "-"
                    log.actorId ? `${log.actorType}:${log.actorId}` : log.actorType || '-',
                ]));
            }
            // Attempt to find decision record for this case (unique lookup by caseId)
            const decision = await prisma.decision.findUnique({
                where: { caseId },
            });
            // Only show decision table if decision exists
            if (decision) {
                console.log('\n=== Decision ===\n');
                (0, output_1.printTable)(['Field', 'Value'], [
                    ['Decision', decision.decision],
                    ['RA User ID', decision.raUserId],
                    ['Reason', decision.reason || '-'],
                    ['Decided At', (0, output_1.formatDate)(decision.decidedAt)],
                ]);
            }
            // Close database connection and cleanup
            await disconnect();
        }
        catch (error) {
            // Type cast error to Error to access .message property
            (0, output_1.printError)(`Failed to inspect case: ${error.message}`);
            process.exit(1);
        }
    });
    // list-pending retrieves all cases currently in awaiting_ra state
    caseCmd
        .command('list-pending')
        .description('List all cases awaiting RA review')
        .action(async () => {
        try {
            const { cases, disconnect } = await (0, container_1.getCliContainer)();
            // Get all cases awaiting RA response
            const pending = await cases.listAwaitingRA();
            if (pending.length === 0) {
                (0, output_1.printInfo)('No pending cases');
                await disconnect();
                return;
            }
            // Print count and table of pending cases
            console.log(`\nFound ${pending.length} pending case(s):\n`);
            // .map() transforms each case into a table row
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
    // force-expire transitions a case to expired state manually (for admin intervention)
    caseCmd
        .command('force-expire <caseId>')
        .description('Manually expire a case')
        // .option() adds optional flags like -r or --reason for extra parameters
        .option('-r, --reason <reason>', 'Reason for expiration')
        .action(async (caseId, options) => {
        try {
            const { cases, audit, disconnect } = await (0, container_1.getCliContainer)();
            // Look up case to get current state and version for update
            const kase = await cases.findById(caseId);
            if (!kase) {
                (0, output_1.printError)(`Case ${caseId} not found`);
                await disconnect();
                process.exit(1);
            }
            // Check that case is not already in terminal state (no double expiration)
            if (kase.state === 'approved' || kase.state === 'denied' || kase.state === 'expired') {
                (0, output_1.printError)(`Case is already in terminal state: ${kase.state}`);
                await disconnect();
                process.exit(1);
            }
            // Transition case from current state to expired with optimistic locking via version
            await cases.updateState(caseId, kase.version, 'expired');
            // Record action in audit log with reason if provided
            await audit.record(caseId, 'cli_force_expire', kase.state, 'expired', 'system', 'cli', { reason: options.reason || 'Manual expiration via CLI' });
            (0, output_1.printSuccess)(`Case ${caseId} expired successfully`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to expire case: ${error.message}`);
            process.exit(1);
        }
    });
    // force-decide allows admin to override and approve or deny a case (bypasses RA review)
    caseCmd
        .command('force-decide <caseId> <decision>')
        .description('Admin override to approve or deny a case')
        .option('-r, --reason <reason>', 'Reason for decision')
        .action(async (caseId, decision, options) => {
        try {
            // Validate decision parameter is one of the allowed values
            if (decision !== 'approve' && decision !== 'deny') {
                (0, output_1.printError)('Decision must be "approve" or "deny"');
                process.exit(1);
            }
            const { cases, audit, prisma, disconnect } = await (0, container_1.getCliContainer)();
            // Look up case to get current state and version
            const kase = await cases.findById(caseId);
            if (!kase) {
                (0, output_1.printError)(`Case ${caseId} not found`);
                await disconnect();
                process.exit(1);
            }
            // Only allow force-decide on cases waiting for RA (protect terminal states)
            if (kase.state !== 'awaiting_ra') {
                (0, output_1.printError)(`Case is not awaiting RA review (current state: ${kase.state})`);
                await disconnect();
                process.exit(1);
            }
            // Convert decision string to correct state name (approve -> approved, deny -> denied)
            const newState = decision === 'approve' ? 'approved' : 'denied';
            // Update case state with RA user ID set to cli-admin for audit trail
            await cases.updateState(caseId, kase.version, newState, {
                raUserId: 'cli-admin',
            });
            // Create decision record with idempotency key to prevent duplicates
            // Date.now() makes each key unique if command runs multiple times
            await prisma.decision.create({
                data: {
                    caseId,
                    raUserId: 'cli-admin',
                    decision: decision,
                    reason: options.reason,
                    idempotencyKey: `cli-${caseId}-${Date.now()}`,
                },
            });
            // Log action in audit trail with reason if provided
            await audit.record(caseId, `cli_force_${decision}`, 'awaiting_ra', newState, 'system', 'cli', { reason: options.reason || `Admin override via CLI` });
            // Success message uses template literal to show which action succeeded
            (0, output_1.printSuccess)(`Case ${caseId} ${decision}d successfully`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to decide case: ${error.message}`);
            process.exit(1);
        }
    });
    // reset-user clears a user's verification state for a given term
    caseCmd
        .command('reset-user <userId>')
        .description('Reset verification for a user')
        // .option() adds -t or --term flag for optional term parameter
        .option('-t, --term <term>', 'Specific term (defaults to current)')
        .action(async (userId, options) => {
        try {
            const { cases, config, disconnect } = await (0, container_1.getCliContainer)();
            // Use provided term or fall back to current term from config
            const term = options.term || config.currentTerm();
            // Delete all case records for this user in this term
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
