/**
 * Homework endpoints — assignments + submissions.
 *
 * Only the read-side methods needed by the Phase 8 mobile homework tab
 * are exposed. Authoring (create, grade, return) lives only on the
 * web today and will be added to this client when the mobile teacher
 * surface ships.
 *
 * Backend reference: `apps/api/src/modules/homework/`.
 */

import type { ApiClient } from '../client';

export type HomeworkSubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'GRADED'
  | 'RETURNED';

export interface AssignmentSummary {
  id: string;
  lessonId: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  dueAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface SubmissionSummary {
  id: string;
  assignmentId: string;
  studentId: string;
  status: HomeworkSubmissionStatus;
  grade: number | null;
  submittedAt: string | null;
  updatedAt: string;
}

export interface HomeworkEndpoints {
  /** `GET /lessons/:lessonId/assignments` */
  listForLesson(lessonId: string): Promise<AssignmentSummary[]>;
  /**
   * `GET /submissions/me?assignmentId=...` — the calling student's
   * submission row, or `null` if they haven't started one yet.
   */
  myForAssignment(assignmentId: string): Promise<SubmissionSummary | null>;
  /** `GET /submissions/me` — every submission belonging to the caller. */
  mySubmissions(): Promise<SubmissionSummary[]>;
}

export function createHomeworkEndpoints(client: ApiClient): HomeworkEndpoints {
  return {
    listForLesson(lessonId) {
      return client.get<AssignmentSummary[]>(
        `/lessons/${encodeURIComponent(lessonId)}/assignments`,
      );
    },
    myForAssignment(assignmentId) {
      return client.get<SubmissionSummary | null>('/submissions/me', {
        params: { assignmentId },
      });
    },
    mySubmissions() {
      return client.get<SubmissionSummary[]>('/submissions/me');
    },
  };
}
