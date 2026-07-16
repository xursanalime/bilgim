import { AiIntent, HomeworkModuleType } from '@prisma/client';

import {
  AI_FEEDBACK_AUTHOR_TYPE,
  AI_LIKELIHOOD_FLAG_THRESHOLD,
  AiGradingPort,
  AiGradingService,
  ModuleGradeInput,
  ModuleGradeResult,
  AiTextDetectionResult,
  MockAiAdapter,
} from './ai-grading.service';

const SUBMISSION_ID = 'sub-1';
const ASSIGNMENT_ID = 'asn-1';
const STUDENT_ID = 'stu-1';
const TEACHER_ID = 'tea-1';
const TOTAL_POINTS = 100;

/**
 * In-memory FakeAdapter — drives the per-module grading + AI text
 * detection paths through `AiGradingService` without a network call.
 *
 * Uses counters so tests can assert how many times each method was
 * invoked (useful for the idempotency assertion).
 */
class FakeAdapter implements AiGradingPort {
  gradeCalls = 0;
  detectCalls = 0;

  constructor(
    private readonly perModule: Map<HomeworkModuleType, ModuleGradeResult>,
    private readonly detection: AiTextDetectionResult,
  ) {}

  async gradeModule(input: ModuleGradeInput): Promise<ModuleGradeResult> {
    this.gradeCalls += 1;
    const stub = this.perModule.get(input.type);
    if (!stub) {
      throw new Error(`FakeAdapter: no stub for module type ${input.type}`);
    }
    return { ...stub, moduleId: input.moduleId, type: input.type };
  }

  async detectAiText(input: {
    text: string;
  }): Promise<AiTextDetectionResult> {
    this.detectCalls += 1;
    return { ...this.detection };
  }
}

/**
 * In-memory Prisma stand-in that records inserts and lets the test
 * inspect what would have been written to the DB. The schema is
 * intentionally minimal — only the columns AiGradingService touches.
 */
function buildPrismaStub(initial: {
  submission: any;
  assignmentModules: any[];
  feedbackForSubmission?: any;
}) {
  const state = {
    submission: { ...initial.submission },
    assignmentModules: [...initial.assignmentModules],
    feedbacks: initial.feedbackForSubmission
      ? [initial.feedbackForSubmission]
      : ([] as any[]),
    aiCalls: [] as any[],
  };

  const submissionDelegate = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id !== state.submission.id) return null;
      const modules = state.assignmentModules;
      return {
        ...state.submission,
        assignment: {
          id: ASSIGNMENT_ID,
          totalPoints: TOTAL_POINTS,
          modules,
        },
      };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (
        where.id === state.submission.id &&
        (where.status === undefined ||
          state.submission.status === where.status)
      ) {
        state.submission = { ...state.submission, ...data };
        return { count: 1 };
      }
      return { count: 0 };
    }),
  };

  const feedbackDelegate = {
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        state.feedbacks.find(
          (f) =>
            f.submissionId === where.submissionId &&
            f.authorType === where.authorType,
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `fb-${state.feedbacks.length + 1}`, ...data };
      state.feedbacks.push(row);
      return row;
    }),
  };

  const aiCallDelegate = {
    createMany: jest.fn(async ({ data }: any) => {
      for (const row of data) state.aiCalls.push(row);
      return { count: data.length };
    }),
  };

  const tx = {
    submission: submissionDelegate,
    feedback: feedbackDelegate,
    aiCall: aiCallDelegate,
  };

  const prisma = {
    submission: submissionDelegate,
    feedback: feedbackDelegate,
    aiCall: aiCallDelegate,
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  return { prisma, state };
}

function buildSuccessResult(
  type: HomeworkModuleType,
  score: number,
): ModuleGradeResult {
  return {
    moduleId: 'placeholder',
    type,
    score,
    comment: `mock-${type}`,
    usage: {
      modelName: 'fake-grader',
      templateKey: `${type.toLowerCase()}.precheck.v1`,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.0001,
      latencyMs: 12,
      status: 'OK',
    },
  };
}

function buildDetection(likelihood: number): AiTextDetectionResult {
  return {
    likelihood,
    signals: ['fake-signal'],
    usage: {
      modelName: 'fake-detector',
      templateKey: 'ai_text_detect.v1',
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0.00005,
      latencyMs: 8,
      status: 'OK',
    },
  };
}

// =====================================================================
// AiGradingService — happy path + aggregator + threshold
// =====================================================================

describe('AiGradingService', () => {
  describe('precheck — happy path', () => {
    it('grades each module, aggregates the score, writes Feedback + AiCall, and flips status to IN_REVIEW', async () => {
      const adapter = new FakeAdapter(
        new Map<HomeworkModuleType, ModuleGradeResult>([
          ['WRITING', buildSuccessResult('WRITING', 0.8)],
          ['READING', buildSuccessResult('READING', 0.6)],
        ]),
        buildDetection(0.3),
      );

      const { prisma, state } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'SUBMITTED',
          answersJson: {
            'mod-1': { text: 'A long writing answer.' },
            'mod-2': { text: 'Reading response.' },
          },
          aiFlagged: false,
          aiLikelihood: null,
        },
        assignmentModules: [
          {
            id: 'mod-1',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 60,
          },
          {
            id: 'mod-2',
            assignmentId: ASSIGNMENT_ID,
            type: 'READING',
            order: 1,
            configJson: {},
            weight: 40,
          },
        ],
      });

      const submissionRepository = {} as any;
      const service = new AiGradingService(
        prisma as any,
        submissionRepository,
        adapter,
      );

      const result = await service.precheck(SUBMISSION_ID);

      expect(result.feedbackCreated).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.moduleCount).toBe(2);
      expect(result.aiFlagged).toBe(false);
      expect(result.aiLikelihood).toBeCloseTo(0.3);

      // Status flipped SUBMITTED → IN_REVIEW.
      expect(state.submission.status).toBe('IN_REVIEW');
      expect(state.submission.aiLikelihood).toBeCloseTo(0.3);
      expect(state.submission.aiFlagged).toBe(false);

      // Exactly one Feedback row, authorType = 'AI', payload aggregates
      // both module results.
      expect(state.feedbacks).toHaveLength(1);
      const feedback = state.feedbacks[0];
      expect(feedback.authorType).toBe(AI_FEEDBACK_AUTHOR_TYPE);
      expect(feedback.authorId).toBeNull();
      expect(feedback.payload.idempotencyTag).toBe(
        `ai-precheck:${SUBMISSION_ID}`,
      );
      expect(feedback.payload.moduleResults).toHaveLength(2);
      expect(feedback.payload.overallSuggestion.suggestedScore).toBe(
        Math.round(((0.8 + 0.6) / 2) * TOTAL_POINTS),
      );

      // One AiCall row per gradeModule + one for detectAiText.
      expect(state.aiCalls).toHaveLength(3);
      const intents = state.aiCalls.map((c) => c.intent);
      expect(intents.filter((i) => i === AiIntent.GRADE_PRECHECK)).toHaveLength(
        2,
      );
      expect(intents.filter((i) => i === AiIntent.AI_TEXT_DETECT)).toHaveLength(
        1,
      );
    });

    it('flags the submission when aiLikelihood crosses the 0.85 threshold', async () => {
      const adapter = new FakeAdapter(
        new Map<HomeworkModuleType, ModuleGradeResult>([
          ['WRITING', buildSuccessResult('WRITING', 0.5)],
        ]),
        buildDetection(AI_LIKELIHOOD_FLAG_THRESHOLD + 0.01),
      );

      const { prisma, state } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'SUBMITTED',
          answersJson: {
            'mod-1': { text: 'Suspicious AI-looking text.' },
          },
          aiFlagged: false,
          aiLikelihood: null,
        },
        assignmentModules: [
          {
            id: 'mod-1',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 100,
          },
        ],
      });

      const service = new AiGradingService(
        prisma as any,
        {} as any,
        adapter,
      );
      const result = await service.precheck(SUBMISSION_ID);

      expect(result.aiFlagged).toBe(true);
      expect(result.aiLikelihood).toBeGreaterThanOrEqual(
        AI_LIKELIHOOD_FLAG_THRESHOLD,
      );
      expect(state.submission.aiFlagged).toBe(true);
    });

    it('does NOT flag when aiLikelihood is exactly below the 0.85 threshold', async () => {
      const adapter = new FakeAdapter(
        new Map<HomeworkModuleType, ModuleGradeResult>([
          ['WRITING', buildSuccessResult('WRITING', 0.5)],
        ]),
        buildDetection(AI_LIKELIHOOD_FLAG_THRESHOLD - 0.01),
      );

      const { prisma, state } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'SUBMITTED',
          answersJson: { 'mod-1': { text: 'human written' } },
          aiFlagged: false,
          aiLikelihood: null,
        },
        assignmentModules: [
          {
            id: 'mod-1',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 100,
          },
        ],
      });

      const service = new AiGradingService(
        prisma as any,
        {} as any,
        adapter,
      );
      const result = await service.precheck(SUBMISSION_ID);

      expect(result.aiFlagged).toBe(false);
      expect(state.submission.aiFlagged).toBe(false);
    });
  });

  // ===================================================================
  // Idempotency
  // ===================================================================

  describe('precheck — idempotency', () => {
    it('returns skipped=true on a re-call for a submission that already has AI feedback', async () => {
      const adapter = new FakeAdapter(
        new Map([['WRITING', buildSuccessResult('WRITING', 0.7)]]),
        buildDetection(0.2),
      );

      const { prisma, state } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'IN_REVIEW',
          answersJson: { 'mod-1': { text: 'text' } },
          aiFlagged: false,
          aiLikelihood: 0.2,
        },
        assignmentModules: [
          {
            id: 'mod-1',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 100,
          },
        ],
        feedbackForSubmission: {
          id: 'fb-existing',
          submissionId: SUBMISSION_ID,
          authorType: AI_FEEDBACK_AUTHOR_TYPE,
          payload: {},
          isFinal: false,
        },
      });

      const service = new AiGradingService(
        prisma as any,
        {} as any,
        adapter,
      );
      const result = await service.precheck(SUBMISSION_ID);

      expect(result.skipped).toBe(true);
      expect(result.feedbackCreated).toBe(false);
      // Adapter must NOT be invoked on the idempotent path.
      expect(adapter.gradeCalls).toBe(0);
      expect(adapter.detectCalls).toBe(0);
      // No new AiCall rows.
      expect(state.aiCalls).toHaveLength(0);
    });

    it('returns skipped=true when the submission is no longer SUBMITTED', async () => {
      const adapter = new FakeAdapter(
        new Map([['WRITING', buildSuccessResult('WRITING', 0.7)]]),
        buildDetection(0.2),
      );

      const { prisma } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'GRADED', // already past precheck
          answersJson: { 'mod-1': { text: 't' } },
          aiFlagged: false,
          aiLikelihood: null,
        },
        assignmentModules: [
          {
            id: 'mod-1',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 100,
          },
        ],
      });

      const service = new AiGradingService(
        prisma as any,
        {} as any,
        adapter,
      );
      const result = await service.precheck(SUBMISSION_ID);

      expect(result.skipped).toBe(true);
      expect(adapter.gradeCalls).toBe(0);
    });

    it('returns skipped=true when the submission does not exist', async () => {
      const adapter = new FakeAdapter(new Map(), buildDetection(0));
      const prismaStub = {
        submission: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        feedback: { findFirst: jest.fn(), create: jest.fn() },
        aiCall: { createMany: jest.fn() },
        $transaction: jest.fn(async (cb: any) => cb({})),
      } as any;

      const service = new AiGradingService(prismaStub, {} as any, adapter);
      const result = await service.precheck('does-not-exist');

      expect(result.skipped).toBe(true);
      expect(adapter.gradeCalls).toBe(0);
    });
  });

  // ===================================================================
  // Aggregator edge cases
  // ===================================================================

  describe('precheck — aggregator', () => {
    it('caps suggestedScore between 0 and totalPoints', async () => {
      const adapter = new FakeAdapter(
        new Map<HomeworkModuleType, ModuleGradeResult>([
          // Adapter returns an out-of-range score; aggregator clamps it.
          ['WRITING', { ...buildSuccessResult('WRITING', 1.5) }],
          ['READING', { ...buildSuccessResult('READING', -0.3) }],
        ]),
        buildDetection(0.1),
      );

      const { prisma, state } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'SUBMITTED',
          answersJson: { 'a': { text: 'x' }, 'b': { text: 'y' } },
          aiFlagged: false,
          aiLikelihood: null,
        },
        assignmentModules: [
          {
            id: 'a',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 50,
          },
          {
            id: 'b',
            assignmentId: ASSIGNMENT_ID,
            type: 'READING',
            order: 1,
            configJson: {},
            weight: 50,
          },
        ],
      });

      const service = new AiGradingService(
        prisma as any,
        {} as any,
        adapter,
      );
      await service.precheck(SUBMISSION_ID);

      const feedback = state.feedbacks[0];
      // 1.5 → 1, -0.3 → 0; mean = 0.5 → 50/100.
      expect(feedback.payload.overallSuggestion.suggestedScore).toBe(50);
    });

    it('continues when one module adapter call fails — partial results still land', async () => {
      const adapter: AiGradingPort = {
        gradeModule: jest
          .fn()
          .mockImplementationOnce(async (i) => buildSuccessResult(i.type, 0.7))
          .mockImplementationOnce(async () => {
            throw new Error('adapter exploded');
          }),
        detectAiText: jest.fn().mockResolvedValue(buildDetection(0.1)),
      };

      const { prisma, state } = buildPrismaStub({
        submission: {
          id: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          status: 'SUBMITTED',
          answersJson: { a: { text: 'x' }, b: { text: 'y' } },
          aiFlagged: false,
          aiLikelihood: null,
        },
        assignmentModules: [
          {
            id: 'a',
            assignmentId: ASSIGNMENT_ID,
            type: 'WRITING',
            order: 0,
            configJson: {},
            weight: 100,
          },
          {
            id: 'b',
            assignmentId: ASSIGNMENT_ID,
            type: 'READING',
            order: 1,
            configJson: {},
            weight: 100,
          },
        ],
      });

      const service = new AiGradingService(
        prisma as any,
        {} as any,
        adapter,
      );
      const result = await service.precheck(SUBMISSION_ID);

      expect(result.feedbackCreated).toBe(true);
      // 1 successful module + 1 failed grading + 1 detection = 3 AiCall rows.
      expect(state.aiCalls).toHaveLength(3);
      const errored = state.aiCalls.filter((c) => c.status === 'ERROR');
      expect(errored).toHaveLength(1);
      expect(errored[0].errorMsg).toMatch(/adapter exploded/);
    });
  });
});

// =====================================================================
// MockAiAdapter — deterministic output
// =====================================================================

describe('MockAiAdapter', () => {
  const adapter = new MockAiAdapter();

  it('produces a deterministic detection score that is stable across calls', async () => {
    const a = await adapter.detectAiText({ text: 'a'.repeat(500) });
    const b = await adapter.detectAiText({ text: 'a'.repeat(500) });
    expect(a.likelihood).toBe(b.likelihood);
    expect(a.likelihood).toBeGreaterThan(0);
    expect(a.likelihood).toBeLessThanOrEqual(1);
  });

  it('returns 0 likelihood for an empty body', async () => {
    const r = await adapter.detectAiText({ text: '' });
    expect(r.likelihood).toBe(0);
  });

  it('grades empty answers with a low placeholder score', async () => {
    const r = await adapter.gradeModule({
      moduleId: 'm',
      type: 'WRITING',
      configJson: {},
      answer: '',
      weight: 100,
    });
    expect(r.score).toBeLessThan(0.5);
    expect(r.usage.modelName).toBe('mock-grading-v1');
  });

  it('grades long answers higher, capped at 0.92', async () => {
    const r = await adapter.gradeModule({
      moduleId: 'm',
      type: 'WRITING',
      configJson: {},
      answer: { text: 'word '.repeat(2000) },
      weight: 100,
    });
    expect(r.score).toBeLessThanOrEqual(0.92);
    expect(r.score).toBeGreaterThan(0.5);
  });
});

// =====================================================================
// AiGradingService — runtime registry integration (Task 18.3)
// =====================================================================

describe('AiGradingService — runtime registry integration (Task 18.3)', () => {
  it('passes the WritingRuntime aiPromptInputs to the adapter as `promptInputs`', async () => {
    // We need to import the registry + writing runtime here so the
    // existing top-level imports stay focused on the legacy path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HomeworkModuleRuntimeRegistry } = require('./runtimes/registry');

    const captured: ModuleGradeInput[] = [];
    const adapter: AiGradingPort = {
      gradeModule: async (input) => {
        captured.push(input);
        return {
          moduleId: input.moduleId,
          type: input.type,
          score: 0.5,
          comment: 'ok',
          usage: {
            modelName: 'test',
            templateKey: 'writing.precheck.v1',
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            latencyMs: 1,
            status: 'OK' as const,
          },
        };
      },
      detectAiText: async () => ({
        likelihood: 0.1,
        signals: [],
        usage: {
          modelName: 'test',
          templateKey: 'ai_text_detect.v1',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          latencyMs: 1,
          status: 'OK' as const,
        },
      }),
    };

    const { prisma } = buildPrismaStub({
      submission: {
        id: SUBMISSION_ID,
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        status: 'SUBMITTED',
        answersJson: {
          'mod-w': { text: 'one two three four five six seven eight' },
        },
        aiFlagged: false,
        aiLikelihood: null,
      },
      assignmentModules: [
        {
          id: 'mod-w',
          assignmentId: ASSIGNMENT_ID,
          type: 'WRITING' as HomeworkModuleType,
          order: 0,
          configJson: {
            prompt: 'Write 5 to 20 words',
            minWords: 5,
            maxWords: 20,
            rubric: { criteria: [{ name: 'Grammar', weight: 100 }] },
          },
          weight: 100,
        },
      ],
    });

    const service = new AiGradingService(
      prisma as any,
      {} as any,
      adapter,
      new HomeworkModuleRuntimeRegistry(),
    );

    await service.precheck(SUBMISSION_ID);

    expect(captured).toHaveLength(1);
    const writingInput = captured[0]!;
    expect(writingInput.promptInputs).toBeDefined();
    expect(writingInput.promptInputs!.moduleType).toBe('WRITING');
    expect(writingInput.promptInputs!.studentText).toBe(
      'one two three four five six seven eight',
    );
    expect(writingInput.promptInputs!.rubric).toEqual([
      { name: 'Grammar', weight: 100 },
    ]);
    expect(writingInput.promptInputs!.metadata).toMatchObject({
      prompt: 'Write 5 to 20 words',
      minWords: 5,
      maxWords: 20,
      wordCount: 8,
    });
  });

  it('omits promptInputs when no runtime is registered for the module type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HomeworkModuleRuntimeRegistry } = require('./runtimes/registry');

    const captured: ModuleGradeInput[] = [];
    const adapter: AiGradingPort = {
      gradeModule: async (input) => {
        captured.push(input);
        return {
          moduleId: input.moduleId,
          type: input.type,
          score: 0.5,
          comment: 'ok',
          usage: {
            modelName: 'test',
            templateKey: 'foo.v1',
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            latencyMs: 1,
            status: 'OK' as const,
          },
        };
      },
      detectAiText: async () => ({
        likelihood: 0,
        signals: [],
        usage: {
          modelName: 't',
          templateKey: 't',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          latencyMs: 1,
          status: 'OK' as const,
        },
      }),
    };

    const { prisma } = buildPrismaStub({
      submission: {
        id: SUBMISSION_ID,
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        status: 'SUBMITTED',
        answersJson: { 'mod-g': { value: 'noun' } },
        aiFlagged: false,
        aiLikelihood: null,
      },
      assignmentModules: [
        {
          id: 'mod-g',
          assignmentId: ASSIGNMENT_ID,
          type: 'GRAMMAR' as HomeworkModuleType,
          order: 0,
          configJson: { question: 'Identify the noun' },
          weight: 100,
        },
      ],
    });

    const service = new AiGradingService(
      prisma as any,
      {} as any,
      adapter,
      new HomeworkModuleRuntimeRegistry(),
    );

    await service.precheck(SUBMISSION_ID);

    expect(captured).toHaveLength(1);
    const grammarInput = captured[0]!;
    expect(grammarInput.promptInputs).toBeUndefined();
    // configJson + answer still flow through unchanged for opaque modules.
    expect(grammarInput.configJson).toEqual({ question: 'Identify the noun' });
    expect(grammarInput.answer).toEqual({ value: 'noun' });
  });
});

// =====================================================================
// AiGradingService — English-teaching feedback dimensions (Req 9.1–9.4)
// =====================================================================

describe('AiGradingService — English-teaching feedback dimensions (Req 9.1–9.4)', () => {
  /**
   * Drives the REAL MockAiAdapter through the service so we assert the
   * end-to-end Feedback payload shape (the FakeAdapter above does not
   * synthesise dimensions). The mock is the production default binding
   * until the Claude grader lands, so this is the behaviour learners see.
   */
  function runWith(moduleType: HomeworkModuleType, detectionLength: number) {
    const adapter = new MockAiAdapter();
    const answerText =
      detectionLength > 0 ? 'x'.repeat(detectionLength) : 'short answer';
    const { prisma, state } = buildPrismaStub({
      submission: {
        id: SUBMISSION_ID,
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        status: 'SUBMITTED',
        answersJson: { 'mod-1': { text: answerText } },
        aiFlagged: false,
        aiLikelihood: null,
      },
      assignmentModules: [
        {
          id: 'mod-1',
          assignmentId: ASSIGNMENT_ID,
          type: moduleType,
          order: 0,
          configJson: {},
          weight: 100,
        },
      ],
    });
    const service = new AiGradingService(prisma as any, {} as any, adapter);
    return { service, state };
  }

  it.each(['WRITING', 'GRAMMAR'] as HomeworkModuleType[])(
    'produces grammar, vocabulary, and coherence dimensions for %s submissions',
    async (moduleType) => {
      const { service, state } = runWith(moduleType, 300);

      const result = await service.precheck(SUBMISSION_ID);
      expect(result.feedbackCreated).toBe(true);

      const feedback = state.feedbacks[0];
      const moduleResult = feedback.payload.moduleResults[0];
      expect(moduleResult.type).toBe(moduleType);
      expect(moduleResult.dimensions).toBeDefined();
      expect(Object.keys(moduleResult.dimensions)).toEqual(
        expect.arrayContaining(['grammar', 'vocabulary', 'coherence']),
      );
      for (const skill of ['grammar', 'vocabulary', 'coherence'] as const) {
        expect(typeof moduleResult.dimensions[skill].score).toBe('number');
        expect(moduleResult.dimensions[skill].score).toBeGreaterThanOrEqual(0);
        expect(moduleResult.dimensions[skill].score).toBeLessThanOrEqual(1);
        expect(typeof moduleResult.dimensions[skill].comment).toBe('string');
        expect(moduleResult.dimensions[skill].comment.length).toBeGreaterThan(
          0,
        );
      }
    },
  );

  it('omits the dimension breakdown for non-WRITING/GRAMMAR skills (e.g. READING)', async () => {
    const { service, state } = runWith('READING', 300);

    await service.precheck(SUBMISSION_ID);

    const moduleResult = state.feedbacks[0].payload.moduleResults[0];
    expect(moduleResult.type).toBe('READING');
    expect(moduleResult.dimensions).toBeUndefined();
  });

  it('transitions the submission to IN_REVIEW (not GRADED) after grading (Req 9.3)', async () => {
    const { service, state } = runWith('WRITING', 300);

    await service.precheck(SUBMISSION_ID);

    expect(state.submission.status).toBe('IN_REVIEW');
  });

  it('preserves the AI-likelihood flag for a high-likelihood submission (Req 9.4)', async () => {
    // The MockAiAdapter returns likelihood 0.7 for bodies >= 800 chars,
    // which meets the 0.7 flag threshold.
    const { service, state } = runWith('WRITING', 1000);

    const result = await service.precheck(SUBMISSION_ID);

    expect(result.aiLikelihood).toBeGreaterThanOrEqual(
      AI_LIKELIHOOD_FLAG_THRESHOLD,
    );
    expect(result.aiFlagged).toBe(true);
    expect(state.submission.aiFlagged).toBe(true);
    expect(state.submission.aiLikelihood).toBe(result.aiLikelihood);
  });

  it('leaves aiFlagged false for a low-likelihood submission (Req 9.4)', async () => {
    // A short body (< 200 chars) yields likelihood 0.2 — below threshold.
    const { service, state } = runWith('WRITING', 0);

    const result = await service.precheck(SUBMISSION_ID);

    expect(result.aiFlagged).toBe(false);
    expect(state.submission.aiFlagged).toBe(false);
    // Status still flips regardless of the flag (flag is informational).
    expect(state.submission.status).toBe('IN_REVIEW');
  });
});
