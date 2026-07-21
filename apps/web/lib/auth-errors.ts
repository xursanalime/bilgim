/**
 * Mapping from backend `error.code` values to user-facing messages.
 *
 * Source codes are listed in the design document (`Auth API` table) and the
 * exception envelope produced by `AllExceptionsFilter` on the API. Any code
 * that the API may return for one of the auth endpoints must have an entry
 * here so that the UI never shows the raw English fallback to end users.
 *
 * Keys are stable strings — they're also used to look up the localized
 * variant via `next-intl` (see `auth.errors.*` in the i18n bundle). The
 * default messages here are in Uzbek to match the existing app default
 * locale.
 */

export type AuthErrorCode =
  // Registration
  | 'EMAIL_ALREADY_EXISTS'
  | 'USERNAME_ALREADY_EXISTS'
  | 'WEAK_PASSWORD'
  | 'VALIDATION_FAILED'
  // Login
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_NOT_VERIFIED'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'ACCOUNT_LOCKED'
  // Tokens
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'INVALID_TOKEN'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'INVALID_REFRESH_TOKEN'
  | 'TOKEN_FAMILY_COMPROMISED'
  // Rate limit
  | 'RATE_LIMITED'
  | 'TOO_MANY_REQUESTS'
  // Network / generic
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN_ERROR';

export const AUTH_ERROR_MESSAGES_UZ: Record<AuthErrorCode, string> = {
  EMAIL_ALREADY_EXISTS:
    "Bu email allaqachon ro'yxatdan o'tgan. Kirishga harakat qilib ko'ring.",
  USERNAME_ALREADY_EXISTS: 'Bu username band. Boshqa username tanlang.',
  WEAK_PASSWORD:
    'Parol juda zaif. Kamida 8 belgi, harf va raqam aralashmasini kiriting.',
  VALIDATION_FAILED:
    "Ma'lumotlar to'g'ri formatda emas. Maydonlarni tekshiring.",

  EMAIL_NOT_VERIFIED:
    'Email tasdiqlangan emas. Pochta qutingizdagi havolani bosing.',
  ACCOUNT_NOT_VERIFIED:
    'Email tasdiqlangan emas. Pochta qutingizdagi havolani bosing.',
  INVALID_CREDENTIALS: "Email yoki parol noto'g'ri.",
  UNAUTHENTICATED: "Email yoki parol noto'g'ri.",
  ACCOUNT_LOCKED:
    "Hisob vaqtincha bloklangan. 15 daqiqadan so'ng qayta urinib ko'ring.",

  TOKEN_EXPIRED: 'Havola muddati tugagan. Yangi havola so\u2019rang.',
  TOKEN_INVALID: 'Havola yaroqsiz. Yangi havola so\u2019rang.',
  INVALID_TOKEN: 'Havola yaroqsiz. Yangi havola so\u2019rang.',
  INVALID_OR_EXPIRED_TOKEN:
    'Havola yaroqsiz yoki muddati tugagan. Yangi havola so\u2019rang.',
  INVALID_REFRESH_TOKEN: 'Sessiya tugagan. Iltimos, qaytadan kiring.',
  TOKEN_FAMILY_COMPROMISED:
    "Xavfsizlik chorasi: barcha qurilmalardan chiqarildi. Iltimos, qaytadan kiring.",

  RATE_LIMITED:
    "So'rovlar juda tez yuborilmoqda. Bir oz kuting va qayta urinib ko'ring.",
  TOO_MANY_REQUESTS:
    "So'rovlar juda tez yuborilmoqda. Bir oz kuting va qayta urinib ko'ring.",

  NETWORK_ERROR: 'Internet bilan aloqa muammosi. Ulanishni tekshiring.',
  INTERNAL_ERROR: 'Server xatoligi. Bir oz kuting va qayta urinib ko\u2019ring.',
  UPSTREAM_ERROR:
    "Tashqi xizmat bilan aloqa xatosi. Bir oz kuting va qayta urinib ko\u2019ring.",
  UNKNOWN_ERROR: 'Kutilmagan xato yuz berdi. Iltimos, qayta urinib ko\u2019ring.',
};

/**
 * Pick a user-facing message for the given error code. Falls back to the
 * `UNKNOWN_ERROR` message when the code isn't recognized.
 *
 * Note: `next-intl` is preferred when a hook is available. This helper is
 * for places that don't have hooks (e.g. server actions / utility code) or
 * for unit tests that want a stable mapping.
 */
export function getAuthErrorMessage(
  code: string | null | undefined,
  fallback?: string,
): string {
  if (!code) return fallback ?? AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR;
  const normalized = code as AuthErrorCode;
  return (
    AUTH_ERROR_MESSAGES_UZ[normalized] ??
    fallback ??
    AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR
  );
}

/**
 * Extracts the error code from an `ApiClientError`'s details envelope.
 * The backend returns
 *   `{ error: { code, message, details, traceId } }`
 * which `apiClient` already unwraps to `details = { code, message, ... }`.
 */
export function extractErrorCode(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const obj = details as Record<string, unknown>;
  if (typeof obj.code === 'string') return obj.code;
  // Sometimes the envelope isn't unwrapped (e.g. older responses).
  if (
    'error' in obj &&
    obj.error &&
    typeof obj.error === 'object' &&
    'code' in (obj.error as object)
  ) {
    const innerCode = (obj.error as Record<string, unknown>).code;
    if (typeof innerCode === 'string') return innerCode;
  }
  return null;
}
