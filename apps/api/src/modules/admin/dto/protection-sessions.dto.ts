import { z } from 'zod';

/**
 * DTOs for the admin leak-investigation surface
 * (content-protection-backend, Task 4.2 / Req 6.3, 6.4).
 *
 * Two surfaces:
 *   1. `LookupSessionsQuery` — map a watermark/session marker
 *      (`viewerTag`) or a `viewerUserId` / `assetId` back to the learner
 *      identity(ies) behind the recorded `PlaybackSession` rows (Req 6.4).
 *   2. `IngestAnomalySignals` — a **provider-agnostic** seam that accepts
 *      concurrency/anomaly signals from the DRM_Provider where available
 *      (Req 6.3). The provider is an Open Question, so the DTO is vendor
 *      neutral and the service treats it as a dev no-op until a real
 *      provider is wired.
 */

/**
 * Query for `GET /admin/protection/sessions`.
 *
 * At least one selector (`viewerTag`, `viewerUserId`, or `assetId`) MUST
 * be supplied — a leak investigation always starts from a known marker,
 * and an unfiltered scan over every viewing session would be both
 * expensive and a needless PII exposure.
 */
export const LookupSessionsQuerySchema = z
  .object({
    /** Forensic watermark label recovered from a leaked recording. */
    viewerTag: z.string().trim().min(1).max(256).optional(),
    /** Resolve every session for a single learner. */
    viewerUserId: z.string().uuid().optional(),
    /** Resolve every session against a single asset. */
    assetId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine(
    (d) =>
      d.viewerTag !== undefined ||
      d.viewerUserId !== undefined ||
      d.assetId !== undefined,
    {
      message:
        'At least one of viewerTag, viewerUserId, or assetId is required',
      path: ['viewerTag'],
    },
  );

export type LookupSessionsQueryDto = z.infer<typeof LookupSessionsQuerySchema>;

/**
 * Vendor-neutral classification of an anomaly signal. Kept deliberately
 * small and provider-agnostic (Req 6.3) — a real DRM_Provider adapter
 * maps its own event vocabulary onto these buckets rather than leaking
 * vendor-specific shapes into the admin surface.
 */
export const AnomalySignalKindSchema = z.enum([
  'CONCURRENCY',
  'GEO_VELOCITY',
  'DEVICE_CHURN',
  'OTHER',
]);

export type AnomalySignalKind = z.infer<typeof AnomalySignalKindSchema>;

/** A single provider-reported anomaly signal. */
export const AnomalySignalSchema = z
  .object({
    kind: AnomalySignalKindSchema,
    /** Session marker the signal correlates to, when the provider knows it. */
    sessionId: z.string().uuid().optional(),
    /** Watermark label the signal correlates to, when available. */
    viewerTag: z.string().trim().min(1).max(256).optional(),
    assetId: z.string().uuid().optional(),
    /** Observed concurrency count, where the signal is a concurrency event. */
    observedConcurrency: z.coerce.number().int().min(0).max(100_000).optional(),
    /** Free-form provider detail (already vendor-redacted by the adapter). */
    detail: z.string().trim().max(2_000).optional(),
    observedAt: z.coerce.date().optional(),
  })
  .refine(
    (s) =>
      s.sessionId !== undefined ||
      s.viewerTag !== undefined ||
      s.assetId !== undefined,
    {
      message:
        'A signal must correlate to at least one of sessionId, viewerTag, or assetId',
      path: ['sessionId'],
    },
  );

export type AnomalySignalDto = z.infer<typeof AnomalySignalSchema>;

/** Body for `POST /admin/protection/anomaly-signals`. */
export const IngestAnomalySignalsSchema = z.object({
  signals: z.array(AnomalySignalSchema).min(1).max(500),
  /** Identifier of the provider emitting the batch (for traceability). */
  source: z.string().trim().min(1).max(120).optional(),
});

export type IngestAnomalySignalsDto = z.infer<typeof IngestAnomalySignalsSchema>;
