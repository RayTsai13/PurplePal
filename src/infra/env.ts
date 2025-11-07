import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  GUILD_ID: z.string().min(1),
  ADMINS_IDS: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
  ...parsed,
  ADMINS_IDS: parsed.ADMINS_IDS
    ? parsed.ADMINS_IDS.split(',').map((id) => id.trim()).filter(Boolean)
    : [],
};
