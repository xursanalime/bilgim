import { z } from 'zod';

/**
 * DTOs for the bot-detection collector endpoints (Task 27.4, Req
 * 27.6). Validated by `ZodValidationPipe` so anything that reaches
 * the service is guaranteed to match these shapes.
 *
 * Keep the schemas tight — these endpoints accept untrusted client
 * input and feed Redis sets that other security layers consult.
 */

/**
 * Body for `POST /security/behavior/report`.
 *
 *   - `sessionId` is bounded to 128 characters because we use it as
 *     a Redis suffix and don't want clients to inflate the key
 *     length arbitrarily.
 *   - All numeric fields are non-negative integers under sensible
 *     ceilings — the service caps them again defensively in
 *     `BehavioralService.sanitise`, but rejecting hostile values at
 *     the boundary keeps the audit log clean.
 */
export const BehaviorReportSchema = z.object({
  sessionId: z.string().min(1).max(128),
  formId: z.string().min(1).max(128).optional(),
  mouseMovements: z.number().int().min(0).max(1_000_000),
  keystrokes: z.number().int().min(0).max(1_000_000),
  dwellTime: z.number().int().min(0).max(60 * 60 * 1000), // ≤ 1h
  formCompletionMs: z.number().int().min(0).max(60 * 60 * 1000), // ≤ 1h
});
export type BehaviorReportDto = z.infer<typeof BehaviorReportSchema>;

/**
 * Body for `POST /security/fingerprint/report`.
 *
 * Bounded for the same reason — the values flow into a Redis-keyed
 * SHA-256 so a 100KB canvas hash from a hostile client doesn't help
 * us, it just bloats logs.
 */
export const FingerprintReportSchema = z.object({
  canvasHash: z.string().min(1).max(256),
  fonts: z.string().min(1).max(4_000),
  screen: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^\d{2,5}x\d{2,5}$/,
      'screen must look like WIDTHxHEIGHT (e.g. 1920x1080)',
    ),
  timezone: z.string().min(1).max(64),
  language: z.string().min(1).max(32),
});
export type FingerprintReportDto = z.infer<typeof FingerprintReportSchema>;
