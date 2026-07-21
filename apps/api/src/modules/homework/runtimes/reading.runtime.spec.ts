import { ZodError } from 'zod';

import {
  ReadingConfig,
  ReadingRuntime,
  readingRuntime,
  scoreReadingQuestion,
} from './reading.runtime';
import { HomeworkRuntimeError } from './types';

/**
 * Unit tests for ReadingRuntime — Task 18.4, Req 11 (Reading module UX).
 *
 * Coverage:
 *   - validateConfig: happy path + every error branch
 *     (missing passage, empty questions, mcq missing/insufficient choices,
 *     mcq answer not in choices, true_false with non-boolean answer,
 *     duplicate question id, short with non-string model answer).
 *   - validateAnswer: happy path (full, partial, missing) + invalid
 *     (response for unknown questionId, mcq value not in choices,
 *     multi-answer when single-answer, single-answer when multi-answer,
 *     missing required fields).
 *   - scoreReadingQuestion: deterministic mcq + true_false + ai-pending
 *     for short.
 *   - aiPromptInputs: passes passage + items + model answers for short
 *     questions only.
 */
describe('ReadingRuntime', () => {
  const runtime: ReadingRuntime = readingRuntime;

  // ==================================================================
  // validateConfig — happy path
  // ==================================================================

  describe('validateConfig — happy path', () => {
    it('parses a minimal mcq + short + true_false config', () => {
      const config = {
        passage: 'The cat sat on the mat.',
        questions: [
          {
            id: 'q1',
            prompt: 'Where did the cat sit?',
            kind: 'mcq',
            choices: ['mat', 'chair'],
            answer: 'mat',
          },
          {
            id: 'q2',
            prompt: 'Was the cat on the mat?',
            kind: 'true_false',
            answer: 'true',
          },
          {
            id: 'q3',
            prompt: 'Describe the scene briefly.',
            kind: 'short',
            answer: 'A cat is sitting on a mat.',
          },
        ],
      };

      const parsed = runtime.validateConfig(config);
      expect(parsed.questions).toHaveLength(3);
      expect(parsed.passage).toBe('The cat sat on the mat.');
    });

    it('accepts mcq with multi-answer (answer as array of choices)', () => {
      const config = {
        passage: 'p',
        questions: [
          {
            id: 'q1',
            prompt: 'Pick the colors mentioned.',
            kind: 'mcq',
            choices: ['red', 'green', 'blue', 'yellow'],
            answer: ['red', 'blue'],
          },
        ],
      };
      const parsed = runtime.validateConfig(config);
      expect(parsed.questions[0]?.answer).toEqual(['red', 'blue']);
    });

    it('accepts short questions without an answer (AI / teacher will grade)', () => {
      const config = {
        passage: 'p',
        questions: [
          { id: 'q1', prompt: 'Reflect on the passage.', kind: 'short' },
        ],
      };
      expect(() => runtime.validateConfig(config)).not.toThrow();
    });
  });

  // ==================================================================
  // validateConfig — error branches
  // ==================================================================

  describe('validateConfig — error branches', () => {
    it('rejects when passage is missing', () => {
      expect(() =>
        runtime.validateConfig({
          questions: [
            { id: 'q1', prompt: 'p', kind: 'short' },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects when passage is empty', () => {
      expect(() =>
        runtime.validateConfig({
          passage: '   ',
          questions: [{ id: 'q1', prompt: 'p', kind: 'short' }],
        }),
      ).toThrow(ZodError);
    });

    it('rejects when questions array is empty', () => {
      expect(() =>
        runtime.validateConfig({ passage: 'p', questions: [] }),
      ).toThrow(ZodError);
    });

    it('rejects mcq without choices', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            { id: 'q1', prompt: 'p', kind: 'mcq', answer: 'a' },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects mcq with fewer than 2 choices', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            {
              id: 'q1',
              prompt: 'p',
              kind: 'mcq',
              choices: ['only'],
              answer: 'only',
            },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects mcq with answer not in choices', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            {
              id: 'q1',
              prompt: 'p',
              kind: 'mcq',
              choices: ['a', 'b'],
              answer: 'c',
            },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects mcq multi-answer with an entry not in choices', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            {
              id: 'q1',
              prompt: 'p',
              kind: 'mcq',
              choices: ['a', 'b', 'c'],
              answer: ['a', 'z'],
            },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects true_false with a non-boolean answer string', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            {
              id: 'q1',
              prompt: 'p',
              kind: 'true_false',
              answer: 'maybe',
            },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects true_false with array answer', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            {
              id: 'q1',
              prompt: 'p',
              kind: 'true_false',
              answer: ['true'],
            },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects short questions with array model answer', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            {
              id: 'q1',
              prompt: 'p',
              kind: 'short',
              answer: ['oops'],
            },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects duplicate question ids', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            { id: 'q1', prompt: 'p1', kind: 'short' },
            { id: 'q1', prompt: 'p2', kind: 'short' },
          ],
        }),
      ).toThrow(ZodError);
    });

    it('rejects an unknown kind value', () => {
      expect(() =>
        runtime.validateConfig({
          passage: 'p',
          questions: [
            { id: 'q1', prompt: 'p', kind: 'essay' as unknown as 'short' },
          ],
        }),
      ).toThrow(ZodError);
    });
  });

  // ==================================================================
  // validateAnswer — happy paths
  // ==================================================================

  describe('validateAnswer — happy paths', () => {
    const config: ReadingConfig = readingRuntime.validateConfig({
      passage: 'A passage.',
      questions: [
        {
          id: 'q1',
          prompt: 'mcq?',
          kind: 'mcq',
          choices: ['x', 'y'],
          answer: 'x',
        },
        {
          id: 'q2',
          prompt: 'multi?',
          kind: 'mcq',
          choices: ['a', 'b', 'c'],
          answer: ['a', 'b'],
        },
        { id: 'q3', prompt: 'tf?', kind: 'true_false', answer: 'true' },
        { id: 'q4', prompt: 'short?', kind: 'short' },
      ],
    });

    it('accepts a fully answered submission', () => {
      const answer = {
        responses: {
          q1: { value: 'x' },
          q2: { value: ['a', 'b'] },
          q3: { value: 'false' },
          q4: { value: 'My short answer.' },
        },
      };
      expect(() => runtime.validateAnswer(config, answer)).not.toThrow();
    });

    it('accepts a partially answered submission (missing answers allowed)', () => {
      const answer = {
        responses: {
          q1: { value: 'y' },
        },
      };
      expect(() => runtime.validateAnswer(config, answer)).not.toThrow();
    });

    it('accepts an empty responses object (student submitted nothing)', () => {
      expect(() =>
        runtime.validateAnswer(config, { responses: {} }),
      ).not.toThrow();
    });
  });

  // ==================================================================
  // validateAnswer — invalid
  // ==================================================================

  describe('validateAnswer — invalid', () => {
    const config: ReadingConfig = readingRuntime.validateConfig({
      passage: 'p',
      questions: [
        {
          id: 'single',
          prompt: 'single mcq',
          kind: 'mcq',
          choices: ['a', 'b'],
          answer: 'a',
        },
        {
          id: 'multi',
          prompt: 'multi mcq',
          kind: 'mcq',
          choices: ['x', 'y', 'z'],
          answer: ['x', 'y'],
        },
        { id: 'tf', prompt: 'tf', kind: 'true_false', answer: 'true' },
        { id: 'short', prompt: 'short', kind: 'short' },
      ],
    });

    it('rejects a response for an unknown question id', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            ghost: { value: 'whatever' },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects mcq value not in choices', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            single: { value: 'c' },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects array value when question is single-answer mcq', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            single: { value: ['a'] },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects single string value when question is multi-answer mcq', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            multi: { value: 'x' },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects multi-answer mcq with a value not in choices', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            multi: { value: ['x', 'q'] },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects true_false with non-boolean value', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            tf: { value: 'maybe' },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects true_false with array value', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            tf: { value: ['true'] },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects short with array value', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: {
            short: { value: ['arr'] },
          },
        }),
      ).toThrow(HomeworkRuntimeError);
    });

    it('rejects responses entry missing the value field', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: { single: {} },
        }),
      ).toThrow(ZodError);
    });

    it('rejects responses with an unknown extra field', () => {
      expect(() =>
        runtime.validateAnswer(config, {
          responses: { single: { value: 'a', extra: 'no' } },
        }),
      ).toThrow(ZodError);
    });

    it('rejects when responses is not an object', () => {
      expect(() =>
        runtime.validateAnswer(config, { responses: null }),
      ).toThrow(ZodError);
    });
  });

  // ==================================================================
  // scoreReadingQuestion — deterministic scoring
  // ==================================================================

  describe('scoreReadingQuestion', () => {
    const cfg: ReadingConfig = readingRuntime.validateConfig({
      passage: 'p',
      questions: [
        {
          id: 'mcq1',
          prompt: 'p',
          kind: 'mcq',
          choices: ['a', 'b', 'c'],
          answer: 'b',
        },
        {
          id: 'multi',
          prompt: 'p',
          kind: 'mcq',
          choices: ['x', 'y', 'z'],
          answer: ['x', 'z'],
        },
        { id: 'tf', prompt: 'p', kind: 'true_false', answer: 'false' },
        {
          id: 'short',
          prompt: 'p',
          kind: 'short',
          answer: 'expected',
        },
      ],
    });

    const byId = new Map(cfg.questions.map((q) => [q.id, q]));

    it('returns null when no response is provided', () => {
      expect(scoreReadingQuestion(byId.get('mcq1')!, undefined)).toBeNull();
    });

    it('mcq single — correct', () => {
      expect(
        scoreReadingQuestion(byId.get('mcq1')!, { value: 'b' }),
      ).toEqual({ kind: 'deterministic', correct: true });
    });

    it('mcq single — incorrect', () => {
      expect(
        scoreReadingQuestion(byId.get('mcq1')!, { value: 'a' }),
      ).toEqual({ kind: 'deterministic', correct: false });
    });

    it('mcq multi — set equality (order-insensitive) correct', () => {
      expect(
        scoreReadingQuestion(byId.get('multi')!, { value: ['z', 'x'] }),
      ).toEqual({ kind: 'deterministic', correct: true });
    });

    it('mcq multi — missing one expected entry is incorrect', () => {
      expect(
        scoreReadingQuestion(byId.get('multi')!, { value: ['x'] }),
      ).toEqual({ kind: 'deterministic', correct: false });
    });

    it('mcq multi — extra entry is incorrect', () => {
      expect(
        scoreReadingQuestion(byId.get('multi')!, {
          value: ['x', 'z', 'y'],
        }),
      ).toEqual({ kind: 'deterministic', correct: false });
    });

    it('true_false — correct', () => {
      expect(scoreReadingQuestion(byId.get('tf')!, { value: 'false' })).toEqual({
        kind: 'deterministic',
        correct: true,
      });
    });

    it('true_false — incorrect', () => {
      expect(scoreReadingQuestion(byId.get('tf')!, { value: 'true' })).toEqual({
        kind: 'deterministic',
        correct: false,
      });
    });

    it('short — returns ai-pending so the AI grader picks it up', () => {
      expect(
        scoreReadingQuestion(byId.get('short')!, { value: 'student text' }),
      ).toEqual({ kind: 'ai', pending: true });
    });
  });

  // ==================================================================
  // aiPromptInputs — passage + items + short-only model answers
  // ==================================================================

  describe('aiPromptInputs', () => {
    it('emits passage, every item, and the model answer ONLY for short questions', () => {
      const config = readingRuntime.validateConfig({
        passage: 'A long passage.',
        questions: [
          {
            id: 'mcq1',
            prompt: 'mcq?',
            kind: 'mcq',
            choices: ['a', 'b'],
            answer: 'a',
          },
          { id: 'tf', prompt: 'tf?', kind: 'true_false', answer: 'true' },
          {
            id: 's1',
            prompt: 'short?',
            kind: 'short',
            answer: 'expected model answer',
          },
        ],
      });
      const answer = readingRuntime.validateAnswer(config, {
        responses: {
          mcq1: { value: 'b' },
          tf: { value: 'true' },
          s1: { value: 'student wrote this' },
        },
      });

      const inputs = runtime.aiPromptInputs(config, answer);

      expect(inputs.moduleType).toBe('READING');
      expect(inputs.studentText).toContain('student wrote this');
      expect(inputs.metadata.passage).toBe('A long passage.');
      const items = inputs.metadata.items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(3);
      const byId = new Map(items.map((i) => [i.id as string, i]));
      // mcq has choices but no modelAnswer
      expect(byId.get('mcq1')!.choices).toEqual(['a', 'b']);
      expect(byId.get('mcq1')!.modelAnswer).toBeUndefined();
      // tf has neither choices nor modelAnswer
      expect(byId.get('tf')!.choices).toBeUndefined();
      expect(byId.get('tf')!.modelAnswer).toBeUndefined();
      // short has modelAnswer
      expect(byId.get('s1')!.modelAnswer).toBe('expected model answer');
    });

    it('handles missing student response by emitting null studentValue', () => {
      const config = readingRuntime.validateConfig({
        passage: 'p',
        questions: [
          { id: 's1', prompt: 'short?', kind: 'short', answer: 'm' },
        ],
      });
      const answer = readingRuntime.validateAnswer(config, { responses: {} });
      const inputs = runtime.aiPromptInputs(config, answer);
      const items = inputs.metadata.items as Array<Record<string, unknown>>;
      expect(items[0]?.studentValue).toBeNull();
      expect(inputs.studentText).toBe('');
    });
  });

  // ==================================================================
  // type identity
  // ==================================================================

  it('declares HomeworkModuleType READING', () => {
    expect(runtime.type).toBe('READING');
  });
});
