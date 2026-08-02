import { z } from 'zod';

/**
 * StartLiveSession DTO — Zod schema for POST /live/sessions/:lessonId/start.
 * `record` is the teacher's choice from the pre-start "record this
 * lesson?" prompt; omitted/undefined defaults to `true` in `LiveService`.
 */
export const StartLiveSessionSchema = z.object({
  record: z.boolean().optional(),
});

export type StartLiveSessionDto = z.infer<typeof StartLiveSessionSchema>;
