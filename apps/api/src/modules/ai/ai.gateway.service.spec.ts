/**
 * AiGatewayService unit tests.
 *
 * The tests drive the real `AiGatewayService` against a `FakeAdapter`
 * for both the primary and fallback ports. Audit + Prisma are stubbed
 * with simple jest mocks so we can assert the side-effect contract
 * (one AiCall row per intent, with the right status / template key).
 *
 * What we cover here:
 *   - Tutor pipeline: happy path, no full answer assertion (Req 13.6),
 *     similarity-rewrite path (Req 13.3), policy reason recording.
 *   - Provider fallback: primary throws AiUpstreamError → fallback
 *     serves the call; primary throws 429 → no fallback.
 *   - Rate limit enforcement: AiRateLimiterService throws → audit row
 *     with status RATE_LIMITED.
 *   - JSON-mode intents (translateWord, detectAiText, classifySpecialty)
 *     parse the structured response and survive malformed JSON.
 */

import { AiAuditService } from './ai-audit.service';
import { AiGatewayService } from './ai.gateway.service';
import { AiRateLimiterService } from './ai-rate-limiter.service';
import { FakeAdapter } from './adapters/fake.adapter';
import { AiRateLimitedError, AiUpstreamError } from './ai.errors';
import { PromptTemplateLoader } from './prompt-template.loader';
import {
  AI_CALL_STATUS,
  PROMPT_TEMPLATE_KEYS,
  TUTOR_SIMILARITY_THRESHOLD,
} from './ai.constants';

// ===================================================================
// Test helpers
// ===================================================================

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

interface BuildOpts {
  primary?: FakeAdapter;
  fallback?: FakeAdapter;
  rateLimiter?: Partial<AiRateLimiterService>;
}

function buildAuditMock() {
  const records: any[] = [];
  const audit = {
    record: jest.fn(async (row) => {
      records.push(row);
    }),
  } as unknown as AiAuditService;
  return { audit, records };
}

function buildLoader() {
  return new PromptTemplateLoader();
}

function buildLimiter(): AiRateLimiterService {
  const limiter = new AiRateLimiterService(undefined as any, undefined as any);
  limiter.resetForTesting();
  return limiter;
}

function buildGateway(opts: BuildOpts = {}) {
  const primary = opts.primary ?? new FakeAdapter({ providerName: 'fake-primary' });
  const fallback =
    opts.fallback ?? new FakeAdapter({ providerName: 'fake-fallback', modelName: 'fake-fallback' });
  const limiter = (opts.rateLimiter as AiRateLimiterService) ?? buildLimiter();
  const auditMock = buildAuditMock();
  const loader = buildLoader();
  const service = new AiGatewayService(
    loader,
    limiter as AiRateLimiterService,
    auditMock.audit,
    primary,
    fallback,
  );
  return { service, primary, fallback, audit: auditMock, limiter };
}

// ===================================================================
// Tutor pipeline
// ===================================================================

describe('AiGatewayService.tutor', () => {
  it('returns the model reply unchanged when similarity is below 0.7 and writes one OK audit row', async () => {
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: 'Think about light scattering — different wavelengths bounce differently.',
          inputTokens: 30,
          outputTokens: 18,
          latencyMs: 12,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service, audit } = buildGateway({ primary });

    const result = await service.tutor({
      userId: STUDENT_ID,
      intent: 'EXPLAIN',
      question: 'Why is the sky blue?',
      contextText: 'My essay is about the ocean.',
      locale: 'en',
    });

    expect(result.policyChecks.noFullAnswer).toBe(true);
    expect(result.policyChecks.rewroteAsHint).toBe(false);
    expect(result.policyChecks.similarity).toBeLessThan(TUTOR_SIMILARITY_THRESHOLD);
    expect(result.reply).toContain('light scattering');

    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      userId: STUDENT_ID,
      intent: 'TUTOR_EXPLAIN',
      templateKey: PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN,
      modelName: 'fake-primary',
      inputTokens: 30,
      outputTokens: 18,
      status: AI_CALL_STATUS.OK,
    });
  });

  it('rewrites the reply as a hint when similarity exceeds 0.7 (Req 13.3, 13.6)', async () => {
    const studentEssay =
      'photosynthesis converts sunlight into chemical energy stored in glucose';
    const primary = new FakeAdapter({
      responses: [
        {
          // Identical to the student's text — should trigger rewrite.
          text: studentEssay,
          inputTokens: 25,
          outputTokens: 25,
          latencyMs: 10,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service, audit } = buildGateway({ primary });

    const result = await service.tutor({
      userId: STUDENT_ID,
      intent: 'EXPLAIN',
      question: 'Help me with my essay',
      contextText: studentEssay,
      locale: 'en',
    });

    expect(result.policyChecks.noFullAnswer).toBe(false);
    expect(result.policyChecks.rewroteAsHint).toBe(true);
    expect(result.policyChecks.similarity).toBeGreaterThanOrEqual(0.7);
    expect(result.reply).toMatch(/Hint:/);
    expect(result.reply).not.toBe(studentEssay);

    expect(audit.records[0]).toMatchObject({
      status: AI_CALL_STATUS.POLICY_BLOCKED,
      errorMsg: expect.stringContaining('similarity'),
    });
  });

  it('appends the hard-rules suffix to the system prompt sent to the adapter', async () => {
    const primary = new FakeAdapter();
    const { service } = buildGateway({ primary });

    await service.tutor({
      userId: STUDENT_ID,
      intent: 'EXPLAIN',
      question: 'Why is the sky blue?',
      locale: 'en',
    });

    expect(primary.lastRequest?.system).toContain('HARD RULES');
    expect(primary.lastRequest?.system).toContain(
      'NEVER write a complete sentence',
    );
  });

  it('rejects empty questions before invoking the adapter', async () => {
    const primary = new FakeAdapter();
    const { service } = buildGateway({ primary });
    await expect(
      service.tutor({
        userId: STUDENT_ID,
        intent: 'EXPLAIN',
        question: '   ',
        locale: 'en',
      }),
    ).rejects.toThrow('non-empty');
    expect(primary.callCount).toBe(0);
  });
});

// ===================================================================
// Provider fallback
// ===================================================================

describe('AiGatewayService — provider fallback', () => {
  it('falls back to the secondary provider when the primary throws AiUpstreamError', async () => {
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      alwaysFail: true,
    });
    const fallback = new FakeAdapter({
      providerName: 'fake-fallback',
      modelName: 'fake-fallback',
      responses: [
        {
          text: 'Fallback served the call',
          inputTokens: 10,
          outputTokens: 5,
          latencyMs: 7,
          modelName: 'fake-fallback',
        },
      ],
    });
    const { service, audit } = buildGateway({ primary, fallback });

    const result = await service.tutor({
      userId: STUDENT_ID,
      intent: 'EXPLAIN',
      question: 'What is gravity?',
      locale: 'en',
    });

    expect(result.reply).toContain('Fallback served the call');
    expect(primary.callCount).toBe(1);
    expect(fallback.callCount).toBe(1);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0].modelName).toBe('fake-fallback');
  });

  it('does NOT fall back on upstream rate-limit errors', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    // Override the responder to throw a 429 explicitly.
    primary.complete = jest
      .fn()
      .mockRejectedValue(new AiRateLimitedError(30_000, 'upstream', '429'));
    const fallback = new FakeAdapter({
      providerName: 'fake-fallback',
      modelName: 'fake-fallback',
    });
    const { service, audit } = buildGateway({ primary, fallback });

    await expect(
      service.tutor({
        userId: STUDENT_ID,
        intent: 'EXPLAIN',
        question: 'What is gravity?',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(AiRateLimitedError);

    expect(fallback.callCount).toBe(0);
    expect(audit.records[0]).toMatchObject({
      status: AI_CALL_STATUS.RATE_LIMITED,
    });
  });

  it('records an ERROR audit row when both providers fail', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary', alwaysFail: true });
    const fallback = new FakeAdapter({
      providerName: 'fake-fallback',
      alwaysFail: true,
    });
    const { service, audit } = buildGateway({ primary, fallback });

    await expect(
      service.tutor({
        userId: STUDENT_ID,
        intent: 'EXPLAIN',
        question: 'Hello',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(AiUpstreamError);

    expect(audit.records).toHaveLength(1);
    expect(audit.records[0].status).toBe(AI_CALL_STATUS.ERROR);
  });
});

// ===================================================================
// Rate limiting
// ===================================================================

describe('AiGatewayService — rate limiting', () => {
  it('throws AiRateLimitedError without calling the adapter when the limiter rejects', async () => {
    const limiter = buildLimiter();
    const failing = {
      ...limiter,
      assertWithinLimit: jest
        .fn()
        .mockRejectedValue(new AiRateLimitedError(60_000, 'local')),
    } as unknown as AiRateLimiterService;

    const primary = new FakeAdapter();
    const { service, audit } = buildGateway({
      primary,
      rateLimiter: failing,
    });

    await expect(
      service.tutor({
        userId: STUDENT_ID,
        intent: 'EXPLAIN',
        question: 'Hello',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(AiRateLimitedError);

    expect(primary.callCount).toBe(0);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0].status).toBe(AI_CALL_STATUS.RATE_LIMITED);
  });
});

// ===================================================================
// JSON-mode intents
// ===================================================================

describe('AiGatewayService.translateWord', () => {
  it('parses strict JSON output and returns translation + examples', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: JSON.stringify({
            translation: 'olma',
            partOfSpeech: 'noun',
            examples: ['Men olma yedim.'],
            note: 'fruit',
          }),
          inputTokens: 12,
          outputTokens: 18,
          latencyMs: 6,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service, audit } = buildGateway({ primary });

    const result = await service.translateWord({
      userId: STUDENT_ID,
      word: 'apple',
      contextSentence: 'I ate an apple.',
      locale: 'uz',
    });

    expect(result.translation).toBe('olma');
    expect(result.partOfSpeech).toBe('noun');
    expect(result.examples).toEqual(['Men olma yedim.']);
    expect(audit.records[0]).toMatchObject({
      intent: 'TUTOR_TRANSLATE',
      refType: 'word',
    });
  });

  it('falls back to defaults when the provider returns malformed JSON', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: 'this is not json at all',
          inputTokens: 5,
          outputTokens: 5,
          latencyMs: 3,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildGateway({ primary });
    const result = await service.translateWord({
      userId: STUDENT_ID,
      word: 'apple',
      contextSentence: '',
      locale: 'uz',
    });
    expect(result.translation).toBe('');
    expect(result.examples).toEqual([]);
  });

  it('strips Markdown code fences before parsing JSON', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: '```json\n{"translation":"olma","examples":[]}\n```',
          inputTokens: 5,
          outputTokens: 5,
          latencyMs: 3,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildGateway({ primary });
    const result = await service.translateWord({
      userId: STUDENT_ID,
      word: 'apple',
      contextSentence: '',
      locale: 'uz',
    });
    expect(result.translation).toBe('olma');
  });
});

describe('AiGatewayService.detectAiText', () => {
  it('clamps the likelihood into [0,1] and surfaces the signals', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: JSON.stringify({
            likelihood: 1.4, // adapter returned out-of-range — gateway clamps
            signals: ['perplexity-low'],
          }),
          inputTokens: 5,
          outputTokens: 5,
          latencyMs: 2,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildGateway({ primary });
    const result = await service.detectAiText({
      userId: STUDENT_ID,
      text: 'something to classify',
    });
    expect(result.likelihood).toBe(1);
    expect(result.signals).toEqual(['perplexity-low']);
  });

  it('runs without a userId (anonymous reading widget)', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: JSON.stringify({ likelihood: 0.4, signals: [] }),
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildGateway({ primary });
    await expect(
      service.detectAiText({ text: 'classify me' }),
    ).resolves.toEqual(expect.objectContaining({ likelihood: 0.4 }));
  });
});

describe('AiGatewayService.classifySpecialty', () => {
  it('returns the first known specialty when JSON parsing fails', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: 'definitely not json',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildGateway({ primary });
    const result = await service.classifySpecialty({
      userId: STUDENT_ID,
      answersJson: { q1: 'A' },
      knownSpecialties: ['math', 'biology'],
    });
    expect(result.specialtySlug).toBe('math');
    expect(result.confidence).toBe(0);
  });

  it('clamps confidence to [0,1]', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: JSON.stringify({ specialtySlug: 'biology', confidence: -5 }),
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildGateway({ primary });
    const result = await service.classifySpecialty({
      userId: STUDENT_ID,
      answersJson: {},
      knownSpecialties: ['math', 'biology'],
    });
    expect(result.specialtySlug).toBe('biology');
    expect(result.confidence).toBe(0);
  });
});

describe('AiGatewayService.precheckWritingSubmission', () => {
  it('parses the structured grading response and surfaces highlights', async () => {
    const primary = new FakeAdapter({
      responses: [
        {
          text: JSON.stringify({
            score: 0.82,
            summary: 'Strong thesis, weak transitions.',
            highlights: [
              {
                from: 0,
                to: 5,
                severity: 'warning',
                reason: 'Transition is abrupt.',
              },
            ],
          }),
          inputTokens: 50,
          outputTokens: 30,
          latencyMs: 9,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service, audit } = buildGateway({ primary });
    const result = await service.precheckWritingSubmission({
      userId: STUDENT_ID,
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      text: 'student essay text',
      rubric: 'thesis, transitions, evidence',
      language: 'en',
    });
    expect(result.score).toBeCloseTo(0.82, 2);
    expect(result.summary).toContain('Strong thesis');
    expect(result.highlights).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      intent: 'GRADE_PRECHECK',
      refType: 'submission',
    });
  });
});
