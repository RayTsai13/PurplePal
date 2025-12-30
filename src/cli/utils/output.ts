import Table from 'cli-table3';
import chalk from 'chalk';

export function printTable(headers: string[], rows: string[][]): void {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  rows.forEach((row) => table.push(row));
  console.log(table.toString());
}

export function printSuccess(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function printError(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return '-';
  return date.toLocaleString();
}

export function formatState(state: string): string {
  const colors: Record<string, typeof chalk.green> = {
    joined: chalk.gray,
    hall_chosen: chalk.blue,
    awaiting_ra: chalk.yellow,
    approved: chalk.green,
    denied: chalk.red,
    expired: chalk.magenta,
  };

  const colorFn = colors[state] || chalk.white;
  return colorFn(state);
}

export function formatStatus(status: string): string {
  const colors: Record<string, typeof chalk.green> = {
    pending: chalk.yellow,
    sent: chalk.green,
    failed: chalk.red,
  };

  const colorFn = colors[status] || chalk.white;
  return colorFn(status);
}
