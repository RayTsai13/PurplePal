import { z } from 'zod';

// Schema for room normalization options
// All fields optional with default empty object
const RoomNormalizeSchema = z
  .object({
    uppercase: z.boolean().optional(),
    trimSpaces: z.boolean().optional(),
    fixHyphens: z.boolean().optional(),
    allowMissingHyphens: z.boolean().optional(),
    collapseDelimiters: z.boolean().optional(),
  })
  .default({});

// Schema for a single residence hall
// z.array() validates array of items, .default([]) provides empty array if missing
// z.record() validates object with dynamic string keys and specific value types
export const HallSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  raRoleId: z.string(),
  queueChannelId: z.string(),
  hallRoleId: z.string(),
  room: z
    .object({
      pattern: z.string(),
      example: z.string(),
      normalize: RoomNormalizeSchema,
    })
    .optional(),
});

// Complete policy configuration schema
// z.infer will be used to generate TypeScript types from this schema
// z.nonempty() ensures at least one hall is configured
// z.int() requires integer, .nonnegative() requires >= 0
export const PolicySchema = z.object({
  term: z.string(),
  timeouts: z.object({
    awaitingRA_ttl_hours: z.number().nonnegative(),
    reminder_hours: z.array(z.number().nonnegative()),
  }),
  halls: z.array(HallSchema).nonempty(),
  limits: z.object({
    maxNotificationRetries: z.number().int().nonnegative(),
    notificationBackoffSeconds: z.array(z.number().nonnegative()),
    roleAssignMaxRetries: z.number().int().nonnegative(),
    roleAssignRetryBackoffSeconds: z.array(z.number().nonnegative()),
  }),
  features: z.record(z.string(), z.boolean()).default({}),
  templates: z.object({
    dm: z.record(z.string(), z.string()),
    ra_queue: z.record(z.string(), z.string()),
  }),
});

// z.infer<typeof Schema> extracts TypeScript type from Zod schema
// This ensures types match the validation rules
export type PolicyConfig = z.infer<typeof PolicySchema>;
// [number] means take the type of array element (first hall type)
export type HallConfig = PolicyConfig['halls'][number];
// NonNullable removes undefined from union type
export type RoomConfig = NonNullable<HallConfig['room']>;
