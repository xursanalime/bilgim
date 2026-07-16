/**
 * Lesson progress API wrapper (frontend-redesign task 2.3, Req 6.6).
 *
 * Replaces the previous `localStorage` "mark watched" stopgap in
 * `components/lesson/lesson-player.tsx` with a server-side progress call so
 * completion is persisted per-user on the backend (and can later drive
 * gamification / analytics) instead of living only in the browser.
 *
 * Backend contract (integration assumption — see task report):
 *   - POST /catalog/lessons/:id/progress   body { completed: boolean }
 *       → records the calling student's completion for the lesson.
 *   - GET  /catalog/groups/:groupId/progress
 *       → LessonProgressEntry[] for the calling student in that group.
 *
 * These routes follow the existing `/catalog/lessons/:id` +
 * `/catalog/groups/:groupId/lessons` surface. Until the backend ships them,
 * `listGroupProgress` degrades gracefully (returns `[]` on 404 / 501) so the
 * lesson navigation still renders; `markLessonComplete` surfaces real errors
 * to the caller's mutation state.
 */

import { apiClient, ApiClientError } from './api-client';

export interface LessonProgressEntry {
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
}

/** Treat "endpoint not deployed yet" responses as "no progress recorded". */
function isNotImplemented(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.statusCode === 404 || error.statusCode === 501)
  );
}

export const lessonProgressApi = {
  /**
   * Record (or clear) the calling student's completion for a lesson.
   * Returns the persisted progress entry.
   */
  markLessonComplete(lessonId: string, completed = true) {
    return apiClient.post<LessonProgressEntry>(
      `/catalog/lessons/${lessonId}/progress`,
      { completed },
    );
  },

  /**
   * Completion entries for every lesson the calling student has progress on
   * within a group. Resolves to `[]` when the backend route is not yet
   * available so navigation/lock UI never hard-fails.
   */
  async listGroupProgress(groupId: string): Promise<LessonProgressEntry[]> {
    try {
      return await apiClient.get<LessonProgressEntry[]>(
        `/catalog/groups/${groupId}/progress`,
      );
    } catch (error) {
      if (isNotImplemented(error)) return [];
      throw error;
    }
  },
};
