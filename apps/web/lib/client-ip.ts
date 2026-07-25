import type { NextRequest } from 'next/server';

/**
 * Resolve the real client IP of a request arriving at the Next.js BFF.
 *
 * Why this exists: every browser→API call now goes through the BFF
 * (`/api/proxy`, `/api/auth/login`), and the BFF only forwarded a fixed
 * header allow-list. The NestJS API therefore saw *one* IP — the web
 * server's — for the entire user base, which silently disabled every
 * IP-scoped control on the API side:
 *
 *   - per-IP rate limits (`@RateLimit`) became a single shared bucket, so
 *     one attacker sending 20 login attempts a minute returned HTTP 429
 *     to every user on the platform;
 *   - `bf:{email}:{ip}` brute-force lockout lost its IP dimension;
 *   - the geo-blocker, tiered rate limiter and credential-stuffing
 *     detector all bucketed the whole world together.
 *
 * Trust model: the value below is only as good as the edge in front of
 * Next.js. `cf-connecting-ip` and `x-real-ip` are single-valued and set
 * by the edge itself, so they are preferred. `x-forwarded-for` is a
 * client-appendable list, so its leftmost entry is trusted **only**
 * because a correctly configured edge (Cloudflare, or nginx with
 * `proxy_set_header X-Forwarded-For $remote_addr`) overwrites the header
 * rather than appending to it. If you deploy behind an edge that appends,
 * strip the inbound header there — otherwise a client can pick its own
 * rate-limit bucket.
 */
export function resolveClientIp(request: NextRequest): string | undefined {
  // Set by Cloudflare; never forwarded from the client.
  const cf = request.headers.get('cf-connecting-ip');
  if (cf?.trim()) return cf.trim();

  // Set by nginx / most ingress controllers; single-valued.
  const real = request.headers.get('x-real-ip');
  if (real?.trim()) return real.trim();

  // Populated by the hosting platform on some runtimes (e.g. Vercel).
  const direct = (request as NextRequest & { ip?: string }).ip;
  if (direct?.trim()) return direct.trim();

  // Leftmost XFF entry — see the trust note above.
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Headers that tell the upstream API who the real caller is. Spread into
 * the outgoing request from every BFF route that proxies to the API.
 *
 * Both headers are sent so the API resolves the same IP whether Express
 * `trust proxy` is enabled (it reads `x-forwarded-for`) or a helper falls
 * back to `x-real-ip`.
 */
export function clientIpHeaders(
  request: NextRequest,
): Record<string, string> {
  const ip = resolveClientIp(request);
  if (!ip) return {};
  return { 'x-forwarded-for': ip, 'x-real-ip': ip };
}
