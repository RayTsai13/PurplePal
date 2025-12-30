import pino from 'pino';

// Pino logger instance configured for the app
// name: identifies this logger in output
// level: production uses info only, dev uses debug (more verbose)
// redact: automatically removes sensitive fields like DISCORD_TOKEN from all logs
export const logger = pino({
  name: 'purplepal',
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['env.DISCORD_TOKEN', 'DISCORD_TOKEN'],
    remove: true,
  },
});

