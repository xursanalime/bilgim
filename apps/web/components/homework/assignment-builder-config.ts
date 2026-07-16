/**
 * Pure validation + config-shaping logic for the teacher AssignmentBuilder
 * (frontend-redesign Req 10.1). Kept separate from the React component so it
 * can be unit-tested without rendering and so the builder file stays lean.
 *
 * The `configJson` shapes produced here mirror the per-skill module runtimes
 * in `components/homework/module-runtimes/*` so a learner UI (Task 6.2) can
 * consume an assignment created by this builder without translation.
 */

import { z } from 'zod';

import {
  isLanguageSkillModuleType,
  type LanguageSkillModuleType,
} from '../../lib/api/homework';

// ── Schema ─────────────────────────────────────────────────────────────

const numericOptional = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z
    .number({ invalid_type_error: 'Raqam kiriting' })
    .int('Butun son bo\u2018lishi kerak')
    .positive('Musbat bo\u2018lishi kerak')
    .max(100_000, 'Juda katta')
    .optional(),
);

export const BuilderSchema = z
  .object({
    courseId: z.string().min(1, 'Kursni tanlang'),
    groupId: z.string().min(1, 'Guruhni tanlang'),
    lessonId: z.string().min(1, 'Darsni tanlang'),
    moduleType: z
      .string()
      .min(1, 'Skill modulini tanlang')
      .refine(isLanguageSkillModuleType, 'Yaroqsiz modul turi'),
    title: z
      .string()
      .trim()
      .min(1, 'Sarlavhani kiriting')
      .max(200, 'Sarlavha 200 belgidan oshmasligi kerak'),
    description: z.string().trim().max(2000, 'Juda uzun').optional(),
    dueAt: z.string().optional(),
    totalPoints: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
      z
        .number({ invalid_type_error: 'Ballni raqam sifatida kiriting' })
        .int('Ball butun son bo\u2018lishi kerak')
        .min(1, 'Kamida 1 ball')
        .max(10_000, 'Ball juda katta'),
    ),
    // Skill-specific prompt fields (only the relevant ones are required,
    // enforced per moduleType in the superRefine below).
    prompt: z.string().trim().max(4000).optional(),
    minWords: numericOptional,
    maxWords: numericOptional,
    passage: z.string().trim().max(8000).optional(),
    audioUrl: z.string().trim().max(2000).optional(),
    transcript: z.string().trim().max(8000).optional(),
    ruleTitle: z.string().trim().max(200).optional(),
    ruleExplanation: z.string().trim().max(4000).optional(),
    words: z.string().trim().max(4000).optional(),
    targetText: z.string().trim().max(2000).optional(),
    studyMode: z.enum(['flashcard', 'quiz', 'both']).optional(),
  })
  .superRefine((v, ctx) => {
    const req = (path: keyof typeof v, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });

    switch (v.moduleType) {
      case 'WRITING':
        if (!v.prompt?.trim()) req('prompt', 'Yozma ish ko\u2018rsatmasini kiriting');
        if (
          v.minWords !== undefined &&
          v.maxWords !== undefined &&
          v.minWords > v.maxWords
        ) {
          req('maxWords', 'Maksimal so\u2018z mindan kichik bo\u2018lmasligi kerak');
        }
        break;
      case 'READING':
        if (!v.passage?.trim()) req('passage', 'O\u2018qish matnini kiriting');
        break;
      case 'LISTENING':
        if (!v.audioUrl?.trim()) {
          req('audioUrl', 'Audio URL kiriting');
        } else if (!/^https?:\/\//i.test(v.audioUrl.trim())) {
          req('audioUrl', 'Yaroqli URL kiriting (http/https)');
        }
        break;
      case 'GRAMMAR':
        if (!v.ruleTitle?.trim()) req('ruleTitle', 'Qoida nomini kiriting');
        if (!v.ruleExplanation?.trim())
          req('ruleExplanation', 'Qoida tushuntirishini kiriting');
        break;
      case 'VOCABULARY':
        if (!v.words?.trim()) req('words', 'Kamida bitta so\u2018z kiriting');
        break;
      case 'SPELLING':
        if (!v.words?.trim()) req('words', 'Kamida bitta so\u2018z kiriting');
        break;
      case 'SPEAKING':
        if (!v.prompt?.trim()) req('prompt', 'Gapirish topshirig\u2018ini kiriting');
        break;
      case 'PRONUNCIATION':
        if (!v.targetText?.trim())
          req('targetText', 'Talaffuz qilinadigan matnni kiriting');
        break;
      default:
        break;
    }
  });

export type BuilderValues = z.infer<typeof BuilderSchema>;
export type BuilderInput = z.input<typeof BuilderSchema>;

// ── configJson builders (shapes mirror the module runtimes) ─────────────

/** Parse a free-text list (comma- or newline-separated) into trimmed words. */
export function parseWordList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Parse "word - translation" (or "word = translation" / "word: translation")
 * lines into flashcard objects compatible with the vocabulary runtime. Lines
 * without a separator become a card with an empty translation.
 */
export function parseFlashcards(raw: string): Array<Record<string, unknown>> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [word, ...rest] = line.split(/\s*[-=:]\s*/);
      return {
        id: `c${i + 1}`,
        word: (word ?? '').trim(),
        translation: rest.join(' ').trim(),
      };
    });
}

/** Build the per-skill `configJson` payload from validated form values. */
export function buildModuleConfig(v: BuilderValues): unknown {
  const instructions = v.prompt?.trim() ? { instructions: v.prompt.trim() } : {};
  switch (v.moduleType as LanguageSkillModuleType) {
    case 'WRITING':
      return {
        prompt: v.prompt?.trim() ?? '',
        ...(v.minWords !== undefined ? { minWords: v.minWords } : {}),
        ...(v.maxWords !== undefined ? { maxWords: v.maxWords } : {}),
      };
    case 'READING':
      return { passage: v.passage?.trim() ?? '', questions: [], ...instructions };
    case 'LISTENING':
      return {
        audioUrl: v.audioUrl?.trim() ?? '',
        ...(v.transcript?.trim() ? { transcript: v.transcript.trim() } : {}),
        questions: [],
        ...instructions,
      };
    case 'GRAMMAR':
      return {
        rule: {
          title: v.ruleTitle?.trim() ?? '',
          explanation: v.ruleExplanation?.trim() ?? '',
          examples: [],
        },
        exercises: [],
        ...instructions,
      };
    case 'VOCABULARY':
      return {
        studyMode: v.studyMode ?? 'flashcard',
        cards: parseFlashcards(v.words ?? ''),
        ...instructions,
      };
    case 'SPELLING':
      return { words: parseWordList(v.words ?? ''), ...instructions };
    case 'SPEAKING':
      return {
        tasks: [
          {
            id: 't1',
            prompt: v.prompt?.trim() ?? '',
            ...(v.targetText?.trim() ? { targetText: v.targetText.trim() } : {}),
          },
        ],
        showTargetText: Boolean(v.targetText?.trim()),
      };
    case 'PRONUNCIATION':
      return {
        tasks: [
          {
            id: 't1',
            prompt: v.prompt?.trim() || v.targetText?.trim() || '',
            targetText: v.targetText?.trim() ?? '',
          },
        ],
        showTargetText: true,
      };
    default:
      return {};
  }
}
