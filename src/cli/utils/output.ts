import Table from 'cli-table3';
import chalk from 'chalk';

// Print formatted table using cli-table3 with cyan headers
export function printTable(headers: string[], rows: string[][]): void {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  // .forEach() iterates array and applies function to each element
  rows.forEach((row) => table.push(row));
  console.log(table.toString());
}

// Print success message with green checkmark
export function printSuccess(message: string): void {
  console.log(chalk.green('✓'), message);
}

// Print error message to stderr with red X
export function printError(message: string): void {
  console.error(chalk.red('✗'), message);
}

// Print warning message with yellow warning icon
export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

// Print info message with blue info icon
export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

// Format date for display. Returns - if null/undefined
export function formatDate(date: Date | null | undefined): string {
  if (!date) return '-';
  return date.toLocaleString();
}

// Format case state with color coding
// Record<string, typeof chalk.green> is mapping of state name to color function
export function formatState(state: string): string {
  const colors: Record<string, typeof chalk.green> = {
    joined: chalk.gray,
    hall_chosen: chalk.blue,
    awaiting_ra: chalk.yellow,
    approved: chalk.green,
    denied: chalk.red,
    expired: chalk.magenta,
  };

  // || provides fallback if state not found in colors map
  const colorFn = colors[state] || chalk.white;
  return colorFn(state);
}

// Format outbox message status with color coding
export function formatStatus(status: string): string {
  const colors: Record<string, typeof chalk.green> = {
    pending: chalk.yellow,
    sent: chalk.green,
    failed: chalk.red,
  };

  const colorFn = colors[status] || chalk.white;
  return colorFn(status);
}
