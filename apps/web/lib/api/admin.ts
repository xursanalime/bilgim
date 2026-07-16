import { apiClient } from '../api-client';

export interface AdminUser {
  id: string;
  /** 6-digit public identifier (e.g. "100001"). Returned by the admin API. */
  publicId: string;
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFY';
  createdAt: string;
}

export interface AdminSpecialty {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  dashboardKey: string;
  isActive: boolean;
}

export interface AdminAuditLog {
  id: string;
  adminId: string | null;
  adminEmail: string | null;
  targetId: string | null;
  action: string;
  context: any;
  ip: string;
  createdAt: string;
}

export interface AdminSystemSetting {
  key: string;
  value: any;
  description: string | null;
  updatedAt: string;
}

export interface AdminAiPromptTemplate {
  id: string;
  key: string;
  intent: string;
  systemText: string;
  userTemplate: string;
  modelName: string;
  maxTokens: number;
  isActive: boolean;
}

export interface AdminOnboardingQuestion {
  id: string;
  specialtyId: string | null;
  order: number;
  textUz: string;
  textRu: string;
  textEn: string;
  optionsJson: any;
  isActive: boolean;
}

export interface AdminPlan {
  id: string;
  name: string;
  priceUzs: number;
  interval: 'MONTHLY' | 'YEARLY';
  isActive: boolean;
  /**
   * Richer fields exposed by the backend `Plan` model (see
   * `apps/api/.../admin/dto/plan.dto.ts`). They are optional here so the
   * pre-existing `/admin/plans` consumers keep compiling; the management
   * table (task 13.2) prefers `nameUz`/`intervalDays` when present.
   */
  slug?: string;
  nameUz?: string;
  intervalDays?: number;
  maxStudents?: number | null;
}

/**
 * One of the eight global English skill modules (English-Only Platform
 * Refocus, Req 6.5 / frontend Req 17.2) plus its admin-managed enabled
 * state.
 *
 * BACKEND ASSUMPTION (task 13.2): `GET /admin/english-modules` returns the
 * eight `Language_Module_Type` skills (WRITING, READING, LISTENING, GRAMMAR,
 * SPELLING, VOCABULARY, SPEAKING, PRONUNCIATION) together with whether each
 * is enabled platform-wide. The catalog itself is fixed (it can never gain or
 * lose a skill — see `apps/api/.../catalog/english-module-catalog.ts`); only
 * the `enabled` flag is mutable. If the endpoint does not yet exist the table
 * degrades to an empty state.
 */
export interface AdminEnglishModule {
  /** The `Language_Module_Type` enum value (also the stable row id). */
  moduleType:
    | 'WRITING'
    | 'READING'
    | 'LISTENING'
    | 'GRAMMAR'
    | 'SPELLING'
    | 'VOCABULARY'
    | 'SPEAKING'
    | 'PRONUNCIATION';
  /** Whether newly created Groups seed this skill on by default (Req 6.4). */
  defaultEnabled: boolean;
  /** Current platform-wide enabled state (admin-toggleable, Req 17.3). */
  enabled: boolean;
}

/**
 * An admin-managed Exam_Track option (e.g. IELTS) — the prep tracks an
 * instructor can focus on during onboarding (Req 17.2).
 *
 * BACKEND ASSUMPTION (task 13.2): the `ExamTrack` model is already validated
 * server-side during onboarding (`examTrackFocus` slugs are checked against
 * `prisma.examTrack`). This assumes the matching admin CRUD surface:
 *   GET    /admin/exam-tracks
 *   POST   /admin/exam-tracks
 *   PATCH  /admin/exam-tracks/:id
 *   DELETE /admin/exam-tracks/:id   (destructive — confirmed in the UI)
 */
export interface AdminExamTrack {
  id: string;
  /** URL-safe identifier referenced by `examTrackFocus` (e.g. "ielts"). */
  slug: string;
  nameUz: string;
  nameEn: string;
  isActive: boolean;
  /** Number of instructors currently focusing on this track (optional). */
  instructorCount?: number;
}

/**
 * A CMS page/section managed from the admin console (Req 17.2).
 *
 * BACKEND ASSUMPTION (task 13.2): the existing CMS surface is key/value based
 * (`/admin/system-settings`, see `listSystemSettings`). This richer
 * page-oriented contract assumes a `GET /admin/cms/pages` listing endpoint and
 * a `DELETE /admin/cms/pages/:id` destructive endpoint. Because that endpoint
 * is not yet confirmed, the CMS pages table is a *consistent stub*: it renders
 * the same data-table pattern and confirm-destructive flow as the other
 * tables but degrades to an empty state until the endpoint lands.
 */
export interface AdminCmsPage {
  id: string;
  slug: string;
  titleUz: string;
  status: 'PUBLISHED' | 'DRAFT';
  updatedAt: string;
}

export interface AdminInvoice {
  id: string;
  kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
  amountUzs: number;
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  studentId: string | null;
  teacherId: string | null;
  issuedAt: string;
  paidAt: string | null;
  teacher?: { user: { id: string; fullName: string; email: string } | null } | null;
}

/**
 * Aggregated KPI counters powering the admin dashboard's stat cards.
 *
 * BACKEND ASSUMPTION (task 13.1): a consolidated `GET /admin/stats` endpoint
 * returns this shape in a single round-trip. The existing backend exposes a
 * partial set via `GET /admin/system/stats` (see `getSystemStats` below:
 * `totalUsers`, `activeTeachers`, `paidInvoicesLast30Days`,
 * `pendingEnrollmentRequests`). This richer endpoint is expected to extend
 * that with student counts, active subscription totals, revenue, and the
 * current live-session count. Every field is required so the UI can render
 * deterministic stat cards; the backend should default missing aggregates to
 * `0` rather than omitting them.
 */
export interface AdminDashboardStats {
  /** Total registered users across all roles. */
  totalUsers: number;
  /** Users with the TEACHER role (active accounts). */
  totalTeachers: number;
  /** Users with the STUDENT role (active accounts). */
  totalStudents: number;
  /** Currently active (non-expired) teacher/student subscriptions. */
  activeSubscriptions: number;
  /** Recognized revenue in Uzbek so'm (UZS), e.g. trailing 30 days. */
  revenueUzs: number;
  /** Live class sessions currently in progress. */
  liveSessions: number;
}

/**
 * A single entry in the admin recent-activity feed.
 *
 * BACKEND ASSUMPTION (task 13.1): `GET /admin/activity` returns a reverse-
 * chronological feed unifying notable platform events (user signups, payments,
 * live sessions, moderation actions, audit-log entries) into a normalized
 * shape. Until that endpoint exists, the feed degrades gracefully to an empty
 * state. `type` is intentionally a loose union so new server-side event kinds
 * render under the `other` bucket without a client change.
 */
export interface AdminActivityItem {
  id: string;
  /** Coarse category used to pick an icon/accent in the feed. */
  type: 'user' | 'payment' | 'live' | 'moderation' | 'system' | 'other';
  /** Short, already-localized (or localizable) title for the event. */
  title: string;
  /** Optional supporting detail (actor, amount, target, …). */
  description: string | null;
  /** ISO-8601 timestamp of when the event occurred. */
  createdAt: string;
}

export const adminApi = {
  // Dashboard (task 13.1)
  //
  // KPI counters + recent-activity feed for the admin overview surface.
  // Both rely on documented backend assumptions (`GET /admin/stats`,
  // `GET /admin/activity`) — see the interfaces above.
  getDashboardStats: () =>
    apiClient.get<AdminDashboardStats>('/admin/stats'),

  getRecentActivity: (params: { limit?: number } = {}) =>
    apiClient.get<{ items: AdminActivityItem[] }>('/admin/activity', { params }),

  // Users
  listUsers: (params: { page?: number; limit?: number; role?: string; q?: string }) =>
    apiClient.get<{ items: AdminUser[]; total: number }>('/admin/users', { params }),
  
  updateUserStatus: (id: string, status: string, idempotencyKey: string) =>
    apiClient.patch(`/admin/users/${id}/status`, { status }, { 
      headers: { 'idempotency-key': idempotencyKey } 
    }),

  // Specialties
  listSpecialties: () =>
    apiClient.get<AdminSpecialty[]>('/admin/specialties'),
  
  createSpecialty: (data: Partial<AdminSpecialty>, idempotencyKey: string) =>
    apiClient.post<AdminSpecialty>('/admin/specialties', data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
  
  updateSpecialty: (id: string, data: Partial<AdminSpecialty>, idempotencyKey: string) =>
    apiClient.patch<AdminSpecialty>(`/admin/specialties/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),

  // Audit Logs
  listAuditLogs: (params: { page?: number; limit?: number; adminId?: string; action?: string }) =>
    apiClient.get<{ items: AdminAuditLog[]; total: number }>('/admin/audit-logs', { params }),

  // Users — destructive moderation (task 13.2)
  //
  // BACKEND ASSUMPTION: `POST /admin/users/:id/ban` exists (see
  // `apps/api/.../admin/dto/users.dto.ts` BanUserSchema). Banning is a
  // high-impact, audit-logged action, so the UI confirms it via a Dialog
  // before calling this. An optional `reason` is forwarded for the audit row.
  banUser: (id: string, reason: string | undefined, idempotencyKey: string) =>
    apiClient.post(`/admin/users/${id}/ban`, reason ? { reason } : {}, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  // Plans
  listPlans: () =>
    apiClient.get<AdminPlan[]>('/admin/plans'),

  // Plans — update + destructive delete (task 13.2)
  //
  // BACKEND ASSUMPTION: `PATCH /admin/plans/:id` (UpdatePlanSchema — already
  // implemented) and `DELETE /admin/plans/:id` (assumed). Deleting/retiring a
  // plan is destructive (existing subscribers reference it), so the UI prefers
  // deactivation via PATCH `{ isActive: false }` and confirms hard deletes.
  updatePlan: (id: string, data: Partial<AdminPlan>, idempotencyKey: string) =>
    apiClient.patch<AdminPlan>(`/admin/plans/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  deletePlan: (id: string, idempotencyKey: string) =>
    apiClient.delete(`/admin/plans/${id}`, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  // English module catalog (task 13.2, Req 17.2/17.3)
  //
  // BACKEND ASSUMPTION: `GET /admin/english-modules` returns the eight fixed
  // English skills + their enabled state; `PATCH /admin/english-modules/:type`
  // toggles the platform-wide `enabled` flag. The catalog membership is
  // immutable (the eight `Language_Module_Type` values) — only `enabled` is
  // mutable. Disabling a skill is treated as destructive in the UI (it removes
  // a skill from every new Group), so it is confirmed via a Dialog.
  listEnglishModules: () =>
    apiClient.get<AdminEnglishModule[]>('/admin/english-modules'),

  setEnglishModuleEnabled: (
    moduleType: string,
    enabled: boolean,
    idempotencyKey: string,
  ) =>
    apiClient.patch<AdminEnglishModule>(
      `/admin/english-modules/${moduleType}`,
      { enabled },
      { headers: { 'idempotency-key': idempotencyKey } },
    ),

  // Exam_Track options (task 13.2, Req 17.2)
  //
  // BACKEND ASSUMPTION: full CRUD under `/admin/exam-tracks` (see the
  // `AdminExamTrack` interface). `DELETE` is destructive and confirmed in the
  // UI; the slug is immutable on update so `examTrackFocus` references stay
  // stable.
  listExamTracks: () =>
    apiClient.get<AdminExamTrack[]>('/admin/exam-tracks'),

  createExamTrack: (data: Partial<AdminExamTrack>, idempotencyKey: string) =>
    apiClient.post<AdminExamTrack>('/admin/exam-tracks', data, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  updateExamTrack: (
    id: string,
    data: Partial<AdminExamTrack>,
    idempotencyKey: string,
  ) =>
    apiClient.patch<AdminExamTrack>(`/admin/exam-tracks/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  deleteExamTrack: (id: string, idempotencyKey: string) =>
    apiClient.delete(`/admin/exam-tracks/${id}`, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  // AI prompts — destructive delete (task 13.2)
  //
  // BACKEND ASSUMPTION: `DELETE /admin/ai-prompts/:id` exists alongside the
  // already-implemented create/update. Deleting a prompt template is
  // destructive (it can break a live AI intent), so it is confirmed in the UI.
  deleteAiPrompt: (id: string, idempotencyKey: string) =>
    apiClient.delete(`/admin/ai-prompts/${id}`, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  // CMS pages (task 13.2, Req 17.2)
  //
  // BACKEND ASSUMPTION: `GET /admin/cms/pages` + `DELETE /admin/cms/pages/:id`.
  // The current CMS surface is key/value (`/admin/system-settings`); this
  // page-oriented contract is not yet confirmed, so the CMS pages table is a
  // consistent stub that degrades to an empty state.
  listCmsPages: () =>
    apiClient.get<AdminCmsPage[]>('/admin/cms/pages'),

  deleteCmsPage: (id: string, idempotencyKey: string) =>
    apiClient.delete(`/admin/cms/pages/${id}`, {
      headers: { 'idempotency-key': idempotencyKey },
    }),

  // System Stats
  getSystemStats: () =>
    apiClient.get<{
      totalUsers: number;
      activeTeachers: number;
      paidInvoicesLast30Days: number;
      pendingEnrollmentRequests: number;
      failedDeliveriesLast24h: number;
      pendingOutboxOlderThan5m: number;
    }>('/admin/system/stats'),

  // System Settings
  listSystemSettings: () =>
    apiClient.get<AdminSystemSetting[]>('/admin/system-settings'),
  
  updateSystemSetting: (key: string, value: any, description: string | undefined, idempotencyKey: string) =>
    apiClient.put<AdminSystemSetting>(`/admin/system-settings/${key}`, { value, description }, {
      headers: { 'idempotency-key': idempotencyKey }
    }),

  // AI Prompts
  listAiPrompts: () =>
    apiClient.get<AdminAiPromptTemplate[]>('/admin/ai-prompts'),
  
  createAiPrompt: (data: Partial<AdminAiPromptTemplate>, idempotencyKey: string) =>
    apiClient.post<AdminAiPromptTemplate>('/admin/ai-prompts', data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
  
  updateAiPrompt: (id: string, data: Partial<AdminAiPromptTemplate>, idempotencyKey: string) =>
    apiClient.patch<AdminAiPromptTemplate>(`/admin/ai-prompts/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),

  // Invoices (recent payments for admin dashboard)
  listRecentInvoices: (params: { limit?: number; status?: string } = {}) =>
    apiClient.get<{ items: AdminInvoice[]; total: number }>('/admin/invoices', { params }),

  // Specialties with teacher count
  listSpecialtiesWithCounts: () =>
    apiClient.get<(AdminSpecialty & { teacherCount: number })[]>('/admin/specialties', { params: { withCounts: 'true' } }),

  // Onboarding Questions
  listOnboardingQuestions: () =>
    apiClient.get<AdminOnboardingQuestion[]>('/admin/onboarding-questions'),
  
  createOnboardingQuestion: (data: Partial<AdminOnboardingQuestion>, idempotencyKey: string) =>
    apiClient.post<AdminOnboardingQuestion>('/admin/onboarding-questions', data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
  
  updateOnboardingQuestion: (id: string, data: Partial<AdminOnboardingQuestion>, idempotencyKey: string) =>
    apiClient.patch<AdminOnboardingQuestion>(`/admin/onboarding-questions/${id}`, data, {
      headers: { 'idempotency-key': idempotencyKey }
    }),
};
