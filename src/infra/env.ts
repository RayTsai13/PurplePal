import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file into process.env
dotenv.config();

// Zod schema validates environment variables at runtime
// z.string().min(1) means required string with at least 1 character
// .default() provides fallback if not set
// z.enum() restricts to specific values (development or production)
// .optional() means field can be undefined
const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DATABASE_URL: z.string().default('postgresql://purplepal:purplepal@localhost:5432/purplepal'),
  GUILD_ID: z.string().min(1),
  ADMINS_IDS: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

// Parse and validate process.env against schema
// Throws error if validation fails
const parsed = EnvSchema.parse(process.env);

// Transform ADMINS_IDS from comma-separated string to array of strings
// split(',') converts string to array, map trims whitespace, filter removes empty strings
export const env = {
  ...parsed,
  ADMINS_IDS: parsed.ADMINS_IDS
    ? parsed.ADMINS_IDS.split(',').map((id) => id.trim()).filter(Boolean)
    : [],
};
