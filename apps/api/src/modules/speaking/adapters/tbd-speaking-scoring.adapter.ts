import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import {
  SpeakingScoreInput,
  SpeakingScoreResult,
  SpeakingScoringPort,
} from '../speaking-scoring.types';

/**
 * TbdSpeakingScoringAdapter — placeholder for the REAL speech-scoring
 * provider binding of `SPEAKING_SCORING_PORT`.
 *
 * The transcription + pronunciation/fluency scoring engine is an OPEN
 * QUESTION (Open Question 6: which speaking-scoring engine; Open
 * Question 7: which transcription provider). Until that decision is
 * made we deliberately DO NOT fake a passing external call — this
 * adapter throws a `ServiceUnavailableException` with a stable
 * `SPEAKING_SCORING_PROVIDER_TBD` code so a misconfigured environment
 * (`SPEAKING_SCORING_REAL=true` before the provider is wired) fails
 * loudly and the scoring job is retried / surfaced for manual review
 * (Req 7.5, Task 4.3) rather than silently producing meaningless data.
 *
 * When the provider is chosen, replace the body of `scoreAudio` with the
 * real integration (fetch the AUDIO MediaAsset → transcribe → score) and
 * return a populated `SpeakingScoreResult` (including the transcript).
 */
@Injectable()
export class TbdSpeakingScoringAdapter implements SpeakingScoringPort {
  private readonly logger = new Logger(TbdSpeakingScoringAdapter.name);

  async scoreAudio(input: SpeakingScoreInput): Promise<SpeakingScoreResult> {
    this.logger.error(
      `Real speaking-scoring provider is not configured (Open Question 6/7). ` +
        `Refusing to score submission ${input.submissionId} (asset ${input.assetId}) ` +
        `without a real transcription/scoring engine.`,
    );
    throw new ServiceUnavailableException({
      code: 'SPEAKING_SCORING_PROVIDER_TBD',
      message:
        'The speaking-scoring provider has not been selected yet (Open Question 6/7). ' +
        'No score was produced; the submission requires manual instructor review.',
    });
  }
}
