/**
 * Enrollment API client — wraps the NestJS `/enrollment/*` endpoints used
 * by the student join flow and the teacher requests inbox.
 *
 * Student:
 *   POST /enrollment/requests        → submit a direct join request
 *   GET  /enrollment/my-requests     → list own requests (any status)
 *   GET  /enrollment/my-enrollments  → list APPROVED enrollments
 *
 * Teacher:
 *   GET  /enrollment/requests              → pending requests inbox
 *   POST /enrollment/requests/:id/approve  → approve a request
 *   POST /enrollment/requests/:id/reject   → reject a request
 *   POST /enrollment/invite-links          → create an invite link
 */

import { apiClient } from '../api-client';

export type EnrollmentStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVOKED';

export interface EnrollmentRequest {
  id: string;
  groupId: string;
  studentId: string;
  status: EnrollmentStatus;
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
  student?: {
    user: {
      id: string;
      fullName: string;
      avatarUrl: string | null;
      email: string;
    };
  };
}

export interface CreateRequestResult {
  requestId: string;
  status: 'PENDING_APPROVAL';
}

export interface TeacherStudentEnrollment {
  id: string;
  groupId: string;
  studentId: string;
  status: EnrollmentStatus;
  approvedAt: string;
  student: {
    user: {
      id: string;
      fullName: string;
      avatarUrl: string | null;
      email: string;
    };
  };
  group: {
    id: string;
    name: string;
    course: {
      id: string;
      title: string;
    };
  };
}

export interface InviteResolution {
  groupId: string;
  groupName: string;
  courseTitle: string;
  teacherName: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface CreateInviteLinkDto {
  groupId: string;
  expiresAt?: string;
  usesLimit?: number;
}

export interface CreatedInvite {
  token: string;
  url: string;
  groupId: string;
}

export const enrollmentApi = {
  // ── Student ──────────────────────────────────────────────────────
  /** Submit a direct join request for a group. */
  createRequest(groupId: string, message?: string) {
    return apiClient.post<CreateRequestResult>('/enrollment/requests', {
      groupId,
      ...(message ? { message } : {}),
    });
  },

  /** Find a group by its unique join code. */
  findByCode(code: string) {
    return apiClient.get<InviteResolution>(`/enrollment/code/${code}`);
  },

  /** Resolve an invite link token. */
  resolveInvite(token: string) {
    return apiClient.get<InviteResolution>(`/enrollment/invite/${token}`);
  },

  /** The calling student's own requests (any status). */
  myRequests() {
    return apiClient.get<EnrollmentRequest[]>('/enrollment/my-requests');
  },

  // ── Teacher ──────────────────────────────────────────────────────
  /** Pending requests across all of the teacher's groups. */
  pendingRequests() {
    return apiClient.get<EnrollmentRequest[]>('/enrollment/requests');
  },

  /** Approved students across all of the teacher's groups. */
  listStudents() {
    return apiClient.get<TeacherStudentEnrollment[]>('/enrollment/students');
  },

  approveRequest(requestId: string) {
    return apiClient.post<{ requestId: string }>(
      `/enrollment/requests/${requestId}/approve`,
      undefined,
    );
  },

  rejectRequest(requestId: string) {
    return apiClient.post<{ requestId: string }>(
      `/enrollment/requests/${requestId}/reject`,
      undefined,
    );
  },

  /** Create a new invite link for a group. */
  createInviteLink(dto: CreateInviteLinkDto) {
    return apiClient.post<CreatedInvite>('/enrollment/invite-links', dto);
  },
};
