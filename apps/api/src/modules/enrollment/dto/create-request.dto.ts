import { z } from 'zod';

/**
 * Body for `POST /enrollment/requests` — a student asks to join a group.
 *
 * EduBridge supports a direct join-request flow (no upfront payment): the
 * student submits a request that lands in the teacher's inbox as
 * `PENDING_APPROVAL`. The teacher then approves or rejects it. An optional
 * short `message` lets the student introduce themselves.
 */
export const CreateEnrollmentRequestSchema = z.object({
  groupId: z.string().uuid('groupId must be a UUID'),
  message: z.string().trim().max(500, 'message must be ≤ 500 chars').optional(),
});

export type CreateEnrollmentRequestDto = z.infer<
  typeof CreateEnrollmentRequestSchema
>;
