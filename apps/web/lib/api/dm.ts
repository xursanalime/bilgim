/**
 * Direct messaging API client — wraps the NestJS `/dm/*` endpoints
 * (Task 25.6, Req 13.1–13.5).
 *
 * Endpoints:
 *   POST  /dm/threads                     → open / reuse a DM thread
 *   GET   /dm/threads                     → cursor-paginated thread list
 *   POST  /dm/threads/:id/messages        → send a message
 *   GET   /dm/threads/:id/messages        → cursor-paginated message history
 *
 * The DTO shapes mirror the API contract in
 * `apps/api/src/modules/dm/dm.service.ts` and `dto/index.ts`.
 */

import { apiClient } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface DmMessage {
  id: string;
  threadId: string;
  /** Per-thread monotonic order (string — backend serializes bigint as string). */
  seq?: string;
  authorId: string;
  text: string;
  assetId?: string | null;
  assetUrl?: string | null;
  createdAt: string;
}

export interface DmPeer {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
}

export interface DmThreadSummary {
  id: string;
  peerId: string;
  peer: DmPeer;
  reciprocated: boolean;
  lastMessage: DmMessage | null;
  unreadCount: number;
  createdAt: string;
}

export interface DmThreadListResponse {
  items: DmThreadSummary[];
  nextCursor: string | null;
}

export interface DmMessageListResponse {
  items: DmMessage[];
  nextCursor: string | null;
}

export interface OpenThreadResult {
  thread: DmThreadSummary;
  created: boolean;
}

export interface SendMessageResult {
  message: DmMessage;
  reciprocated: boolean;
  becameReciprocated: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// API methods
// ──────────────────────────────────────────────────────────────────────

interface ListParams {
  cursor?: string;
  pageSize?: number;
}

export const dmApi = {
  /** Open (or reuse) a DM thread with `recipientId`. */
  openThread(recipientId: string) {
    return apiClient.post<OpenThreadResult>('/dm/threads', { recipientId });
  },

  /** Cursor-paginated list of the caller's threads, newest activity first. */
  listThreads(params: ListParams = {}) {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiClient.get<DmThreadListResponse>(
      `/dm/threads${qs ? `?${qs}` : ''}`,
    );
  },

  /** Get details for a single thread by id. */
  getThread(threadId: string) {
    return apiClient.get<DmThreadSummary>(`/dm/threads/${threadId}`);
  },

  /** Get total unread message count. */
  getUnreadCount() {
    return apiClient.get<{ count: number }>('/dm/unread-count');
  },

  /** Mark all messages in a thread as read. */
  markRead(threadId: string) {
    return apiClient.patch(`/dm/threads/${threadId}/read`);
  },

  /** Send a message on an existing thread. */
  sendMessage(threadId: string, text?: string | null, assetId?: string) {
    return apiClient.post<SendMessageResult>(
      `/dm/threads/${threadId}/messages`,
      { text, assetId },
    );
  },

  /** Cursor-paginated message history for a thread the caller is in. */
  listMessages(threadId: string, params: ListParams = {}) {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiClient.get<DmMessageListResponse>(
      `/dm/threads/${threadId}/messages${qs ? `?${qs}` : ''}`,
    );
  },
};
