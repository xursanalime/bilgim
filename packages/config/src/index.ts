// Shared configuration exports for Bilgim monorepo

/** Supported locales across the platform */
export const SUPPORTED_LOCALES = ['uz', 'ru', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'uz';

/** API versioning */
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

/** Token TTLs */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const IDEMPOTENCY_KEY_TTL_HOURS = 24;

/** Rate limiting defaults */
export const RATE_LIMIT_DEFAULT = {
  ttl: 60_000, // 1 minute window
  limit: 100,  // requests per window
};

/** Pagination defaults */
export const PAGINATION_DEFAULTS = {
  pageSize: 20,
  maxPageSize: 100,
};
