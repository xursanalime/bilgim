import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';

import {
  SENTRY_ADAPTER,
  type SentryAdapter,
} from '../../infra/sentry/sentry.port';

/**
 * Standard error response envelope (Requirement 25.6):
 * { error: { code, message, details, traceId } }
 *
 * Never exposes stack traces, internal paths, or DB schema in production.
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId: string;
  };
}

/**
 * Field names whose values must never reach the structured logs (Task 24.1).
 * Match is case-insensitive and recursive across nested objects / arrays.
 */
const SENSITIVE_FIELD_PATTERN =
  /^(password|passwordHash|newPassword|currentPassword|token|refreshToken|accessToken|secret|authorization|cookie|set-cookie|api[-_]?key|x[-_]?api[-_]?key|otp|pin)$/i;

/**
 * Inline patterns for `secret-bearing values` that may end up
 * concatenated into an error message (e.g. `"Bearer eyJhbGciOi..."`).
 * The redactor rewrites the offending substring rather than dropping
 * the whole message so operators can still see the failure shape.
 */
const INLINE_SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Authorization: Bearer <token>
  {
    regex: /\bBearer\s+[A-Za-z0-9._\-+/=]+/gi,
    replacement: 'Bearer [REDACTED]',
  },
  // Authorization: Basic <b64>
  {
    regex: /\bBasic\s+[A-Za-z0-9+/=]+/gi,
    replacement: 'Basic [REDACTED]',
  },
  // Cookie / Set-Cookie header echoed in messages.
  {
    regex: /\b(?:cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi,
    replacement: 'cookie=[REDACTED]',
  },
  // Generic "password=…" / "token=…" key/value pairs in URL-encoded payloads.
  {
    regex:
      /\b(password|passwordHash|newPassword|currentPassword|token|refresh[_-]?token|access[_-]?token|secret|api[_-]?key)\s*[:=]\s*[^\s,;&}]+/gi,
    replacement: '$1=[REDACTED]',
  },
];

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Recursively scrub secret-bearing fields from any payload before it
 * lands in the logger. The function is pure — it never mutates its
 * input — so the original request body is preserved for downstream
 * handlers that legitimately need it (e.g. AuthService).
 *
 * @internal exported for unit testing.
 */
export function scrubSensitive<T>(input: T, depth = 0): T {
  if (input == null || depth > MAX_DEPTH) return input;
  if (typeof input === 'string') return redactString(input) as unknown as T;
  if (Array.isArray(input)) {
    return input.map((item) => scrubSensitive(item, depth + 1)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubSensitive(value, depth + 1);
    }
    return out as unknown as T;
  }
  return input;
}

/**
 * Strip inline secret signatures from a free-form string (e.g. an
 * `Error.message`). Returns the original string when nothing matches
 * so the typical happy path stays allocation-free.
 */
export function redactString(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input;
  for (const { regex, replacement } of INLINE_SECRET_PATTERNS) {
    if (regex.test(out)) {
      // Reset stateful flag for global regex re-use across calls.
      regex.lastIndex = 0;
      out = out.replace(regex, replacement);
    }
  }
  return out;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(
    @Optional()
    @Inject(SENTRY_ADAPTER)
    private readonly sentry?: SentryAdapter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const traceId: string = request.traceId || '-';

    let status: number;
    let code: string;
    let message: string;
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        code = (resp.code as string) || this.httpStatusToCode(status);
        message = (resp.message as string) || exception.message;
        details = resp.details || resp.errors || undefined;
      } else {
        code = this.httpStatusToCode(status);
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message;
      }
    } else {
      // Unhandled exception — log full error, return generic message.
      // Body and `Error.message` are scrubbed before they reach the logger
      // so accidental `JSON.stringify(req.body)` paths can never leak
      // `password` / `token` / `authorization` fields (Task 24.1).
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';

      this.logger.error({
        message: 'Unhandled exception',
        traceId,
        error:
          exception instanceof Error
            ? redactString(exception.message)
            : redactString(String(exception)),
        stack: exception instanceof Error ? exception.stack : undefined,
        body: scrubSensitive(request?.body),
        query: scrubSensitive(request?.query),
        params: scrubSensitive(request?.params),
      });
    }

    // Outbound message must also be scrubbed — controllers occasionally
    // throw `BadRequestException(JSON.stringify(payload))` which would
    // otherwise echo secrets back in the HTTP response.
    message = redactString(message);
    if (details !== undefined) {
      details = scrubSensitive(details);
    }

    // Forward 5xx events to the SentryAdapter (Task 24.3, Req 26.4).
    // 4xx responses are caller errors and never reach Sentry — that
    // would drown the production project in validation noise.
    if (status >= 500 && this.sentry) {
      const userId =
        (request?.user?.sub as string | undefined) ??
        (request?.user?.id as string | undefined) ??
        null;
      const route =
        (request?.route?.path as string | undefined) ??
        (request?.url as string | undefined);
      const sentryContext = {
        traceId,
        statusCode: status,
        userId,
        tags: { code },
        ...(request?.method ? { method: request.method as string } : {}),
        ...(route ? { route } : {}),
      };
      // Fire and forget — never await the capture, never fail the
      // response if the adapter throws.
      void this.sentry
        .captureException(exception, sentryContext)
        .catch((err) => {
          this.logger.warn(
            `SentryAdapter.captureException threw: ${(err as Error).message}`,
          );
        });
    }

    const errorResponse: ErrorResponse = {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        traceId,
      },
    };

    response.status(status).json(errorResponse);
  }

  private httpStatusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_FAILED',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN_ROLE',
      404: 'RESOURCE_NOT_FOUND',
      409: 'CONFLICT',
      422: 'BUSINESS_RULE_VIOLATED',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
      502: 'UPSTREAM_ERROR',
    };
    return map[status] || 'UNKNOWN_ERROR';
  }
}
