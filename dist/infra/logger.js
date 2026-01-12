"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
// Pino logger instance configured for the app
// name: identifies this logger in output
// level: production uses info only, dev uses debug (more verbose)
// redact: automatically removes sensitive fields like DISCORD_TOKEN from all logs
exports.logger = (0, pino_1.default)({
    name: 'purplepal',
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: {
        paths: ['env.DISCORD_TOKEN', 'DISCORD_TOKEN'],
        remove: true,
    },
});
