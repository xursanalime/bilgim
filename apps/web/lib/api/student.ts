/**
 * Student API client — wraps the NestJS endpoints used by the student
 * dashboard pages (Task 25.3).
 *
 * Covered endpoints:
 *  - GET  /enrollment/my-enrollments        → student dashboard groups list
 *  - GET  /catalog/groups/:id               → group detail (basic fields)
 *  - GET  /catalog/groups/:id/lessons       → lesson list (READY only for student)
 *  - GET  /catalog/lessons/:id              → single lesson + access check
 *  - GET  /schedule/groups/:id/events       → schedule + upcoming occurrences
 *  - GET  /lessons/:id/assignments          → assignments for a lesson
 *  - GET  /submissions/me?assignmentId=...  → my submission for an assignment
 *  - GET  /notifications                    → recent notifications
 *  - GET  /media/assets/:id/url             → signed playback URL (HLS or original)
 *  - GET  /live/sessions/:lessonId          → current live session heartbeat
 */

import { apiClient } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Shared types — mirror the API response shapes loosely so we don't
// drift if the server adds optional fields.
// ──────────────────────────────────────────────────────────────────────

export interface StudentEnrollment {
  id: string;
  groupId: string;
  studentId: string;
  status: 'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  approvedAt: string | null;
  invoiceId: string | null;
}

export interface StudentGroup {
  id: string;
  courseId: string;
  name: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
}

export type LessonStatusLiteral = 'DRAFT' | 'READY' | 'ARCHIVED';
export type LessonTypeLiteral =
  | 'VIDEO'
  | 'LIVE'
  | 'TEXT'
  | 'AUDIO'
  | 'FILE'
  | 'HOMEWORK';

export interface LessonSummary {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  type: LessonTypeLiteral;
  status: LessonStatusLiteral;
  position: number;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface LessonAttachment {
  id: string;
  lessonId: string;
  assetId: string;
  kind: 'VIDEO' | 'AUDIO' | 'PDF' | 'IMAGE' | 'FILE' | 'DOCX' | 'XLSX';
  role: string;
  position: number;
}

export interface LessonDetail extends LessonSummary {
  group?: {
    id: string;
    courseId: string;
    course?: { id: string; teacherId: string };
  };
  attachments?: LessonAttachment[];
}

export interface ScheduleOccurrence {
  startsAt: string;
  endsAt: string;
  isException: boolean;
}

export interface ScheduleResponse {
  schedule: {
    id: string;
    groupId: string;
    rrule: string;
    timezone: string;
    durationMin: number;
    version: number;
  } | null;
  exceptions: Array<{
    id: string;
    originalAt: string;
    newAt: string | null;
    cancelled: boolean;
    reason: string | null;
  }>;
  upcoming: ScheduleOccurrence[];
}

export interface AssignmentSummary {
  id: string;
  lessonId: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  totalPoints: number;
  isPublished: boolean;
}

export interface SubmissionSummary {
  id: string;
  assignmentId: string;
  studentId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'GRADED' | 'RETURNED';
  score: number | null;
  submittedAt: string | null;
  gradedAt: string | null;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsListResponse {
  data: NotificationItem[];
  meta?: { nextCursor: string | null };
}

export interface PlaybackUrlEntry {
  role: 'manifest' | 'variant' | 'original';
  key: string;
  url: string;
  variant?: string;
}

export interface MediaPlaybackResponse {
  assetId: string;
  kind: string;
  status: string;
  url: string;
  type: 'manifest' | 'variant' | 'original';
  urls: PlaybackUrlEntry[];
  expiresInSeconds: number;
  expiresAt: string;
}

export interface LiveSessionHeartbeat {
  id: string;
  lessonId: string;
  status: 'SCHEDULED' | 'STARTING' | 'LIVE' | 'ENDED' | 'RECORDING_FAILED';
  startedAt: string | null;
  endedAt: string | null;
  roomId: string | null;
  sfu?: {
    routerId?: string;
    rtpCapabilities?: unknown;
  } | null;
}

// ──────────────────────────────────────────────────────────────────────
// API methods
// ──────────────────────────────────────────────────────────────────────

export const studentApi = {
  /** Approved enrollments for the calling student. */
  myEnrollments() {
    return apiClient.get<StudentEnrollment[]>('/enrollment/my-enrollments');
  },

  /** Single group (by id). The student endpoint piggy-backs on the
   * teacher endpoint — the API resolves access via the schedule/lesson
   * paths the dashboard already calls; here we only need scalar fields. */
  getGroup(id: string) {
    return apiClient.get<StudentGroup>(`/catalog/groups/${id}`);
  },

  /** Lessons for a group (READY only, server-enforced for STUDENT role). */
  listLessons(groupId: string) {
    return apiClient.get<LessonSummary[]>(
      `/catalog/groups/${groupId}/lessons`,
    );
  },

  /** Full lesson with attachments (LessonAccessGuard runs server-side). */
  getLesson(id: string) {
    return apiClient.get<LessonDetail>(`/catalog/lessons/${id}`);
  },

  /** Schedule + RRULE-expanded upcoming occurrences for a group. */
  groupSchedule(groupId: string) {
    return apiClient.get<ScheduleResponse>(
      `/schedule/groups/${groupId}/events`,
    );
  },

  /** Assignments attached to a lesson. */
  lessonAssignments(lessonId: string) {
    return apiClient.get<AssignmentSummary[]>(
      `/lessons/${lessonId}/assignments`,
    );
  },

  /** Calling student's submission for an assignment (or null). */
  mySubmission(assignmentId: string) {
    return apiClient.get<SubmissionSummary | null>(
      `/submissions/me?assignmentId=${encodeURIComponent(assignmentId)}`,
    );
  },

  /** Inbox feed (recent notifications). */
  notifications(limit = 10) {
    return apiClient.get<NotificationsListResponse>(
      `/notifications?limit=${limit}`,
    );
  },

  /** Signed playback URL for a media asset (HLS manifest or original). */
  getMediaPlayback(assetId: string) {
    return apiClient.get<MediaPlaybackResponse>(
      `/media/assets/${assetId}/url`,
    );
  },

  /** Heartbeat for the live session attached to a lesson. */
  getLiveSession(lessonId: string) {
    return apiClient.get<LiveSessionHeartbeat>(
      `/live/sessions/${lessonId}`,
    );
  },
};
