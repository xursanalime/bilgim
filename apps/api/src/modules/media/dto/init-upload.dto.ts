import { z } from 'zod';

import { MEDIA_KIND_VALUES } from '../media.types';

/**
 * Body for `POST /media/uploads` — initiates an R2 multipart upload.
 *
 * - `fileName` is sanitized server-side and used only inside the object key.
 * - `contentType` must be in the per-kind allow-list (Req 8.7). The service
 *   layer also re-validates that `contentType` matches `kind` so a TEACHER
 *   cannot smuggle a `.exe` under `kind=PDF`.
 * - `sizeBytes` is required so the service can compute the part count and
 *   reject files that exceed the platform cap (5 GiB by default, well below
 *   R2's 5 TiB limit).
 * - `partsCount` is the number of parts the client plans to upload. Must be
 *   between 1 and 10 000 (S3 cap). Clients typically derive this from
 *   `ceil(sizeBytes / partSize)` with `partSize = 8 MiB`.
 */
export const InitUploadSchema = z.object({
  fileName: z
    .string()
    .min(1, 'fileName is required')
    .max(255, 'fileName must be ≤ 255 characters'),
  kind: z.enum(MEDIA_KIND_VALUES),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'contentType must be a valid MIME type'),
  sizeBytes: z
    .number()
    .int('sizeBytes must be an integer')
    .positive('sizeBytes must be positive')
    .max(5 * 1024 * 1024 * 1024, 'sizeBytes exceeds 5 GiB cap'),
  partsCount: z
    .number()
    .int('partsCount must be an integer')
    .min(1, 'partsCount must be ≥ 1')
    .max(10_000, 'partsCount must be ≤ 10 000 (R2 multipart limit)'),
});

export type InitUploadDto = z.infer<typeof InitUploadSchema>;
