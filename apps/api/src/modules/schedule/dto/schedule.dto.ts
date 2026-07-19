import { z } from 'zod';

/**
 * RFC 5545 RRULE validator. We use the `rrule` library to parse the string
 * at the boundary so the service layer can trust the value without
 * re-parsing. Empty / non-string values fall through to Zod's required-string
 * check first so the error message is predictable.
 */
function isValidRrule(value: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RRule } = require('rrule');
    // RRule.fromString accepts both prefixed ("RRULE:FREQ=...") and bare
    // ("FREQ=...") forms — that matches what the design doc shows in
    // examples (`FREQ=WEEKLY;BYDAY=TU,TH,SA;...`).
    RRule.fromString(value);
    return true;
  } catch {
    return false;
  }
}

const RruleSchema = z
  .string()
  .min(1, 'rrule is required')
  .max(500)
  .refine(isValidRrule, {
    message:
      'rrule must be a valid RFC 5545 RRULE (e.g. "FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0")',
  });

const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]+$/, {
    message: 'timezone must be an IANA tz string (e.g. "Asia/Tashkent")',
  });

const DurationSchema = z
  .number()
  .int('durationMin must be an integer')
  .positive('durationMin must be > 0')
  // 1 day cap — keeps a single occurrence within a real-world boundary.
  .max(24 * 60, 'durationMin must be <= 1440');

/**
 * Body for `POST /schedule/events` (Req 10.1).
 *
 * Creates the (one) schedule for a group. If the group already has a
 * schedule, the service rejects with 409 SCHEDULE_ALREADY_EXISTS — the
 * caller should use PATCH instead.
 */
export const CreateScheduleEventSchema = z.object({
  groupId: z.string().uuid({ message: 'groupId must be a UUID' }),
  rrule: RruleSchema,
  timezone: TimezoneSchema.default('Asia/Tashkent'),
  durationMin: DurationSchema,
});
export type CreateScheduleEventDto = z.infer<typeof CreateScheduleEventSchema>;

/**
 * Body for `PATCH /schedule/events/:id` (Req 10.1).
 *
 * Partial update — at least one field must be present. Each successful
 * call bumps `Schedule.version` by exactly 1 and emits `schedule.changed`.
 */
export const UpdateScheduleEventSchema = z
  .object({
    rrule: RruleSchema.optional(),
    timezone: TimezoneSchema.optional(),
    durationMin: DurationSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateScheduleEventDto = z.infer<typeof UpdateScheduleEventSchema>;
