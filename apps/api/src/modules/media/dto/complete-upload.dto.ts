import { z } from 'zod';

/**
 * Body for `POST /media/uploads/:id/complete` — finalizes an R2 multipart
 * upload.
 *
 * The client passes the ETag returned by R2 from each part PUT alongside
 * the part number. The service layer normalizes ETags and verifies that
 * the part numbers cover the contiguous range expected at init time.
 */
export const CompleteUploadSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z
          .number()
          .int()
          .min(1, 'partNumber must be ≥ 1')
          .max(10_000, 'partNumber must be ≤ 10 000'),
        etag: z.string().min(1, 'etag is required'),
      }),
    )
    .min(1, 'At least one part is required')
    .max(10_000),
});

export type CompleteUploadDto = z.infer<typeof CompleteUploadSchema>;
