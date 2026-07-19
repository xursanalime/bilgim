/**
 * Unit tests for AnthropicAiGradingAdapter (Task 20.3).
 *
 * The tests drive the real adapter against a stub `AiGateway`. We
 * never reach a network or the Anthropic SDK — the gateway is the
 * only collaborator and we replace it with a jest mock that
 * implements the full `AiGateway` surface.
 *
 * What we cover:
 *   - WRITING modules route through `precheckWritingSubmission`,
 *     parse the response, and surface `{score, comment, highlights}`.
 *   - Empty / non-textual modules short-circuit without burning a
 *     gateway call.
 *   - Score is clamped into `[0, 1]`.
 *   - `detectAiText` clamps the gateway likelihood and signals.
 *   - Gateway errors propagate so `AiGradingService.precheck` can
 *     record an ERROR audit row.
 */

import type { AiGateway } from '../ai/ai.types';
import { AnthropicAiGradingAdapter } from './anthropic-ai-grading.adapter';
import { ModuleGradeInput } from './ai-grading.service';

function buildGatewayStub(): jest.Mocked<AiGateway> {
  return {
    tutor: jest.fn(),
    tutorExplain: jest.fn(),
    tutorTranslate: jest.fn(),
    tutorExample: jest.fn(),
    translateWord: jest.fn(),
    translateSentence: jest.fn(),
    precheckWritingSubmission: jest.fn(),
    detectAiText: jest.fn(),
    classifySpecialty: jest.fn(),
    suggestRubric: jest.fn(),
  } as unknown as jest.Mocked<AiGateway>;
}

function buildWritingInput(
  overrides: Partial<ModuleGradeInput> = {},
): ModuleGradeInput {
  return {
    moduleId: 'mod-w',
    type: 'WRITING' as any,
    configJson: {},
    answer: { text: 'The student wrote about photosynthesis and energy.' },
    weight: 100,
    ...overrides,
  };
}

describe('AnthropicAiGradingAdapter.gradeModule', () => {
  it('routes WRITING modules through AiGateway.precheckWritingSubmission and parses the verdict', async () => {
    const gateway = buildGatewayStub();
    gateway.precheckWritingSubmission.mockResolvedValue({
      score: 0.78,
      summary: 'Strong thesis, watch your transitions.',
      highlights: [
        {
          from: 0,
          to: 5,
          severity: 'warning' as const,
          reason: 'Consider rephrasing the opening sentence.',
        },
      ],
      aiLikelihood: 0,
      aiFlagged: false,
    });
    const adapter = new AnthropicAiGradingAdapter(gateway);

    const result = await adapter.gradeModule(buildWritingInput());

    expect(result.moduleId).toBe('mod-w');
    expect(result.type).toBe('WRITING');
    expect(result.score).toBeCloseTo(0.78);
    expect(result.comment).toContain('Strong thesis');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights![0]).toMatchObject({
      from: 0,
      to: 5,
      severity: 'warning',
      reason: 'Consider rephrasing the opening sentence.',
    });
    expect(result.usage).toMatchObject({
      modelName: 'ai-gateway',
      templateKey: 'grade-precheck.v1',
      status: 'OK',
      // The gateway already wrote the upstream AiCall row — homework
      // side stays at zero so we don't double count.
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(gateway.precheckWritingSubmission).toHaveBeenCalledTimes(1);
  });

  it('forwards the runtime promptInputs rubric to the gateway as a flat string', async () => {
    const gateway = buildGatewayStub();
    gateway.precheckWritingSubmission.mockResolvedValue({
      score: 0.5,
      summary: '',
      highlights: [],
      aiLikelihood: 0,
      aiFlagged: false,
    });
    const adapter = new AnthropicAiGradingAdapter(gateway);

    await adapter.gradeModule(
      buildWritingInput({
        promptInputs: {
          moduleType: 'WRITING' as any,
          studentText: 'student text',
          rubric: [
            { name: 'Grammar', weight: 50 },
            { name: 'Coherence', weight: 50 },
          ],
          metadata: {},
        },
      }),
    );

    const call = gateway.precheckWritingSubmission.mock.calls[0]![0];
    expect(call.text).toBe('student text');
    expect(call.rubric).toContain('Grammar');
    expect(call.rubric).toContain('Coherence');
    expect(call.rubric).toContain('weight=50');
  });

  it('clamps an out-of-range score returned by the gateway', async () => {
    const gateway = buildGatewayStub();
    gateway.precheckWritingSubmission.mockResolvedValue({
      score: 1.7,
      summary: 'Too high',
      highlights: [],
      aiLikelihood: 0,
      aiFlagged: false,
    });
    const adapter = new AnthropicAiGradingAdapter(gateway);

    const result = await adapter.gradeModule(buildWritingInput());
    expect(result.score).toBe(1);
  });

  it('returns a placeholder result for empty WRITING answers without calling the gateway', async () => {
    const gateway = buildGatewayStub();
    const adapter = new AnthropicAiGradingAdapter(gateway);

    const result = await adapter.gradeModule(
      buildWritingInput({ answer: { text: '' } }),
    );

    expect(gateway.precheckWritingSubmission).not.toHaveBeenCalled();
    expect(result.score).toBe(0);
    expect(result.comment).toMatch(/No answer detected/);
  });

  it('skips non-textual module types and reports a neutral comment', async () => {
    const gateway = buildGatewayStub();
    const adapter = new AnthropicAiGradingAdapter(gateway);

    const result = await adapter.gradeModule({
      moduleId: 'mod-mc',
      type: 'MULTIPLE_CHOICE' as any,
      configJson: {},
      answer: { value: 'A' },
      weight: 100,
    });

    expect(gateway.precheckWritingSubmission).not.toHaveBeenCalled();
    expect(result.score).toBe(0);
    expect(result.comment).toMatch(/auto-scored/i);
    expect(result.usage.status).toBe('OK');
  });

  it('lets gateway errors propagate so AiGradingService can record an ERROR audit row', async () => {
    const gateway = buildGatewayStub();
    gateway.precheckWritingSubmission.mockRejectedValue(
      new Error('upstream 502'),
    );
    const adapter = new AnthropicAiGradingAdapter(gateway);

    await expect(adapter.gradeModule(buildWritingInput())).rejects.toThrow(
      /upstream 502/,
    );
  });

  it('falls back to the answer-shape text when promptInputs is missing', async () => {
    const gateway = buildGatewayStub();
    gateway.precheckWritingSubmission.mockResolvedValue({
      score: 0.6,
      summary: 'ok',
      highlights: [],
      aiLikelihood: 0,
      aiFlagged: false,
    });
    const adapter = new AnthropicAiGradingAdapter(gateway);

    await adapter.gradeModule(
      buildWritingInput({ answer: 'plain string answer' }),
    );

    const call = gateway.precheckWritingSubmission.mock.calls[0]![0];
    expect(call.text).toBe('plain string answer');
  });
});

describe('AnthropicAiGradingAdapter.detectAiText', () => {
  it('clamps gateway likelihood to [0, 1] and surfaces signals', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 1.4,
      signals: ['perplexity-low', 'classifier-strong'],
    });
    const adapter = new AnthropicAiGradingAdapter(gateway);

    const result = await adapter.detectAiText({ text: 'classify this' });

    expect(result.likelihood).toBe(1);
    expect(result.signals).toEqual(['perplexity-low', 'classifier-strong']);
    expect(result.usage.modelName).toBe('ai-gateway');
  });

  it('returns 0 for empty text without calling the gateway', async () => {
    const gateway = buildGatewayStub();
    const adapter = new AnthropicAiGradingAdapter(gateway);

    const result = await adapter.detectAiText({ text: '' });

    expect(gateway.detectAiText).not.toHaveBeenCalled();
    expect(result.likelihood).toBe(0);
    expect(result.signals).toContain('empty-text');
  });

  it('propagates gateway errors so the caller can record an audit row', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockRejectedValue(new Error('rate limited'));
    const adapter = new AnthropicAiGradingAdapter(gateway);

    await expect(adapter.detectAiText({ text: 'some' })).rejects.toThrow(
      /rate limited/,
    );
  });
});
