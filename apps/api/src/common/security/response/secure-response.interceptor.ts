import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Headers required by Requirement 30.3 / design.md §"Property 27".
 * Kept as a frozen map so tests can import the same source-of-truth
 * the runtime emits.
 */
export const SECURE_RESPONSE_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'geolocation=(), microphone=(), camera=(), payment=()',
  });

/**
 * Permissions-Policy variant for `/live/*` routes — the WebRTC layer
 * legitimately needs `microphone` / `camera`. Kept here so the
 * relaxation is visible in code review rather than buried in a
 * controller decorator. `geolocation` and `payment` stay disabled
 * even on /live since neither feature is part of the live-class flow.
 */
export const LIVE_RESPONSE_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'geolocation=(), microphone=(self), camera=(self), payment=()',
  });

/**
 * Property keys we strip from outbound JSON to neuter prototype-
 * pollution echoes. A controller that accidentally includes
 * `__proto__` (e.g. by spreading a Mongo / Prisma raw row that picked
 * one up from a malicious upstream) would otherwise relay it into
 * client JSON, where naïve clients can re-deserialize it back into
 * `Object.prototype`.
 */
const PROTOTYPE_POLLUTION_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Walk depth budget — same shape as SanitizePipe. */
const MAX_DEPTH = 8;

/**
 * SecureResponseInterceptor (Task 29.4, Req 30.3, 30.9).
 *
 * Two responsibilities, both applied uniformly to every response:
 *
 *   1. Set the platform-wide security headers
 *      (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
 *      `Permissions-Policy`). The `/live/*` family receives a
 *      relaxed Permissions-Policy that re-enables `microphone` /
 *      `camera` for `self` so WebRTC keeps working.
 *
 *      Note: helmet (wired in `configureSecurity`) already sets
 *      `X-Frame-Options: DENY` and `nosniff`, but helmet's middleware
 *      runs at the Express layer. Setting them again here makes the
 *      Nest unit tests (where helmet isn't wired) deterministic, and
 *      keeps the surface idempotent — a duplicated header value is
 *      not a security problem, and avoids "missing header" surprises
 *      if helmet's defaults are ever changed.
 *
 *   2. Strip prototype-pollution keys (`__proto__`, `constructor`,
 *      `prototype`) from the outbound JSON. This is belt-and-brace —
 *      the SanitizePipe scrubs them on input, but a controller that
 *      forgets to validate (e.g. raw passthrough from Prisma) would
 *      otherwise leak them through.
 */
@Injectable()
export class SecureResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const httpCtx = context.switchToHttp();
    const request = httpCtx.getRequest();
    const response = httpCtx.getResponse();

    applyHeaders(response, request);

    return next.handle().pipe(map((body) => sanitizeOutbound(body, 0)));
  }
}

/**
 * Apply the right header set for the request. Non-Express responses
 * (e.g. unit-test mocks that stub `setHeader`) are tolerated — we
 * silently no-op when the response object can't accept headers, and
 * tests assert against the calls.
 */
function applyHeaders(
  response: { setHeader?: (name: string, value: string) => unknown } | undefined,
  request: { url?: string; originalUrl?: string } | undefined,
): void {
  if (!response || typeof response.setHeader !== 'function') return;

  const url = request?.originalUrl ?? request?.url ?? '';
  const isLive = /^\/(api\/v\d+\/)?live(\/|$)/i.test(url);
  const headers = isLive ? LIVE_RESPONSE_HEADERS : SECURE_RESPONSE_HEADERS;

  for (const [name, value] of Object.entries(headers)) {
    try {
      response.setHeader(name, value);
    } catch {
      /* response already streamed — bail silently */
    }
  }
}

/**
 * Recursively rebuild the outbound payload, dropping prototype-
 * pollution keys. Buffers / Dates / typed-array bodies are returned
 * untouched so binary endpoints (CSV streams, file downloads) aren't
 * mangled.
 */
function sanitizeOutbound(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (
    Buffer.isBuffer(value) ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOutbound(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    out[key] = sanitizeOutbound(v, depth + 1);
  }
  return out;
}
