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
    DISCORD_TOKEN: zod_1.z.string(),
    NODE_ENV: zod_1.z.enum(['development', 'production']).default('development'),
});
exports.env = EnvSchema.parse(process.env);
