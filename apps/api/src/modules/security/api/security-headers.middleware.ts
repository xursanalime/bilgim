import { Injectable, Logger, NestMiddleware } from '@nestjs/common';

/**
 * Minimal Express-compatible request/response shapes for the middleware.
 */
export interface SecurityHeadersRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface SecurityHeadersResponse {
  setHeader: (name: string, value: string) => unknown;
  headersSent?: boolean;
}

export type SecurityHeadersNext = (err?: unknown) => void;

/**
 * Default Content-Security-Policy directives (strict).
 * Blocks inline scripts, eval, and restricts resource origins.
 */
const DEFAULT_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/**
 * Default Permissions-Policy: disables sensitive browser features.
 */
const DEFAULT_PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()',
].join(', ');

/**
 * `SecurityHeadersMiddleware` — Task 29.4, Req 30.3.
 *
 * Sets security-related HTTP response headers on every response:
 *   - Content-Security-Policy (strict)
 *   - X-Frame-Options: DENY
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy (restrictive)
 *   - X-XSS-Protection: 0 (disabled — CSP is the modern replacement)
 *   - Strict-Transport-Security (HSTS)
 *
 * These headers protect against clickjacking, MIME-type sniffing,
 * cross-site scripting, and information leakage.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityHeadersMiddleware.name);

  use(
    _req: SecurityHeadersRequest,
    res: SecurityHeadersResponse,
    next: SecurityHeadersNext,
  ): void {
    try {
      if (res.headersSent) {
        return next();
      }

      // Content-Security-Policy — strict policy blocking inline scripts and eval
      res.setHeader('Content-Security-Policy', DEFAULT_CSP_DIRECTIVES);

      // X-Frame-Options — prevents clickjacking by denying all framing
      res.setHeader('X-Frame-Options', 'DENY');

      // X-Content-Type-Options — prevents MIME-type sniffing
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // Referrer-Policy — limits referrer information leakage
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Permissions-Policy — disables sensitive browser APIs
      res.setHeader('Permissions-Policy', DEFAULT_PERMISSIONS_POLICY);

      // X-XSS-Protection — disabled (CSP is the modern replacement;
      // the legacy filter can introduce vulnerabilities)
      res.setHeader('X-XSS-Protection', '0');

      // Strict-Transport-Security — enforce HTTPS for 1 year
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    } catch (err) {
      this.logger.warn('Failed to set security headers', err);
    }

    next();
  }
}
