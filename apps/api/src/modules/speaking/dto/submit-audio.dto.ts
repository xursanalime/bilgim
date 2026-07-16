import { z } from 'zod';

import { SPEAKING_AUDIO_MAX_SIZE_BYTES } from '../speaking.types';

/**
 * Body for `POST /assignments/:assignmentId/modules/:moduleId/speaking-audio`.
 *
 * The learner's client first records audio, then asks the
 * Speaking_Assessment_Module to register the recording for the speaking
 * module. The service initiates an R2 multipart upload through the
 * Media_Module and returns signed part URLs — so the wire payload here
 * mirrors the Media_Module `init-upload` contract (fileName / contentType
 * / sizeBytes / partsCount).
 *
 * `contentType` is validated as a well-formed MIME type at the schema
 * level; the allowlist check (Req 7.7) is enforced in the service so a
 * rejected type yields a stable domain error code rather than a generic
 * schema failure.
 */
export const SubmitSpeakingAudioSchema = z
  .object({
    fileName: z
      .string()
      .min(1, 'fileName is required')
      .max(255, 'fileName must be ≤ 255 characters'),
    contentType: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[\w.+-]+\/[\w.+-]+$/, 'contentType must be a valid MIME type'),
    sizeBytes: z
      .number()
      .int('sizeBytes must be an integer')
      .positive('sizeBytes must be positive')
      .max(
        SPEAKING_AUDIO_MAX_SIZE_BYTES,
        `sizeBytes exceeds the ${SPEAKING_AUDIO_MAX_SIZE_BYTES}-byte speaking-audio cap`,
      ),
    partsCount: z
      .number()
      .int('partsCount must be an integer')
      .min(1, 'partsCount must be ≥ 1')
      .max(10_000, 'partsCount must be ≤ 10 000 (R2 multipart limit)'),
  })
  .strict();

export type SubmitSpeakingAudioDto = z.infer<typeof SubmitSpeakingAudioSchema>;
