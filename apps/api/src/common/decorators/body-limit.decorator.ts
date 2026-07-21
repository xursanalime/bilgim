import { SetMetadata } from '@nestjs/common';

/**
 * Reflector key for `@BodyLimit()` (Task 24.1).
 *
 * Set at the controller or method level to override the platform-wide
 * 1 MiB JSON body cap. The value is the maximum allowed
 * `Content-Length` for the route, in bytes.
 */
export const BODY_LIMIT_KEY = 'bodyLimit';

/**
 * Per-route body-size override.
 *
 * The default request body cap is `BODY_LIMIT_BYTES` (1 MiB) and is
 * enforced by the Express body parser configured in
 * `configureSecurity()`. This decorator records a route-level override
 * that the {@link BodyLimitGuard} consults to either tighten the cap
 * (e.g. 4 KiB on `/auth/login`) or loosen it for routes that legitimately
 * accept larger payloads (e.g. JSON-RPC webhook bodies).
 *
 * Usage:
 *   @BodyLimit(4 * 1024)     // 4 KiB cap
 *   @Post('login')
 *
 *   @BodyLimit('4mb')        // 4 MiB cap
 *   @Post('webhook')
 *
 * Implementation note: when a route opts in to a higher limit, the
 * Express body parser (configured at the platform default) still
 * applies first, so callers that need to *raise* the cap above
 * `BODY_LIMIT_BYTES` must also raise the platform default via the
 * `BODY_LIMIT_BYTES` env. The decorator therefore primarily serves to
 * tighten the cap per route; widening is reserved for ops review.
 */
export interface BodyLimitOptions {
  /** Maximum permitted Content-Length, in bytes. */
  bytes: number;
}

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i;

function parseSize(input: number | string): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      throw new Error(`@BodyLimit must be positive, got ${input}`);
    }
    return Math.floor(input);
  }
  const match = SIZE_PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(
      `@BodyLimit must look like "4kb", "1mb", or a byte count, got "${input}"`,
    );
  }
  const value = Number.parseFloat(match[1]!);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multiplier =
    unit === 'b'
      ? 1
      : unit === 'kb'
        ? 1024
        : unit === 'mb'
          ? 1024 * 1024
          : 1024 * 1024 * 1024;
  return Math.floor(value * multiplier);
}

export function BodyLimit(
  size: number | string,
): MethodDecorator & ClassDecorator {
  const bytes = parseSize(size);
  const options: BodyLimitOptions = { bytes };
  return SetMetadata(BODY_LIMIT_KEY, options);
}
