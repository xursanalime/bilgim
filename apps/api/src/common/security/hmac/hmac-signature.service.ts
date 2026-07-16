import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 signing primitive (Task 29.4, Req 30.1).
 *
 * Used by `HmacGuard` to verify request signatures on the high-risk
 * surfaces (admin mutations, billing webhooks). Kept as its own
 * injectable so the same primitive can be reused from outbound webhook
 * delivery later (signing OUR payloads back to integrators) without
 * duplicating the constant-time compare logic.
 *
 * Design notes:
 *
 *   - `sign()` always returns base64. Hex was tempting (URL-safe, fixed
 *     length) but base64 matches the wire format documented in
 *     design.md §"Property 26" and what most integrators actually
 *     expect (Stripe, GitHub, Slack all ship base64 / hex flavours; we
 *     pick base64 because it survives JSON / header transport with
 *     fewer bytes).
 *
 *   - `verify()` runs through `crypto.timingSafeEqual` so a forging
 *     attacker can't infer prefix-length information from response
 *     latency. The two halves are length-checked first; if they
 *     differ, we still spend CPU comparing equal-length buffers so the
 *     timing leak is constant w.r.t. the *correct* signature length,
 *     not w.r.t. the attacker-supplied one.
 *
 *   - `sign(payload)` accepts both strings and `Buffer`s; webhook
 *     bodies are best signed as the *raw* request bytes, so the guard
 *     hands us a Buffer when one is available (Express raw-body) and
 *     falls back to UTF-8 of the JSON payload otherwise.
 */
@Injectable()
export class HmacSignatureService {
  /**
   * Compute `base64(HMAC-SHA256(secret, payload))`.
   *
   * Throws if the secret is empty — refusing to sign with no key is
   * safer than silently producing a deterministic-but-meaningless
   * digest that callers might then trust.
   */
  sign(payload: string | Buffer, secret: string): string {
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error('HmacSignatureService.sign requires a non-empty secret');
    }
    const buf =
      typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return createHmac('sha256', secret).update(buf).digest('base64');
  }

  /**
   * Constant-time verify. Returns `false` (never throws) for any kind
   * of malformed input — empty signature, wrong length, non-base64
   * characters — so the caller's failure path is a single boolean
   * branch rather than a try/catch.
   */
  verify(
    payload: string | Buffer,
    signature: string | undefined | null,
    secret: string,
  ): boolean {
    if (typeof signature !== 'string' || signature.length === 0) return false;
    if (typeof secret !== 'string' || secret.length === 0) return false;

    let expected: Buffer;
    try {
      expected = Buffer.from(this.sign(payload, secret), 'base64');
    } catch {
      return false;
    }

    let actual: Buffer;
    try {
      actual = Buffer.from(signature, 'base64');
    } catch {
      return false;
    }

    // `timingSafeEqual` REQUIRES equal-length buffers — pad the shorter
    // one to the expected length so we still spend constant CPU even
    // when the attacker-supplied signature is the wrong length. The
    // explicit length check after the compare returns `false` if the
    // padding had to kick in, so a length mismatch can never sneak
    // through as "valid".
    if (actual.length !== expected.length) {
      // Touch every byte so we run for the same wall-clock as a real
      // compare; this is defence-in-depth rather than a strict
      // requirement (the length mismatch is itself the answer).
      const padded = Buffer.alloc(expected.length);
      actual.copy(padded, 0, 0, Math.min(actual.length, expected.length));
      try {
        timingSafeEqual(padded, expected);
      } catch {
        /* impossible — same length now */
      }
      return false;
    }

    try {
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
