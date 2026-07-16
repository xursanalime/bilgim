/**
 * Static placement question bank — Phase 3, Task 3.1.
 *
 * Covers at least the READING, GRAMMAR and VOCABULARY skills (Req 5.1). The
 * sequence of questions returned by `POST /placement/start` is drawn from this
 * bank.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SOURCE: TBD — Open Question 5 (`requirements.md`).
 *
 * "Should the placement assessment use a fixed admin-authored question bank,
 *  AI-generated questions, or a third-party item bank?"
 *
 * Until that decision is made this module ships a small, fixed, in-code set so
 * the start/resume/answer flow is fully functional and testable. When the
 * source is finalised this constant should be replaced by a seed table / item
 * bank loader without changing the service contract.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * NOTE: scoring / CEFR computation is intentionally NOT implemented here — that
 * is Task 3.2. The `correctOption` field is recorded for that later task but is
 * never exposed to the learner (see `toPublicQuestion`).
 */

/** Skills the placement assessment must cover (Req 5.1). */
export const PLACEMENT_SKILLS = ['READING', 'GRAMMAR', 'VOCABULARY'] as const;
export type PlacementSkill = (typeof PLACEMENT_SKILLS)[number];

/** A single multiple-choice placement question (internal representation). */
export interface PlacementQuestion {
  /** Stable identifier used as `PlacementAnswer.questionRef` (Req 5.4). */
  questionRef: string;
  skill: PlacementSkill;
  /** Approximate CEFR band the item targets — used later by Task 3.2 scoring. */
  targetLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  prompt: string;
  options: string[];
  /**
   * Index of the correct option. Kept for Task 3.2 (scoring) ONLY and never
   * serialised to the learner.
   */
  correctOption: number;
}

/** Learner-facing shape of a question (no answer key). */
export interface PublicPlacementQuestion {
  questionRef: string;
  skill: PlacementSkill;
  prompt: string;
  options: string[];
}

/**
 * The fixed question set. Ordered so the returned sequence interleaves skills
 * and ascends roughly in difficulty.
 *
 * SOURCE: TBD per Open Question 5 — placeholder admin-authored items.
 */
export const PLACEMENT_QUESTION_BANK: readonly PlacementQuestion[] = [
  // ---- GRAMMAR --------------------------------------------------------
  {
    questionRef: 'GRAMMAR_A1_01',
    skill: 'GRAMMAR',
    targetLevel: 'A1',
    prompt: 'She ___ a teacher.',
    options: ['is', 'are', 'am', 'be'],
    correctOption: 0,
  },
  {
    questionRef: 'GRAMMAR_A2_01',
    skill: 'GRAMMAR',
    targetLevel: 'A2',
    prompt: 'They ___ to the cinema yesterday.',
    options: ['go', 'went', 'gone', 'going'],
    correctOption: 1,
  },
  {
    questionRef: 'GRAMMAR_B1_01',
    skill: 'GRAMMAR',
    targetLevel: 'B1',
    prompt: 'If I had time, I ___ help you.',
    options: ['will', 'would', 'am', 'did'],
    correctOption: 1,
  },
  {
    questionRef: 'GRAMMAR_B2_01',
    skill: 'GRAMMAR',
    targetLevel: 'B2',
    prompt: 'By next year she ___ here for a decade.',
    options: [
      'will have worked',
      'works',
      'worked',
      'is working',
    ],
    correctOption: 0,
  },
  // ---- VOCABULARY -----------------------------------------------------
  {
    questionRef: 'VOCABULARY_A1_01',
    skill: 'VOCABULARY',
    targetLevel: 'A1',
    prompt: 'The opposite of "big" is ___.',
    options: ['small', 'tall', 'fast', 'loud'],
    correctOption: 0,
  },
  {
    questionRef: 'VOCABULARY_A2_01',
    skill: 'VOCABULARY',
    targetLevel: 'A2',
    prompt: 'A person who teaches students is a ___.',
    options: ['doctor', 'teacher', 'driver', 'farmer'],
    correctOption: 1,
  },
  {
    questionRef: 'VOCABULARY_B1_01',
    skill: 'VOCABULARY',
    targetLevel: 'B1',
    prompt: 'Choose the word closest in meaning to "rapid".',
    options: ['slow', 'quick', 'quiet', 'heavy'],
    correctOption: 1,
  },
  {
    questionRef: 'VOCABULARY_B2_01',
    skill: 'VOCABULARY',
    targetLevel: 'B2',
    prompt: 'Choose the word closest in meaning to "meticulous".',
    options: ['careless', 'thorough', 'cheerful', 'sudden'],
    correctOption: 1,
  },
  // ---- READING --------------------------------------------------------
  {
    questionRef: 'READING_A2_01',
    skill: 'READING',
    targetLevel: 'A2',
    prompt:
      'Read: "Tom wakes up at 7 and goes to school by bus." How does Tom go to school?',
    options: ['By car', 'By bus', 'On foot', 'By train'],
    correctOption: 1,
  },
  {
    questionRef: 'READING_B1_01',
    skill: 'READING',
    targetLevel: 'B1',
    prompt:
      'Read: "Although it was raining, the match continued." What happened to the match?',
    options: [
      'It was cancelled',
      'It continued',
      'It was delayed',
      'It never started',
    ],
    correctOption: 1,
  },
  {
    questionRef: 'READING_B2_01',
    skill: 'READING',
    targetLevel: 'B2',
    prompt:
      'Read: "The proposal was met with scepticism by the committee." How did the committee react?',
    options: ['Enthusiastically', 'Doubtfully', 'Angrily', 'Indifferently'],
    correctOption: 1,
  },
  {
    questionRef: 'READING_C1_01',
    skill: 'READING',
    targetLevel: 'C1',
    prompt:
      'Read: "Her argument, while compelling, rested on a flawed premise." What is the writer\'s view of the argument?',
    options: [
      'Entirely convincing',
      'Persuasive but built on a weak basis',
      'Completely worthless',
      'Irrelevant',
    ],
    correctOption: 1,
  },
];

/** Map for O(1) lookup of a question by its ref. */
const QUESTION_BY_REF = new Map<string, PlacementQuestion>(
  PLACEMENT_QUESTION_BANK.map((q) => [q.questionRef, q]),
);

/** Find a question by ref, or `undefined` if it is not in the bank. */
export function findQuestion(
  questionRef: string,
): PlacementQuestion | undefined {
  return QUESTION_BY_REF.get(questionRef);
}

/** Strip the answer key so a question can be sent to the learner. */
export function toPublicQuestion(
  question: PlacementQuestion,
): PublicPlacementQuestion {
  return {
    questionRef: question.questionRef,
    skill: question.skill,
    prompt: question.prompt,
    options: question.options,
  };
}

/** The full learner-facing question sequence for a placement assessment. */
export function getPublicQuestionSequence(): PublicPlacementQuestion[] {
  return PLACEMENT_QUESTION_BANK.map(toPublicQuestion);
}
