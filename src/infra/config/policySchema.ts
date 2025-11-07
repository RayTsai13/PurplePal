import { z } from 'zod';

const RoomNormalizeSchema = z
  .object({
    uppercase: z.boolean().optional(),
    trimSpaces: z.boolean().optional(),
    fixHyphens: z.boolean().optional(),
    allowMissingHyphens: z.boolean().optional(),
    collapseDelimiters: z.boolean().optional(),
  })
  .default({});

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

export type PolicyConfig = z.infer<typeof PolicySchema>;
export type HallConfig = PolicyConfig['halls'][number];
export type RoomConfig = NonNullable<HallConfig['room']>;
