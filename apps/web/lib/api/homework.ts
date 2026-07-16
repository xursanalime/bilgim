/**
 * Homework API client — wraps the NestJS `/lessons/:id/assignments`,
 * `/assignments/:id`, and `/submissions/...` endpoints used by the
 * Homework UI (Task 25.4, Req 11.1, 11.4-11.8, 12.1-12.8).
 *
 * Mirrors the DTOs in `apps/api/src/modules/homework/dto/*.ts`. Keep
 * these type definitions in sync when the backend DTOs evolve.
 */

import { apiClient } from '../api-client';

// ── Domain types ────────────────────────────────────────────────────

/** Mirrors the `HomeworkModuleType` Prisma enum. */
export type HomeworkModuleType =
  | 'WRITING'
  | 'READING'
  | 'LISTENING'
  | 'GRAMMAR'
  | 'SPELLING'
  | 'VOCABULARY'
  | 'SPEAKING'
  | 'PRONUNCIATION'
  | 'MULTIPLE_CHOICE'
  | 'GAP_FILL'
  | 'MATCHING'
  | 'DRAG_DROP'
  | 'PROJECT_SUBMISSION'
  | 'CASE_STUDY'
  | 'MARKETING_COPY'
  | 'AUDIENCE_ANALYSIS'
  | 'CONTENT_CALENDAR'
  | 'MATH_WORD_PROBLEM'
  | 'MATH_EQUATION_SOLVER'
  | 'MATH_GEOMETRY_PROOF'
  | 'CODE_REVIEW'
  | 'CODE_UNIT_TEST';

/**
 * The eight English language-skill module types that homework can be
 * built from (frontend-redesign Req 10.1 / english-only-platform-refocus
 * Req 6.1). Bilgim is English-only, so assignment authoring is restricted
 * to this set — the legacy `HomeworkModuleType` members (MULTIPLE_CHOICE,
 * CODE_REVIEW, MATH_*, …) remain in the type for backward-compatible reads
 * of historical assignments but must NOT be offered when creating new ones.
 *
 * Backend assumption (matches `english-only-platform-refocus` Task 5.1):
 *   POST /lessons/:lessonId/assignments validates every module against
 *   this set and rejects anything else with `MODULE_TYPE_NOT_SUPPORTED`.
 *   It also re-checks that the module is enabled for the lesson's group
 *   (GroupModule.isEnabled), so the client filter below is a UX
 *   convenience, not the source of truth.
 */
export const LANGUAGE_SKILL_MODULE_TYPES = [
  'WRITING',
  'READING',
  'LISTENING',
  'GRAMMAR',
  'VOCABULARY',
  'SPELLING',
  'SPEAKING',
  'PRONUNCIATION',
] as const;

/** Union of the eight English language-skill module types. */
export type LanguageSkillModuleType =
  (typeof LANGUAGE_SKILL_MODULE_TYPES)[number];

/** Narrowing guard — is `type` one of the eight English skill modules? */
export function isLanguageSkillModuleType(
  type: string,
): type is LanguageSkillModuleType {
  return (LANGUAGE_SKILL_MODULE_TYPES as readonly string[]).includes(type);
}

export type SubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'GRADED'
  | 'RETURNED';

export interface AssignmentModule {
  id: string;
  assignmentId: string;
  type: HomeworkModuleType;
  order: number;
  configJson: unknown;
  weight: number;
}

export interface Assignment {
  id: string;
  lessonId: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  totalPoints: number;
  isPublished: boolean;
  createdAt: string;
}

export interface AssignmentWithModules extends Assignment {
  modules: AssignmentModule[];
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  enrollmentId: string | null;
  status: SubmissionStatus;
  answersJson: Record<string, unknown> | null;
  score: number | null;
  aiFlagged: boolean;
  aiLikelihood: number | null;
  submittedAt: string | null;
  gradedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Teacher-authored feedback entries attached to the grade. The current
   * `GET /submissions/:id` response does NOT include these (they live in
   * separate `Feedback` rows), so this is optional and forward-compatible:
   * the learner result view renders them when the backend starts returning
   * them. See the backend assumption note in `submission-result.tsx`.
   */
  feedback?: FeedbackEntry[] | undefined;
  student?: {
    user: {
      id: string;
      fullName: string;
      avatarUrl: string | null;
      email: string;
    };
  };
}

export interface FeedbackEntry {
  moduleId?: string | undefined;
  comment?: string | undefined;
  payload?: unknown;
}

export interface GradePayload {
  score: number;
  feedback?: FeedbackEntry[] | undefined;
}

export interface ReturnPayload {
  comment?: string | undefined;
}

/** Inputs to `POST /lessons/:lessonId/assignments`. */
export interface AssignmentModuleInput {
  type: HomeworkModuleType;
  order: number;
  configJson: unknown;
  weight?: number | undefined;
}

export interface CreateAssignmentPayload {
  title: string;
  description?: string | undefined;
  dueAt?: string | undefined;
  totalPoints?: number | undefined;
  modules: AssignmentModuleInput[];
}

/** Row returned by `GET /homework/available-modules`. */
export interface AvailableModule {
  id: string;
  specialtyId: string;
  moduleType: HomeworkModuleType;
  isActive: boolean;
  defaultEnabled: boolean;
}

/** Severity of an AI-flagged span in an AI grading draft. */
export type AiHighlightSeverity = 'info' | 'warning' | 'error';

/** A span the AI grader flagged in the student's answer. */
export interface AiGradeHighlight {
  from: number;
  to: number;
  severity: AiHighlightSeverity;
  reason: string;
}

/** Inputs to `POST /ai/grade/precheck`. */
export interface AiGradePrecheckPayload {
  submissionId: string;
  text: string;
  rubric?: string | undefined;
  language?: string | undefined;
}

/**
 * Result of `POST /ai/grade/precheck` — the AI-draft grade for a
 * submission. `score` is a 0..1 fraction of `assignment.totalPoints`;
 * `aiLikelihood` is the AI-authorship probability (0..1).
 */
export interface AiGradePrecheckResult {
  score: number;
  summary: string;
  highlights: AiGradeHighlight[];
  aiLikelihood: number;
  aiFlagged: boolean;
}

// ── API methods ─────────────────────────────────────────────────────

export const homeworkApi = {
  // ── Assignments (teacher / student shared reads) ──────────────
  /** GET /lessons/:lessonId/assignments — list every assignment on a lesson. */
  listForLesson(lessonId: string) {
    return apiClient.get<AssignmentWithModules[]>(
      `/lessons/${lessonId}/assignments`,
    );
  },

  /** GET /assignments/:id — single assignment with its module set. */
  getAssignment(id: string) {
    return apiClient.get<AssignmentWithModules>(`/assignments/${id}`);
  },

  /** POST /assignments/:id/publish — flip isPublished=true. */
  publishAssignment(id: string) {
    return apiClient.post<AssignmentWithModules>(
      `/assignments/${id}/publish`,
    );
  },

  /**
   * POST /lessons/:lessonId/assignments — create a draft Assignment with
   * one or more AssignmentModule rows (Task 17.3, Req 11.5, 11.8).
   */
  createForLesson(lessonId: string, dto: CreateAssignmentPayload) {
    return apiClient.post<AssignmentWithModules>(
      `/lessons/${lessonId}/assignments`,
      dto,
    );
  },

  /**
   * GET /homework/available-modules — returns the active SpecialtyModule
   * catalog for the calling teacher (or for an admin-supplied
   * specialtyId / groupId). Used by the AssignmentBuilder picker.
   */
  listAvailableModules(query: {
    groupId?: string | undefined;
    specialtyId?: string | undefined;
  } = {}) {
    const params = new URLSearchParams();
    if (query.groupId) params.set('groupId', query.groupId);
    if (query.specialtyId) params.set('specialtyId', query.specialtyId);
    const qs = params.toString();
    return apiClient.get<AvailableModule[]>(
      `/homework/available-modules${qs ? `?${qs}` : ''}`,
    );
  },

  // ── Submissions — student lifecycle ───────────────────────────
  /** POST /assignments/:assignmentId/submissions — idempotently create a DRAFT row. */
  createDraft(assignmentId: string, answersJson?: Record<string, unknown>) {
    return apiClient.post<Submission>(
      `/assignments/${assignmentId}/submissions`,
      answersJson ? { answersJson } : {},
    );
  },

  /** GET /submissions/me?assignmentId=... — own submission for an assignment (or null). */
  getMyForAssignment(assignmentId: string) {
    return apiClient.get<Submission | null>(
      `/submissions/me?assignmentId=${encodeURIComponent(assignmentId)}`,
    );
  },

  /** PATCH /submissions/:id — autosave answers (DRAFT or RETURNED). */
  updateAnswers(id: string, answersJson: Record<string, unknown>) {
    return apiClient.patch<Submission>(`/submissions/${id}`, {
      answersJson,
    });
  },

  /** GET /homework/pending-count — get count of ungraded/unsubmitted homework. */
  getPendingCount() {
    return apiClient.get<{ count: number }>('/homework/pending-count');
  },

  /** POST /submissions/:id/submit — DRAFT/RETURNED → SUBMITTED. */
  submit(id: string, answersJson?: Record<string, unknown>) {
    return apiClient.post<Submission>(
      `/submissions/${id}/submit`,
      answersJson ? { answersJson } : {},
    );
  },

  // ── Submissions — teacher review / grading ────────────────────
  /** GET /assignments/:assignmentId/submissions — list every student's submission. */
  listForAssignment(assignmentId: string) {
    return apiClient.get<Submission[]>(
      `/assignments/${assignmentId}/submissions`,
    );
  },

  /** GET /submissions/:id — single submission (teacher or owning student). */
  getSubmission(id: string) {
    return apiClient.get<Submission>(`/submissions/${id}`);
  },

  /** POST /submissions/:id/grade — SUBMITTED/IN_REVIEW → GRADED. */
  grade(id: string, payload: GradePayload) {
    return apiClient.post<Submission>(`/submissions/${id}/grade`, payload);
  },

  /** POST /submissions/:id/return — IN_REVIEW/GRADED → RETURNED. */
  returnToStudent(id: string, payload: ReturnPayload = {}) {
    return apiClient.post<Submission>(`/submissions/${id}/return`, payload);
  },

  /**
   * POST /ai/grade/precheck — request an AI-draft grade (score + summary
   * + flagged spans + AI-authorship likelihood) for a submission. Used by
   * the teacher grading panel to seed the score/feedback before the
   * teacher adjusts and finalizes (Req 10.5). The backend write is
   * idempotent: the first call drafts the grade and moves the submission
   * SUBMITTED → IN_REVIEW; later calls re-evaluate without duplicating.
   */
  gradePrecheck(payload: AiGradePrecheckPayload) {
    return apiClient.post<AiGradePrecheckResult>('/ai/grade/precheck', {
      submissionId: payload.submissionId,
      text: payload.text,
      rubric:
        payload.rubric ??
        'Evaluate the quality, accuracy, and clarity of the student submission.',
      language: payload.language ?? 'uz',
    });
  },
};
