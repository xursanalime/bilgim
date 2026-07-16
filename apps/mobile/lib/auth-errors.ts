/**
 * Friendly Uzbek messages for auth-related backend error codes.
 * Mirrors `apps/web/lib/auth-errors.ts` so the two clients render the
 * same text for the same backend code.
 */

import { ApiClientError } from '@bilgim/api-client';

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

  TOKEN_EXPIRED: "Havola muddati tugagan. Yangi havola so'rang.",
  TOKEN_INVALID: "Havola yaroqsiz. Yangi havola so'rang.",
  INVALID_TOKEN: "Havola yaroqsiz. Yangi havola so'rang.",
  INVALID_OR_EXPIRED_TOKEN:
    "Havola yaroqsiz yoki muddati tugagan. Yangi havola so'rang.",
  INVALID_REFRESH_TOKEN: 'Sessiya tugagan. Iltimos, qaytadan kiring.',
  TOKEN_FAMILY_COMPROMISED:
    'Xavfsizlik chorasi: barcha qurilmalardan chiqarildi. Iltimos, qaytadan kiring.',

  RATE_LIMITED:
    "So'rovlar juda tez yuborilmoqda. Bir oz kuting va qayta urinib ko'ring.",
  TOO_MANY_REQUESTS:
    "So'rovlar juda tez yuborilmoqda. Bir oz kuting va qayta urinib ko'ring.",

  NETWORK_ERROR: 'Internet bilan aloqa muammosi. Ulanishni tekshiring.',
  INTERNAL_ERROR:
    "Server xatoligi. Bir oz kuting va qayta urinib ko'ring.",
  UPSTREAM_ERROR:
    "Tashqi xizmat bilan aloqa xatosi. Bir oz kuting va qayta urinib ko'ring.",
  UNKNOWN_ERROR:
    "Kutilmagan xato yuz berdi. Iltimos, qayta urinib ko'ring.",
};

/**
 * Convert any thrown value into a friendly Uzbek string.
 * - `ApiClientError` → uses the `code` from the API envelope when known.
 * - `{ code, message }` plain object → e.g. an `AuthResult.error`.
 * - Other Errors → falls back to the message text.
 * - Anything else → generic UNKNOWN_ERROR copy.
 */
export function getAuthErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiClientError) {
    const code = err.code as AuthErrorCode | undefined;
    if (code && code in AUTH_ERROR_MESSAGES_UZ) {
      return AUTH_ERROR_MESSAGES_UZ[code];
    }
    return err.message || fallback || AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR;
  }
  // `AuthResult.error` shape (`{ code, message }`) used by lib/api/auth.ts.
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  ) {
    const e = err as { code: string; message?: string };
    const code = e.code as AuthErrorCode;
    if (code in AUTH_ERROR_MESSAGES_UZ) return AUTH_ERROR_MESSAGES_UZ[code];
    return e.message || fallback || AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR;
  }
  if (err instanceof Error) {
    return err.message || fallback || AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR;
  }
  return fallback ?? AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR;
}
