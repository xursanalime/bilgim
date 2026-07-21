import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import type { EnvConfig } from '../../../config/config.module';
import { RedisService } from '../../../infra/redis';
import {
  REQUIRE_HMAC_KEY,
  DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S,
  type RequireHmacOptions,
} from './require-hmac.decorator';
import { HmacSignatureService } from './hmac-signature.service';

/**
 * TTL the nonce is held in Redis after the first sighting. Picked at 1h
 * so it comfortably outlives the timestamp-tolerance window even if a
 * caller's clock is skewed, while still bounding the storage cost on
 * Redis (a single 64-byte key per signed request, dropped automatically).
 */
export const HMAC_NONCE_TTL_SECONDS = 60 * 60;

/**
 * Errors all rendered with the same shape as the rest of the platform —
 * `{ code, message }` body that the AllExceptionsFilter wraps into the
 * standard error envelope. Codes are stable so SIEM / dashboards can
 * route on them.
 */
const ERROR_CODES = {
  required: 'SIGNATURE_REQUIRED',
  invalid: 'INVALID_SIGNATURE',
  expired: 'SIGNATURE_EXPIRED',
  replay: 'NONCE_REUSED',
  misconfigured: 'SIGNATURE_MISCONFIGURED',
} as const;

/**
 * Express-shaped request fields the guard touches. We deliberately
 * accept `any` for the body slot — the standard JSON parser leaves
 * us a parsed object, while raw-body middleware (used for Payme
 * webhooks) leaves a Buffer; both serialize correctly.
 */
interface SignedRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  rawBody?: Buffer;
}

/**
 * HmacGuard (Task 29.4, Req 30.1).
 *
 * Verifies HMAC-SHA256 request signatures on routes opted-in via
 * `@RequireHmac()`. Routes WITHOUT the decorator are passed through
 * untouched, so the guard can be safely wired as a global / module-
 * level provider without breaking the rest of the surface.
 *
 * Verification chain (fail-closed in this order):
 *
 *   1. `X-Timestamp` header must be present, an integer (epoch
 *      seconds), and within `±timestampToleranceSeconds` of server
 *      time. Anything outside that window is `SIGNATURE_EXPIRED`.
 *
 *   2. `X-Nonce` header must be present (≤128 chars). The guard
 *      reserves it in Redis with `SET ... EX 1h NX`; a duplicate is
 *      `NONCE_REUSED`.
 *
 *   3. `X-Signature` header must be present and match
 *      `base64(HMAC-SHA256(secret, signedPayload))`. Mismatch is
 *      `INVALID_SIGNATURE`. Constant-time compare via
 *      `HmacSignatureService.verify()`.
 *
 * The `signedPayload` is `${timestamp}.${nonce}.${rawBody}` — the
 * timestamp + nonce being part of the digest stops a man-in-the-middle
 * from swapping headers between two captures of the same body. This
 * mirrors the Stripe / Slack envelope shape so integrators can reuse
 * the same client SDKs.
 */
@Injectable()
export class HmacGuard implements CanActivate {
  private readonly logger = new Logger(HmacGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly hmac: HmacSignatureService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly config?: ConfigService<EnvConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const options = this.reflector.getAllAndOverride<RequireHmacOptions>(
      REQUIRE_HMAC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<SignedRequest>();
    const headers = request.headers ?? {};

    const signature = pickHeader(headers, 'x-signature');
    const timestampHeader = pickHeader(headers, 'x-timestamp');
    const nonce = pickHeader(headers, 'x-nonce');

    if (!signature || !timestampHeader || !nonce) {
      throw makeError(
        ERROR_CODES.required,
        'Request must include X-Signature, X-Timestamp, and X-Nonce headers',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (nonce.length > 128) {
      // Bound the storage cost — 128 chars covers UUIDv4, ULID, and
      // every reasonable fingerprint. Rejecting longer values stops a
      // caller from filling Redis with a single signed request.
      throw makeError(
        ERROR_CODES.invalid,
        'X-Nonce must be ≤128 characters',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // ---- 1. Timestamp window -------------------------------------------
    const tolerance =
      options.timestampToleranceSeconds ??
      DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S;
    const timestamp = Number.parseInt(timestampHeader, 10);
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      `${timestamp}` !== timestampHeader
    ) {
      throw makeError(
        ERROR_CODES.invalid,
        'X-Timestamp must be an integer of epoch seconds',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > tolerance) {
      throw makeError(
        ERROR_CODES.expired,
        `X-Timestamp outside ±${tolerance}s tolerance window`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    // ---- 2. Resolve secret ---------------------------------------------
    const secretKey = options.secretEnvKey ?? 'HMAC_ADMIN_SECRET';
    const secret = this.resolveSecret(secretKey);
    if (!secret) {
      // Misconfigured deploys fail closed: refuse to open the route
      // without a key rather than silently degrading to "no signing".
      this.logger.error(
        `@RequireHmac is set on ${request.method} ${request.url} but ` +
          `${secretKey} is not configured`,
      );
      throw makeError(
        ERROR_CODES.misconfigured,
        'Signed-request secret is not configured for this route',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // ---- 3. Signature compare ------------------------------------------
    const bodyBuf = serializeBody(request);
    const signedPayload = Buffer.concat([
      Buffer.from(`${timestamp}.${nonce}.`, 'utf8'),
      bodyBuf,
    ]);
    if (!this.hmac.verify(signedPayload, signature, secret)) {
      throw makeError(
        ERROR_CODES.invalid,
        'X-Signature did not match the expected HMAC-SHA256 of the request',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // ---- 4. Replay protection (Redis nonce reservation) ----------------
    // Done LAST so a forged signature can't burn through the nonce
    // namespace by reserving fresh entries before its compare fails.
    if (this.redis) {
      const key = `hmac:nonce:${secretKey}:${nonce}`;
      const reserved = await this.redis.setnx(
        key,
        `${timestamp}`,
        HMAC_NONCE_TTL_SECONDS,
      );
      if (!reserved) {
        throw makeError(
          ERROR_CODES.replay,
          'X-Nonce has already been used',
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    return true;
  }

  /**
   * Lookup the configured shared secret. Falls back to
   * `process.env[secretKey]` when no ConfigService is present (unit
   * tests / standalone usage) so callers can build the guard with a
   * minimal DI graph.
   */
  private resolveSecret(secretKey: string): string | undefined {
    const fromConfig = this.config?.get(secretKey as keyof EnvConfig, {
      infer: true,
    } as any) as string | undefined;
    if (typeof fromConfig === 'string' && fromConfig.length > 0) {
      return fromConfig;
    }
    const fromEnv = process.env[secretKey];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
    return undefined;
  }
}

/**
 * Pull a single header value, lowercasing the lookup key. Returns
 * `undefined` for missing / empty / array-valued (multi-header) cases —
 * we don't want a duplicate header being silently squashed into a
 * single comma-joined string here.
 */
function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  if (typeof v === 'string') return v.length > 0 ? v : undefined;
  return undefined;
}

/**
 * Reduce the request body to a Buffer for signing. Preference order:
 *   1. `req.rawBody`                — preserves byte-for-byte fidelity,
 *                                     critical for webhook callbacks
 *                                     where the integrator signs the
 *                                     bytes they actually transmitted.
 *   2. `JSON.stringify(req.body)`   — what most admin clients hand us
 *                                     after the global JSON parser
 *                                     runs.
 *   3. empty buffer                 — no body, e.g. signed DELETE.
 *
 * Note that signing post-JSON-stringify is theoretically lossy
 * (whitespace / key-order differences), but every internal admin
 * client we ship uses the same canonicaliser via the SDK, so the
 * round-trip is stable. External webhook integrators MUST use raw-body
 * (option 1) — wired via the route-specific middleware, not this
 * fallback.
 */
function serializeBody(request: SignedRequest): Buffer {
  if (request.rawBody && Buffer.isBuffer(request.rawBody)) {
    return request.rawBody;
  }
  const body = request.body;
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  try {
    return Buffer.from(JSON.stringify(body), 'utf8');
  } catch {
    return Buffer.alloc(0);
  }
}

function makeError(
  code: string,
  message: string,
  status: number,
): HttpException {
  return new HttpException({ code, message }, status);
}
