import { HomeworkModuleType } from '@prisma/client';

/**
 * Canonical set of the eight English `Language_Module_Type` values
 * (English-Only Platform Refocus, Req 6.1).
 *
 * After the refocus, assignment creation is restricted to exactly these
 * eight language-skill module types. Every other `HomeworkModuleType`
 * value (MULTIPLE_CHOICE, GAP_FILL, MATCHING, DRAG_DROP,
 * PROJECT_SUBMISSION, CASE_STUDY, MARKETING_COPY, AUDIENCE_ANALYSIS,
 * CONTENT_CALENDAR, MATH_*, CODE_*) is a `Legacy_Module_Type` that the
 * builder must reject with `MODULE_TYPE_NOT_SUPPORTED` (Req 6.3).
 *
 * This list is the single source of truth for the restriction; it is
 * intentionally a `const satisfies readonly HomeworkModuleType[]` so a
 * future enum rename in Prisma fails the build here rather than silently
 * drifting.
 */
export const LANGUAGE_MODULE_TYPES = [
  'WRITING',
  'READING',
  'LISTENING',
  'GRAMMAR',
  'SPELLING',
  'VOCABULARY',
  'SPEAKING',
  'PRONUNCIATION',
] as const satisfies readonly HomeworkModuleType[];

/** One of the eight supported English language-skill module types. */
export type LanguageModuleType = (typeof LANGUAGE_MODULE_TYPES)[number];

/** Fast-membership set used by the server-side restriction check. */
export const LANGUAGE_MODULE_TYPE_SET: ReadonlySet<HomeworkModuleType> =
  new Set<HomeworkModuleType>(LANGUAGE_MODULE_TYPES);

/**
 * Type guard: `true` when the given module type is one of the eight
 * supported English `Language_Module_Type` values, `false` for any
 * `Legacy_Module_Type`.
 */
export function isLanguageModuleType(
  type: HomeworkModuleType,
): type is LanguageModuleType {
  return LANGUAGE_MODULE_TYPE_SET.has(type);
}
