#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const case_1 = require("./commands/case");
const system_1 = require("./commands/system");
const outbox_1 = require("./commands/outbox");
const config_1 = require("./commands/config");
// Load environment variables
require("dotenv/config");
const program = new commander_1.Command();
program
    .name('purplepal')
    .description('PurplePal CLI - Admin tools for the verification bot')
    .version('1.0.0');
// Register command modules
(0, case_1.registerCaseCommands)(program);
(0, system_1.registerSystemCommands)(program);
(0, outbox_1.registerOutboxCommands)(program);
(0, config_1.registerConfigCommands)(program);
// Parse and execute
program.parseAsync(process.argv).catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
});
