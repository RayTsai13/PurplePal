"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const EnvSchema = zod_1.z.object({
    DISCORD_TOKEN: zod_1.z.string().min(1),
    DISCORD_APPLICATION_ID: zod_1.z.string().min(1),
    DATABASE_URL: zod_1.z.string().min(1),
    GUILD_ID: zod_1.z.string().min(1),
    ADMINS_IDS: zod_1.z.string().optional(),
    NODE_ENV: zod_1.z.enum(['development', 'production']).default('development'),
});
const parsed = EnvSchema.parse(process.env);
exports.env = {
    ...parsed,
    ADMINS_IDS: parsed.ADMINS_IDS
        ? parsed.ADMINS_IDS.split(',').map((id) => id.trim()).filter(Boolean)
        : [],
};
