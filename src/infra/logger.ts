import pino from 'pino';

export const logger = pino({
  name: 'purplepal',
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['env.DISCORD_TOKEN', 'DISCORD_TOKEN'],
    remove: true,
  },
});

