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
function printTable(headers, rows) {
    const table = new cli_table3_1.default({
        head: headers.map((h) => chalk_1.default.cyan(h)),
        style: { head: [], border: [] },
    });
    rows.forEach((row) => table.push(row));
    console.log(table.toString());
}
function printSuccess(message) {
    console.log(chalk_1.default.green('✓'), message);
}
function printError(message) {
    console.error(chalk_1.default.red('✗'), message);
}
function printWarning(message) {
    console.log(chalk_1.default.yellow('⚠'), message);
}
function printInfo(message) {
    console.log(chalk_1.default.blue('ℹ'), message);
}
function formatDate(date) {
    if (!date)
        return '-';
    return date.toLocaleString();
}
function formatState(state) {
    const colors = {
        joined: chalk_1.default.gray,
        hall_chosen: chalk_1.default.blue,
        awaiting_ra: chalk_1.default.yellow,
        approved: chalk_1.default.green,
        denied: chalk_1.default.red,
        expired: chalk_1.default.magenta,
    };
    const colorFn = colors[state] || chalk_1.default.white;
    return colorFn(state);
}
function formatStatus(status) {
    const colors = {
        pending: chalk_1.default.yellow,
        sent: chalk_1.default.green,
        failed: chalk_1.default.red,
    };
    const colorFn = colors[status] || chalk_1.default.white;
    return colorFn(status);
}
