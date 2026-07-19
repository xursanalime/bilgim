import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Decorator to mark a route as requiring HMAC-SHA256 request signing.
 * Applied to critical endpoints: payment, enrollment, admin operations.
 *
 * Usage:
 *   @RequireRequestSigning()
 *   @Post('payment/process')
 *   handlePayment() { ... }
 */
export const REQUIRE_REQUEST_SIGNING_KEY = 'require_request_signing';
export const RequireRequestSigning = () =>
  SetMetadata(REQUIRE_REQUEST_SIGNING_KEY, true);

/**
 * Expected headers for request signing:
 *   - `x-signature`: HMAC-SHA256 hex digest
 *   - `x-timestamp`: Unix timestamp (seconds) — used for replay protection
 *   - `x-nonce`: Unique nonce per request — used for replay protection
 */
export interface SignedRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: unknown;
}

/** Maximum age of a signed request (5 minutes). */
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

/**
 * `RequestSigningGuard` — Task 29.4, Req 30.1.
 *
 * Validates HMAC-SHA256 request signatures on critical endpoints
 * (payment, enrollment, admin operations). Only activates on routes
 * decorated with `@RequireRequestSigning()`.
 *
 * Signing algorithm:
 *   1. Construct the signing string: `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
 *   2. Compute HMAC-SHA256 of the signing string using the shared secret
 *   3. Compare with the `x-signature` header (timing-safe)
 *
 * Replay protection:
 *   - Rejects requests with timestamps older than 5 minutes
 *   - Nonce uniqueness can be enforced via Redis (optional, not in this guard)
 */
@Injectable()
export class RequestSigningGuard implements CanActivate {
  private readonly logger = new Logger(RequestSigningGuard.name);
  private readonly secret: string;

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.secret =
      this.config?.get<string>('REQUEST_SIGNING_SECRET') ??
      process.env.REQUEST_SIGNING_SECRET ??
      '';
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const requiresSigning = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_REQUEST_SIGNING_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresSigning) return true;

    const request = context.switchToHttp().getRequest<SignedRequest>();
    return this.validateSignature(request);
  }

  private validateSignature(request: SignedRequest): boolean {
    const signature = this.getHeader(request, 'x-signature');
    const timestamp = this.getHeader(request, 'x-timestamp');
    const nonce = this.getHeader(request, 'x-nonce');

    if (!signature || !timestamp || !nonce) {
      this.logger.warn('Request signing: missing required headers');
      throw new HttpException(
        {
          code: 'SIGNATURE_MISSING',
          message: 'Request signature headers are required',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Validate timestamp freshness (replay protection)
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime)) {
      throw new HttpException(
        {
          code: 'SIGNATURE_INVALID_TIMESTAMP',
          message: 'Invalid timestamp format',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const now = Date.now();
    const drift = Math.abs(now - requestTime * 1000);
    if (drift > MAX_TIMESTAMP_DRIFT_MS) {
      this.logger.warn(
        `Request signing: timestamp drift ${drift}ms exceeds maximum ${MAX_TIMESTAMP_DRIFT_MS}ms`,
      );
      throw new HttpException(
        {
          code: 'SIGNATURE_EXPIRED',
          message: 'Request signature has expired',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Construct signing string
    const method = (request.method ?? 'GET').toUpperCase();
    const path = this.extractPath(request);
    const bodyStr = this.serializeBody(request.body);
    const bodyHash = crypto
      .createHash('sha256')
      .update(bodyStr)
      .digest('hex');

    const signingString = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;

    // Compute expected HMAC
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(signingString)
      .digest('hex');

    // Timing-safe comparison
    if (!this.timingSafeEqual(signature, expectedSignature)) {
      this.logger.warn('Request signing: signature mismatch');
      throw new HttpException(
        {
          code: 'SIGNATURE_INVALID',
          message: 'Request signature verification failed',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    return true;
  }

  private getHeader(
    request: SignedRequest,
    name: string,
  ): string | undefined {
    const value = request.headers?.[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value[0]) return String(value[0]);
    return undefined;
  }

  private extractPath(request: SignedRequest): string {
    const raw = request.originalUrl ?? request.url ?? request.path ?? '/';
    const idx = raw.indexOf('?');
    return idx >= 0 ? raw.slice(0, idx) : raw;
  }

  private serializeBody(body: unknown): string {
    if (body === null || body === undefined) return '';
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Still do a comparison to avoid leaking length info via timing
      const dummy = Buffer.alloc(a.length, 0);
      crypto.timingSafeEqual(dummy, Buffer.from(a));
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
