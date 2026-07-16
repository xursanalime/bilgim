/**
 * Catalog API client — wraps the NestJS `/catalog/*` endpoints for the
 * teacher dashboard's Course / Group / Lesson CRUD pages.
 *
 * Mirrors the DTOs in `apps/api/src/modules/catalog/dto/*.ts`. Keep these
 * type definitions in sync when the backend DTOs evolve.
 */

import { apiClient } from '../api-client';
import type { CefrLevel } from '../discovery-api';

// ── Types (mirror the Prisma + DTO shapes) ─────────────────────────────

export interface Course {
  id: string;
  teacherId: string;
  title: string;
  description: string | null;
  /**
   * Legacy free-text level string. Retained for backward compatibility; the
   * teacher course form keeps it in sync with {@link Course.cefrLevel} so the
   * existing level pills keep rendering. Prefer `cefrLevel` going forward.
   */
  level: string | null;
  /** CEFR proficiency level of the course (A1–C2), or `null` (Req 8.1). */
  cefrLevel: CefrLevel | null;
  /** Optional Exam_Track slug (e.g. `ielts`), or `null` (Req 8.1). */
  examTrack: string | null;
  /** Resolved cover image URL, or `null` when no cover was uploaded. */
  coverUrl: string | null;
  fromPriceUzs: number | null;
  isPublished: boolean;
  isDiscoverable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  courseId: string;
  name: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: string | null;
  endsOn: string | null;
  isDiscoverable?: boolean;
  joinCode?: string | null;
  /**
   * Per-group CEFR level (A1–C2), or `null` (Req 8.2 — "each group with its
   * own name/level"). NOTE: the backend Group model / `CreateGroupSchema` /
   * `UpdateGroupSchema` do not yet persist this field; see the group form
   * for the documented backend assumption. Optional so existing callers keep
   * working until the column lands.
   */
  cefrLevel?: CefrLevel | null;
  /**
   * Server-authoritative Download_Permission (Content Protection Req 4.5 /
   * Req 2.1): whether entitled students may download this group's protected
   * lesson materials. The backend always surfaces this on Group DTOs and
   * coerces a missing column to `false`, so it is safe to treat as required.
   * Only the owning teacher (or an ADMIN) may flip it via {@link
   * groupsApi.setDownloadPermission}; the value is always read back from the DB and
   * can never be asserted by the client.
   */
  downloadAllowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupModule {
  id: string;
  groupId: string;
  moduleType: string;
  isEnabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
}

export interface GroupWithModules extends Group {
  modules: GroupModule[];
}

export type LessonStatus = 'DRAFT' | 'READY' | 'ARCHIVED';
export type LessonType = 'RECORDED' | 'LIVE' | 'HYBRID' | 'TEXT_ONLY';

export interface Lesson {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  type: LessonType;
  status: LessonStatus;
  position: number;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Request DTOs ──────────────────────────────────────────────────────

export interface CreateCourseDto {
  title: string;
  description?: string;
  level?: string;
  /** CEFR proficiency level (A1–C2) for the course (Req 8.1). */
  cefrLevel?: CefrLevel;
  /** Optional Exam_Track slug (e.g. `ielts`) (Req 8.1). */
  examTrack?: string;
  /**
   * Media asset id of an uploaded cover image. The backend resolves this to
   * `Course.coverUrl`. Produced by the simple cover upload (`lib/upload.ts`),
   * not the resumable lesson uploader (Task 4.4).
   */
  coverAssetId?: string;
  fromPriceUzs?: number;
}

export interface UpdateCourseDto {
  title?: string;
  description?: string | null;
  level?: string | null;
  cefrLevel?: CefrLevel | null;
  examTrack?: string | null;
  coverAssetId?: string | null;
  fromPriceUzs?: number | null;
}

export interface CreateGroupDto {
  name: string;
  priceUzs: number;
  capacity?: number;
  startsOn?: string;
  endsOn?: string;
  /**
   * Per-group CEFR level (Req 8.2). Backend assumption: requires
   * `CreateGroupSchema` to accept `cefrLevel`; currently stripped server-side.
   */
  cefrLevel?: CefrLevel;
}

export interface UpdateGroupDto {
  name?: string;
  priceUzs?: number;
  capacity?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  joinCode?: string | null;
  /**
   * Per-group CEFR level (Req 8.2). Backend assumption: requires
   * `UpdateGroupSchema` to accept `cefrLevel`; currently stripped server-side.
   */
  cefrLevel?: CefrLevel | null;
}

export interface CreateLessonDto {
  title: string;
  description?: string;
  type: LessonType;
  position?: number;
  scheduledAt?: string;
}

export interface UpdateLessonDto {
  title?: string;
  description?: string | null;
  type?: LessonType;
  position?: number;
  scheduledAt?: string | null;
}

/**
 * Group protection-settings DTO (Content Protection Req 4.5 / Req 2.1).
 * Currently just the Download_Permission toggle. Backs
 * `PATCH /catalog/groups/:id/settings` (see {@link groupsApi.setDownloadPermission}).
 */
export interface UpdateGroupSettingsDto {
  downloadAllowed: boolean;
}

// ── Course endpoints ──────────────────────────────────────────────────

export const coursesApi = {
  list: () => apiClient.get<Course[]>('/catalog/courses'),
  get: (id: string) => apiClient.get<Course>(`/catalog/courses/${id}`),
  create: (dto: CreateCourseDto) =>
    apiClient.post<Course>('/catalog/courses', dto),
  update: (id: string, dto: UpdateCourseDto) =>
    apiClient.patch<Course>(`/catalog/courses/${id}`, dto),
  remove: (id: string) =>
    apiClient.delete<void>(`/catalog/courses/${id}`),
  publish: (id: string) =>
    apiClient.patch<Course>(`/catalog/courses/${id}/publish`, undefined),
};

// ── Group endpoints ───────────────────────────────────────────────────

export const groupsApi = {
  listForCourse: (courseId: string) =>
    apiClient.get<Group[]>(`/catalog/courses/${courseId}/groups`),
  get: (id: string) => apiClient.get<Group>(`/catalog/groups/${id}`),
  create: (courseId: string, dto: CreateGroupDto) =>
    apiClient.post<GroupWithModules>(
      `/catalog/courses/${courseId}/groups`,
      dto,
    ),
  update: (id: string, dto: UpdateGroupDto) =>
    apiClient.patch<Group>(`/catalog/groups/${id}`, dto),
  /**
   * Set the server-authoritative Download_Permission for a group
   * (Content Protection Req 4.5 / Req 2.1).
   *
   * Backend assumption: `PATCH /catalog/groups/:id/settings` accepts
   * `{ downloadAllowed: boolean }` (Zod-validated `UpdateGroupSettingsSchema`),
   * enforces owning-teacher/ADMIN authorization, reads the value back from the
   * database, and returns the updated Group DTO with `downloadAllowed`
   * surfaced. The client never gets to assert the flag itself. See
   * `apps/api/src/modules/catalog/groups.controller.ts` (`updateSettings`).
   *
   * Takes the raw boolean for ergonomics; the {@link UpdateGroupSettingsDto}
   * envelope is constructed internally.
   */
  setDownloadPermission: (id: string, downloadAllowed: boolean) =>
    apiClient.patch<Group>(`/catalog/groups/${id}/settings`, {
      downloadAllowed,
    } satisfies UpdateGroupSettingsDto),
  remove: (id: string) => apiClient.delete<void>(`/catalog/groups/${id}`),
  updateJoinCode: (groupId: string, joinCode: string | null) =>
    apiClient.patch<Group>(`/catalog/groups/${groupId}`, { joinCode }),
  listModules: (groupId: string) =>
    apiClient.get<GroupModule[]>(`/catalog/groups/${groupId}/modules`),
  toggleModule: (groupId: string, moduleType: string, isEnabled: boolean) =>
    apiClient.patch<GroupModule>(
      `/catalog/groups/${groupId}/modules/${moduleType}`,
      { isEnabled },
    ),
};

// ── Lesson endpoints ──────────────────────────────────────────────────

export const lessonsApi = {
  listForGroup: (groupId: string) =>
    apiClient.get<Lesson[]>(`/catalog/groups/${groupId}/lessons`),
  get: (id: string) => apiClient.get<Lesson>(`/catalog/lessons/${id}`),
  create: (groupId: string, dto: CreateLessonDto) =>
    apiClient.post<Lesson>(`/catalog/groups/${groupId}/lessons`, dto),
  update: (id: string, dto: UpdateLessonDto) =>
    apiClient.patch<Lesson>(`/catalog/lessons/${id}`, dto),
  remove: (id: string) => apiClient.delete<void>(`/catalog/lessons/${id}`),
  publish: (id: string) =>
    apiClient.patch<Lesson>(`/catalog/lessons/${id}/publish`, undefined),
};

// ── Attachments (lesson materials) ────────────────────────────────────

export type AttachmentKind =
  | 'VIDEO'
  | 'AUDIO'
  | 'IMAGE'
  | 'PDF'
  | 'DOC'
  | 'SHEET'
  | 'RECORDING'
  | 'OTHER';

export type AssetStatus =
  | 'UPLOADING'
  | 'UPLOADED'
  | 'TRANSCODING'
  | 'READY'
  | 'FAILED';

export interface AttachmentAsset {
  id: string;
  kind: AttachmentKind;
  status: AssetStatus;
  bytes: number | null;
  contentType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  lessonId: string;
  assetId: string;
  kind: AttachmentKind;
  role: string;
  position: number;
  createdAt: string;
  asset: AttachmentAsset;
  caption?: string | null;
}

export interface CreateAttachmentDto {
  assetId: string;
  kind: AttachmentKind;
  role?: string;
  position?: number;
}

export const attachmentsApi = {
  listForLesson: (lessonId: string) =>
    apiClient.get<Attachment[]>(`/catalog/lessons/${lessonId}/attachments`),
  create: (lessonId: string, dto: CreateAttachmentDto) =>
    apiClient.post<Attachment>(
      `/catalog/lessons/${lessonId}/attachments`,
      dto,
    ),
  update: (id: string, dto: { role?: string; caption?: string | null; position?: number }) =>
    apiClient.patch<Attachment>(`/catalog/attachments/${id}`, dto),
  remove: (id: string) =>
    apiClient.delete<void>(`/catalog/attachments/${id}`),
};

// ── Media uploads ─────────────────────────────────────────────────────

export interface InitUploadDto {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  partsCount: number;
  kind: AttachmentKind;
}

export interface SignedPartUrl {
  partNumber: number;
  url: string;
}

export interface UploadInitiated {
  assetId: string;
  uploadId: string;
  key: string;
  partUrls: SignedPartUrl[];
  expiresInSeconds: number;
  partSizeBytes: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export const mediaApi = {
  initUpload: (dto: InitUploadDto) =>
    apiClient.post<UploadInitiated>('/media/uploads', dto),
  completeUpload: (assetId: string, parts: CompletedPart[]) =>
    apiClient.post<{ assetId: string; status: 'UPLOADED' }>(
      `/media/uploads/${assetId}/complete`,
      { parts },
    ),
  abortUpload: (assetId: string) =>
    apiClient.post<{ assetId: string; status: 'FAILED' }>(
      `/media/uploads/${assetId}/abort`,
    ),
};
