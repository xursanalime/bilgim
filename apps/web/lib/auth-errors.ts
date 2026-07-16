/**
 * Localized auth API error catalog.
 *
 * Maps backend `error.code` values (produced by the NestJS auth module and
 * unwrapped by `AllExceptionsFilter` into `{ code, message, details, traceId }`)
 * to clear, user-facing copy. Every code the auth endpoints can return for
 * register / login / verify-email / forgot-password / reset-password should
 * have an entry so the UI never shows the raw English API fallback.
 *
 * Messages are provided for the three platform locales:
 *   - `uz` (default), `ru`, `en`
 * with `uz` used as the ultimate fallback when a locale-specific string is
 * missing. Unknown codes fall back to a generic `UNKNOWN_ERROR` message.
 *
 * The component-level UI strings are still hard-coded Uzbek (forms are not
 * yet wired to `next-intl` message bundles), so this catalog is the single
 * source of truth for localized API-error copy and accepts the active locale
 * directly rather than relying on a translation hook.
 */

export type SupportedLocale = 'uz' | 'ru' | 'en';

export type AuthErrorCode =
  // Registration
  | 'EMAIL_ALREADY_EXISTS'
  | 'USERNAME_ALREADY_EXISTS'
  | 'WEAK_PASSWORD'
  | 'VALIDATION_FAILED'
  // Login / account state
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_NOT_VERIFIED'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'USER_NOT_FOUND'
  | 'WRONG_CURRENT_PASSWORD'
  // Lockouts / brute-force protection
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_LOCKED_TEMP'
  | 'ACCOUNT_LOCKED_HARD'
  | 'LOGIN_LOCKED'
  | 'IP_DENYLISTED'
  | 'IP_BLOCKED_TEMP'
  | 'CREDENTIAL_STUFFING_BLOCKED'
  | 'IMPOSSIBLE_TRAVEL'
  // MFA
  | 'MFA_REQUIRED'
  | 'MFA_REQUIRED_FOR_ROLE'
  | 'MFA_NOT_AVAILABLE'
  | 'INVALID_TOTP_CODE'
  | 'INVALID_MFA_CODE'
  | 'INVALID_BACKUP_CODE'
  | 'MFA_FACTOR_REQUIRED'
  | 'TOTP_NOT_INITIALISED'
  | 'TOTP_NOT_ENABLED'
  | 'MFA_CREDENTIAL_NOT_FOUND'
  | 'WEBAUTHN_NOT_ENROLLED'
  | 'WEBAUTHN_CHALLENGE_EXPIRED'
  | 'WEBAUTHN_VERIFICATION_FAILED'
  | 'WEBAUTHN_CREDENTIAL_UNKNOWN'
  // Tokens (verify-email / password reset / refresh)
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'INVALID_TOKEN'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'INVALID_REFRESH_TOKEN'
  | 'TOKEN_FAMILY_COMPROMISED'
  // Rate limit / bot detection
  | 'RATE_LIMITED'
  | 'TOO_MANY_REQUESTS'
  | 'CAPTCHA_REQUIRED'
  | 'BOT_DETECTED'
  // Network / generic
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN_ERROR';

const UZ: Record<AuthErrorCode, string> = {
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
  USER_NOT_FOUND: "Foydalanuvchi topilmadi.",
  WRONG_CURRENT_PASSWORD: "Joriy parol noto'g'ri.",

  ACCOUNT_LOCKED:
    "Hisob vaqtincha bloklangan. 15 daqiqadan so'ng qayta urinib ko'ring.",
  ACCOUNT_LOCKED_TEMP:
    "Juda ko'p urinish. Hisob vaqtincha bloklandi, biroz kuting.",
  ACCOUNT_LOCKED_HARD:
    "Xavfsizlik uchun hisob bloklandi. Emailingizga yuborilgan ko'rsatma orqali oching.",
  LOGIN_LOCKED:
    "Juda ko'p muvaffaqiyatsiz urinish. Bir oz kuting va qayta urinib ko'ring.",
  IP_DENYLISTED:
    "Ushbu tarmoqdan kirish vaqtincha cheklangan. Keyinroq urinib ko'ring.",
  IP_BLOCKED_TEMP:
    "Ushbu tarmoqdan so'rovlar vaqtincha bloklandi. Bir oz kuting.",
  CREDENTIAL_STUFFING_BLOCKED:
    "Shubhali faollik aniqlandi. Xavfsizlik uchun kirish vaqtincha cheklandi.",
  IMPOSSIBLE_TRAVEL:
    "Notanish joydan kirish aniqlandi. Xavfsizlik uchun emailingizni tekshiring.",

  MFA_REQUIRED: "Ikki bosqichli tasdiqlash kerak. Kodingizni kiriting.",
  MFA_REQUIRED_FOR_ROLE:
    "Bu rol uchun ikki bosqichli himoya majburiy. Avval uni sozlang.",
  MFA_NOT_AVAILABLE:
    "Ikki bosqichli tasdiqlash hozircha mavjud emas. Administrator bilan bog'laning.",
  INVALID_TOTP_CODE: "Kod noto'g'ri yoki muddati o'tgan. Qaytadan kiriting.",
  INVALID_MFA_CODE: "Kod noto'g'ri. Qaytadan urinib ko'ring.",
  INVALID_BACKUP_CODE: "Zaxira kodi noto'g'ri yoki allaqachon ishlatilgan.",
  MFA_FACTOR_REQUIRED: "Tasdiqlash kodi yoki passkey kiriting.",
  TOTP_NOT_INITIALISED: "Avval authenticator ilovasini ulang.",
  TOTP_NOT_ENABLED: "Bu hisobda TOTP yoqilmagan.",
  MFA_CREDENTIAL_NOT_FOUND: "Bunday MFA vositasi topilmadi.",
  WEBAUTHN_NOT_ENROLLED: "Hech qanday passkey ro'yxatdan o'tmagan.",
  WEBAUTHN_CHALLENGE_EXPIRED: "So'rov muddati tugadi. Qaytadan urinib ko'ring.",
  WEBAUTHN_VERIFICATION_FAILED: "Passkey tekshiruvi muvaffaqiyatsiz tugadi.",
  WEBAUTHN_CREDENTIAL_UNKNOWN: "Bu passkey hisobingizga ulanmagan.",

  TOKEN_EXPIRED: 'Havola muddati tugagan. Yangi havola so\u2019rang.',
  TOKEN_INVALID: 'Havola yaroqsiz. Yangi havola so\u2019rang.',
  INVALID_TOKEN: 'Havola yaroqsiz. Yangi havola so\u2019rang.',
  INVALID_OR_EXPIRED_TOKEN:
    'Havola yaroqsiz yoki muddati tugagan. Yangi havola so\u2019rang.',
  INVALID_REFRESH_TOKEN: 'Sessiya tugagan. Iltimos, qaytadan kiring.',
  TOKEN_FAMILY_COMPROMISED:
    'Xavfsizlik chorasi: barcha qurilmalardan chiqarildi. Iltimos, qaytadan kiring.',

  RATE_LIMITED:
    "So'rovlar juda tez yuborilmoqda. Bir oz kuting va qayta urinib ko'ring.",
  TOO_MANY_REQUESTS:
    "So'rovlar juda tez yuborilmoqda. Bir oz kuting va qayta urinib ko'ring.",
  CAPTCHA_REQUIRED:
    "Xavfsizlik tekshiruvini bajaring va qayta urinib ko'ring.",
  BOT_DETECTED:
    "So'rov avtomatik trafik sifatida aniqlandi. Birozdan so'ng qayta urinib ko'ring.",

  NETWORK_ERROR: 'Internet bilan aloqa muammosi. Ulanishni tekshiring.',
  INTERNAL_ERROR: 'Server xatoligi. Bir oz kuting va qayta urinib ko\u2019ring.',
  UPSTREAM_ERROR:
    "Tashqi xizmat bilan aloqa xatosi. Bir oz kuting va qayta urinib ko\u2019ring.",
  UNKNOWN_ERROR: 'Kutilmagan xato yuz berdi. Iltimos, qayta urinib ko\u2019ring.',
};

const RU: Record<AuthErrorCode, string> = {
  EMAIL_ALREADY_EXISTS:
    'Этот email уже зарегистрирован. Попробуйте войти.',
  USERNAME_ALREADY_EXISTS: 'Это имя пользователя занято. Выберите другое.',
  WEAK_PASSWORD:
    'Пароль слишком простой. Используйте минимум 8 символов с буквами и цифрами.',
  VALIDATION_FAILED: 'Данные заполнены неверно. Проверьте поля.',

  EMAIL_NOT_VERIFIED:
    'Email не подтверждён. Нажмите ссылку в письме.',
  ACCOUNT_NOT_VERIFIED:
    'Email не подтверждён. Нажмите ссылку в письме.',
  INVALID_CREDENTIALS: 'Неверный email или пароль.',
  UNAUTHENTICATED: 'Неверный email или пароль.',
  USER_NOT_FOUND: 'Пользователь не найден.',
  WRONG_CURRENT_PASSWORD: 'Текущий пароль неверен.',

  ACCOUNT_LOCKED:
    'Аккаунт временно заблокирован. Повторите через 15 минут.',
  ACCOUNT_LOCKED_TEMP:
    'Слишком много попыток. Аккаунт временно заблокирован, подождите.',
  ACCOUNT_LOCKED_HARD:
    'Аккаунт заблокирован в целях безопасности. Разблокируйте по инструкции из письма.',
  LOGIN_LOCKED:
    'Слишком много неудачных попыток. Подождите и повторите позже.',
  IP_DENYLISTED:
    'Доступ из этой сети временно ограничен. Повторите позже.',
  IP_BLOCKED_TEMP:
    'Запросы из этой сети временно заблокированы. Подождите.',
  CREDENTIAL_STUFFING_BLOCKED:
    'Обнаружена подозрительная активность. Вход временно ограничен.',
  IMPOSSIBLE_TRAVEL:
    'Обнаружен вход из необычного места. Проверьте email в целях безопасности.',

  MFA_REQUIRED: 'Требуется двухфакторная проверка. Введите код.',
  MFA_REQUIRED_FOR_ROLE:
    'Для этой роли обязательна двухфакторная защита. Сначала настройте её.',
  MFA_NOT_AVAILABLE:
    'Двухфакторная проверка сейчас недоступна. Обратитесь к администратору.',
  INVALID_TOTP_CODE: 'Неверный или просроченный код. Введите ещё раз.',
  INVALID_MFA_CODE: 'Неверный код. Попробуйте снова.',
  INVALID_BACKUP_CODE: 'Резервный код неверен или уже использован.',
  MFA_FACTOR_REQUIRED: 'Введите код подтверждения или используйте passkey.',
  TOTP_NOT_INITIALISED: 'Сначала подключите приложение-аутентификатор.',
  TOTP_NOT_ENABLED: 'TOTP не включён для этого аккаунта.',
  MFA_CREDENTIAL_NOT_FOUND: 'Такой способ MFA не найден.',
  WEBAUTHN_NOT_ENROLLED: 'Ни один passkey не зарегистрирован.',
  WEBAUTHN_CHALLENGE_EXPIRED: 'Срок запроса истёк. Попробуйте снова.',
  WEBAUTHN_VERIFICATION_FAILED: 'Проверка passkey не удалась.',
  WEBAUTHN_CREDENTIAL_UNKNOWN: 'Этот passkey не привязан к вашему аккаунту.',

  TOKEN_EXPIRED: 'Срок действия ссылки истёк. Запросите новую.',
  TOKEN_INVALID: 'Ссылка недействительна. Запросите новую.',
  INVALID_TOKEN: 'Ссылка недействительна. Запросите новую.',
  INVALID_OR_EXPIRED_TOKEN:
    'Ссылка недействительна или истекла. Запросите новую.',
  INVALID_REFRESH_TOKEN: 'Сессия истекла. Войдите снова.',
  TOKEN_FAMILY_COMPROMISED:
    'Мера безопасности: выполнен выход на всех устройствах. Войдите снова.',

  RATE_LIMITED:
    'Слишком частые запросы. Подождите и повторите попытку.',
  TOO_MANY_REQUESTS:
    'Слишком частые запросы. Подождите и повторите попытку.',
  CAPTCHA_REQUIRED:
    'Пройдите проверку безопасности и повторите попытку.',
  BOT_DETECTED:
    'Запрос распознан как автоматический трафик. Повторите попытку позже.',

  NETWORK_ERROR: 'Проблема с подключением к интернету. Проверьте сеть.',
  INTERNAL_ERROR: 'Ошибка сервера. Подождите и повторите попытку.',
  UPSTREAM_ERROR:
    'Ошибка связи с внешним сервисом. Подождите и повторите попытку.',
  UNKNOWN_ERROR: 'Произошла непредвиденная ошибка. Повторите попытку.',
};

const EN: Record<AuthErrorCode, string> = {
  EMAIL_ALREADY_EXISTS:
    'This email is already registered. Try signing in instead.',
  USERNAME_ALREADY_EXISTS: 'That username is taken. Please choose another.',
  WEAK_PASSWORD:
    'Password is too weak. Use at least 8 characters with letters and numbers.',
  VALIDATION_FAILED: 'Some details are invalid. Please check the fields.',

  EMAIL_NOT_VERIFIED:
    'Email not verified. Please click the link in your inbox.',
  ACCOUNT_NOT_VERIFIED:
    'Email not verified. Please click the link in your inbox.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  UNAUTHENTICATED: 'Incorrect email or password.',
  USER_NOT_FOUND: 'User not found.',
  WRONG_CURRENT_PASSWORD: 'Your current password is incorrect.',

  ACCOUNT_LOCKED:
    'Account temporarily locked. Please try again in 15 minutes.',
  ACCOUNT_LOCKED_TEMP:
    'Too many attempts. Your account is temporarily locked, please wait.',
  ACCOUNT_LOCKED_HARD:
    'Account locked for security. Unlock it using the instructions emailed to you.',
  LOGIN_LOCKED:
    'Too many failed attempts. Please wait and try again.',
  IP_DENYLISTED:
    'Access from this network is temporarily restricted. Try again later.',
  IP_BLOCKED_TEMP:
    'Requests from this network are temporarily blocked. Please wait.',
  CREDENTIAL_STUFFING_BLOCKED:
    'Suspicious activity detected. Sign-in is temporarily restricted.',
  IMPOSSIBLE_TRAVEL:
    'Sign-in from an unusual location detected. Please check your email for security.',

  MFA_REQUIRED: 'Two-factor verification required. Enter your code.',
  MFA_REQUIRED_FOR_ROLE:
    'Two-factor protection is required for this role. Please set it up first.',
  MFA_NOT_AVAILABLE:
    'Two-factor verification is currently unavailable. Contact an administrator.',
  INVALID_TOTP_CODE: 'That code is incorrect or expired. Try again.',
  INVALID_MFA_CODE: 'That code is incorrect. Please try again.',
  INVALID_BACKUP_CODE: 'That backup code is invalid or already used.',
  MFA_FACTOR_REQUIRED: 'Enter a verification code or use a passkey.',
  TOTP_NOT_INITIALISED: 'Set up your authenticator app first.',
  TOTP_NOT_ENABLED: 'TOTP is not enabled for this account.',
  MFA_CREDENTIAL_NOT_FOUND: 'That MFA method was not found.',
  WEBAUTHN_NOT_ENROLLED: 'No passkey is registered.',
  WEBAUTHN_CHALLENGE_EXPIRED: 'The request expired. Please try again.',
  WEBAUTHN_VERIFICATION_FAILED: 'Passkey verification failed.',
  WEBAUTHN_CREDENTIAL_UNKNOWN: 'This passkey is not linked to your account.',

  TOKEN_EXPIRED: 'This link has expired. Request a new one.',
  TOKEN_INVALID: 'This link is invalid. Request a new one.',
  INVALID_TOKEN: 'This link is invalid. Request a new one.',
  INVALID_OR_EXPIRED_TOKEN:
    'This link is invalid or has expired. Request a new one.',
  INVALID_REFRESH_TOKEN: 'Your session has expired. Please sign in again.',
  TOKEN_FAMILY_COMPROMISED:
    'Security measure: you were signed out everywhere. Please sign in again.',

  RATE_LIMITED:
    'Too many requests. Please wait a moment and try again.',
  TOO_MANY_REQUESTS:
    'Too many requests. Please wait a moment and try again.',
  CAPTCHA_REQUIRED:
    'Please complete the security check and try again.',
  BOT_DETECTED:
    'This request was flagged as automated traffic. Please try again shortly.',

  NETWORK_ERROR: 'Network connection problem. Please check your connection.',
  INTERNAL_ERROR: 'Server error. Please wait a moment and try again.',
  UPSTREAM_ERROR:
    'Error communicating with an external service. Please try again shortly.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

const CATALOG: Record<SupportedLocale, Record<AuthErrorCode, string>> = {
  uz: UZ,
  ru: RU,
  en: EN,
};

/** Default catalog locale used as the ultimate fallback. */
export const DEFAULT_AUTH_LOCALE: SupportedLocale = 'uz';

/** Uzbek catalog kept as a named export for back-compat / tests. */
export const AUTH_ERROR_MESSAGES_UZ = UZ;

function normalizeLocale(locale: string | null | undefined): SupportedLocale {
  if (locale === 'ru' || locale === 'en' || locale === 'uz') return locale;
  return DEFAULT_AUTH_LOCALE;
}

export interface AuthErrorMessageOptions {
  /** Active UI locale. Falls back to `uz` when missing/unknown. */
  locale?: string | null | undefined;
  /** Optional fallback used before the generic `UNKNOWN_ERROR` message. */
  fallback?: string | null | undefined;
}

/**
 * Resolve a localized, user-facing message for the given backend error code.
 *
 * Resolution order:
 *   1. Locale-specific message for the code.
 *   2. Uzbek (default-locale) message for the code.
 *   3. Caller-provided `fallback` (e.g. the raw API message).
 *   4. Generic localized `UNKNOWN_ERROR` message.
 */
export function getAuthErrorMessage(
  code: string | null | undefined,
  options?: AuthErrorMessageOptions,
): string {
  const locale = normalizeLocale(options?.locale);
  const table = CATALOG[locale];
  const fallbackTable = CATALOG[DEFAULT_AUTH_LOCALE];

  if (code && code in table) {
    return table[code as AuthErrorCode];
  }
  if (code && code in fallbackTable) {
    return fallbackTable[code as AuthErrorCode];
  }
  return (
    options?.fallback ?? table.UNKNOWN_ERROR ?? fallbackTable.UNKNOWN_ERROR
  );
}

/**
 * Extracts the error code from an `ApiClientError`'s details envelope.
 * The backend returns `{ error: { code, message, details, traceId } }`
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
