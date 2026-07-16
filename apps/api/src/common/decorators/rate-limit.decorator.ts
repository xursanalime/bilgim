import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export type RateLimitWindowUnit = 's' | 'm' | 'h';

export interface RateLimitOptions {
  /** Maximum number of requests permitted within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

const WINDOW_PATTERN = /^(\d+)\s*([smh])$/i;

/**
 * Parse a window string like "1m", "30s", "1h" → seconds.
 * Throws at module load time if the format is invalid.
 */
function parseWindow(window: string | number): number {
  if (typeof window === 'number') {
    if (!Number.isFinite(window) || window <= 0) {
      throw new Error(`@RateLimit window must be a positive number, got ${window}`);
    }
    return Math.floor(window);
  }

  const match = WINDOW_PATTERN.exec(window.trim());
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `@RateLimit window must look like "30s", "1m", or "1h", got "${window}"`,
    );
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase() as RateLimitWindowUnit;
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    default:
      throw new Error(`Unsupported window unit: ${unit}`);
  }
}

/**
 * Per-route rate limit override (Requirement 21.5).
 *
 * Usage:
 *   @RateLimit(60, '1m')            // 60 requests per minute
 *   @RateLimit({ limit: 5, windowSeconds: 10 })
 */
export function RateLimit(
  limit: number,
  window: string | number,
): MethodDecorator & ClassDecorator;
export function RateLimit(
  options: RateLimitOptions,
): MethodDecorator & ClassDecorator;
export function RateLimit(
  limitOrOptions: number | RateLimitOptions,
  window?: string | number,
): MethodDecorator & ClassDecorator {
  const options: RateLimitOptions =
    typeof limitOrOptions === 'number'
      ? { limit: limitOrOptions, windowSeconds: parseWindow(window ?? '1m') }
      : limitOrOptions;

  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    throw new Error('@RateLimit limit must be a positive number');
  }

  return SetMetadata(RATE_LIMIT_KEY, options);
}
