import { SetMetadata } from '@nestjs/common';

/**
 * Reflector key for `@RequireHmac()` (Task 29.4, Req 30.1).
 *
 * Set at the controller class or method level; consumed by
 * {@link HmacGuard} to gate sensitive admin / billing-webhook routes
 * behind a valid `X-Signature` + `X-Timestamp` + `X-Nonce` triple.
 */
export const REQUIRE_HMAC_KEY = 'security:require-hmac';

export interface RequireHmacOptions {
  /**
   * Configuration key on `EnvConfig` that holds the shared secret.
   * Defaults to `HMAC_ADMIN_SECRET` so the most common case
   * (admin mutations) can be enabled with `@RequireHmac()` alone.
   *
   * Each high-risk surface that needs its own secret (e.g. Payme
   * webhook vs internal admin) declares a different `secretEnvKey`,
   * which lets ops rotate them independently and locks the impact of
   * a leaked secret to one surface.
   */
  secretEnvKey?: string;

  /**
   * Maximum drift between the `X-Timestamp` header and server time
   * before a signed request is rejected as replay-stale. Defaults to
   * 300 seconds (±5 minutes), matching the design.md note for
   * Property 26.
   */
  timestampToleranceSeconds?: number;
}

/**
 * Marks a controller class or handler as requiring HMAC request
 * signing. The guard reads this metadata to decide whether to verify;
 * routes WITHOUT the decorator are not signature-checked (the guard is
 * registered globally but no-ops when the metadata is absent, which
 * keeps the wiring simple).
 *
 * Usage (controller-level, every method gets it):
 * ```ts
 * @Controller('admin/specialties')
 * @RequireHmac()
 * export class AdminSpecialtiesController { ... }
 * ```
 *
 * Usage (per method, e.g. only the payment webhook on a mixed controller):
 * ```ts
 * @Post('payme/webhook')
 * @RequireHmac({ secretEnvKey: 'PAYME_HMAC_SECRET' })
 * webhook(...) { ... }
 * ```
 */
export function RequireHmac(
  options: RequireHmacOptions = {},
): MethodDecorator & ClassDecorator {
  // Normalise once at decorator-evaluation time so the guard can rely
  // on a fully-populated `RequireHmacOptions` regardless of how the
  // caller spelt the invocation.
  const normalised: Required<RequireHmacOptions> = {
    secretEnvKey: options.secretEnvKey ?? 'HMAC_ADMIN_SECRET',
    timestampToleranceSeconds:
      options.timestampToleranceSeconds ?? DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S,
  };
  return SetMetadata(REQUIRE_HMAC_KEY, normalised);
}

/**
 * Default replay window — ±5 minutes either side of server time. Anything
 * older / further in the future is treated as a replay attack.
 */
export const DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S = 300;
