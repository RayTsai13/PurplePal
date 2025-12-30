"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = void 0;
const renderTemplate = (template, data) => {
    if (!data) {
        return template;
    }
    return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key) => {
        const value = data[key];
        if (value === undefined || value === null) {
            return match;
        }
        return String(value);
    });
};
exports.renderTemplate = renderTemplate;
