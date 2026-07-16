/**
 * Placement scoring → CEFR computation — Phase 3, Task 3.2 (Req 5.2, 5.5).
 *
 * Pure, dependency-free functions so the scoring → CEFR mapping can be
 * unit-tested without Nest/Prisma and reused by Task 3.2's service. No I/O,
 * no answer-key leakage to callers.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SCORING MODEL (deterministic, difficulty-weighted)
 * ──────────────────────────────────────────────────────────────────────────
 * Each multiple-choice item targets a CEFR band (`question.targetLevel`) and
 * carries the answer key (`question.correctOption`). We weight every item by
 * its target band so harder, higher-band items contribute more evidence of
 * ability:
 *
 *     A1=1  A2=2  B1=3  B2=4  C1=5  C2=6   (see CEFR_WEIGHT)
 *
 * An item is CORRECT iff the learner's saved answer is the numeric index that
 * equals `correctOption`. (Answers are stored as free JSON for forward
 * compatibility — non-numeric / out-of-range answers simply count as wrong.)
 *
 * Per skill we earn the summed weight of the items answered correctly out of
 * the summed weight of all that skill's items, giving a 0..1 `ratio`. The
 * overall ratio is earned-weight / max-weight across ALL items.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * OVERALL CEFR THRESHOLD MAPPING (applied to the overall weighted ratio)
 * ──────────────────────────────────────────────────────────────────────────
 *   ratio < 0.15            → A1
 *   0.15 <= ratio < 0.35    → A2
 *   0.35 <= ratio < 0.55    → B1
 *   0.55 <= ratio < 0.75    → B2
 *   0.75 <= ratio < 0.90    → C1
 *   ratio >= 0.90           → C2
 *
 * The bands are intentionally widening-at-the-bottom / tightening-at-the-top
 * so that demonstrating mastery of the harder (heavier) items is required to
 * reach C1/C2. Thresholds live in CEFR_THRESHOLDS so they are easy to tune
 * when the question source is finalised (Open Question 5).
 */
import type { CefrLevel } from '@prisma/client';

import {
  PLACEMENT_QUESTION_BANK,
  PLACEMENT_SKILLS,
  PlacementSkill,
} from './question-bank';

/** Numeric weight of each CEFR band — drives difficulty-weighted scoring. */
export const CEFR_WEIGHT: Record<CefrLevel, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
};

/**
 * Overall-ratio → CEFR thresholds, ordered ascending. The first entry whose
 * `maxExclusive` is greater than the ratio wins; the final `C2` entry uses
 * `Infinity` so every ratio maps to exactly one level (total mapping).
 */
export const CEFR_THRESHOLDS: ReadonlyArray<{
  level: CefrLevel;
  maxExclusive: number;
}> = [
  { level: 'A1', maxExclusive: 0.15 },
  { level: 'A2', maxExclusive: 0.35 },
  { level: 'B1', maxExclusive: 0.55 },
  { level: 'B2', maxExclusive: 0.75 },
  { level: 'C1', maxExclusive: 0.9 },
  { level: 'C2', maxExclusive: Number.POSITIVE_INFINITY },
];

/** Per-skill scored result, persisted to `PlacementAssessment.perSkillScores`. */
export interface PerSkillScore {
  skill: PlacementSkill;
  /** Number of items the learner answered correctly for this skill. */
  correct: number;
  /** Total number of items for this skill in the bank. */
  total: number;
  /** Summed CEFR weight of the correctly-answered items. */
  weightedScore: number;
  /** Summed CEFR weight of all items for this skill. */
  maxWeightedScore: number;
  /** `weightedScore / maxWeightedScore`, in [0, 1] (0 when the skill is absent). */
  ratio: number;
}

/** Full scoring result: per-skill breakdown + the overall computed CEFR level. */
export interface ScoreResult {
  perSkill: PerSkillScore[];
  /** Overall weighted ratio across all items, in [0, 1]. */
  overallRatio: number;
  computedLevel: CefrLevel;
}

/** A learner answer keyed by the question it belongs to. */
export interface AnswerInput {
  questionRef: string;
  answer: unknown;
}

/** Map a 0..1 overall ratio to a CEFR level via {@link CEFR_THRESHOLDS}. */
export function ratioToCefrLevel(ratio: number): CefrLevel {
  for (const band of CEFR_THRESHOLDS) {
    if (ratio < band.maxExclusive) {
      return band.level;
    }
  }
  // Unreachable: the last threshold is Infinity. Kept for total-function safety.
  return 'C2';
}

/**
 * Score a placement assessment from its saved answers.
 *
 * Iterates the static question bank (the source of truth for items + answer
 * keys) and looks up the learner's answer per `questionRef`. Items with no
 * saved answer, or a non-matching answer, count as incorrect. Pure and
 * deterministic: the same answers always yield the same `ScoreResult`.
 */
export function scoreAssessment(answers: readonly AnswerInput[]): ScoreResult {
  const answerByRef = new Map<string, unknown>(
    answers.map((a) => [a.questionRef, a.answer]),
  );

  let earnedTotal = 0;
  let maxTotal = 0;
  const perSkill: PerSkillScore[] = [];

  for (const skill of PLACEMENT_SKILLS) {
    const items = PLACEMENT_QUESTION_BANK.filter((q) => q.skill === skill);
    let correct = 0;
    let weightedScore = 0;
    let maxWeightedScore = 0;

    for (const item of items) {
      const weight = CEFR_WEIGHT[item.targetLevel];
      maxWeightedScore += weight;
      const given = answerByRef.get(item.questionRef);
      if (typeof given === 'number' && given === item.correctOption) {
        correct += 1;
        weightedScore += weight;
      }
    }

    earnedTotal += weightedScore;
    maxTotal += maxWeightedScore;
    perSkill.push({
      skill,
      correct,
      total: items.length,
      weightedScore,
      maxWeightedScore,
      ratio: maxWeightedScore === 0 ? 0 : weightedScore / maxWeightedScore,
    });
  }

  const overallRatio = maxTotal === 0 ? 0 : earnedTotal / maxTotal;
  return {
    perSkill,
    overallRatio,
    computedLevel: ratioToCefrLevel(overallRatio),
  };
}
