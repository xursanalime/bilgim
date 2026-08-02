import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Standalone HMAC-SHA256 utility for webhook-style request signing
 * (Task 29.4, Req 30.1).
 *
 * This module is intentionally separate from the `HmacGuard` /
 * `HmacSignatureService` pair under `./hmac/`. The guard verifies a
 * Stripe-style envelope (`X-Signature` + `X-Timestamp` + `X-Nonce`,
 * base64 digest, Redis-backed nonce reservation) on first-party admin
 * mutations. This utility serves the simpler webhook contract used by
 * external integrators and the platform's own export/system endpoints:
 *
 *   - Header format: `X-Signature: sha256=<hex>` — the same convention
 *     GitHub / Slack / Twilio / Linear ship, so integrators can drop in
 *     their existing SDKs.
 *
 *   - Signed payload: `${timestamp}.${rawBody}` — timestamp is included
 *     in the digest so a captured signature can't be replayed against a
 *     different body or a forged timestamp.
 *
 *   - Replay window: ±5 minutes by default. Past that, the verifier
 *     returns a `SIGNATURE_EXPIRED` reason without inspecting the
 *     digest. This intentionally mirrors `DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S`
 *     (the guard's window) so operators only have one number to reason
 *     about.
 *
 *   - No nonce store. The 5-minute window plus signature uniqueness is
 *     sufficient for endpoints that are themselves idempotent (the
 *     export endpoints stream historical data; rerunning the same
 *     export is harmless). Endpoints needing replay protection should
 *     use the `HmacGuard` envelope instead.
 *
 * The functions return discriminated-union results rather than booleans
 * so the calling middleware / guard can map each failure mode to the
 * right error code:
 *
 *   - `MISSING`           → 401 SIGNATURE_REQUIRED
 *   - `MALFORMED`         → 401 INVALID_SIGNATURE
 *   - `EXPIRED`           → 401 SIGNATURE_EXPIRED
 *   - `MISMATCH`          → 401 INVALID_SIGNATURE
 *   - `MISCONFIGURED`     → 401 SIGNATURE_MISCONFIGURED
 */

/**
 * Default replay window — ±5 minutes. Matches `DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S`
 * in `./hmac/require-hmac.decorator.ts`.
 */
export const DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S = 300;

/**
 * Header prefix every signed request must use. Picked to match the
 * GitHub / Stripe convention so an integrator copy-pasting a
 * `crypto.createHmac` snippet from those docs into theirs lands on a
 * working contract.
 */
export const HMAC_SIGNATURE_PREFIX = 'sha256=';

/** Failure reasons returned by {@link verifyHmac}. */
export type HmacFailureCode =
  | 'MISSING'
  | 'MALFORMED'
  | 'EXPIRED'
  | 'MISMATCH'
  | 'MISCONFIGURED';

/** Verification outcome — discriminated on `ok`. */
export type HmacVerifyResult =
  | { ok: true }
  | { ok: false; code: HmacFailureCode; message: string };

/** Inputs accepted by {@link verifyHmac} and {@link signHmac}. */
export interface HmacSignParams {
  /** Raw request body. Strings are encoded as UTF-8; Buffers pass through. */
  body: string | Buffer;
  /** Epoch-seconds timestamp included in the signed payload. */
  timestamp: number;
  /** Shared secret. Must be a non-empty string; refused otherwise. */
  secret: string;
}

export interface HmacVerifyParams extends HmacSignParams {
  /**
   * `X-Signature` header value as received. Accepts both raw hex and
   * the `sha256=<hex>` form — the prefix is stripped automatically so
   * callers don't need to massage the header.
   */
  signature: string | undefined | null;
  /**
   * Current epoch-seconds time. Defaulting to `Date.now()` is correct
   * for live traffic; tests pass a frozen clock so the drift checks are
   * deterministic.
   */
  now?: number;
  /**
   * Maximum allowed drift between `timestamp` and `now`, in seconds.
   * Defaults to {@link DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S}.
   */
  toleranceSeconds?: number;
}

/**
 * Compute `sha256=<hex>` for the canonical signed payload.
 *
 * Throws (rather than returning a sentinel) on misconfiguration so a
 * forgotten secret can never produce a deterministic-but-meaningless
 * digest that callers might trust. The wrapper signed-request middleware
 * always validates configuration at startup, so this throw should be
 * truly unreachable in production.
 */
export function signHmac(params: HmacSignParams): string {
  const { body, timestamp, secret } = params;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('signHmac requires a non-empty secret');
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('signHmac requires a positive integer timestamp');
  }

  const bodyBuf =
    typeof body === 'string'
      ? Buffer.from(body, 'utf8')
      : Buffer.isBuffer(body)
        ? body
        : Buffer.alloc(0);

  // `${timestamp}.${body}` — the dot separator is safe because the
  // timestamp is digits-only, so a forging attacker can't shift the
  // body across the delimiter to alter the digest input.
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    bodyBuf,
  ]);

  const digest = createHmac('sha256', secret).update(payload).digest('hex');
  return `${HMAC_SIGNATURE_PREFIX}${digest}`;
}

/**
 * Verify an `X-Signature: sha256=<hex>` header against the canonical
 * signed payload, returning a discriminated result.
 *
 * Verification order (fail-closed):
 *
 *   1. Signature header present and well-formed
 *   2. Secret configured (non-empty)
 *   3. Timestamp inside the drift window
 *   4. Constant-time digest compare
 *
 * The compare runs through `crypto.timingSafeEqual` against equal-
 * length buffers; mismatched lengths short-circuit to MISMATCH after
 * touching every byte, which keeps the wall-clock observable to an
 * attacker independent of how close they got to the right digest.
 */
export function verifyHmac(params: HmacVerifyParams): HmacVerifyResult {
  const { signature, secret, body, timestamp } = params;
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const tolerance =
    params.toleranceSeconds ?? DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S;

  // ---- 1. Header present ---------------------------------------------
  if (typeof signature !== 'string' || signature.length === 0) {
    return {
      ok: false,
      code: 'MISSING',
      message: 'X-Signature header is required',
    };
  }

  // ---- 2. Secret configured ------------------------------------------
  if (typeof secret !== 'string' || secret.length === 0) {
    return {
      ok: false,
      code: 'MISCONFIGURED',
      message: 'HMAC secret is not configured for this route',
    };
  }

  // ---- 3. Timestamp inside the drift window --------------------------
  // Done BEFORE the digest compare so an obviously stale request is
  // rejected with the right code (`SIGNATURE_EXPIRED`) instead of being
  // misreported as `INVALID_SIGNATURE`. The flip side — a forging
  // attacker now learns whether their forged timestamp parses — is a
  // non-issue: the timestamp is also part of the digest, so the
  // INVALID_SIGNATURE branch fires for any forged value that happens to
  // pass this gate.
  if (
    !Number.isFinite(timestamp) ||
    timestamp <= 0 ||
    !Number.isInteger(timestamp)
  ) {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'timestamp must be a positive integer of epoch seconds',
    };
  }
  if (Math.abs(now - timestamp) > tolerance) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: `timestamp outside ±${tolerance}s tolerance window`,
    };
  }

  // ---- 4. Parse the header ------------------------------------------
  // Accept both `sha256=<hex>` and a bare `<hex>` form. The prefixed
  // form is canonical (matches GitHub / Stripe), but tolerating the
  // bare form makes the utility easier to reuse from internal SDKs that
  // already produce a hex digest.
  const headerHex = signature.startsWith(HMAC_SIGNATURE_PREFIX)
    ? signature.slice(HMAC_SIGNATURE_PREFIX.length)
    : signature;
  if (!isLowerHex(headerHex)) {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'X-Signature must be lowercase hex (optionally prefixed sha256=)',
    };
  }

  // ---- 5. Compare digests --------------------------------------------
  const expected = signHmac({ body, timestamp, secret }).slice(
    HMAC_SIGNATURE_PREFIX.length,
  );

  // Equal-length buffers required by `timingSafeEqual`. We pad to the
  // longer of the two so a length mismatch still spends constant CPU
  // (defence-in-depth — the explicit length check below is the
  // authoritative answer).
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = bufferFromHexLenient(headerHex);
  if (actualBuf.length !== expectedBuf.length) {
    constantTimeTouch(actualBuf, expectedBuf);
    return {
      ok: false,
      code: 'MISMATCH',
      message: 'X-Signature did not match the expected HMAC-SHA256 digest',
    };
  }

  let matches = false;
  try {
    matches = timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    matches = false;
  }
  if (!matches) {
    return {
      ok: false,
      code: 'MISMATCH',
      message: 'X-Signature did not match the expected HMAC-SHA256 digest',
    };
  }

  return { ok: true };
}

/**
 * Strict `[0-9a-f]+` matcher — uppercase hex is rejected so the
 * canonical `sha256=<hex>` form is unambiguous. SHA-256 hex is always
 * 64 characters, but we leave the length check to the buffer compare
 * so MALFORMED is reserved for "this isn't even hex" rather than
 * "this is hex but the wrong length".
 */
function isLowerHex(input: string): boolean {
  if (input.length === 0) return false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    const isDigit = ch >= 0x30 && ch <= 0x39; // 0-9
    const isLowerAf = ch >= 0x61 && ch <= 0x66; // a-f
    if (!isDigit && !isLowerAf) return false;
  }
  return true;
}

/**
 * Decode hex → Buffer, returning an empty buffer for any odd-length /
 * malformed input. Caller has already gated on {@link isLowerHex} so
 * the only failure mode that survives is "odd-length lowercase hex",
 * which we treat as a digest of length 0 — guaranteed mismatch on the
 * length compare, no exception.
 */
function bufferFromHexLenient(hex: string): Buffer {
  if (hex.length % 2 !== 0) return Buffer.alloc(0);
  try {
    return Buffer.from(hex, 'hex');
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Touch every byte of `actual` against `expected`-length space so a
 * length-mismatched compare still spends constant wall-clock relative
 * to the *expected* signature, not the attacker-supplied one. The
 * actual answer (`false`) was decided before this call by the explicit
 * length check.
 */
function constantTimeTouch(actual: Buffer, expected: Buffer): void {
  if (expected.length === 0) return;
  const padded = Buffer.alloc(expected.length);
  actual.copy(padded, 0, 0, Math.min(actual.length, expected.length));
  try {
    timingSafeEqual(padded, expected);
  } catch {
    /* impossible — same length now */
  }
}
