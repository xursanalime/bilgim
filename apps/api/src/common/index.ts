// Guards
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { RolesGuard } from './guards/roles.guard';
export { LessonAccessGuard } from './guards/lesson-access.guard';
export {
  BodyLimitGuard,
  DEFAULT_BODY_LIMIT_BYTES,
} from './guards/body-limit.guard';

// Interceptors
export { LoggingInterceptor } from './interceptors/logging.interceptor';
export { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
export {
  RateLimitInterceptor,
  DEFAULT_RATE_LIMITS,
  type RateLimitDefaults,
} from './interceptors/rate-limit.interceptor';
export {
  CacheResponse,
  CacheResponseInterceptor,
  CACHE_RESPONSE_METADATA,
  CACHE_BYPASS_QUERY_PARAM,
  defaultCacheKey,
  shouldBypassCache,
  type CacheResponseOptions,
  type CacheableRequest,
} from './interceptors/cache-response.interceptor';

// Filters
export { AllExceptionsFilter } from './filters/all-exceptions.filter';

// Pipes
export { ZodValidationPipe } from './pipes/zod-validation.pipe';
export {
  paginationSchema,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGE_SIZE,
  type PaginationDto,
} from './pipes/pagination.schema';

// Decorators
export { Public, IS_PUBLIC_KEY } from './decorators/public.decorator';
export { Roles, ROLES_KEY } from './decorators/roles.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export {
  RateLimit,
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from './decorators/rate-limit.decorator';
export {
  BodyLimit,
  BODY_LIMIT_KEY,
  type BodyLimitOptions,
} from './decorators/body-limit.decorator';

// Auth completeness
export {
  inspectAuthCompleteness,
  inspectControllerClasses,
  assertAuthCompleteness,
  ALLOWED_ROLES,
  type AllowedRole,
  type AuthCompletenessReport,
  type AuthCompletenessOptions,
  type AuthCompletenessIssueReason,
  type MissingGuardRoute,
} from './auth/auth-completeness';

// HMAC request signing (Task 29.4, Req 30.1)
export {
  HmacSignatureService,
  HmacGuard,
  HMAC_NONCE_TTL_SECONDS,
  RequireHmac,
  REQUIRE_HMAC_KEY,
  DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S,
  type RequireHmacOptions,
} from './security/hmac';

// Input sanitization (Task 29.4, Req 30.2)
export {
  SanitizePipe,
  Sanitize,
  SANITIZE_KEY,
  stripControlCharacters,
  looksLikeSqlInjection,
  strictHtmlSanitize,
  type SanitizeOptions,
} from './security/sanitize';

// Response envelope security (Task 29.4, Req 30.3, 30.9)
export {
  SecureResponseInterceptor,
  SECURE_RESPONSE_HEADERS,
  LIVE_RESPONSE_HEADERS,
} from './security/response';
