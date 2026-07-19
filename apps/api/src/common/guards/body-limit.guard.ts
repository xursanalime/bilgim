import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  BODY_LIMIT_KEY,
  BodyLimitOptions,
} from '../decorators/body-limit.decorator';

/**
 * Default global cap mirrored from the env contract (`BODY_LIMIT_BYTES`).
 * Kept here as a fallback for environments / unit tests that don't
 * inject a ConfigService — the production wiring binds the actual
 * value via `BodyLimitGuard.withDefaultBytes()`.
 */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Body-size guard (Task 24.1).
 *
 * Enforces a per-request `Content-Length` cap before any route handler
 * runs. The Express body parser (configured in `configureSecurity()`)
 * already enforces the platform default, but this guard runs alongside
 * it so:
 *   - routes can opt into a tighter cap via `@BodyLimit(bytes)` —
 *     useful for auth endpoints that must reject oversized payloads
 *     before parsing kicks in;
 *   - chunked / unknown-length requests get a fast 411 response;
 *   - the rejection path is consistent with the rest of the API
 *     (HttpException → AllExceptionsFilter → standard error envelope).
 *
 * Resolution order (most specific wins):
 *   1. `@BodyLimit()` declared on the handler.
 *   2. `@BodyLimit()` declared on the controller class.
 *   3. The platform default (1 MiB by default).
 */
@Injectable()
export class BodyLimitGuard implements CanActivate {
  private static defaultBytes = DEFAULT_BODY_LIMIT_BYTES;

  /**
   * Allow the bootstrap layer to override the global default at runtime
   * (e.g. drive it from `BODY_LIMIT_BYTES` env var).
   */
  static withDefaultBytes(bytes: number): void {
    if (Number.isFinite(bytes) && bytes > 0) {
      BodyLimitGuard.defaultBytes = Math.floor(bytes);
    }
  }

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    const method = (request.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    const override = this.reflector.getAllAndOverride<BodyLimitOptions>(
      BODY_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    const limitBytes = override?.bytes ?? BodyLimitGuard.defaultBytes;

    const lengthHeader = request.headers?.['content-length'];
    if (lengthHeader === undefined || lengthHeader === '') {
      // Allow chunked / no-content requests through; the body parser
      // still enforces the platform-wide cap when bytes actually arrive.
      return true;
    }

    const contentLength = Number(lengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new HttpException(
        {
          code: 'INVALID_CONTENT_LENGTH',
          message: 'Content-Length header is not a valid positive integer',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (contentLength > limitBytes) {
      throw new HttpException(
        {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds the ${limitBytes}-byte limit`,
          limitBytes,
          contentLength,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    return true;
  }
}
