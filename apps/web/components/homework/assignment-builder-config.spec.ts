import {
  BuilderSchema,
  buildModuleConfig,
  parseFlashcards,
  parseWordList,
  type BuilderValues,
} from './assignment-builder-config';

// Minimal valid base; individual tests override `moduleType` + skill fields.
const base = {
  courseId: 'course-1',
  groupId: 'group-1',
  lessonId: 'lesson-1',
  title: 'My assignment',
  totalPoints: 100,
};

function parse(input: Record<string, unknown>) {
  return BuilderSchema.safeParse(input);
}

describe('BuilderSchema — location + basics', () => {
  it('requires course, group and lesson', () => {
    const r = parse({ ...base, courseId: '', moduleType: 'WRITING', prompt: 'x' });
    expect(r.success).toBe(false);
  });

  it('requires a non-empty title and a positive integer points value', () => {
    expect(parse({ ...base, title: '', moduleType: 'WRITING', prompt: 'x' }).success).toBe(
      false,
    );
    expect(
      parse({ ...base, totalPoints: 0, moduleType: 'WRITING', prompt: 'x' }).success,
    ).toBe(false);
    expect(
      parse({ ...base, totalPoints: 2.5, moduleType: 'WRITING', prompt: 'x' }).success,
    ).toBe(false);
  });
});

describe('BuilderSchema — module-type restriction (Req 10.1 — eight skills)', () => {
  it.each([
    'WRITING',
    'READING',
    'LISTENING',
    'GRAMMAR',
    'VOCABULARY',
    'SPELLING',
    'SPEAKING',
    'PRONUNCIATION',
  ])('accepts the English skill %s', (moduleType) => {
    // Provide whatever that skill needs so only the type matters here.
    const skillFields: Record<string, unknown> = {
      WRITING: { prompt: 'Write something' },
      READING: { passage: 'A passage' },
      LISTENING: { audioUrl: 'https://cdn.example.com/a.mp3' },
      GRAMMAR: { ruleTitle: 'Present Simple', ruleExplanation: 'Used for habits' },
      VOCABULARY: { words: 'apple - olma' },
      SPELLING: { words: 'rhythm' },
      SPEAKING: { prompt: 'Introduce yourself' },
      PRONUNCIATION: { targetText: 'The quick brown fox' },
    }[moduleType] as Record<string, unknown>;
    expect(parse({ ...base, moduleType, ...skillFields }).success).toBe(true);
  });

  it.each(['MULTIPLE_CHOICE', 'CODE_REVIEW', 'MATH_WORD_PROBLEM', 'PROJECT_SUBMISSION'])(
    'rejects the legacy/non-language module %s',
    (moduleType) => {
      expect(parse({ ...base, moduleType, prompt: 'x' }).success).toBe(false);
    },
  );

  it('rejects an empty module selection', () => {
    expect(parse({ ...base, moduleType: '' }).success).toBe(false);
  });
});

describe('BuilderSchema — per-skill required prompt fields', () => {
  it('WRITING requires a prompt and rejects min > max words', () => {
    expect(parse({ ...base, moduleType: 'WRITING' }).success).toBe(false);
    expect(
      parse({
        ...base,
        moduleType: 'WRITING',
        prompt: 'ok',
        minWords: 200,
        maxWords: 100,
      }).success,
    ).toBe(false);
  });

  it('READING requires a passage', () => {
    expect(parse({ ...base, moduleType: 'READING' }).success).toBe(false);
  });

  it('LISTENING requires a valid http(s) audio URL', () => {
    expect(parse({ ...base, moduleType: 'LISTENING' }).success).toBe(false);
    expect(
      parse({ ...base, moduleType: 'LISTENING', audioUrl: 'not-a-url' }).success,
    ).toBe(false);
    expect(
      parse({
        ...base,
        moduleType: 'LISTENING',
        audioUrl: 'https://cdn.example.com/a.mp3',
      }).success,
    ).toBe(true);
  });

  it('GRAMMAR requires a rule title + explanation', () => {
    expect(
      parse({ ...base, moduleType: 'GRAMMAR', ruleTitle: 'Only title' }).success,
    ).toBe(false);
  });

  it('VOCABULARY and SPELLING require words', () => {
    expect(parse({ ...base, moduleType: 'VOCABULARY' }).success).toBe(false);
    expect(parse({ ...base, moduleType: 'SPELLING' }).success).toBe(false);
  });

  it('SPEAKING requires a prompt; PRONUNCIATION requires target text', () => {
    expect(parse({ ...base, moduleType: 'SPEAKING' }).success).toBe(false);
    expect(parse({ ...base, moduleType: 'PRONUNCIATION' }).success).toBe(false);
  });
});

describe('parse helpers', () => {
  it('parseWordList splits on commas and newlines and trims', () => {
    expect(parseWordList(' a, b\nc ,  , d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('parseFlashcards splits "word - translation" lines', () => {
    expect(parseFlashcards('apple - olma\nbook = kitob\nlonely')).toEqual([
      { id: 'c1', word: 'apple', translation: 'olma' },
      { id: 'c2', word: 'book', translation: 'kitob' },
      { id: 'c3', word: 'lonely', translation: '' },
    ]);
  });
});

describe('buildModuleConfig — runtime-compatible shapes', () => {
  function valuesFor(input: Record<string, unknown>): BuilderValues {
    const r = parse(input);
    if (!r.success) throw new Error('expected valid input for ' + JSON.stringify(input));
    return r.data;
  }

  it('WRITING includes prompt and optional word bounds', () => {
    const cfg = buildModuleConfig(
      valuesFor({ ...base, moduleType: 'WRITING', prompt: 'Essay', minWords: 50, maxWords: 200 }),
    ) as Record<string, unknown>;
    expect(cfg).toEqual({ prompt: 'Essay', minWords: 50, maxWords: 200 });
  });

  it('READING produces a passage + empty questions array', () => {
    const cfg = buildModuleConfig(
      valuesFor({ ...base, moduleType: 'READING', passage: 'Text', prompt: 'Read it' }),
    ) as Record<string, unknown>;
    expect(cfg).toMatchObject({ passage: 'Text', questions: [], instructions: 'Read it' });
  });

  it('LISTENING carries the audio URL', () => {
    const cfg = buildModuleConfig(
      valuesFor({
        ...base,
        moduleType: 'LISTENING',
        audioUrl: 'https://cdn.example.com/a.mp3',
      }),
    ) as Record<string, unknown>;
    expect(cfg).toMatchObject({
      audioUrl: 'https://cdn.example.com/a.mp3',
      questions: [],
    });
  });

  it('VOCABULARY builds flashcards from the words field', () => {
    const cfg = buildModuleConfig(
      valuesFor({ ...base, moduleType: 'VOCABULARY', words: 'apple - olma' }),
    ) as { studyMode: string; cards: unknown[] };
    expect(cfg.studyMode).toBe('flashcard');
    expect(cfg.cards).toEqual([{ id: 'c1', word: 'apple', translation: 'olma' }]);
  });

  it('SPEAKING wraps the prompt in a single task', () => {
    const cfg = buildModuleConfig(
      valuesFor({ ...base, moduleType: 'SPEAKING', prompt: 'Talk', targetText: 'Hello' }),
    ) as { tasks: Array<Record<string, unknown>>; showTargetText: boolean };
    expect(cfg.tasks).toHaveLength(1);
    expect(cfg.tasks[0]).toMatchObject({ prompt: 'Talk', targetText: 'Hello' });
    expect(cfg.showTargetText).toBe(true);
  });
});
