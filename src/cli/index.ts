#!/usr/bin/env node
import { Command } from 'commander';
import { registerCaseCommands } from './commands/case';
import { registerSystemCommands } from './commands/system';
import { registerOutboxCommands } from './commands/outbox';
import { registerConfigCommands } from './commands/config';

// Load environment variables
import 'dotenv/config';

const program = new Command();

program
  .name('purplepal')
  .description('PurplePal CLI - Admin tools for the verification bot')
  .version('1.0.0');

// Register command modules
registerCaseCommands(program);
registerSystemCommands(program);
registerOutboxCommands(program);
registerConfigCommands(program);

// Parse and execute
program.parseAsync(process.argv).catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
