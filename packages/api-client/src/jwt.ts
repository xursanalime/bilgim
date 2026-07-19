/**
 * Lightweight JWT helpers — no signature verification.
 *
 * The frontends only need to read `exp` to decide whether to refresh
 * before sending a request. Verification happens server-side, so we
 * intentionally avoid pulling in a crypto library here.
 *
 * Works in all our runtimes (browser, React Native, Node 18+):
 *   - browser / RN  → `globalThis.atob`
 *   - Node          → `Buffer.from(b64, 'base64')`
 */

export interface DecodedJwtPayload {
  /** Subject — usually the user's database id. */
  sub: string;
  email?: string;
  role?: 'STUDENT' | 'TEACHER' | 'ADMIN';
  /** Issued at (epoch seconds). */
  iat: number;
  /** Expires at (epoch seconds). */
  exp: number;
  [key: string]: unknown;
}

/**
 * Treat a token as expired this many milliseconds before its real
 * `exp`. Avoids the race where a token is "valid for 200ms more" when
 * the request is sent and arrives at the server already expired.
 */
const EXPIRY_BUFFER_MS = 30_000;

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  const b64 = padded + '='.repeat(padLen);

  type AtobLike = (data: string) => string;
  const atobFn = (globalThis as unknown as { atob?: AtobLike }).atob;
  if (typeof atobFn === 'function') {
    return atobFn(b64);
  }

  // Node fallback. We deliberately do not statically `import 'buffer'`
  // so React Native's Metro bundler doesn't pull node:buffer into the
  // bundle for browsers.
  type BufferLike = {
    from: (data: string, encoding: string) => { toString: (e: string) => string };
  };
  const bufferGlobal = (globalThis as unknown as { Buffer?: BufferLike })
    .Buffer;
  if (bufferGlobal) {
    return bufferGlobal.from(b64, 'base64').toString('utf-8');
  }

  throw new Error(
    'No base64 decoder available (atob / Buffer not found in runtime).',
  );
}

/**
 * Decode a JWT without verifying its signature.
 * Returns `null` for malformed tokens.
 */
export function decodeJwt(token: string): DecodedJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    return JSON.parse(base64UrlDecode(payload)) as DecodedJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true if the token is malformed, missing `exp`, or within the
 * 30 s expiry buffer of expiring.
 */
export function isJwtExpired(token: string): boolean {
  const decoded = decodeJwt(token);
  if (!decoded || typeof decoded.exp !== 'number') return true;
  return Date.now() >= decoded.exp * 1000 - EXPIRY_BUFFER_MS;
}
