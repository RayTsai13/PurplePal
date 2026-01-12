#!/usr/bin/env node
"use strict";
// Shebang line allows this file to be executed directly as CLI tool
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const case_1 = require("./commands/case");
const system_1 = require("./commands/system");
const outbox_1 = require("./commands/outbox");
const config_1 = require("./commands/config");
const repl_1 = require("./repl");
// Load environment variables from .env file
require("dotenv/config");
// Create CLI program using Commander.js
const program = new commander_1.Command();
// Configure program metadata
program
    .name('purplepal')
    .description('PurplePal CLI - Admin tools for the verification bot')
    .version('1.0.0');
// Add interactive mode command
program
    .command('interactive')
    .alias('i')
    .description('Start interactive REPL mode')
    .action(async () => {
    await (0, repl_1.startREPL)();
});
// Register all command modules
(0, case_1.registerCaseCommands)(program);
(0, system_1.registerSystemCommands)(program);
(0, outbox_1.registerOutboxCommands)(program);
(0, config_1.registerConfigCommands)(program);
// Parse command line arguments and execute
// .catch() handles any errors thrown by commands
// process.exit(1) terminates with error code
program.parseAsync(process.argv).catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
});
