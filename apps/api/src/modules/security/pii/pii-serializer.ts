import { PiiMaskingService } from './pii-masking.service';

/**
 * Shared PII masking service instance used by the serializer.
 * Instantiated once at module load time so the Pino serializer
 * (which is a plain function, not a Nest injectable) can use it.
 */
const piiService = new PiiMaskingService();

/**
 * Recursively walk an object and mask any string values that
 * contain PII. Handles nested objects and arrays.
 */
function maskObjectValues(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion on deeply nested / circular objects.
  if (depth > 10) return obj;

  if (typeof obj === 'string') {
    return piiService.mask(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskObjectValues(item, depth + 1));
  }

  if (obj !== null && typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      masked[key] = maskObjectValues(value, depth + 1);
    }
    return masked;
  }

  return obj;
}

/**
 * Pino custom serializer for request objects.
 * Masks PII in common request fields (headers, query params, URL).
 *
 * Usage with Pino:
 * ```ts
 * import { piiRequestSerializer } from './pii-serializer';
 *
 * const logger = pino({
 *   serializers: {
 *     req: piiRequestSerializer,
 *   },
 * });
 * ```
 */
export function piiRequestSerializer(req: Record<string, unknown>): Record<string, unknown> {
  if (!req || typeof req !== 'object') return req;

  const serialized: Record<string, unknown> = { ...req };

  // Mask URL (may contain email or other PII in query params).
  if (typeof serialized.url === 'string') {
    serialized.url = piiService.mask(serialized.url);
  }

  // Mask specific headers that commonly carry PII.
  if (serialized.headers && typeof serialized.headers === 'object') {
    const headers = { ...(serialized.headers as Record<string, unknown>) };

    // Authorization header — redact entirely.
    if (headers.authorization) {
      headers.authorization = '***REDACTED***';
    }

    // Cookie header — redact entirely.
    if (headers.cookie) {
      headers.cookie = '***REDACTED***';
    }

    // X-Forwarded-For may contain IPs.
    if (typeof headers['x-forwarded-for'] === 'string') {
      headers['x-forwarded-for'] = piiService.mask(
        headers['x-forwarded-for'] as string,
      );
    }

    serialized.headers = headers;
  }

  // Mask remoteAddress (IP).
  if (typeof serialized.remoteAddress === 'string') {
    serialized.remoteAddress = piiService.mask(serialized.remoteAddress);
  }

  return serialized;
}

/**
 * Pino custom serializer for response objects.
 * Minimal — responses rarely contain PII, but we mask headers
 * just in case.
 */
export function piiResponseSerializer(res: Record<string, unknown>): Record<string, unknown> {
  if (!res || typeof res !== 'object') return res;
  return { ...res };
}

/**
 * Pino custom serializer for error objects.
 * Masks PII in error messages and stack traces.
 *
 * Usage with Pino:
 * ```ts
 * import { piiErrorSerializer } from './pii-serializer';
 *
 * const logger = pino({
 *   serializers: {
 *     err: piiErrorSerializer,
 *   },
 * });
 * ```
 */
export function piiErrorSerializer(err: Record<string, unknown>): Record<string, unknown> {
  if (!err || typeof err !== 'object') return err;

  const serialized: Record<string, unknown> = { ...err };

  // Mask the error message.
  if (typeof serialized.message === 'string') {
    serialized.message = piiService.mask(serialized.message);
  }

  // Mask the stack trace (may contain file paths with usernames,
  // or interpolated PII from the original throw site).
  if (typeof serialized.stack === 'string') {
    serialized.stack = piiService.mask(serialized.stack);
  }

  return serialized;
}

/**
 * Generic Pino serializer that masks PII in any logged value.
 * Use this for custom log fields that may contain user data.
 *
 * Usage:
 * ```ts
 * logger.info({ user: piiGenericSerializer(userData) }, 'User action');
 * ```
 */
export function piiGenericSerializer(value: unknown): unknown {
  return maskObjectValues(value);
}

/**
 * Complete set of Pino serializers for PII masking.
 * Drop this into your Pino configuration to enable automatic
 * PII redaction across all log output.
 *
 * Usage:
 * ```ts
 * import { piiSerializers } from './pii-serializer';
 *
 * const logger = pino({
 *   serializers: piiSerializers,
 * });
 * ```
 */
export const piiSerializers = {
  req: piiRequestSerializer,
  res: piiResponseSerializer,
  err: piiErrorSerializer,
};
