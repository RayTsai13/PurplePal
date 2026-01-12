"use strict";
// Lightweight dependency injection container for CLI
// Only loads database and config services, no Discord client or background workers
// Uses singleton pattern to reuse container across commands
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCliContainer = getCliContainer;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../generated/prisma");
const policySchema_1 = require("../infra/config/policySchema");
const Config_1 = require("../infra/services/Config");
const prismaCaseService_1 = require("../infra/services/prismaCaseService");
const prismaAuditService_1 = require("../infra/services/prismaAuditService");
const prismaOutboxService_1 = require("../infra/services/prismaOutboxService");
// Cached container instance (singleton pattern)
let container = null;
// Get or create CLI container
// Returns cached instance if already created
// Initializes database connection and all repositories on first call
async function getCliContainer() {
    if (container) {
        return container;
    }
    const policyConfig = loadPolicyConfig();
    const prisma = new prisma_1.PrismaClient();
    await prisma.$connect();
    const config = new Config_1.ConfigImpl(policyConfig);
    const cases = new prismaCaseService_1.PrismaCaseRepository(prisma);
    const audit = new prismaAuditService_1.PrismaAuditRepository(prisma);
    const outbox = new prismaOutboxService_1.PrismaOutboxRepository(prisma);
    // disconnect function closes database and resets singleton
    const disconnect = async () => {
        await prisma.$disconnect();
        container = null;
    };
    container = { config, cases, audit, outbox, prisma, disconnect };
    return container;
}
// Load and validate policy config from JSON file
// Throws if file not found or validation fails
function loadPolicyConfig() {
    const policyPath = path_1.default.resolve(process.cwd(), 'config/policy.json');
    try {
        const fileContents = fs_1.default.readFileSync(policyPath, 'utf-8');
        const raw = JSON.parse(fileContents);
        return policySchema_1.PolicySchema.parse(raw);
    }
    catch (error) {
        throw new Error(`Failed to read configuration file at ${policyPath}: ${error.message}`);
    }
}
