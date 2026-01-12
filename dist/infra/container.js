"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOrchestrator = buildOrchestrator;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../generated/prisma");
const DiscordClient_1 = require("../adapters/discord/DiscordClient");
const VerificationBot_1 = require("../adapters/discord/VerificationBot");
const OutboxWorker_1 = require("../adapters/scheduler/OutboxWorker");
const TimeoutWorker_1 = require("../adapters/scheduler/TimeoutWorker");
const VerificationOrchestrator_1 = require("../core/application/orchestrator/VerificationOrchestrator");
const logger_1 = require("./logger");
const env_1 = require("./env");
const policySchema_1 = require("./config/policySchema");
const hallDirectory_1 = require("./services/hallDirectory");
const DiscordService_1 = require("./services/DiscordService");
const Config_1 = require("./services/Config");
const prismaCaseService_1 = require("./services/prismaCaseService");
const prismaDecisionService_1 = require("./services/prismaDecisionService");
const prismaAuditService_1 = require("./services/prismaAuditService");
const prismaOutboxService_1 = require("./services/prismaOutboxService");
// Dependency injection container. Builds and wires all services together
// Creates Prisma client, Discord client, loads policy config
// Instantiates all repositories, services, orchestrator, and bot
// Returns container with orchestrator and start/stop lifecycle functions
async function buildOrchestrator() {
    const { policyConfig, configPath } = loadPolicyConfig();
    const prisma = new prisma_1.PrismaClient();
    const discordClient = new DiscordClient_1.DiscordClient();
    const hallDirectory = new hallDirectory_1.HallDirectory(policyConfig.halls);
    const services = buildServices(policyConfig, configPath, hallDirectory, prisma, discordClient);
    // Wire up HallDirectory to rebuild when config is hot-reloaded
    // ConfigImpl.onReload registers a callback that will be invoked on reload()
    services.config.onReload((newPolicy) => {
        hallDirectory.rebuild(newPolicy.halls);
        logger_1.logger.info('HallDirectory rebuilt after config reload');
    });
    const orchestrator = new VerificationOrchestrator_1.VerificationOrchestrator(services.discord, services.config, services.cases, services.decisions, services.audit, services.outbox, logger_1.logger);
    const verificationBot = new VerificationBot_1.VerificationBot(discordClient, orchestrator, services.cases, services.config, services.discord, env_1.env.ADMINS_IDS, env_1.env.GUILD_ID);
    verificationBot.bind();
    // Array of worker lifecycle objects that have stop() method
    const workerHandles = [];
    // Start the application: connect database, start workers, login Discord bot
    const start = async () => {
        logger_1.logger.info("Starting application container");
        await prisma.$connect();
        // Start background workers for message and timeout processing
        workerHandles.push((0, OutboxWorker_1.startOutboxWorker)({
            outbox: services.outbox,
            notification: services.discord,
            policy: services.config,
        }));
        workerHandles.push((0, TimeoutWorker_1.startTimeoutWorker)({
            cases: services.cases,
            policy: services.config,
            orchestrator,
            outbox: services.outbox,
        }));
        await discordClient.start(env_1.env.DISCORD_TOKEN);
        logger_1.logger.info({ guilds: discordClient.guildCount }, "Discord client ready");
    };
    // Shutdown the application: stop workers, disconnect Discord, close database
    const stop = async () => {
        logger_1.logger.info("Stopping application container");
        // Promise.all runs all in parallel, map returns array of promises, await waits for all
        await Promise.all(workerHandles.map((worker) => worker.stop()));
        discordClient.shutdown();
        await prisma.$disconnect();
    };
    return { orchestrator, start, stop };
}
// Load policy.json from config directory and validate against schema
// Returns both the config and the path for hot-reload capability
function loadPolicyConfig() {
    const configPath = resolveFromRoot('config/policy.json');
    const raw = readJson(configPath);
    const policyConfig = policySchema_1.PolicySchema.parse(raw);
    return { policyConfig, configPath };
}
// Convert relative path to absolute path from project root
function resolveFromRoot(relative) {
    return path_1.default.resolve(process.cwd(), relative);
}
// Read and parse JSON file. Throws if file not found or JSON invalid
function readJson(targetPath) {
    try {
        const fileContents = fs_1.default.readFileSync(targetPath, 'utf-8');
        return JSON.parse(fileContents);
    }
    catch (error) {
        throw new Error(`Failed to read configuration file at ${targetPath}: ${error.message}`);
    }
}
// Instantiate all service implementations and wire them together
// Returns object with all port interface implementations
function buildServices(policy, configPath, hallDirectory, prisma, discordClient) {
    const discord = new DiscordService_1.DiscordServiceImpl(discordClient, hallDirectory, env_1.env.GUILD_ID);
    const config = new Config_1.ConfigImpl(policy, configPath);
    const cases = new prismaCaseService_1.PrismaCaseRepository(prisma);
    const decisions = new prismaDecisionService_1.PrismaDecisionRepository(prisma);
    const audit = new prismaAuditService_1.PrismaAuditRepository(prisma);
    const outbox = new prismaOutboxService_1.PrismaOutboxRepository(prisma);
    return { discord, config, cases, decisions, audit, outbox };
}
