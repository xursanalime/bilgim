import { timingSafeEqual } from 'crypto';

/**
 * Restore the real client IP when the request arrived through the
 * Next.js BFF.
 *
 * ## Why this exists
 *
 * Every browser→API call is proxied by the web app
 * (`apps/web/app/api/proxy`). To the API that proxy *is* the client: on
 * Railway it connects from the private network (`100.64.0.x`), so
 * `req.ip` is the same value for the entire user base. Every IP-scoped
 * control then operates on one shared bucket:
 *
 *   - one user's failed logins count against everybody,
 *   - one 500-storm blocklists the BFF's address and takes the whole
 *     platform offline with "This network has been blocked due to
 *     suspicious activity" (this happened on 2026-07-25).
 *
 * The BFF forwards the caller's address, but Express only honours
 * `X-Forwarded-For` from a hop it trusts, and `TRUST_PROXY` defaults to
 * `loopback` — which `100.64.0.x` is not.
 *
 * ## Why not just widen TRUST_PROXY
 *
 * `api.bilgim.uz` is publicly reachable. Trusting the private range
 * would also trust Railway's public edge, which sits in that same range —
 * so anyone could `curl api.bilgim.uz -H 'X-Forwarded-For: 1.2.3.4'` and
 * pick their own rate-limit bucket, or step around an active IP block.
 * Network position cannot distinguish "came from our BFF" from "came from
 * the internet via the edge".
 *
 * A shared secret can. The BFF sends `x-bilgim-client-ip` alongside
 * `x-bilgim-proxy-token`; the IP is honoured only when the token matches
 * `BFF_PROXY_SECRET`. That holds regardless of topology, so it keeps
 * working if the deployment moves.
 *
 * When `BFF_PROXY_SECRET` is unset this middleware does nothing and the
 * stack falls back to plain `TRUST_PROXY` behaviour — no accidental
 * loosening on an environment that has not opted in.
 */

/** Header carrying the caller's address, set by the BFF. */
export const CLIENT_IP_HEADER = 'x-bilgim-client-ip';

/** Header proving the request really came from our BFF. */
export const PROXY_TOKEN_HEADER = 'x-bilgim-proxy-token';

interface MutableRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
}

/** Constant-time compare that tolerates differing lengths. */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Accept only a plausible IP literal. Prevents a compromised/mistaken
 * proxy from injecting arbitrary text into Redis keys and audit rows.
 */
export function isIpLiteral(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  // IPv4, optionally IPv4-mapped IPv6, or a bare IPv6.
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const mapped = /^::ffff:(?:\d{1,3}\.){3}\d{1,3}$/i;
  const ipv6 = /^[0-9a-f:]+$/i;
  if (ipv4.test(value)) {
    return value.split('.').every((o) => Number(o) <= 255);
  }
  if (mapped.test(value)) {
    return value
      .slice('::ffff:'.length)
      .split('.')
      .every((o) => Number(o) <= 255);
  }
  return ipv6.test(value) && value.includes(':');
}

function headerValue(
  req: MutableRequest,
  name: string,
): string | undefined {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Overwrite `req.ip` with the BFF-supplied client address when the shared
 * secret checks out.
 *
 * Rewriting `req.ip` (rather than adding another accessor) is deliberate:
 * a dozen security helpers across the codebase already read `req.ip`, and
 * they all become correct at once without touching any of them. Express
 * defines `ip` as a getter on the prototype, hence `defineProperty`.
 */
export function applyTrustedClientIp(
  req: MutableRequest,
  secret: string | undefined,
): void {
  if (!secret) return;

  const presented = headerValue(req, PROXY_TOKEN_HEADER);
  if (!presented || !secretsMatch(presented, secret)) return;

  const claimed = headerValue(req, CLIENT_IP_HEADER);
  if (!claimed || !isIpLiteral(claimed)) return;

  Object.defineProperty(req, 'ip', {
    value: claimed,
    configurable: true,
    enumerable: true,
    writable: false,
  });
}

/**
 * Express middleware factory. Must be installed as the FIRST `app.use`,
 * ahead of the threat-protection middleware and every guard, so they all
 * see the corrected address.
 */
export function makeTrustedClientIpHandler(secret: string | undefined) {
  return function trustedClientIp(
    req: MutableRequest,
    _res: unknown,
    next: () => void,
  ): void {
    applyTrustedClientIp(req, secret);
    next();
  };
}
