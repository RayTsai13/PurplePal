"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = void 0;
// Replace template placeholders like {{key}} with values from data object
// Uses regex to find all {{...}} patterns and substitutes with data values
// Returns original placeholder if key not found or value is null/undefined
const renderTemplate = (template, data) => {
    if (!data) {
        return template;
    }
    // /regex/g = global flag applies pattern to entire string
    // \{\{ matches literal {{ (\ escapes special chars)
    // \s* matches optional whitespace
    // ([^}\s]+) captures key name (non-greedy, excludes } and whitespace)
    // .replace(pattern, (match, captured) => ...) replaces each match
    return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key) => {
        const value = data[key];
        if (value === undefined || value === null) {
            return match;
        }
        // String(value) converts any type to string representation
        return String(value);
    });
};
exports.renderTemplate = renderTemplate;
