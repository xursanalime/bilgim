/**
 * Types, constants and the scoring port for the Speaking_Assessment_Module
 * AI scoring flow (Phase 4, Task 4.2, Req 7.3, 7.4, 7.6).
 *
 * The actual speech-to-text transcription / pronunciation-scoring
 * provider is an OPEN QUESTION (Open Question 6/7 in requirements.md):
 * we do not yet know which engine (Azure Speech, AWS Transcribe +
 * a scoring model, a Claude-driven transcript analysis, …) will back
 * the score. This module is therefore written against a provider-
 * agnostic `SpeakingScoringPort` abstraction — exactly the same shape
 * the homework AI-grading flow uses (`AiGradingPort`). A deterministic
 * `MockSpeakingScoringAdapter` is the default binding so the pipeline
 * (queue → processor → AI_DRAFT Feedback → IN_REVIEW) is exercised end
 * to end offline; the real provider binding is a clearly-marked TBD stub
 * that refuses to fake a passing external call.
 */

/**
 * Feedback.authorType discriminator for the AI-produced speaking score
 * draft (Req 7.4 — "stored as an AI_DRAFT Feedback record").
 *
 * `Feedback.authorType` is a free-form string column; the homework
 * text-precheck flow uses `'AI'`. The speaking flow uses the distinct
 * `'AI_DRAFT'` tag the requirement names so a grader UI can tell an
 * AI-produced speaking draft apart from a text precheck and from a
 * teacher's final feedback.
 */
export const SPEAKING_AI_DRAFT_AUTHOR_TYPE = 'AI_DRAFT';

/** Feedback.authorType for a teacher's override of the AI draft (Req 7.6). */
export const SPEAKING_TEACHER_AUTHOR_TYPE = 'TEACHER';

/**
 * Feedback.authorType marking a TERMINAL scoring failure (Task 4.3, Req 7.5).
 *
 * `SubmissionStatus` has no FAILED member and the schema is frozen for
 * this task, so the "scoring failed" state is represented as a dedicated
 * Feedback row rather than a status enum value. The row doubles as:
 *   - the durable "job failed" marker (so the submission is never left
 *     silently stuck pending an AI draft that will never arrive), and
 *   - the manual-review flag (Property 4 — a speaking submission always
 *     ends with either an AI score or a manual-review flag), and
 *   - the idempotency guard: `markScoringFailed` is a no-op once a row
 *     with this authorType exists, so a re-delivered terminal failure
 *     never notifies the instructor twice.
 */
export const SPEAKING_SCORING_FAILED_AUTHOR_TYPE = 'AI_SCORING_FAILED';

/**
 * Outbox topic emitted when audio scoring exhausts its retries (Req 7.5).
 * Routed to the notification fan-out worker, which materialises a single
 * instructor-facing notification prompting a manual review.
 */
export const SPEAKING_SCORING_FAILED_TOPIC = 'speaking.scoring_failed';

/**
 * Outbox topic emitted when a speaking submission reaches GRADED
 * (Req 15.3). Intentionally REUSES the homework module's `homework.graded`
 * topic + `homework.graded:{submissionId}` idempotency key so the
 * existing fan-out path produces the same single HOMEWORK_GRADED
 * notification for the student — whether the grade came from the speaking
 * finalize path or the generic homework grade path (same key → the
 * outbox `ON CONFLICT DO NOTHING` dedupes a double-emit).
 */
export const SPEAKING_GRADED_TOPIC = 'homework.graded';

/** Dependency-injection token for the underlying scoring provider. */
export const SPEAKING_SCORING_PORT = Symbol('SPEAKING_SCORING_PORT');

/** BullMQ job name pushed onto the `speaking-scoring` queue. */
export const SPEAKING_SCORING_JOB_NAME = 'speaking.score';

/**
 * Payload pushed onto the `speaking-scoring` queue when a SPEAKING /
 * PRONUNCIATION submission reaches SUBMITTED (Req 7.3). The processor
 * re-loads the submission from the DB inside `SpeakingScoringService`
 * so this snapshot is purely a convenience for tracing — it can drift
 * from the row by the time the worker runs.
 */
export interface SpeakingScoringJob {
  submissionId: string;
  moduleId: string;
  assetId: string;
  /** Stamped for traceability — matches the Feedback idempotency tag. */
  idempotencyKey?: string;
}

/**
 * Input handed to the scoring provider. The provider receives the AUDIO
 * MediaAsset reference (it is responsible for fetching / transcribing the
 * recording) plus the module type so a PRONUNCIATION rubric can weight
 * pronunciation differently from a free-form SPEAKING answer.
 */
export interface SpeakingScoreInput {
  submissionId: string;
  moduleId: string;
  assetId: string;
  contentType: string;
  /** SPEAKING or PRONUNCIATION. */
  moduleType: string;
}

/** Per-dimension sub-score in the 0..1 range with a short comment. */
export interface SpeakingDimensionScore {
  /** 0..1 — provider's confidence for this dimension. */
  score: number;
  /** Learner-facing comment for this dimension. */
  comment: string;
}

/**
 * Provider verdict for one audio submission. `overall` is in the 0..1
 * range; `SpeakingScoringService` scales it to the assignment's
 * `totalPoints` to produce the numeric score (Req 7.4).
 */
export interface SpeakingScoreResult {
  /** 0..1 — overall spoken-answer quality. */
  overall: number;
  /** Pronunciation accuracy dimension (Req 7.4). */
  pronunciation: SpeakingDimensionScore;
  /** Fluency dimension (Req 7.4). */
  fluency: SpeakingDimensionScore;
  /** Free-form overall summary the teacher / learner sees. */
  summary: string;
  /** Provider identifier (e.g. `mock-speaking-v1`) for the audit trail. */
  provider: string;
  /**
   * Optional transcript of the recording. `null` until the transcription
   * provider Open Question (6/7) is resolved — the mock leaves it null.
   */
  transcript?: string | null;
}

/**
 * Provider-agnostic scoring port. Production binds this to a real
 * speech-scoring provider (TBD — Open Question 6/7); tests and offline
 * dev bind it to the deterministic mock.
 */
export interface SpeakingScoringPort {
  scoreAudio(input: SpeakingScoreInput): Promise<SpeakingScoreResult>;
}

/**
 * Shape of the AI_DRAFT Feedback `payload` written by the scoring
 * service (Req 7.4). Persisted under a single Feedback row with
 * `authorType = 'AI_DRAFT'`, `isFinal = false`.
 */
export interface SpeakingAiDraftPayload {
  kind: 'SPEAKING_SCORE';
  source: 'AI_DRAFT';
  moduleId: string;
  assetId: string;
  /** Numeric score scaled to the assignment totalPoints (Req 7.4). */
  score: number;
  /** Raw 0..1 overall score before scaling. */
  scoreRaw: number;
  pronunciation: SpeakingDimensionScore;
  fluency: SpeakingDimensionScore;
  summary: string;
  provider: string;
  transcript: string | null;
  /** Idempotency guard tag — `speaking-score:{submissionId}`. */
  idempotencyTag: string;
}

/** Clamp a number into the 0..1 range, mapping NaN to 0. */
export function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
