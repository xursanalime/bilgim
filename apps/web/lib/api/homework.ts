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
};
