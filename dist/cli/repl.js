"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startREPL = startREPL;
const readline = __importStar(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
const container_1 = require("./container");
const output_1 = require("./utils/output");
// Handler functions for each command
const handlers = {
    'case:inspect': async (args, { cases, prisma, disconnect }) => {
        if (args.length < 1) {
            (0, output_1.printError)('Usage: case inspect <caseId>');
            return;
        }
        const caseId = args[0];
        const kase = await cases.findById(caseId);
        if (!kase) {
            (0, output_1.printError)(`Case ${caseId} not found`);
            return;
        }
        console.log('\n=== Case Details ===\n');
        (0, output_1.printTable)(['Field', 'Value'], [
            ['ID', kase.id],
            ['User ID', kase.userId],
            ['Term', kase.term],
            ['State', kase.state],
            ['Hall', kase.hall || '-'],
            ['Room', kase.room || '-'],
            ['RA User ID', kase.raUserId || '-'],
            ['Version', kase.version.toString()],
            ['Expires At', kase.expiresAt?.toLocaleString() || '-'],
            ['Reminder Sent', kase.reminderSentAt?.toLocaleString() || '-'],
            ['Updated At', kase.updatedAt?.toLocaleString() || '-'],
        ]);
        const auditLogs = await prisma.auditLog.findMany({
            where: { caseId },
            orderBy: { timestamp: 'asc' },
        });
        if (auditLogs.length > 0) {
            console.log('\n=== Audit Trail ===\n');
            (0, output_1.printTable)(['Timestamp', 'Action', 'From', 'To', 'Actor'], auditLogs.map((log) => [
                log.timestamp.toLocaleString(),
                log.action,
                log.fromState || '-',
                log.toState || '-',
                log.actorId ? `${log.actorType}:${log.actorId}` : log.actorType || '-',
            ]));
        }
        const decision = await prisma.decision.findUnique({
            where: { caseId },
        });
        if (decision) {
            console.log('\n=== Decision ===\n');
            (0, output_1.printTable)(['Field', 'Value'], [
                ['Decision', decision.decision],
                ['RA User ID', decision.raUserId],
                ['Reason', decision.reason || '-'],
                ['Decided At', decision.decidedAt?.toLocaleString() || '-'],
            ]);
        }
    },
    'case:list-pending': async (args, { cases }) => {
        const pending = await cases.listAwaitingRA();
        if (pending.length === 0) {
            (0, output_1.printInfo)('No pending cases');
            return;
        }
        console.log(`\nFound ${pending.length} pending case(s):\n`);
        (0, output_1.printTable)(['ID', 'User ID', 'Hall', 'Room', 'Expires At', 'Updated At'], pending.map((c) => [
            c.id,
            c.userId,
            c.hall || '-',
            c.room || '-',
            c.expiresAt?.toLocaleString() || '-',
            c.updatedAt?.toLocaleString() || '-',
        ]));
    },
    'case:force-expire': async (args, { cases, audit }) => {
        if (args.length < 1) {
            (0, output_1.printError)('Usage: case force-expire <caseId> [-r reason]');
            return;
        }
        const caseId = args[0];
        const kase = await cases.findById(caseId);
        if (!kase) {
            (0, output_1.printError)(`Case ${caseId} not found`);
            return;
        }
        if (kase.state === 'approved' || kase.state === 'denied' || kase.state === 'expired') {
            (0, output_1.printError)(`Case is already in terminal state: ${kase.state}`);
            return;
        }
        await cases.updateState(caseId, kase.version, 'expired');
        await audit.record(caseId, 'cli_force_expire', kase.state, 'expired', 'system', 'cli', { reason: 'Manual expiration via CLI' });
        (0, output_1.printInfo)(`✓ Case ${caseId} expired successfully`);
    },
    'case:force-decide': async (args, { cases, audit, prisma }) => {
        if (args.length < 2) {
            (0, output_1.printError)('Usage: case force-decide <caseId> <approve|deny>');
            return;
        }
        const caseId = args[0];
        const decision = args[1];
        if (decision !== 'approve' && decision !== 'deny') {
            (0, output_1.printError)('Decision must be "approve" or "deny"');
            return;
        }
        const kase = await cases.findById(caseId);
        if (!kase) {
            (0, output_1.printError)(`Case ${caseId} not found`);
            return;
        }
        if (kase.state !== 'awaiting_ra') {
            (0, output_1.printError)(`Case is not awaiting RA review (current state: ${kase.state})`);
            return;
        }
        const newState = decision === 'approve' ? 'approved' : 'denied';
        await cases.updateState(caseId, kase.version, newState, {
            raUserId: 'cli-admin',
        });
        await prisma.decision.create({
            data: {
                caseId,
                raUserId: 'cli-admin',
                decision: decision,
                idempotencyKey: `cli-${caseId}-${Date.now()}`,
            },
        });
        await audit.record(caseId, `cli_force_${decision}`, 'awaiting_ra', newState, 'system', 'cli', { reason: `Admin override via CLI` });
        (0, output_1.printInfo)(`✓ Case ${caseId} ${decision}d successfully`);
    },
    'case:reset-user': async (args, { cases, config }) => {
        if (args.length < 1) {
            (0, output_1.printError)('Usage: case reset-user <userId> [-t term]');
            return;
        }
        const userId = args[0];
        const term = args.includes('-t') ? args[args.indexOf('-t') + 1] : config.currentTerm();
        await cases.resetCase(userId, term);
        (0, output_1.printInfo)(`✓ Reset verification for user ${userId} in term ${term}`);
    },
    status: async (args, { cases, prisma, config }) => {
        try {
            await prisma.$queryRaw `SELECT 1`;
            (0, output_1.printInfo)('Database connection: OK');
        }
        catch {
            (0, output_1.printError)('Database connection: FAILED');
        }
        const pending = await cases.listAwaitingRA();
        const term = config.currentTerm();
        const stats = await prisma.verificationCase.groupBy({
            by: ['state'],
            _count: { state: true },
        });
        console.log(`\n=== Current Term: ${term} ===\n`);
        console.log('Case Statistics:');
        (0, output_1.printTable)(['State', 'Count'], stats.map((s) => [s.state, s._count.state.toString()]));
        const outboxStats = await prisma.outbox.groupBy({
            by: ['status'],
            _count: { status: true },
        });
        console.log('\nOutbox Statistics:');
        (0, output_1.printTable)(['Status', 'Count'], outboxStats.map((s) => [s.status, s._count.status.toString()]));
        if (pending.length > 0) {
            (0, output_1.printInfo)(`\n${pending.length} case(s) awaiting RA review`);
        }
        else {
            (0, output_1.printInfo)('\nNo cases awaiting RA review');
        }
    },
    'config:show': async (args, { config }) => {
        console.log('\n=== Current Configuration ===\n');
        console.log(`Term: ${config.currentTerm()}\n`);
        const timeouts = config.timeouts();
        console.log('Timeouts:');
        (0, output_1.printTable)(['Setting', 'Value'], [
            ['Awaiting RA TTL', `${timeouts.awaitingRA_ttl_hours} hours`],
            ['Reminder Hours', timeouts.reminder_hours.join(', ')],
        ]);
        const limits = config.limits();
        console.log('\nLimits:');
        (0, output_1.printTable)(['Setting', 'Value'], [
            ['Max Notification Retries', limits.maxNotificationRetries.toString()],
            ['Notification Backoff (sec)', limits.notificationBackoffSeconds.join(', ')],
            ['Role Assign Max Retries', limits.roleAssignMaxRetries.toString()],
            ['Role Assign Backoff (sec)', limits.roleAssignRetryBackoffSeconds.join(', ')],
        ]);
        const halls = config.halls();
        console.log('\nConfigured Halls:');
        (0, output_1.printTable)(['Name', 'Aliases', 'Queue Channel', 'Hall Role'], halls.map((h) => [
            h.name,
            h.aliases.join(', ') || '-',
            h.queueChannelId.slice(0, 10) + '...',
            h.hallRoleId.slice(0, 10) + '...',
        ]));
    },
    'config:halls': async (args, { config }) => {
        const halls = config.halls();
        console.log('\n=== Hall Configuration ===\n');
        for (const hall of halls) {
            console.log(`\n${hall.name}`);
            console.log('-'.repeat(hall.name.length));
            (0, output_1.printTable)(['Field', 'Value'], [
                ['Aliases', hall.aliases.join(', ') || 'None'],
                ['RA Role ID', hall.raRoleId],
                ['Queue Channel ID', hall.queueChannelId],
                ['Hall Role ID', hall.hallRoleId],
                ['Room Pattern', hall.room?.pattern || 'Any'],
                ['Room Example', hall.room?.example || '-'],
            ]);
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
function printHelp() {
    console.log(`
${chalk_1.default.cyan('PurplePal CLI Interactive Mode')}

${chalk_1.default.yellow('Case Commands:')}
  case inspect <caseId>           - View case details and audit trail
  case list-pending               - List cases awaiting RA review
  case force-expire <caseId>      - Manually expire a case
  case force-decide <caseId> <approve|deny> - Override RA decision
  case reset-user <userId>        - Clear user's verification

${chalk_1.default.yellow('System Commands:')}
  status                          - Show system health and statistics
  audit <caseId>                  - View complete audit trail

${chalk_1.default.yellow('Configuration Commands:')}
  config show                     - Display current configuration
  config halls                    - List all configured halls
  config templates                - Show message templates

${chalk_1.default.yellow('Other Commands:')}
  help                            - Show this help message
  exit                            - Exit the CLI
  `);
}
async function startREPL() {
    const container = await (0, container_1.getCliContainer)();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk_1.default.green('purplepal> '),
    });
    console.log(chalk_1.default.cyan('\nPurplePal CLI - Interactive Mode'));
    console.log(chalk_1.default.dim('Type "help" for available commands or "exit" to quit\n'));
    rl.prompt();
    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }
        if (trimmed === 'exit' || trimmed === 'quit') {
            console.log(chalk_1.default.dim('Goodbye!'));
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
            }
            else {
                (0, output_1.printError)(`Unknown command: ${trimmed}`);
                console.log(chalk_1.default.dim('Type "help" for available commands'));
            }
        }
        catch (error) {
            (0, output_1.printError)(`Error: ${error.message}`);
        }
        rl.prompt();
    });
    rl.on('close', async () => {
        await container.disconnect();
        process.exit(0);
    });
}
