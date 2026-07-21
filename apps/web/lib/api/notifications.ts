/**
 * Notifications API client — wraps the NestJS `/notifications/*` endpoints
 * used by the in-app notification center and preferences page (Task 25.6,
 * Req 16.1–16.6).
 *
 * Endpoints:
 *   GET    /notifications              → cursor-paginated inbox
 *   GET    /notifications/unread-count → bell badge counter
 *   PATCH  /notifications/:id/read     → mark single notification as read
 *   POST   /notifications/mark-all-read
 *   GET    /notifications/preferences  → kind × channel matrix
 *   PATCH  /notifications/preferences  → bulk update preferences
 *   PUT    /notifications/preferences/:kind/:channel → flip single
 *
 * The DTO shapes mirror the API contract in
 * `apps/api/src/modules/notifications/{dto,notifications.service}.ts`.
 * Keep them in sync when the backend evolves.
 */

import { apiClient } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export const NOTIFICATION_KINDS = [
  'ENROLLMENT_REQUESTED',
  'ENROLLMENT_APPROVED',
  'ENROLLMENT_REJECTED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'LESSON_PUBLISHED',
  'SCHEDULE_CHANGED',
  'LIVE_STARTED',
  'LIVE_REMINDER',
  'HOMEWORK_ASSIGNED',
  'HOMEWORK_GRADED',
  'AI_REVIEW_READY',
  'TRIAL_ENDING',
  'SUBSCRIPTION_PAST_DUE',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = [
  'IN_APP',
  'EMAIL',
  'TELEGRAM',
  'PUSH',
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  /**
   * Notification-specific structured payload (the Prisma `data` JSON
   * column). Topics use this to carry route hints (e.g. `lessonId`,
   * `assignmentId`) and an optional `deeplink` string.
   */
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface NotificationPreference {
  kind: NotificationKind;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface BulkUpdateResponse {
  updated: number;
  preferences: NotificationPreference[];
}

// ──────────────────────────────────────────────────────────────────────
// API methods
// ──────────────────────────────────────────────────────────────────────

interface ListParams {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
}

export const notificationsApi = {
  /**
   * Cursor-paginated inbox (newest first).
   * `cursor` is the ISO timestamp of the last seen `createdAt`.
   */
  list(params: ListParams = {}) {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.unreadOnly) search.set('unreadOnly', 'true');
    const qs = search.toString();
    return apiClient.get<NotificationListResponse>(
      `/notifications${qs ? `?${qs}` : ''}`,
    );
  },

  /** Badge counter for the navbar bell. */
  unreadCount() {
    return apiClient.get<{ count: number }>('/notifications/unread-count');
  },

  /** Mark a single notification as read. Returns the updated row. */
  markRead(id: string) {
    return apiClient.patch<NotificationItem>(
      `/notifications/${id}/read`,
      undefined,
    );
  },

  /** Bulk mark every unread notification as read for the caller. */
  markAllRead() {
    return apiClient.post<{ updated: number }>(
      '/notifications/mark-all-read',
      undefined,
    );
  },

  /** Full kind × channel preference matrix. */
  getPreferences() {
    return apiClient.get<NotificationPreference[]>(
      '/notifications/preferences',
    );
  },

  /** Bulk update preferences in a single round-trip. */
  bulkUpdatePreferences(preferences: NotificationPreference[]) {
    return apiClient.patch<BulkUpdateResponse>(
      '/notifications/preferences',
      { preferences },
    );
  },

  /** Toggle a single (kind, channel) tuple. */
  updatePreference(
    kind: NotificationKind,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    return apiClient.put<NotificationPreference>(
      `/notifications/preferences/${kind}/${channel}`,
      { enabled },
    );
  },
};

// ──────────────────────────────────────────────────────────────────────
// Display helpers
// ──────────────────────────────────────────────────────────────────────

/** Uzbek labels for each notification kind. Used for filters and UI. */
export const NOTIFICATION_KIND_LABELS_UZ: Record<NotificationKind, string> = {
  ENROLLMENT_REQUESTED: "Yangi qo'shilish so'rovi",
  ENROLLMENT_APPROVED: 'Yozilish tasdiqlandi',
  ENROLLMENT_REJECTED: 'Yozilish rad etildi',
  PAYMENT_SUCCEEDED: "To'lov muvaffaqiyatli",
  PAYMENT_FAILED: "To'lov muvaffaqiyatsiz",
  LESSON_PUBLISHED: "Yangi dars e'lon qilindi",
  SCHEDULE_CHANGED: "Jadval o'zgardi",
  LIVE_STARTED: 'Jonli efir boshlandi',
  LIVE_REMINDER: 'Jonli efir eslatmasi',
  HOMEWORK_ASSIGNED: 'Yangi uy vazifa',
  HOMEWORK_GRADED: 'Uy vazifa baholandi',
  AI_REVIEW_READY: 'AI tahlil tayyor',
  TRIAL_ENDING: 'Sinov muddati tugayapti',
  SUBSCRIPTION_PAST_DUE: 'Obuna muddati o\'tdi',
};

export const NOTIFICATION_CHANNEL_LABELS_UZ: Record<
  NotificationChannel,
  string
> = {
  IN_APP: 'Ilova ichida',
  EMAIL: 'Email',
  TELEGRAM: 'Telegram',
  PUSH: 'Push',
};
