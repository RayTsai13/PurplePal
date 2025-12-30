"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicySchema = exports.HallSchema = void 0;
const zod_1 = require("zod");
const RoomNormalizeSchema = zod_1.z
    .object({
    uppercase: zod_1.z.boolean().optional(),
    trimSpaces: zod_1.z.boolean().optional(),
    fixHyphens: zod_1.z.boolean().optional(),
    allowMissingHyphens: zod_1.z.boolean().optional(),
    collapseDelimiters: zod_1.z.boolean().optional(),
})
    .default({});
exports.HallSchema = zod_1.z.object({
    name: zod_1.z.string(),
    aliases: zod_1.z.array(zod_1.z.string()).default([]),
    raRoleId: zod_1.z.string(),
    queueChannelId: zod_1.z.string(),
    hallRoleId: zod_1.z.string(),
    room: zod_1.z
        .object({
        pattern: zod_1.z.string(),
        example: zod_1.z.string(),
        normalize: RoomNormalizeSchema,
    })
        .optional(),
});
exports.PolicySchema = zod_1.z.object({
    term: zod_1.z.string(),
    timeouts: zod_1.z.object({
        awaitingRA_ttl_hours: zod_1.z.number().nonnegative(),
        reminder_hours: zod_1.z.array(zod_1.z.number().nonnegative()),
    }),
    halls: zod_1.z.array(exports.HallSchema).nonempty(),
    limits: zod_1.z.object({
        maxNotificationRetries: zod_1.z.number().int().nonnegative(),
        notificationBackoffSeconds: zod_1.z.array(zod_1.z.number().nonnegative()),
        roleAssignMaxRetries: zod_1.z.number().int().nonnegative(),
        roleAssignRetryBackoffSeconds: zod_1.z.array(zod_1.z.number().nonnegative()),
    }),
    features: zod_1.z.record(zod_1.z.string(), zod_1.z.boolean()).default({}),
    templates: zod_1.z.object({
        dm: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
        ra_queue: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
    }),
});
