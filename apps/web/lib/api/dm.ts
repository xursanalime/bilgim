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

import { apiClient, ApiClientError } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface DmMessage {
  id: string;
  threadId: string;
  authorId: string;
  text: string;
  assetId?: string | null;
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

// ──────────────────────────────────────────────────────────────────────
// Friendly Uzbek error helpers (Property 11 / DM_RATE_LIMITED, plus
// forbidden + conflict envelopes) so every DM call site formats errors
// the same way.
// ──────────────────────────────────────────────────────────────────────

/**
 * Map an `ApiClientError` from a DM-related call into a user-facing
 * Uzbek message. Handles the common error codes returned by the API:
 *
 *   - 429 DM_RATE_LIMITED       → pre-reciprocation daily cap (Prop 11)
 *   - 403 DM_VISIBILITY_FAILED  → not enrolled with this teacher
 *   - 403 DM_FORBIDDEN_ROLE     → role not allowed to use DM
 *   - 403 DM_RECIPIENT_INACTIVE → recipient deactivated
 *   - 403 DM_NOT_PARTICIPANT    → caller isn't part of this thread
 *   - 404 DM_THREAD_NOT_FOUND
 *   - 404 DM_RECIPIENT_NOT_FOUND
 *   - 400 DM_SELF_NOT_ALLOWED
 *   - 409 conflict envelope (generic)
 *
 * Any unrecognised shape falls back to the original API message.
 */
export function describeDmError(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error
      ? error.message
      : "Xabarni yuborib bo'lmadi.";
  }

  const details = (error.details ?? {}) as {
    code?: string;
    message?: string;
  };
  const code = details.code;

  switch (code) {
    case 'DM_RATE_LIMITED':
      return "Bu foydalanuvchi sizga hali javob bermadi, kunlik DM limitiga yetdingiz.";
    case 'DM_VISIBILITY_FAILED':
      return "Siz bu o'qituvchining guruhida ro'yxatdan o'tmagansiz. Avval kursga yoziling.";
    case 'DM_FORBIDDEN_ROLE':
    case 'DM_FORBIDDEN_PEER_ROLE':
      return "Shaxsiy xabarlar faqat talaba va o'qituvchi o'rtasida mumkin.";
    case 'DM_RECIPIENT_INACTIVE':
      return "Qabul qiluvchi hozir faol emas.";
    case 'DM_RECIPIENT_NOT_FOUND':
      return "Qabul qiluvchi topilmadi.";
    case 'DM_NOT_PARTICIPANT':
      return "Siz bu suhbat ishtirokchisi emassiz.";
    case 'DM_THREAD_NOT_FOUND':
      return "Suhbat topilmadi.";
    case 'DM_SELF_NOT_ALLOWED':
      return "O'zingizga xabar yuborib bo'lmaydi.";
    default:
      break;
  }

  // Fallback by HTTP status.
  if (error.statusCode === 429) {
    return "Bu foydalanuvchi sizga hali javob bermadi, kunlik DM limitiga yetdingiz.";
  }
  if (error.statusCode === 403) {
    return "Siz bu o'qituvchi bilan suhbatlasha olmaysiz.";
  }
  if (error.statusCode === 409) {
    return "Konflikt yuz berdi, qaytadan urinib ko'ring.";
  }
  return error.message || "Xabarni yuborib bo'lmadi.";
}

/**
 * Extract the `windowSeconds` hint from a `DM_RATE_LIMITED` envelope so
 * the chat composer can surface a precise countdown. Falls back to
 * 24h when the field is absent or malformed.
 */
export function extractRateLimitWindowSeconds(error: unknown): number {
  if (!(error instanceof ApiClientError) || error.statusCode !== 429) {
    return 24 * 60 * 60;
  }
  const details = error.details as { windowSeconds?: unknown } | null;
  if (
    details &&
    typeof details === 'object' &&
    typeof details.windowSeconds === 'number'
  ) {
    return details.windowSeconds;
  }
  return 24 * 60 * 60;
}
