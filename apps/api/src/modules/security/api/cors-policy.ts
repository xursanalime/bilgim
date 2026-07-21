/**
 * CORS Policy Configuration (Task 29.5, Req 30.8).
 *
 * Strict CORS configuration that only allows requests from:
 *   - edubridge.uz (exact match)
 *   - *.edubridge.uz (any subdomain)
 *
 * All other origins are blocked. This prevents cross-origin attacks
 * from unauthorized domains.
 */

/**
 * Allowed origin patterns for CORS.
 * Only edubridge.uz and its subdomains are permitted.
 */
export const ALLOWED_ORIGINS = [
  'https://edubridge.uz',
  'http://edubridge.uz',
] as const;

/**
 * Regex pattern matching *.edubridge.uz subdomains.
 * Matches: https://app.edubridge.uz, https://api.edubridge.uz, etc.
 */
export const SUBDOMAIN_PATTERN = /^https?:\/\/([a-z0-9-]+\.)*edubridge\.uz$/i;

/**
 * Validates whether a given origin is allowed by the CORS policy.
 *
 * @param origin - The origin header value from the request
 * @returns true if the origin is allowed, false otherwise
 */
export function isOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return false;

  // Exact match for base domain
  if (
    origin === 'https://edubridge.uz' ||
    origin === 'http://edubridge.uz'
  ) {
    return true;
  }

  // Subdomain match (*.edubridge.uz)
  return SUBDOMAIN_PATTERN.test(origin);
}

/**
 * CORS origin callback for NestJS/Express CORS middleware.
 *
 * Usage with NestJS:
 *   app.enableCors({
 *     origin: corsOriginCallback,
 *     credentials: true,
 *     methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
 *     allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-API-Version'],
 *     exposedHeaders: ['X-API-Version', 'X-Request-Id', 'Deprecation', 'Sunset', 'Link'],
 *     maxAge: 86400, // 24 hours preflight cache
 *   });
 */
export function corsOriginCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // Allow requests with no origin (server-to-server, curl, mobile apps)
  if (!origin) {
    callback(null, true);
    return;
  }

  if (isOriginAllowed(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origin '${origin}' is not allowed by CORS policy`));
  }
}

/**
 * Complete CORS configuration object for NestJS app.enableCors().
 * Implements Req 30.8: only edubridge.uz and *.edubridge.uz allowed.
 */
export const CORS_CONFIG = {
  origin: corsOriginCallback,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Idempotency-Key',
    'X-API-Version',
    'X-Signature',
    'X-Timestamp',
    'X-Nonce',
  ],
  exposedHeaders: [
    'X-API-Version',
    'X-Request-Id',
    'Deprecation',
    'Sunset',
    'Link',
    'X-API-Deprecation-Notice',
    'Retry-After',
  ],
  maxAge: 86400, // 24 hours preflight cache
} as const;

/**
 * Development CORS configuration — allows localhost origins
 * in addition to production origins. Only use in development.
 */
export function createDevCorsConfig() {
  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4200',
    'http://127.0.0.1:3000',
  ];

  return {
    ...CORS_CONFIG,
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin) || devOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin '${origin}' is not allowed by CORS policy`));
      }
    },
  };
}
