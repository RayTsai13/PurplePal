"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printTable = printTable;
exports.printSuccess = printSuccess;
exports.printError = printError;
exports.printWarning = printWarning;
exports.printInfo = printInfo;
exports.formatDate = formatDate;
exports.formatState = formatState;
exports.formatStatus = formatStatus;
const cli_table3_1 = __importDefault(require("cli-table3"));
const chalk_1 = __importDefault(require("chalk"));
// Print formatted table using cli-table3 with cyan headers
function printTable(headers, rows) {
    const table = new cli_table3_1.default({
        head: headers.map((h) => chalk_1.default.cyan(h)),
        style: { head: [], border: [] },
    });
    // .forEach() iterates array and applies function to each element
    rows.forEach((row) => table.push(row));
    console.log(table.toString());
}
// Print success message with green checkmark
function printSuccess(message) {
    console.log(chalk_1.default.green('✓'), message);
}
// Print error message to stderr with red X
function printError(message) {
    console.error(chalk_1.default.red('✗'), message);
}
// Print warning message with yellow warning icon
function printWarning(message) {
    console.log(chalk_1.default.yellow('⚠'), message);
}
// Print info message with blue info icon
function printInfo(message) {
    console.log(chalk_1.default.blue('ℹ'), message);
}
// Format date for display. Returns - if null/undefined
function formatDate(date) {
    if (!date)
        return '-';
    return date.toLocaleString();
}
// Format case state with color coding
// Record<string, typeof chalk.green> is mapping of state name to color function
function formatState(state) {
    const colors = {
        joined: chalk_1.default.gray,
        hall_chosen: chalk_1.default.blue,
        awaiting_ra: chalk_1.default.yellow,
        approved: chalk_1.default.green,
        denied: chalk_1.default.red,
        expired: chalk_1.default.magenta,
    };
    // || provides fallback if state not found in colors map
    const colorFn = colors[state] || chalk_1.default.white;
    return colorFn(state);
}
// Format outbox message status with color coding
function formatStatus(status) {
    const colors = {
        pending: chalk_1.default.yellow,
        sent: chalk_1.default.green,
        failed: chalk_1.default.red,
    };
    const colorFn = colors[status] || chalk_1.default.white;
    return colorFn(status);
}
