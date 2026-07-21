import { z } from 'zod';

/**
 * Body for `POST /catalog/lessons/:lessonId/attachments`.
 *
 * Used by the teacher dashboard after a media upload completes — links a
 * `MediaAsset` (UPLOADED/READY) to a Lesson via the `Attachment` table.
 */
export const CreateAttachmentSchema = z.object({
  assetId: z.string().uuid('assetId UUID bo\u2018lishi kerak'),
  kind: z.enum([
    'VIDEO',
    'AUDIO',
    'IMAGE',
    'PDF',
    'DOC',
    'SHEET',
    'RECORDING',
    'OTHER',
  ]),
  role: z.string().trim().max(40).optional(),
  position: z.number().int().nonnegative().max(1000).optional(),
});

export type CreateAttachmentDto = z.infer<typeof CreateAttachmentSchema>;
