import { z } from 'zod';

// Discord snowflake IDs are 17-20 digit numbers. Rejecting anything else catches unreplaced
// placeholders (e.g. "REPLACE_WITH_ROLE_ID") at startup instead of failing silently at runtime
const DiscordIdSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'must be a numeric Discord ID (enable Developer Mode, then right-click > Copy ID)');

const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

const RegexSchema = z.string().refine(isValidRegex, 'must be a valid regular expression');

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
// Rooms are collected in two DM steps (room number, then unit) and joined as `${prefix}-${number}-${unit}`,
// which must then match `pattern`
export const HallSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  raRoleId: DiscordIdSchema,
  queueChannelId: DiscordIdSchema,
  hallRoleId: DiscordIdSchema,
  room: z
    .object({
      pattern: RegexSchema,
      example: z.string(),
      prefix: z.string().min(1),
      roomNumberPattern: RegexSchema.default('^\\d{3}$'),
      roomNumberExample: z.string().default('312'),
      unitPattern: RegexSchema.default('^[A-D]$'),
      unitExample: z.string().default('A'),
      normalize: RoomNormalizeSchema,
    })
    .optional(),
});

// Every DM template the code sends. z.looseObject keeps any extra keys
const DmTemplatesSchema = z.looseObject({
  welcome_joined: z.string().optional(),
  ask_hall: z.string(),
  invalid_hall: z.string(),
  ask_room_number: z.string(),
  invalid_room_number: z.string(),
  ask_unit: z.string(),
  invalid_unit: z.string(),
  invalid_room: z.string(),
  await_ra_notice: z.string(),
  reminder_user: z.string(),
  approved: z.string(),
  denied: z.string(),
  expired: z.string(),
  already_in_progress: z.string(),
  already_verified: z
    .string()
    .default("You're already verified for {{hall}} this term. If that's wrong, ask an admin to reset your verification."),
  system_error: z.string(),
});

// Every RA queue template the code posts
const RaQueueTemplatesSchema = z.looseObject({
  ra_verify_card_title: z.string(),
  ra_verify_card_body: z.string(),
  ra_reminder: z.string(),
  unauthorized_attempt: z.string(),
  decision_ack: z.string(),
});

// Complete policy configuration schema
// z.infer will be used to generate TypeScript types from this schema
// z.nonempty() ensures at least one hall is configured
// z.int() requires integer, .nonnegative() requires >= 0
export const PolicySchema = z.object({
  term: z.string(),
  lobbyChannelId: DiscordIdSchema.optional(),    // Channel where unverified users can chat
  unverifiedRoleId: DiscordIdSchema.optional(),  // Role assigned to new members until verified
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
  templates: z.object({
    dm: DmTemplatesSchema,
    ra_queue: RaQueueTemplatesSchema,
  }),
});

// z.infer<typeof Schema> extracts TypeScript type from Zod schema
// This ensures types match the validation rules
export type PolicyConfig = z.infer<typeof PolicySchema>;
// [number] means take the type of array element (first hall type)
export type HallConfig = PolicyConfig['halls'][number];
// NonNullable removes undefined from union type
export type RoomConfig = NonNullable<HallConfig['room']>;
