import { HomeworkModuleType } from '@prisma/client';

/**
 * Inputs handed to the AI grading precheck pipeline (Task 18.2,
 * design.md `precheckWritingSubmission`).
 *
 * The runtime extracts the module-type-specific signal that the AI
 * grading worker needs to compose its prompt — for the writing module
 * that means the rubric criteria + the student's free text. Other
 * runtimes (reading, listening, ...) can return their own shape because
 * each module type has its own AI prompt template (`writing.precheck.v1`,
 * `reading.precheck.v1`, …).
 */
export interface AiPromptInputs {
  /**
   * The HomeworkModuleType that produced this prompt. Lets the AI
   * gateway look up the right template key and grading rubric.
   */
  readonly moduleType: HomeworkModuleType;
  /**
   * The student-authored free text that should be graded. Empty string
   * is allowed — the AI worker decides whether to skip on empty.
   */
  readonly studentText: string;
  /**
   * Rubric criteria (from the assignment config) that the prompt should
   * grade against. Empty list when the teacher did not configure a
   * rubric — the AI worker falls back to a default rubric.
   */
  readonly rubric: { name: string; weight: number }[];
  /**
   * Free-form metadata bag for module-specific signals that the AI
   * prompt template might want to include (e.g. `prompt`, `minWords`,
   * `maxWords` for writing). Kept open-ended so each runtime can pass
   * whatever its template needs without expanding the union here.
   */
  readonly metadata: Record<string, unknown>;
}

/**
 * Contract every Homework module runtime implements (Task 18.3).
 *
 * The runtime is the single source of truth for a module's:
 *   - configJson shape (validated when the teacher saves the assignment)
 *   - per-student answer shape (validated on autosave / submit)
 *   - AI prompt skeleton (consumed by the AI grading precheck worker)
 *
 * Each runtime is stateless and side-effect-free. `validateConfig` and
 * `validateAnswer` throw `ZodError` on invalid input — the
 * AssignmentService / SubmissionService translate that into a 400
 * response with a stable error code (`INVALID_MODULE_CONFIG` /
 * `INVALID_MODULE_ANSWER`). The runtime can also throw a tagged
 * `HomeworkRuntimeError` for domain-specific failures (e.g.
 * `ANSWER_TOO_SHORT`) that should map to a different error code.
 */
export interface HomeworkModuleRuntime<
  Config = unknown,
  Answer = unknown,
> {
  /** The HomeworkModuleType this runtime handles. */
  readonly type: HomeworkModuleType;

  /**
   * Validate the assignment-builder `configJson` for this module.
   * Throws `ZodError` on a bad shape so the calling controller can
   * surface a 400 with the field-level details intact.
   */
  validateConfig(configJson: unknown): Config;

  /**
   * Validate the per-student answer slice on autosave or submit.
   * Throws `ZodError` on a bad shape; throws a `HomeworkRuntimeError`
   * with `code = 'ANSWER_TOO_SHORT' | 'ANSWER_TOO_LONG'` for word-count
   * violations so the controller layer can map them to an HTTP 400 with
   * a stable error code.
   */
  validateAnswer(configJson: Config, answer: unknown): Answer;

  /**
   * Build the input bag for the AI grading precheck pipeline. Called
   * by the AI grading worker (Task 18.2 follow-up) once the submission
   * has transitioned to SUBMITTED.
   */
  aiPromptInputs(config: Config, answer: Answer): AiPromptInputs;
}

/**
 * Stable, machine-readable error codes that homework runtimes can throw
 * for domain-specific failures (anything that is NOT a Zod shape error).
 * Keeping them centralised here means the AssignmentService / Submission
 * Service can map them to HTTP responses without coupling to a specific
 * runtime.
 */
export type HomeworkRuntimeErrorCode =
  | 'ANSWER_TOO_SHORT'
  | 'ANSWER_TOO_LONG'
  | 'INVALID_MODULE_CONFIG'
  | 'INVALID_MODULE_ANSWER';

/**
 * Tagged error thrown by runtimes for domain failures. The controller
 * layer intercepts these and maps them onto a `BadRequestException`
 * with the matching `code`. Distinct from `ZodError` so we can preserve
 * the human-readable code in the API response without re-parsing the
 * Zod issue tree.
 */
export class HomeworkRuntimeError extends Error {
  constructor(
    readonly code: HomeworkRuntimeErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HomeworkRuntimeError';
  }
}
