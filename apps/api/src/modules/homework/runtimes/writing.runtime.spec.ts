import { ZodError } from 'zod';

import {
  HomeworkRuntimeError,
  WritingRuntime,
  countWords,
  writingRuntime,
} from './';

/**
 * Unit tests for WritingRuntime — Task 18.3, Req 11.5, 11.8, 23.1, 23.2.
 *
 * Coverage:
 *   - validateConfig: happy path, missing prompt, negative wordcount,
 *     min > max, oversized rubric.
 *   - validateAnswer: happy path, ANSWER_TOO_SHORT, ANSWER_TOO_LONG,
 *     missing config bounds (skips count check), invalid attachments.
 *   - aiPromptInputs: passes rubric criteria + student text + word count.
 *   - countWords helper: basic, unicode whitespace, empty.
 */
describe('WritingRuntime', () => {
  const runtime = new WritingRuntime();

  it('declares the WRITING module type', () => {
    expect(runtime.type).toBe('WRITING');
  });

  describe('countWords', () => {
    it('counts whitespace-separated tokens', () => {
      expect(countWords('one two three')).toBe(3);
    });

    it('returns 0 for empty / whitespace-only strings', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
      expect(countWords('\n\t')).toBe(0);
    });

    it('handles multiple consecutive separators and unicode spaces', () => {
      expect(countWords('one   two\nthree\t\tfour')).toBe(4);
      // U+00A0 NO-BREAK SPACE
      expect(countWords('alpha\u00A0beta')).toBe(2);
    });
  });

  describe('validateConfig', () => {
    it('accepts a minimal valid config (prompt only)', () => {
      const cfg = runtime.validateConfig({ prompt: 'Write a 5-paragraph essay' });
      expect(cfg.prompt).toBe('Write a 5-paragraph essay');
      expect(cfg.minWords).toBeUndefined();
      expect(cfg.maxWords).toBeUndefined();
    });

    it('accepts a full config with rubric', () => {
      const cfg = runtime.validateConfig({
        prompt: 'Argue for or against...',
        minWords: 100,
        maxWords: 500,
        rubric: {
          criteria: [
            { name: 'Grammar', weight: 30 },
            { name: 'Coherence', weight: 70 },
          ],
        },
      });
      expect(cfg.minWords).toBe(100);
      expect(cfg.maxWords).toBe(500);
      expect(cfg.rubric?.criteria).toHaveLength(2);
    });

    it('rejects missing prompt', () => {
      expect(() => runtime.validateConfig({})).toThrow(ZodError);
      expect(() => runtime.validateConfig({ prompt: '' })).toThrow(ZodError);
      expect(() => runtime.validateConfig({ prompt: '   ' })).toThrow(ZodError);
    });

    it('rejects negative wordcount', () => {
      expect(() =>
        runtime.validateConfig({ prompt: 'p', minWords: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        runtime.validateConfig({ prompt: 'p', maxWords: -10 }),
      ).toThrow(ZodError);
    });

    it('rejects non-integer wordcount', () => {
      expect(() =>
        runtime.validateConfig({ prompt: 'p', minWords: 1.5 }),
      ).toThrow(ZodError);
    });

    it('rejects min > max', () => {
      expect(() =>
        runtime.validateConfig({ prompt: 'p', minWords: 200, maxWords: 100 }),
      ).toThrow(ZodError);
    });

    it('rejects unknown top-level keys (strict)', () => {
      expect(() =>
        runtime.validateConfig({ prompt: 'p', extra: 'nope' }),
      ).toThrow(ZodError);
    });

    it('rejects rubric with empty criteria', () => {
      expect(() =>
        runtime.validateConfig({
          prompt: 'p',
          rubric: { criteria: [] },
        }),
      ).toThrow(ZodError);
    });

    it('rejects rubric criterion with weight=0 or negative', () => {
      expect(() =>
        runtime.validateConfig({
          prompt: 'p',
          rubric: { criteria: [{ name: 'X', weight: 0 }] },
        }),
      ).toThrow(ZodError);
    });
  });

  describe('validateAnswer', () => {
    const baseConfig = runtime.validateConfig({ prompt: 'p' });
    const minMaxConfig = runtime.validateConfig({
      prompt: 'p',
      minWords: 5,
      maxWords: 10,
    });

    it('accepts a well-formed answer (no count limits)', () => {
      const ans = runtime.validateAnswer(baseConfig, {
        text: 'hello world',
      });
      expect(ans.text).toBe('hello world');
      expect(ans.attachments).toBeUndefined();
    });

    it('accepts attachments with valid uuid mediaIds', () => {
      const ans = runtime.validateAnswer(baseConfig, {
        text: 'x',
        attachments: [
          { mediaId: '11111111-1111-1111-1111-111111111111' },
          { mediaId: '22222222-2222-2222-2222-222222222222' },
        ],
      });
      expect(ans.attachments).toHaveLength(2);
    });

    it('rejects non-uuid mediaId', () => {
      expect(() =>
        runtime.validateAnswer(baseConfig, {
          text: 'x',
          attachments: [{ mediaId: 'not-a-uuid' }],
        }),
      ).toThrow(ZodError);
    });

    it('rejects more than 10 attachments', () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => ({
        mediaId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      }));
      expect(() =>
        runtime.validateAnswer(baseConfig, {
          text: 'x',
          attachments: tooMany,
        }),
      ).toThrow(ZodError);
    });

    it('rejects unknown top-level keys (strict)', () => {
      expect(() =>
        runtime.validateAnswer(baseConfig, { text: 'x', extra: 'nope' }),
      ).toThrow(ZodError);
    });

    it('throws ANSWER_TOO_SHORT when below minWords', () => {
      let thrown: HomeworkRuntimeError | null = null;
      try {
        runtime.validateAnswer(minMaxConfig, { text: 'one two three' });
      } catch (err) {
        thrown = err as HomeworkRuntimeError;
      }
      expect(thrown).toBeInstanceOf(HomeworkRuntimeError);
      expect(thrown!.code).toBe('ANSWER_TOO_SHORT');
      expect(thrown!.details).toMatchObject({ wordCount: 3, minWords: 5 });
    });

    it('throws ANSWER_TOO_LONG when above maxWords', () => {
      let thrown: HomeworkRuntimeError | null = null;
      try {
        runtime.validateAnswer(minMaxConfig, {
          text: 'a b c d e f g h i j k l',
        });
      } catch (err) {
        thrown = err as HomeworkRuntimeError;
      }
      expect(thrown).toBeInstanceOf(HomeworkRuntimeError);
      expect(thrown!.code).toBe('ANSWER_TOO_LONG');
      expect(thrown!.details).toMatchObject({ wordCount: 12, maxWords: 10 });
    });

    it('accepts a count exactly on the lower bound', () => {
      const ans = runtime.validateAnswer(minMaxConfig, {
        text: 'a b c d e',
      });
      expect(ans.text).toBe('a b c d e');
    });

    it('accepts a count exactly on the upper bound', () => {
      const ans = runtime.validateAnswer(minMaxConfig, {
        text: 'a b c d e f g h i j',
      });
      expect(ans.text).toBe('a b c d e f g h i j');
    });

    it('skips count enforcement when the config has no bounds', () => {
      const ans = runtime.validateAnswer(baseConfig, { text: '' });
      expect(ans.text).toBe('');
    });

    it('rejects when text is missing entirely', () => {
      expect(() => runtime.validateAnswer(baseConfig, {})).toThrow(ZodError);
    });
  });

  describe('aiPromptInputs', () => {
    it('passes rubric criteria + student text into the prompt bag', () => {
      const cfg = runtime.validateConfig({
        prompt: 'Write about your weekend',
        minWords: 50,
        maxWords: 200,
        rubric: {
          criteria: [
            { name: 'Grammar', weight: 40 },
            { name: 'Vocabulary', weight: 60 },
          ],
        },
      });
      const ans = runtime.validateAnswer(cfg, {
        text: Array(60).fill('word').join(' '), // 60 words
      });
      const inputs = runtime.aiPromptInputs(cfg, ans);
      expect(inputs.moduleType).toBe('WRITING');
      expect(inputs.studentText).toContain('word');
      expect(inputs.rubric).toEqual([
        { name: 'Grammar', weight: 40 },
        { name: 'Vocabulary', weight: 60 },
      ]);
      expect(inputs.metadata).toMatchObject({
        prompt: 'Write about your weekend',
        minWords: 50,
        maxWords: 200,
        wordCount: 60,
      });
    });

    it('returns an empty rubric array when none was configured', () => {
      const cfg = runtime.validateConfig({ prompt: 'p' });
      const ans = runtime.validateAnswer(cfg, { text: 'hi there' });
      const inputs = runtime.aiPromptInputs(cfg, ans);
      expect(inputs.rubric).toEqual([]);
      expect(inputs.metadata).toMatchObject({
        prompt: 'p',
        wordCount: 2,
      });
    });
  });

  it('exports a singleton instance', () => {
    expect(writingRuntime).toBeInstanceOf(WritingRuntime);
    expect(writingRuntime.type).toBe('WRITING');
  });
});
