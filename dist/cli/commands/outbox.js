"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOutboxCommands = registerOutboxCommands;
const container_1 = require("../container");
const output_1 = require("../utils/output");
function registerOutboxCommands(program) {
    const outboxCmd = program
        .command('outbox')
        .description('Notification queue management');
    outboxCmd
        .command('list')
        .description('List outbox messages')
        .option('-s, --status <status>', 'Filter by status (pending, sent, failed)')
        .option('-l, --limit <limit>', 'Limit results', '20')
        .action(async (options) => {
        try {
            const { prisma, disconnect } = await (0, container_1.getCliContainer)();
            const where = {};
            if (options.status) {
                where.status = options.status;
            }
            const messages = await prisma.outbox.findMany({
                where,
                orderBy: { nextAttemptAt: 'asc' },
                take: parseInt(options.limit, 10),
            });
            if (messages.length === 0) {
                (0, output_1.printInfo)('No messages found');
                await disconnect();
                return;
            }
            console.log(`\nFound ${messages.length} message(s):\n`);
            (0, output_1.printTable)(['ID', 'Kind', 'Status', 'Attempts', 'Next Attempt', 'Last Error'], messages.map((m) => [
                m.id.slice(0, 8) + '...',
                m.kind,
                (0, output_1.formatStatus)(m.status),
                m.attempts.toString(),
                (0, output_1.formatDate)(m.nextAttemptAt),
                m.lastError ? m.lastError.slice(0, 30) + '...' : '-',
            ]));
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to list outbox: ${error.message}`);
            process.exit(1);
        }
    });
    outboxCmd
        .command('inspect <jobId>')
        .description('View details of a specific outbox message')
        .action(async (jobId) => {
        try {
            const { prisma, disconnect } = await (0, container_1.getCliContainer)();
            const message = await prisma.outbox.findUnique({
                where: { id: jobId },
            });
            if (!message) {
                (0, output_1.printError)(`Message ${jobId} not found`);
                await disconnect();
                process.exit(1);
            }
            console.log('\n=== Outbox Message ===\n');
            (0, output_1.printTable)(['Field', 'Value'], [
                ['ID', message.id],
                ['Case ID', message.caseId || '-'],
                ['Kind', message.kind],
                ['Template', message.template],
                ['Status', (0, output_1.formatStatus)(message.status)],
                ['Attempts', message.attempts.toString()],
                ['Next Attempt', (0, output_1.formatDate)(message.nextAttemptAt)],
                ['Last Error', message.lastError || '-'],
                ['Idempotency Key', message.idempotencyKey || '-'],
            ]);
            if (message.payload) {
                console.log('\nPayload:');
                console.log(JSON.stringify(message.payload, null, 2));
            }
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to inspect message: ${error.message}`);
            process.exit(1);
        }
    });
    outboxCmd
        .command('retry <jobId>')
        .description('Retry a failed outbox message')
        .action(async (jobId) => {
        try {
            const { prisma, disconnect } = await (0, container_1.getCliContainer)();
            const message = await prisma.outbox.findUnique({
                where: { id: jobId },
            });
            if (!message) {
                (0, output_1.printError)(`Message ${jobId} not found`);
                await disconnect();
                process.exit(1);
            }
            if (message.status === 'sent') {
                (0, output_1.printError)('Message was already sent successfully');
                await disconnect();
                process.exit(1);
            }
            // Reset to pending for immediate retry
            await prisma.outbox.update({
                where: { id: jobId },
                data: {
                    status: 'pending',
                    nextAttemptAt: new Date(),
                    lastError: null,
                },
            });
            (0, output_1.printSuccess)(`Message ${jobId} queued for retry`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to retry message: ${error.message}`);
            process.exit(1);
        }
    });
    outboxCmd
        .command('purge-failed')
        .description('Delete all permanently failed messages')
        .option('-y, --yes', 'Skip confirmation')
        .action(async (options) => {
        try {
            const { prisma, disconnect } = await (0, container_1.getCliContainer)();
            const count = await prisma.outbox.count({
                where: { status: 'failed' },
            });
            if (count === 0) {
                (0, output_1.printInfo)('No failed messages to purge');
                await disconnect();
                return;
            }
            if (!options.yes) {
                (0, output_1.printInfo)(`Found ${count} failed message(s). Use --yes to confirm deletion.`);
                await disconnect();
                return;
            }
            await prisma.outbox.deleteMany({
                where: { status: 'failed' },
            });
            (0, output_1.printSuccess)(`Purged ${count} failed message(s)`);
            await disconnect();
        }
        catch (error) {
            (0, output_1.printError)(`Failed to purge messages: ${error.message}`);
            process.exit(1);
        }
    });
}
