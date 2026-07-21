import { Job } from 'bullmq';

import { AiGradingService, PrecheckResult } from '../ai-grading.service';
import {
  AI_GRADING_JOB_NAME,
  AiGradingJob,
  AiGradingProcessor,
} from './ai-grading.processor';

const SUBMISSION_ID = 'sub-1';
const ASSIGNMENT_ID = 'asn-1';
const STUDENT_ID = 'stu-1';

function buildJob(overrides: Partial<AiGradingJob> = {}): Job<AiGradingJob> {
  const data: AiGradingJob = {
    submissionId: SUBMISSION_ID,
    assignmentId: ASSIGNMENT_ID,
    studentId: STUDENT_ID,
    modules: [
      {
        type: 'WRITING' as any,
        configJson: {},
        answer: { text: 'hello' },
      },
    ],
    idempotencyKey: `ai-precheck:${SUBMISSION_ID}`,
    ...overrides,
  };
  return {
    id: 'job-1',
    name: AI_GRADING_JOB_NAME,
    data,
  } as unknown as Job<AiGradingJob>;
}

function buildPrecheckResult(
  overrides: Partial<PrecheckResult> = {},
): PrecheckResult {
  return {
    submissionId: SUBMISSION_ID,
    feedbackCreated: true,
    skipped: false,
    aiLikelihood: 0.3,
    aiFlagged: false,
    moduleCount: 1,
    aiCallsRecorded: 2,
    ...overrides,
  };
}

/**
 * Unit tests for AiGradingProcessor — Task 18.2, Req 12.3, 12.4, 13.7.
 *
 * Coverage:
 *   - happy path: enqueue → process moves SUBMITTED → IN_REVIEW and
 *     reports a `processed` action with the precheck stats.
 *   - idempotent re-process: the underlying service returns
 *     `{ skipped: true }` and the worker reports `action: 'skipped'`
 *     without re-throwing (so BullMQ acks the duplicate job).
 *   - missing submissionId: SKIPPED so BullMQ does not retry forever.
 *   - 404 from the service: SKIPPED.
 *   - other errors: re-thrown so BullMQ retries with backoff.
 */
describe('AiGradingProcessor', () => {
  let aiGradingService: jest.Mocked<AiGradingService>;
  let processor: AiGradingProcessor;

  beforeEach(() => {
    aiGradingService = {
      precheck: jest.fn(),
    } as unknown as jest.Mocked<AiGradingService>;
    processor = new AiGradingProcessor(aiGradingService);
  });

  it('runs the precheck and reports a `processed` action on the happy path', async () => {
    aiGradingService.precheck.mockResolvedValue(buildPrecheckResult());
    const result = await processor.process(buildJob());

    expect(aiGradingService.precheck).toHaveBeenCalledWith(SUBMISSION_ID);
    expect(result).toEqual({
      submissionId: SUBMISSION_ID,
      action: 'processed',
      feedbackCreated: true,
      aiLikelihood: 0.3,
      aiFlagged: false,
      moduleCount: 1,
    });
  });

  it('reports a `skipped` action on idempotent re-process — no re-throw', async () => {
    aiGradingService.precheck.mockResolvedValue(
      buildPrecheckResult({
        feedbackCreated: false,
        skipped: true,
        aiCallsRecorded: 0,
      }),
    );

    const result = await processor.process(buildJob());

    expect(result.action).toBe('skipped');
    expect(result.feedbackCreated).toBe(false);
  });

  it('reports `not_found` when the service raises a 404 (submission deleted)', async () => {
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    aiGradingService.precheck.mockRejectedValueOnce(notFound);

    const result = await processor.process(buildJob());

    expect(result.action).toBe('not_found');
    expect(result.submissionId).toBe(SUBMISSION_ID);
  });

  it('re-throws transient errors so BullMQ retries with backoff', async () => {
    aiGradingService.precheck.mockRejectedValueOnce(
      new Error('postgres connection refused'),
    );

    await expect(processor.process(buildJob())).rejects.toThrow(
      /postgres connection refused/,
    );
  });

  it('skips jobs without a submissionId rather than retrying forever', async () => {
    const job = buildJob({ submissionId: '' as any });
    const result = await processor.process(job);

    expect(aiGradingService.precheck).not.toHaveBeenCalled();
    expect(result.action).toBe('skipped');
  });

  it('idempotency contract — calling the worker twice for the same job hits the service twice but only one call writes feedback', async () => {
    aiGradingService.precheck
      .mockResolvedValueOnce(buildPrecheckResult({ feedbackCreated: true }))
      .mockResolvedValueOnce(
        buildPrecheckResult({
          feedbackCreated: false,
          skipped: true,
          aiCallsRecorded: 0,
        }),
      );

    const first = await processor.process(buildJob());
    const second = await processor.process(buildJob());

    expect(first.feedbackCreated).toBe(true);
    expect(first.action).toBe('processed');
    expect(second.feedbackCreated).toBe(false);
    expect(second.action).toBe('skipped');
    expect(aiGradingService.precheck).toHaveBeenCalledTimes(2);
  });
});
