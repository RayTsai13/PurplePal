import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string(),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

export const env = EnvSchema.parse(process.env);

