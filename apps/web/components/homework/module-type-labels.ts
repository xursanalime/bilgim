import type { HomeworkModuleType } from '../../lib/homework-api';

/**
 * Uzbek display names for every homework module type.
 *
 * Deliberately in its own module with no React or browser imports: it is
 * consumed by server components (the lesson page) as well as client ones, and
 * it previously lived in the `module-runtimes` client barrel, which pulls in
 * all seven runtime components.
 */
export const MODULE_TYPE_LABELS: Record<HomeworkModuleType, string> = {
  WRITING: "Yozma ish",
  READING: "Oʻqish",
  LISTENING: "Tinglash",
  GRAMMAR: "Grammatika",
  SPELLING: "Imlo",
  VOCABULARY: "Lugʻat (Flashcard)",
  SPEAKING: "Gapirish",
  PRONUNCIATION: "Talaffuz",
  MULTIPLE_CHOICE: "Test (variantlar)",
  GAP_FILL: "Boʻsh joy toʻldirish",
  MATCHING: "Mos qoʻying",
  DRAG_DROP: "Sudrab tashlash",
  PROJECT_SUBMISSION: "Loyiha topshirish",
  CASE_STUDY: "Case study",
  MARKETING_COPY: "Marketing matni",
  AUDIENCE_ANALYSIS: "Auditoriya tahlili",
  CONTENT_CALENDAR: "Kontent kalendari",
  MATH_WORD_PROBLEM: "Masala (matnli)",
  MATH_EQUATION_SOLVER: "Tenglama yechish",
  MATH_GEOMETRY_PROOF: "Geometriya isboti",
  CODE_REVIEW: "Kod koʻrib chiqish",
  CODE_UNIT_TEST: "Kod testi",
};

/**
 * Tint + ink pairing per module type, drawn from the same brand palette
 * (tailwind.config.ts "Apple Liquid Glass Light") used across the dashboard —
 * keeps module pills visually consistent with the rest of the app instead of
 * the flat gray they fell back to.
 */
export const MODULE_TYPE_TONE: Record<HomeworkModuleType, string> = {
  WRITING: 'bg-blue-tint text-blue-600',
  READING: 'bg-green-tint text-green-600',
  LISTENING: 'bg-purple-tint text-purple-600',
  SPEAKING: 'bg-orange-tint text-orange-600',
  PRONUNCIATION: 'bg-orange-tint text-orange-600',
  GRAMMAR: 'bg-teal/10 text-teal-600',
  SPELLING: 'bg-teal/10 text-teal-600',
  VOCABULARY: 'bg-purple-tint text-purple-600',
  MULTIPLE_CHOICE: 'bg-blue-tint text-blue-600',
  GAP_FILL: 'bg-blue-tint text-blue-600',
  MATCHING: 'bg-blue-tint text-blue-600',
  DRAG_DROP: 'bg-blue-tint text-blue-600',
  PROJECT_SUBMISSION: 'bg-teal/10 text-teal-600',
  CASE_STUDY: 'bg-teal/10 text-teal-600',
  MARKETING_COPY: 'bg-teal/10 text-teal-600',
  AUDIENCE_ANALYSIS: 'bg-teal/10 text-teal-600',
  CONTENT_CALENDAR: 'bg-teal/10 text-teal-600',
  MATH_WORD_PROBLEM: 'bg-green-tint text-green-600',
  MATH_EQUATION_SOLVER: 'bg-green-tint text-green-600',
  MATH_GEOMETRY_PROOF: 'bg-green-tint text-green-600',
  CODE_REVIEW: 'bg-soft text-ink-soft',
  CODE_UNIT_TEST: 'bg-soft text-ink-soft',
};
