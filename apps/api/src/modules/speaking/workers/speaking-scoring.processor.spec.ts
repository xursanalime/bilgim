import { NotFoundException } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  SpeakingScoreOutcome,
  SpeakingScoringService,
} from '../speaking-scoring.service';
import { type SpeakingScoringJob } from '../speaking-scoring.types';
import { SpeakingScoringProcessor } from './speaking-scoring.processor';

/**
 * Unit tests for SpeakingScoringProcessor (Task 4.2, Req 7.4).
 *
 * The processor is a thin BullMQ adapter over
 * `SpeakingScoringService.score`. We assert it forwards the
 * submissionId, maps the service outcome to a job action, acks the
 * not-found path, and re-throws other errors so BullMQ retries.
 */
describe('SpeakingScoringProcessor', () => {
  let processor: SpeakingScoringProcessor;
  let scoringService: jest.Mocked<
    Pick<SpeakingScoringService, 'score' | 'markScoringFailed'>
  >;

  const SUBMISSION_ID = '66666666-6666-6666-6666-666666666666';

  function job(
    data: Partial<SpeakingScoringJob>,
    opts: { attemptsMade?: number; attempts?: number } = {},
  ): Job<SpeakingScoringJob> {
    const { attemptsMade = 0, attempts = 3 } = opts;
    return {
      id: 'job-1',
      data,
      attemptsMade,
      opts: { attempts },
    } as unknown as Job<SpeakingScoringJob>;
  }

  function outcome(over: Partial<SpeakingScoreOutcome> = {}): SpeakingScoreOutcome {
    return {
      submissionId: SUBMISSION_ID,
      feedbackCreated: true,
      skipped: false,
      score: 80,
      ...over,
    };
  }

  beforeEach(() => {
    scoringService = {
      score: jest.fn().mockResolvedValue(outcome()),
      markScoringFailed: jest.fn().mockResolvedValue(
        outcome({ feedbackCreated: true, skipped: false, score: null }),
      ),
    };
    processor = new SpeakingScoringProcessor(
      scoringService as unknown as SpeakingScoringService,
    );
  });

  it('scores the submission and reports a processed action', async () => {
    const result = await processor.process(
      job({ submissionId: SUBMISSION_ID }),
    );
    expect(scoringService.score).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(result).toMatchObject({
      submissionId: SUBMISSION_ID,
      action: 'processed',
      feedbackCreated: true,
      score: 80,
    });
  });

  it('reports a skipped action on the idempotent path', async () => {
    scoringService.score.mockResolvedValueOnce(
      outcome({ feedbackCreated: false, skipped: true, score: null }),
    );
    const result = await processor.process(
      job({ submissionId: SUBMISSION_ID }),
    );
    expect(result.action).toBe('skipped');
  });

  it('acks (does not throw) when the submission was deleted', async () => {
    scoringService.score.mockRejectedValueOnce(new NotFoundException());
    const result = await processor.process(
      job({ submissionId: SUBMISSION_ID }),
    );
    expect(result.action).toBe('not_found');
  });

  it('skips a malformed job with no submissionId', async () => {
    const result = await processor.process(job({}));
    expect(scoringService.score).not.toHaveBeenCalled();
    expect(result.action).toBe('skipped');
  });

  it('re-throws non-404 errors so BullMQ retries', async () => {
    scoringService.score.mockRejectedValueOnce(new Error('provider down'));
    await expect(
      processor.process(job({ submissionId: SUBMISSION_ID }, { attemptsMade: 0, attempts: 3 })),
    ).rejects.toThrow('provider down');
  });

  it('does NOT mark the submission failed while retries remain', async () => {
    scoringService.score.mockRejectedValueOnce(new Error('transient'));
    await expect(
      processor.process(
        job({ submissionId: SUBMISSION_ID }, { attemptsMade: 0, attempts: 3 }),
      ),
    ).rejects.toThrow('transient');
    expect(scoringService.markScoringFailed).not.toHaveBeenCalled();
  });

  it('marks the submission failed + notifies on the FINAL failed attempt (Req 7.5)', async () => {
    scoringService.score.mockRejectedValueOnce(new Error('provider gone'));
    await expect(
      processor.process(
        // attemptsMade=2 with attempts=3 → this is the last attempt.
        job({ submissionId: SUBMISSION_ID }, { attemptsMade: 2, attempts: 3 }),
      ),
    ).rejects.toThrow('provider gone');
    expect(scoringService.markScoringFailed).toHaveBeenCalledTimes(1);
    expect(scoringService.markScoringFailed).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'provider gone',
    );
  });

  it('still re-throws if marking the failure itself fails on the final attempt', async () => {
    scoringService.score.mockRejectedValueOnce(new Error('provider gone'));
    scoringService.markScoringFailed.mockRejectedValueOnce(
      new Error('outbox write failed'),
    );
    await expect(
      processor.process(
        job({ submissionId: SUBMISSION_ID }, { attemptsMade: 2, attempts: 3 }),
      ),
    ).rejects.toThrow('provider gone');
  });

  it('does not mark failed on the not-found path', async () => {
    scoringService.score.mockRejectedValueOnce(new NotFoundException());
    const result = await processor.process(
      job({ submissionId: SUBMISSION_ID }, { attemptsMade: 2, attempts: 3 }),
    );
    expect(result.action).toBe('not_found');
    expect(scoringService.markScoringFailed).not.toHaveBeenCalled();
  });
});
