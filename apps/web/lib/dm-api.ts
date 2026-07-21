/**
 * Public re-export of the direct-messaging API client (Task 25.6).
 *
 * The implementation lives at `lib/api/dm.ts` and wraps the NestJS
 * `/dm/*` endpoints. The task checklist asks for `dm-api.ts` under
 * `apps/web/lib`, so this file forwards the typed surface under a
 * single import.
 *
 * Endpoints wrapped (see `apps/api/src/modules/dm/dm.controller.ts`):
 *   POST  /dm/threads                     → open / reuse a thread
 *   GET   /dm/threads                     → list rooms (cursor-paginated)
 *   POST  /dm/threads/:id/messages        → send a message
 *   GET   /dm/threads/:id/messages        → message history
 *
 * Note: the task brief references `/dm/rooms` — the canonical API path
 * is `/dm/threads` (a "thread" is a 1:1 ChatRoom). Naming aside, the
 * wrapper exposes the same domain surface.
 *
 * Friendly Uzbek error helper (Property 11 / DM_RATE_LIMITED, plus
 * forbidden + conflict envelopes) is provided here so every caller
 * formats messages the same way.
 */

import { ApiClientError } from './api-client';

export {
  dmApi,
  type DmMessage,
  type DmThreadSummary,
  type DmThreadListResponse,
  type DmMessageListResponse,
  type OpenThreadResult,
  type SendMessageResult,
} from './api/dm';

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
