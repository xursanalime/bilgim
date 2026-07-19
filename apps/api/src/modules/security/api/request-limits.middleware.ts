import { Injectable, Logger, NestMiddleware } from '@nestjs/common';

/**
 * Request shape for the limits middleware.
 */
export interface RequestLimitsRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  /** Raw headers as a flat array [key, value, key, value, ...] (Node.js style). */
  rawHeaders?: string[];
  /** Content-Length header parsed as number, if available. */
  socket?: { bytesRead?: number };
}

export interface RequestLimitsResponse {
  headersSent?: boolean;
  status: (code: number) => RequestLimitsResponse;
  json: (body: unknown) => RequestLimitsResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type RequestLimitsNext = (err?: unknown) => void;

/**
 * Request size limit configuration (Req 30.5).
 */
export interface RequestLimitsConfig {
  /** Maximum request body size in bytes. Default: 10MB. */
  maxBodySize: number;
  /** Maximum total headers size in bytes. Default: 8KB. */
  maxHeadersSize: number;
  /** Maximum URL length in characters. Default: 2048. */
  maxUrlLength: number;
}

/** Default limits per Req 30.5. */
export const DEFAULT_REQUEST_LIMITS: Readonly<RequestLimitsConfig> = {
  maxBodySize: 10 * 1024 * 1024, // 10MB
  maxHeadersSize: 8 * 1024, // 8KB
  maxUrlLength: 2048, // 2048 characters
};

/**
 * `RequestLimitsMiddleware` — enforces request size limits (Task 29.5, Req 30.5).
 *
 * Behaviour:
 *   - Checks Content-Length header against maxBodySize (10MB).
 *     If exceeded, responds with 413 REQUEST_BODY_TOO_LARGE.
 *   - Estimates total headers size and rejects if > maxHeadersSize (8KB).
 *     Responds with 431 REQUEST_HEADERS_TOO_LARGE.
 *   - Checks URL length against maxUrlLength (2048 characters).
 *     If exceeded, responds with 414 REQUEST_URI_TOO_LONG.
 *
 * Note: The body size check here is based on Content-Length header.
 * For streaming bodies without Content-Length, use express body-parser
 * `limit` option as a secondary defence.
 */
@Injectable()
export class RequestLimitsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLimitsMiddleware.name);
  private readonly limits: RequestLimitsConfig;

  constructor() {
    this.limits = { ...DEFAULT_REQUEST_LIMITS };
  }

  use(
    req: RequestLimitsRequest,
    res: RequestLimitsResponse,
    next: RequestLimitsNext,
  ): void {
    // 1. Check URL length (Req 30.5: max 2048 characters)
    const url = req.originalUrl ?? req.url ?? '';
    if (url.length > this.limits.maxUrlLength) {
      this.logger.warn(
        `Request URL too long: ${url.length} chars (max ${this.limits.maxUrlLength})`,
      );
      if (!res.headersSent) {
        res.status(414).json({
          error: {
            code: 'REQUEST_URI_TOO_LONG',
            message: `URL exceeds maximum length of ${this.limits.maxUrlLength} characters`,
            maxLength: this.limits.maxUrlLength,
            actualLength: url.length,
          },
        });
      }
      return;
    }

    // 2. Check headers size (Req 30.5: max 8KB)
    const headersSize = this.estimateHeadersSize(req);
    if (headersSize > this.limits.maxHeadersSize) {
      this.logger.warn(
        `Request headers too large: ${headersSize} bytes (max ${this.limits.maxHeadersSize})`,
      );
      if (!res.headersSent) {
        res.status(431).json({
          error: {
            code: 'REQUEST_HEADERS_TOO_LARGE',
            message: `Headers exceed maximum size of ${this.limits.maxHeadersSize} bytes`,
            maxSize: this.limits.maxHeadersSize,
            estimatedSize: headersSize,
          },
        });
      }
      return;
    }

    // 3. Check body size via Content-Length (Req 30.5: max 10MB)
    const contentLength = this.getContentLength(req);
    if (contentLength !== null && contentLength > this.limits.maxBodySize) {
      this.logger.warn(
        `Request body too large: ${contentLength} bytes (max ${this.limits.maxBodySize})`,
      );
      if (!res.headersSent) {
        res.status(413).json({
          error: {
            code: 'REQUEST_BODY_TOO_LARGE',
            message: `Request body exceeds maximum size of ${this.limits.maxBodySize} bytes (${Math.round(this.limits.maxBodySize / 1024 / 1024)}MB)`,
            maxSize: this.limits.maxBodySize,
            contentLength,
          },
        });
      }
      return;
    }

    return next();
  }

  /**
   * Estimate total headers size by summing key + value byte lengths.
   * Uses rawHeaders if available (more accurate), otherwise falls back
   * to the parsed headers object.
   */
  private estimateHeadersSize(req: RequestLimitsRequest): number {
    if (req.rawHeaders && req.rawHeaders.length > 0) {
      let size = 0;
      for (const part of req.rawHeaders) {
        size += Buffer.byteLength(part, 'utf8');
      }
      return size;
    }

    if (!req.headers) return 0;

    let size = 0;
    for (const [key, value] of Object.entries(req.headers)) {
      size += Buffer.byteLength(key, 'utf8');
      if (typeof value === 'string') {
        size += Buffer.byteLength(value, 'utf8');
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (v) size += Buffer.byteLength(v, 'utf8');
        }
      }
    }
    return size;
  }

  /**
   * Extract Content-Length from headers. Returns null if not present
   * or not a valid number.
   */
  private getContentLength(req: RequestLimitsRequest): number | null {
    const raw = req.headers?.['content-length'];
    const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
    if (!value) return null;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }
}
