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
 *
 * Invite links & join codes (Task 5.1 — Req 9.1, 9.2). Backend ASSUMPTIONS
 * (mirror `apps/api/src/modules/enrollment`); adjust if the routes differ:
 *   POST   /enrollment/invite-links            { groupId, expiresAt?, usesLimit? } → CreatedInvite
 *   GET    /enrollment/invite-links?groupId=   → CreatedInvite[] (active links + usesCount)
 *   DELETE /enrollment/invite-links/:id        → 204 (revoke / deactivate)
 *   GET    /enrollment/invite/:token           → InviteResolution (public preview)
 *   POST   /enrollment/invite/:token/join      → CreateRequestResult (consumes one use)
 *   GET    /enrollment/code/:code              → InviteResolution (public preview by join code)
 *
 * The per-Group join code itself is owned by the catalog module and is
 * set/cleared through `groupsApi.updateJoinCode` (PATCH /catalog/groups/:id).
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
  /**
   * Optional teacher-supplied reason for a REJECTED / REVOKED request.
   * Backend ASSUMPTION (Task 5.3 — Req 9.5): older payloads omit it, so the
   * learner status UI renders the reason only when present and degrades
   * gracefully otherwise. Wire it through `GET /enrollment/my-requests` when
   * the reject/revoke endpoints start persisting a reason.
   */
  reason?: string | null;
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
  id: string;
  token: string;
  url: string;
  groupId: string;
  expiresAt: string | null;
  usesLimit: number | null;
  /**
   * How many times this link has already been used (enrollment requests
   * created via the token). Optional — older backends may omit it; the UI
   * falls back to `0` when absent. Backend ASSUMPTION: the
   * `GET /enrollment/invite-links?groupId=` payload returns `usesCount`.
   */
  usesCount?: number;
  createdAt: string;
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

  /** Resolve an invite link token (preview info only). */
  resolveInvite(token: string) {
    return apiClient.get<InviteResolution>(`/enrollment/invite/${token}`);
  },

  /**
   * Actually use an invite token to create an enrollment request.
   * Increments usesCount atomically. (NEW — completes invite flow)
   */
  joinViaInvite(token: string) {
    return apiClient.post<CreateRequestResult>(`/enrollment/invite/${token}/join`, undefined);
  },

  /** The calling student's own requests (any status). */
  myRequests() {
    return apiClient.get<EnrollmentRequest[]>('/enrollment/my-requests');
  },

  /** Cancel a PENDING_APPROVAL request. (NEW) */
  cancelRequest(requestId: string) {
    return apiClient.delete<void>(`/enrollment/requests/${requestId}`);
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

  /** List active invite links for a group. (NEW) */
  listInviteLinks(groupId: string) {
    return apiClient.get<CreatedInvite[]>(`/enrollment/invite-links?groupId=${groupId}`);
  },

  /** Revoke (deactivate) an invite link. (NEW) */
  revokeInviteLink(inviteLinkId: string) {
    return apiClient.delete<void>(`/enrollment/invite-links/${inviteLinkId}`);
  },
};
