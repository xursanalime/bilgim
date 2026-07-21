/**
 * Typed wrappers for the assignment + submission endpoints (Task 25.4).
 *
 * Canonical entry-point referenced by the spec. Most fetchers re-export
 * the existing implementation in `lib/api/homework.ts` so we keep the
 * single fetch layer (`apiClient`) without duplication. The
 * `homeworkFetchers` map exposes the same surface as URL-keyed
 * functions so it slots cleanly into `useSWR(['homework:get', id], …)`
 * style hooks.
 */

import { apiClient } from './api-client';
import {
  homeworkApi,
  type Assignment,
  type AssignmentModule,
  type AssignmentModuleInput,
  type AssignmentWithModules,
  type AvailableModule,
  type CreateAssignmentPayload,
  type FeedbackEntry,
  type GradePayload,
  type HomeworkModuleType,
  type ReturnPayload,
  type Submission,
  type SubmissionStatus,
} from './api/homework';

export {
  homeworkApi,
  type Assignment,
  type AssignmentModule,
  type AssignmentModuleInput,
  type AssignmentWithModules,
  type AvailableModule,
  type CreateAssignmentPayload,
  type FeedbackEntry,
  type GradePayload,
  type HomeworkModuleType,
  type ReturnPayload,
  type Submission,
  type SubmissionStatus,
};

/**
 * SWR-friendly fetcher map. Each entry is keyed by a stable string
 * (used as the SWR cache key) and yields a typed promise.
 *
 * Example:
 *   const { data } = useSWR(
 *     ['homework:assignment', id],
 *     () => homeworkFetchers.assignment(id),
 *   );
 */
export const homeworkFetchers = {
  /** Single assignment + its module list. */
  assignment: (id: string) => homeworkApi.getAssignment(id),

  /** Assignments published on a single lesson. */
  lessonAssignments: (lessonId: string) =>
    homeworkApi.listForLesson(lessonId),

  /** Calling student's submission for a given assignment (or null). */
  mySubmission: (assignmentId: string) =>
    homeworkApi.getMyForAssignment(assignmentId),

  /** Single submission row (teacher review surface). */
  submission: (id: string) => homeworkApi.getSubmission(id),

  /** Every submission for an assignment (teacher grading list). */
  assignmentSubmissions: (assignmentId: string) =>
    homeworkApi.listForAssignment(assignmentId),

  /** Active SpecialtyModule catalog (AssignmentBuilder picker). */
  availableModules: (query: { groupId?: string; specialtyId?: string } = {}) =>
    homeworkApi.listAvailableModules(query),
};

// ── Mutation helpers (thin pass-throughs, kept for symmetry) ─────────

export const homeworkMutations = {
  createDraft: (assignmentId: string, answersJson?: Record<string, unknown>) =>
    homeworkApi.createDraft(assignmentId, answersJson),

  /** PATCH /submissions/:id — autosave answers (DRAFT or RETURNED). */
  updateAnswers: (id: string, answersJson: Record<string, unknown>) =>
    homeworkApi.updateAnswers(id, answersJson),

  /** POST /submissions/:id/submit — DRAFT/RETURNED → SUBMITTED. */
  submit: (id: string, answersJson?: Record<string, unknown>) =>
    homeworkApi.submit(id, answersJson),

  grade: (id: string, payload: GradePayload) =>
    homeworkApi.grade(id, payload),

  returnToStudent: (id: string, payload: ReturnPayload = {}) =>
    homeworkApi.returnToStudent(id, payload),

  /** POST /lessons/:lessonId/assignments — AssignmentBuilder create. */
  createAssignment: (lessonId: string, dto: CreateAssignmentPayload) =>
    homeworkApi.createForLesson(lessonId, dto),

  /** POST /assignments/:id/publish — fan out HOMEWORK_ASSIGNED. */
  publishAssignment: (id: string) => homeworkApi.publishAssignment(id),
};

// Re-export `apiClient` so callers building bespoke SWR fetchers don't
// have to import from two paths.
export { apiClient };
