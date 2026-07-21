import { z } from 'zod';

/**
 * Checkout DTO — Zod schema for POST /billing/checkout.
 *
 * Two flows are supported via discriminated union on `kind`:
 *   - STUDENT_COURSE: pay for course access (creates EnrollmentRequest on Perform)
 *   - TEACHER_SUBSCRIPTION: pay platform subscription (activates Subscription on Perform)
 */
export const CheckoutSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('STUDENT_COURSE'),
    groupId: z.string().uuid('groupId must be a UUID'),
  }),
  z.object({
    kind: z.literal('TEACHER_SUBSCRIPTION'),
    planSlug: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
        message: 'planSlug must be kebab-case',
      })
      .default('teacher-monthly')
      .optional(),
  }),
]);

export type CheckoutDto = z.infer<typeof CheckoutSchema>;
