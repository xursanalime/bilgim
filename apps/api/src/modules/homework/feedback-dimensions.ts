import { HomeworkModuleType } from '@prisma/client';

/**
 * English-teaching AI grading feedback dimensions
 * (English-Only Platform Refocus, Req 9.1, 9.2).
 *
 * After the refocus, AI pre-grading for text-based language skills no
 * longer emits a single opaque comment. WRITING and GRAMMAR submissions
 * receive a structured, typed breakdown across the three core
 * English-teaching dimensions the platform grades against:
 *
 *   - `grammar`    — sentence structure, tense agreement, punctuation.
 *   - `vocabulary` — word choice, range, and register.
 *   - `coherence`  — organisation, cohesion, and logical flow.
 *
 * The shape is intentionally narrow and typed (rather than a loose
 * `Record<string, ...>`) so the teacher UI and the gradebook can render
 * the three dimensions deterministically, and a future enum/dimension
 * change fails the build here rather than drifting silently.
 */

/** Module types that receive structured grammar/vocabulary/coherence feedback. */
export const FEEDBACK_DIMENSION_MODULE_TYPES: ReadonlySet<HomeworkModuleType> =
  new Set<HomeworkModuleType>(['WRITING', 'GRAMMAR']);

/**
 * `true` when the given module type should receive structured
 * grammar/vocabulary/coherence feedback (WRITING / GRAMMAR — Req 9.2).
 */
export function requiresFeedbackDimensions(type: HomeworkModuleType): boolean {
  return FEEDBACK_DIMENSION_MODULE_TYPES.has(type);
}

/** A single scored English-teaching feedback dimension. */
export interface FeedbackDimension {
  /** 0..1 — confidence/quality score for this dimension. */
  readonly score: number;
  /** Learner/teacher-facing feedback for this dimension. */
  readonly comment: string;
}

/**
 * Structured English-teaching feedback for a WRITING / GRAMMAR
 * submission. The three keys are fixed (Req 9.2) so consumers can rely
 * on the shape without runtime guards.
 */
export interface LanguageFeedbackDimensions {
  readonly grammar: FeedbackDimension;
  readonly vocabulary: FeedbackDimension;
  readonly coherence: FeedbackDimension;
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Build a deterministic `LanguageFeedbackDimensions` breakdown for a
 * WRITING / GRAMMAR submission.
 *
 * The per-dimension scores are derived from the adapter's overall
 * `baseScore` with small stable offsets so the breakdown is consistent
 * with the headline suggestion while still giving the teacher a per-skill
 * signal. The comments are English-teaching oriented and degrade
 * gracefully to a "no answer" message when the learner submitted nothing.
 *
 * Pure + side-effect free so both the deterministic mock adapter and the
 * Anthropic-backed adapter can share it without duplicating the shape.
 */
export function buildLanguageFeedbackDimensions(args: {
  type: HomeworkModuleType;
  text: string;
  baseScore: number;
}): LanguageFeedbackDimensions {
  const base = clamp01(args.baseScore);
  const hasText = (args.text ?? '').trim().length > 0;

  if (!hasText) {
    const empty = (skill: string): FeedbackDimension => ({
      score: 0,
      comment: `${skill}: no answer submitted yet — nothing to assess.`,
    });
    return {
      grammar: empty('Grammar'),
      vocabulary: empty('Vocabulary'),
      coherence: empty('Coherence'),
    };
  }

  return {
    grammar: {
      score: clamp01(base),
      comment:
        'Grammar: check sentence structure, verb tense agreement, and punctuation.',
    },
    vocabulary: {
      score: clamp01(base - 0.05),
      comment:
        'Vocabulary: aim for varied, precise word choice and appropriate register.',
    },
    coherence: {
      score: clamp01(base - 0.1),
      comment:
        'Coherence: strengthen paragraph organisation and use linking words to connect ideas.',
    },
  };
}
