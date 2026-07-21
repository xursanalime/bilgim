/**
 * Notifications service — typed wrappers around the `/notifications/*`
 * REST routes (Task 22.2, Req 16.1).
 *
 * Used by:
 *   - The notifications inbox screen (not in this task).
 *   - The background sync task to refresh the unread count when the
 *     OS wakes us up.
 *
 * The functions here are thin: list/unreadCount/markRead share the
 * exact response shape that `apps/api/src/modules/notifications/notifications.controller.ts`
 * returns (`{ items, nextCursor }`, `{ count }`).
 */

import { apiClient } from '../lib/api-client';

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
}

export async function listNotifications(opts?: {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<NotificationsPage> {
  return apiClient.get<NotificationsPage>('/notifications', {
    params: {
      ...(opts?.cursor ? { cursor: opts.cursor } : {}),
      ...(opts?.limit ? { limit: opts.limit } : {}),
      ...(opts?.unreadOnly !== undefined
        ? { unreadOnly: opts.unreadOnly }
        : {}),
    },
  });
}

export async function getUnreadCount(): Promise<UnreadCount> {
  return apiClient.get<UnreadCount>('/notifications/unread-count');
}

export async function markNotificationRead(
  notificationId: string,
): Promise<NotificationItem> {
  return apiClient.patch<NotificationItem>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
  );
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiClient.post<{ updated: number }>('/notifications/mark-all-read');
}
