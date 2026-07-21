import { z } from 'zod';

/**
 * Body schema for `PUT /notifications/preferences/:kind/:channel`.
 *
 * Per Req 16.3 the only mutable field is `enabled`. `kind` and `channel`
 * are taken from the URL params and validated via Zod enums in the
 * controller's path schema below.
 */
export const UpdatePreferenceSchema = z.object({
  enabled: z.boolean(),
});

export type UpdatePreferenceDto = z.infer<typeof UpdatePreferenceSchema>;

/**
 * The supported notification kinds for which a user can override the
 * default channel preferences (Req 16.2).
 */
export const NotificationKindSchema = z.enum([
  'ENROLLMENT_REQUESTED',
  'ENROLLMENT_APPROVED',
  'ENROLLMENT_REJECTED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'LESSON_PUBLISHED',
  'SCHEDULE_CHANGED',
  'LIVE_STARTED',
  'LIVE_REMINDER',
  'HOMEWORK_ASSIGNED',
  'HOMEWORK_GRADED',
  'AI_REVIEW_READY',
  'TRIAL_ENDING',
  'SUBSCRIPTION_PAST_DUE',
]);

export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationChannelSchema = z.enum([
  'IN_APP',
  'EMAIL',
  'TELEGRAM',
  'PUSH',
]);

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/**
 * Body schema for `PATCH /notifications/preferences` — bulk update.
 *
 * The user submits an array of `{ kind, channel, enabled }` triples; the
 * server upserts each row. Per Req 16.1 and 16.3 the call is **partial**
 * — combinations not listed are left at their previous (or default)
 * value. An empty array is valid (no-op) but the schema enforces a sane
 * upper bound to avoid pathological payloads (4 channels × 13 kinds =
 * 52 combinations, so we cap at 64).
 *
 * Per Task 14.3 / Req 16.1 the IN_APP channel is always-on; attempts to
 * set `{ channel: 'IN_APP', enabled: false }` are rejected at the
 * validation layer with a 400 so the upsert layer never sees them.
 */
export const BulkUpdatePreferencesSchema = z.object({
  preferences: z
    .array(
      z
        .object({
          kind: NotificationKindSchema,
          channel: NotificationChannelSchema,
          enabled: z.boolean(),
        })
        .superRefine((value, ctx) => {
          if (value.channel === 'IN_APP' && value.enabled === false) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['enabled'],
              message:
                'IN_APP channel is always-on and cannot be disabled',
            });
          }
        }),
    )
    .max(64),
});

export type BulkUpdatePreferencesDto = z.infer<
  typeof BulkUpdatePreferencesSchema
>;
