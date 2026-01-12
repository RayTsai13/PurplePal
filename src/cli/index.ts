#!/usr/bin/env node
// Shebang line allows this file to be executed directly as CLI tool

import { Command } from 'commander';
import { registerCaseCommands } from './commands/case';
import { registerSystemCommands } from './commands/system';
import { registerOutboxCommands } from './commands/outbox';
import { registerConfigCommands } from './commands/config';
import { startREPL } from './repl';

// Load environment variables from .env file
import 'dotenv/config';

// Create CLI program using Commander.js
const program = new Command();

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
    await startREPL();
  });

// Register all command modules
registerCaseCommands(program);
registerSystemCommands(program);
registerOutboxCommands(program);
registerConfigCommands(program);

// Parse command line arguments and execute
// .catch() handles any errors thrown by commands
// process.exit(1) terminates with error code
program.parseAsync(process.argv).catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
