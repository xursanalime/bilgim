import { Injectable, Logger } from '@nestjs/common';

import {
  SpeakingScoreInput,
  SpeakingScoreResult,
  SpeakingScoringPort,
  clamp01,
} from '../speaking-scoring.types';

/**
 * MockSpeakingScoringAdapter — deterministic, offline binding for
 * `SPEAKING_SCORING_PORT` used by default until the real speech-scoring
 * provider Open Question (6/7) is resolved.
 *
 * It does NOT contact any external service and makes no attempt to
 * transcribe the recording — it derives stable pseudo-scores from the
 * asset id so the pipeline (queue → processor → AI_DRAFT Feedback →
 * IN_REVIEW) and the audit trail are exercised end to end without a
 * network call. The output is intentionally stable (no randomness) so
 * unit tests can assert exact values and the idempotency guard holds.
 *
 * IMPORTANT: this is a clearly-labelled placeholder, not a stand-in for
 * a passing external call. The numeric scores carry no pedagogical
 * meaning — the instructor override path (Req 7.6) exists precisely so a
 * human corrects the draft before the submission is GRADED.
 */
@Injectable()
export class MockSpeakingScoringAdapter implements SpeakingScoringPort {
  private readonly logger = new Logger(MockSpeakingScoringAdapter.name);

  async scoreAudio(input: SpeakingScoreInput): Promise<SpeakingScoreResult> {
    // Stable hash of the asset id → spread the three sub-scores across a
    // plausible 0.55..0.9 band so the teacher always has room to adjust.
    const seed = hashString(input.assetId);
    const pronunciation = bandedScore(seed, 0);
    const fluency = bandedScore(seed, 1);
    const overall = clamp01((pronunciation + fluency) / 2);

    this.logger.debug(
      `mock speaking score: submission=${input.submissionId} module=${input.moduleId} ` +
        `asset=${input.assetId} overall=${overall.toFixed(3)}`,
    );

    return {
      overall,
      pronunciation: {
        score: pronunciation,
        comment: this.pronunciationComment(pronunciation),
      },
      fluency: {
        score: fluency,
        comment: this.fluencyComment(fluency),
      },
      summary:
        `[mock] Placeholder AI speaking assessment for ${input.moduleType}. ` +
        `A real speech-scoring provider (Open Question 6/7) will replace these ` +
        `figures; the instructor should review and override before grading.`,
      provider: 'mock-speaking-v1',
      // Transcription provider is unresolved (Open Question 7) — the
      // mock never fabricates a transcript.
      transcript: null,
    };
  }

  private pronunciationComment(score: number): string {
    if (score >= 0.8) {
      return 'Clear articulation of most phonemes; minor slips on stressed vowels.';
    }
    if (score >= 0.65) {
      return 'Generally intelligible; a few consonant clusters need work.';
    }
    return 'Several phonemes unclear; practise minimal pairs and word stress.';
  }

  private fluencyComment(score: number): string {
    if (score >= 0.8) {
      return 'Smooth pacing with natural pausing and few fillers.';
    }
    if (score >= 0.65) {
      return 'Mostly steady; some hesitation mid-sentence.';
    }
    return 'Frequent pauses and self-corrections break the flow.';
  }
}

/** Deterministic 32-bit FNV-1a hash so scores are reproducible. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Normalise to an unsigned int.
  return hash >>> 0;
}

/**
 * Map the hash to a sub-score in the 0.55..0.9 band. `offset` lets us
 * derive two distinct-but-stable values from the same seed.
 */
function bandedScore(seed: number, offset: number): number {
  const slice = ((seed >>> (offset * 8)) & 0xff) / 0xff; // 0..1
  return clamp01(0.55 + slice * 0.35);
}
