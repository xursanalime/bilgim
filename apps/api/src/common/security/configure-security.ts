import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { EnvConfig } from '../../config/config.module';
import { BodyLimitGuard } from '../guards/body-limit.guard';

// Lightweight express type stand-ins so we don't pull `@types/express` in
// (NestJS's platform-express already supplies it transitively at runtime).
// We only need the request/response surface used here.
interface ExpressRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  setTimeout: (ms: number, cb: () => void) => unknown;
  destroy: () => void;
}
interface ExpressResponse {
  headersSent: boolean;
  status: (code: number) => ExpressResponse;
  json: (body: unknown) => ExpressResponse;
  setHeader?: (name: string, value: string) => unknown;
}
type ExpressNext = (err?: unknown) => void;

/**
 * Pluggable hooks so tests can stub out helmet / compression and avoid
 * requiring the modules at unit-test time.
 */
export interface SecurityDeps {
  helmet: (...args: any[]) => any;
  compression: (...args: any[]) => any;
}

/**
 * Apply the platform-wide hardening layer: helmet, CORS allow-list,
 * body size limits, request timeouts, gzip compression, and the
 * sensitive-header strip middleware. Wired from `main.ts` and exercised
 * from tests via `bootstrapSecurityTestApp` so the same pipeline is
 * verified end-to-end.
 *
 * Implements Task 24.1:
 *   - Helmet defaults; CSP gated on `HELMET_CSP` (defaults to prod-only)
 *   - CORS: origin allow-list from `WEB_ORIGIN`, credentials from
 *     `CORS_CREDENTIALS`
 *   - JSON / urlencoded parsers capped at `BODY_LIMIT_BYTES` (default 1 MB)
 *   - `compression()` enabled outside test runs
 *   - Per-request hard timeout (`REQUEST_TIMEOUT_MS`, default 30 s)
 *   - Strips `Authorization` / `Cookie` from the request shape used by
 *     downstream loggers / exception filter so the standard error envelope
 *     never leaks bearer tokens.
 *
 * Requirements: 17.1–17.6, 21.2, 21.3, 21.5
 */
export function configureSecurity(
  app: NestExpressApplication,
  configService: ConfigService<EnvConfig, true>,
  deps: SecurityDeps,
): void {
  const logger = new Logger('Security');
  const env = configService.get('NODE_ENV', { infer: true }) as string;
  const isProd = env === 'production';
  const isTest = env === 'test';

  // ---------------------------------------------------------------------
  // 1. Helmet — sane defaults + opt-in CSP, explicit HSTS / referrer policy
  // ---------------------------------------------------------------------
  // Explicit knobs (Task 24.1):
  //   * Content-Security-Policy: helmet defaults in prod, off elsewhere
  //     (Next dev tooling needs inline scripts).
  //   * Strict-Transport-Security: 1 year, includeSubDomains, preload — only
  //     emitted in production so local HTTP dev isn't accidentally pinned.
  //   * X-Content-Type-Options: nosniff (helmet default).
  //   * Referrer-Policy: strict-origin-when-cross-origin so cross-origin
  //     navigations only leak the origin, not the path.
  const cspOverride = configService.get('HELMET_CSP', { infer: true });
  const cspEnabled =
    typeof cspOverride === 'boolean' ? cspOverride : isProd;
  app.use(
    deps.helmet({
      contentSecurityPolicy: cspEnabled ? undefined : false,
      crossOriginEmbedderPolicy: false,
      hsts: isProd
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      // Force DENY (not the helmet default of SAMEORIGIN) — the API has
      // no UI of its own, so framing it would only ever serve a
      // clickjacking attack against an embedded admin tool. Req 30.3.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Lock down browser-side capability surface (camera / microphone /
      // geolocation / payment / clipboard) for any HTML the API ever
      // accidentally serves. The web app sends its own
      // Permissions-Policy from the Next layer; this one is the
      // backstop. Req 30.3.
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    }),
  );

  // ---------------------------------------------------------------------
  // 1a. Permissions-Policy — helmet doesn't set this directly. Req 30.3
  // ---------------------------------------------------------------------
  app.use(applyPermissionsPolicy);

  // ---------------------------------------------------------------------
  // 2. CORS — explicit allow-list, credentials gated on env
  // ---------------------------------------------------------------------
  const allowedOrigins = parseOriginList(
    configService.get('WEB_ORIGIN', { infer: true }) as string,
  );
  // Dev: always allow localhost:3000 and localhost:3001
  const devOrigins = process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000','http://localhost:3001','http://127.0.0.1:3000','http://127.0.0.1:3001']
    : [];
  const allOrigins = [...new Set([...allowedOrigins, ...devOrigins])];
  // Teacher subdomains (nodira.bilgim.uz, ...) aren't individually
  // allow-listable — there's one per teacher. `COOKIE_DOMAIN` is already
  // the exact trust boundary the session cookie is scoped to
  // (`.bilgim.uz` prod / `.bilgim.test` local), so any origin on that
  // domain or a subdomain of it is allowed too. Bare (undefined) leaves
  // CORS exactly as before — no behaviour change unless subdomain routing
  // is actually configured.
  const cookieDomain = (
    configService.get('COOKIE_DOMAIN', { infer: true }) as string | undefined
  )?.replace(/^\./, '');
  const credentials = Boolean(
    configService.get('CORS_CREDENTIALS', { infer: true }),
  );
  app.enableCors({
    origin: (origin, cb) => {
      // Same-origin / curl requests have no Origin header.
      if (!origin) return cb(null, true);
      if (allOrigins.includes(origin)) return cb(null, true);
      if (cookieDomain && isOriginOnDomain(origin, cookieDomain)) {
        return cb(null, true);
      }
      return cb(new Error(`Origin ${origin} is not allowed`), false);
    },
    credentials,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'x-trace-id',
    ],
    exposedHeaders: ['x-trace-id', 'Retry-After', 'ETag', 'Content-Range', 'Accept-Ranges'],
    maxAge: 86_400,
  });

  // ---------------------------------------------------------------------
  // 3. Body size limit — applied before any controller runs
  // ---------------------------------------------------------------------
  const bodyLimitBytes = Number(
    configService.get('BODY_LIMIT_BYTES', { infer: true }),
  );
  app.useBodyParser('json', { limit: bodyLimitBytes });
  app.useBodyParser('urlencoded', {
    limit: bodyLimitBytes,
    extended: true,
  });
  // Mirror the env-driven default into the per-route guard so that
  // `@BodyLimit()` decorators resolve against the same baseline.
  BodyLimitGuard.withDefaultBytes(bodyLimitBytes);

  // ---------------------------------------------------------------------
  // 4. Compression — skip during tests so supertest sees raw bodies
  // ---------------------------------------------------------------------
  // Threshold is 1 KB so very small payloads (status codes, tiny
  // health pings) skip the gzip overhead while paginated lists and
  // catalog pages still get compressed (Task 24.2). `level: 6` is
  // the zlib default — strikes the usual balance between CPU and
  // ratio.
  if (!isTest) {
    app.use(
      deps.compression({
        threshold: 1024,
        level: 6,
      }),
    );
  }

  // ---------------------------------------------------------------------
  // 5. Slow-loris timeout — drop hanging requests deterministically
  // ---------------------------------------------------------------------
  const timeoutMs = Number(
    configService.get('REQUEST_TIMEOUT_MS', { infer: true }),
  );
  app.use(makeRequestTimeout(timeoutMs, logger));

  // ---------------------------------------------------------------------
  // 6. Sensitive header redaction — keep traceId payloads clean
  // ---------------------------------------------------------------------
  app.use(redactSensitiveHeaders);
}

/**
 * Split + trim the `WEB_ORIGIN` string. Empty / whitespace-only entries
 * are dropped so an accidentally trailing comma never widens the
 * allow-list.
 */
function parseOriginList(raw: string | undefined): string[] {
  if (!raw) {
    // Dev fallback: allow all localhost origins
    return [
      'http://localhost:3000', 'http://localhost:3001',
      'http://127.0.0.1:3000', 'http://127.0.0.1:3001',
    ];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Whether `origin` (e.g. `https://nodira.bilgim.uz`) is `rootDomain` itself
 * or any subdomain of it. Used to trust teacher subdomains for CORS
 * without enumerating each one — mirrors the `Domain=` scope of the shared
 * session cookie (`COOKIE_DOMAIN`), so "can read the session cookie" and
 * "can make a credentialed CORS request" stay the same trust boundary.
 * Malformed origins (no parseable hostname) are rejected, never trusted.
 */
function isOriginOnDomain(origin: string, rootDomain: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return hostname === rootDomain || hostname.endsWith(`.${rootDomain}`);
}

/**
 * Express middleware emitting a `Permissions-Policy` header that
 * disables every browser capability the API never legitimately exposes
 * (camera, microphone, geolocation, payment, USB, …). Helmet does not
 * ship a Permissions-Policy module, so we set it ourselves. The
 * directive list mirrors what we send from the Next layer.
 *
 * Requirement 30.3.
 */
function applyPermissionsPolicy(
  _req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNext,
) {
  // Each token = "feature=()" disables the feature for every origin.
  const policy = [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'clipboard-read=()',
    'clipboard-write=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'picture-in-picture=()',
    'usb=()',
  ].join(', ');
  if (typeof (res as any).setHeader === 'function') {
    (res as any).setHeader('Permissions-Policy', policy);
  }
  next();
}

/**
 * Express middleware that enforces a hard per-request timeout. We use
 * `req.setTimeout` rather than the `connect-timeout` package to keep the
 * dependency surface small.
 */
function makeRequestTimeout(timeoutMs: number, logger: Logger) {
  return function requestTimeout(
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNext,
  ) {
    if (timeoutMs <= 0) {
      next();
      return;
    }
    req.setTimeout(timeoutMs, () => {
      if (res.headersSent) return;
      logger.warn({
        message: 'Request timed out',
        traceId: (req as any).traceId,
        method: req.method,
        url: req.url,
        timeoutMs,
      });
      res.status(503).json({
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Request exceeded server timeout',
          traceId: (req as any).traceId ?? '-',
        },
      });
      try {
        req.destroy();
      } catch {
        /* socket already gone */
      }
    });
    next();
  };
}

/**
 * Strip secret-bearing headers from the object that gets attached to
 * the request before downstream handlers run. The originals stay on
 * `req.headers` for guards that need them (JwtAuthGuard, PaymeAuthGuard);
 * we expose a sanitized view on `req.safeHeaders` and ensure that any
 * future logging / error-filter code reads from there.
 */
function redactSensitiveHeaders(
  req: ExpressRequest,
  _res: ExpressResponse,
  next: ExpressNext,
) {
  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') {
      sanitized[lower] = '[REDACTED]';
    } else {
      sanitized[lower] = value as string | string[] | undefined;
    }
  }
  (req as any).safeHeaders = sanitized;
  next();
}
