export const renderTemplate = (template: string, data?: Record<string, unknown>): string => {
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
