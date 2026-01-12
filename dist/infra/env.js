"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
// Load .env file into process.env
dotenv_1.default.config();
// Zod schema validates environment variables at runtime
// z.string().min(1) means required string with at least 1 character
// .default() provides fallback if not set
// z.enum() restricts to specific values (development or production)
// .optional() means field can be undefined
const EnvSchema = zod_1.z.object({
    DISCORD_TOKEN: zod_1.z.string().min(1),
    DISCORD_APPLICATION_ID: zod_1.z.string().min(1),
    DATABASE_URL: zod_1.z.string().default('postgresql://purplepal:purplepal@localhost:5432/purplepal'),
    GUILD_ID: zod_1.z.string().min(1),
    ADMINS_IDS: zod_1.z.string().optional(),
    NODE_ENV: zod_1.z.enum(['development', 'production']).default('development'),
});
// Parse and validate process.env against schema
// Throws error if validation fails
const parsed = EnvSchema.parse(process.env);
// Transform ADMINS_IDS from comma-separated string to array of strings
// split(',') converts string to array, map trims whitespace, filter removes empty strings
exports.env = {
    ...parsed,
    ADMINS_IDS: parsed.ADMINS_IDS
        ? parsed.ADMINS_IDS.split(',').map((id) => id.trim()).filter(Boolean)
        : [],
};
