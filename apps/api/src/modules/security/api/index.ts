export {
  RequestSigningGuard,
  RequireRequestSigning,
  REQUIRE_REQUEST_SIGNING_KEY,
} from './request-signing.guard';

export {
  InputSanitizationPipe,
  ZodValidationPipe,
  createStrictSchema,
} from './input-sanitization.pipe';

export { SecurityHeadersMiddleware } from './security-headers.middleware';

export { ApiVersioningMiddleware } from './api-versioning.middleware';

export { RequestLimitsMiddleware } from './request-limits.middleware';

export {
  CORS_CONFIG,
  corsOriginCallback,
  isOriginAllowed,
  createDevCorsConfig,
} from './cors-policy';

export { ErrorSanitizerInterceptor } from './error-sanitizer.interceptor';

export {
  FileValidationService,
  CLAMAV_CLIENT_TOKEN,
  ALLOWED_MIME_TYPES,
  MAGIC_BYTES_SIGNATURES,
  type ClamAvClient,
  type AntivirusScanResult,
  type FileValidationResult,
} from './file-validation.service';
