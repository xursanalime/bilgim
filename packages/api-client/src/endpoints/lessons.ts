/**
 * Lesson + group endpoints.
 *
 * Mirrors the surface used by the web app's catalog routes
 * (`apps/web/lib/api/catalog.ts`). Only the endpoints needed by Phase 8
 * mobile screens are exposed here — extend as new screens land. Backend
 * reference: `apps/api/src/modules/catalog/`.
 */

import type { ApiClient } from '../client';

export interface GroupSummary {
  id: string;
  courseId: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED';
  capacity: number | null;
  enrolledCount: number;
  startsAt: string | null;
  createdAt: string;
}

export interface LessonSummary {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  scheduledFor: string | null;
  durationMinutes: number | null;
  orderIndex: number;
  createdAt: string;
}

export interface LessonDetail extends LessonSummary {
  contentMarkdown: string | null;
  attachments: Array<{
    id: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    downloadUrl: string;
  }>;
}

export interface LessonsEndpoints {
  /** `GET /catalog/groups/:groupId/lessons` */
  listForGroup(groupId: string): Promise<LessonSummary[]>;
  /** `GET /catalog/lessons/:id` — runs LessonAccessGuard server-side. */
  get(id: string): Promise<LessonDetail>;
}

export interface GroupsEndpoints {
  /** `GET /enrollment/my-enrollments` — current student's groups. */
  myEnrollments(): Promise<GroupSummary[]>;
  /** `GET /catalog/groups/:id` */
  get(id: string): Promise<GroupSummary>;
}

export function createLessonsEndpoints(client: ApiClient): LessonsEndpoints {
  return {
    listForGroup(groupId) {
      return client.get<LessonSummary[]>(
        `/catalog/groups/${encodeURIComponent(groupId)}/lessons`,
      );
    },
    get(id) {
      return client.get<LessonDetail>(
        `/catalog/lessons/${encodeURIComponent(id)}`,
      );
    },
  };
}

export function createGroupsEndpoints(client: ApiClient): GroupsEndpoints {
  return {
    myEnrollments() {
      return client.get<GroupSummary[]>('/enrollment/my-enrollments');
    },
    get(id) {
      return client.get<GroupSummary>(
        `/catalog/groups/${encodeURIComponent(id)}`,
      );
    },
  };
}
