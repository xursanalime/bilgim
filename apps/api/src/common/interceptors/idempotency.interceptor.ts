import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';

import { RedisService } from '../../infra/redis/redis.service';

/**
 * Idempotency interceptor — caches responses by `Idempotency-Key` header for 24h.
 *
 * Behaviour (Requirements 18.6, 19.1, 19.2, 19.3):
 *   - Triggers on POST/PUT/PATCH/DELETE only when an `Idempotency-Key` header is present.
 *   - Validates the key (8–128 chars, alphanumeric / `-` / `_`).
 *   - Computes a SHA-256 payload hash of `method + path + JSON(body)`.
 *   - Cache scope is `(userId, method, path, key)` — same key can safely be
 *     reused on different routes or by different users (matches design
 *     guidance: scope = "POST /enrollment/checkout").
 *   - On cache hit with matching payload hash → returns the cached response (Req 19.1).
 *   - On cache hit with mismatching payload hash → 409 IDEMPOTENCY_CONFLICT (Req 19.2).
 *   - On cache miss → executes the handler, caches success responses for 24h
 *     (skips 5xx so clients can safely retry), and persists an
 *     `IdempotencyRecord` for audit/cleanup (Req 19.3 / 18.6).
 *
 * Storage:
 *   - Redis key: `idempotency:{method}:{path}:{userId|anon}:{key}` (24h TTL) — fast hot path.
 *   - Postgres `IdempotencyRecord` — durable audit + 24h cleanup window.
 *
 * Cleanup:
 *   - Redis entries expire automatically via TTL.
 *   - Postgres rows are removed by `cleanupExpired()` (call from a cron / scheduled
 *     task; an index on `expiresAt` keeps the sweep cheap).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  /** 24 hours in seconds. */
  static readonly TTL_SECONDS = 24 * 60 * 60;

  /** Allowed key character set: UUIDs, ULIDs, base64url, etc. */
  private static readonly KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly prisma?: PrismaClient,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const idempotencyKey = this.readIdempotencyKey(request);

    if (!idempotencyKey) {
      return next.handle();
    }

    const method = (request.method ?? '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    if (!IdempotencyInterceptor.KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be 8–128 characters of [A-Za-z0-9_-]',
      });
    }

    const userId = request.user?.sub ?? request.user?.id ?? 'anon';
    const path = this.extractPath(request);
    const scope = `${method} ${path}`;
    const cacheKey = this.buildCacheKey(method, path, userId, idempotencyKey);
    const recordKey = this.buildRecordKey(method, path, userId, idempotencyKey);
    const payloadHash = this.hashPayload(method, path, request.body);

    return from(this.lookupCached(cacheKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          if (cached.payloadHash !== payloadHash) {
            this.setHeader(response, 'X-Idempotency-Key-Status', 'conflict');
            throw new ConflictException({
              code: 'IDEMPOTENCY_CONFLICT',
              message:
                'Idempotency-Key already used with a different request payload',
            });
          }

          this.setHeader(response, 'X-Idempotency-Key-Status', 'hit');
          if (typeof response?.status === 'function' && cached.statusCode) {
            response.status(cached.statusCode);
          }
          return of(cached.responseBody);
        }

        this.setHeader(response, 'X-Idempotency-Key-Status', 'miss');

        return next.handle().pipe(
          tap((body) => {
            const statusCode =
              typeof response?.statusCode === 'number'
                ? response.statusCode
                : 200;
            // Skip 5xx so clients are free to retry (Req 19.3 spirit).
            if (statusCode >= 500) return;
            void this.persist({
              cacheKey,
              recordKey,
              scope,
              userId: userId === 'anon' ? null : userId,
              payloadHash,
              statusCode,
              responseBody: body,
            });
          }),
          catchError((err) => {
            // Never cache failures — let the client retry safely.
            throw err;
          }),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  /**
   * Remove `IdempotencyRecord` rows whose 24-hour window has expired.
   * Wire this to a cron/scheduler (see `Req 19.3`).
   *
   * Returns the number of rows removed.
   */
  async cleanupExpired(now: Date = new Date()): Promise<number> {
    if (!this.prisma) return 0;
    try {
      const result = await this.prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: now } },
      });
      return result.count;
    } catch (err) {
      this.logger.warn(
        `Failed to cleanup expired idempotency records: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readIdempotencyKey(request: any): string | undefined {
    const headers = request.headers ?? {};
    const raw =
      headers['idempotency-key'] ??
      headers['Idempotency-Key'] ??
      headers['x-idempotency-key'];
    if (Array.isArray(raw)) return raw[0];
    return typeof raw === 'string' ? raw.trim() : undefined;
  }

  /** Strips the query string so `/x?foo=1` and `/x?foo=2` share an idempotency scope. */
  private extractPath(request: any): string {
    const raw = request.originalUrl ?? request.url ?? '';
    const qIdx = raw.indexOf('?');
    return qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  }

  private buildCacheKey(
    method: string,
    path: string,
    userId: string,
    key: string,
  ): string {
    return `idempotency:${method}:${path}:${userId}:${key}`;
  }

  /**
   * Composite key for the Postgres `IdempotencyRecord` table. The schema's PK
   * is a single string, so we encode `(userId, method, path, key)` into one
   * value to preserve user/route scoping at the storage layer too.
   */
  private buildRecordKey(
    method: string,
    path: string,
    userId: string,
    key: string,
  ): string {
    return `${userId}|${method} ${path}|${key}`;
  }

  private hashPayload(method: string, path: string, body: unknown): string {
    const safeBody = this.stableStringify(body);
    return createHash('sha256')
      .update(`${method}\n${path}\n${safeBody}`)
      .digest('hex');
  }

  /** Deterministic JSON stringify so key ordering doesn't change the hash. */
  private stableStringify(value: unknown): string {
    if (value === undefined || value === null) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map(
        (k) =>
          `${JSON.stringify(k)}:${this.stableStringify(
            (value as Record<string, unknown>)[k],
          )}`,
      )
      .join(',')}}`;
  }

  private setHeader(response: any, name: string, value: string): void {
    if (response && typeof response.setHeader === 'function') {
      try {
        response.setHeader(name, value);
      } catch {
        /* response already sent — ignore */
      }
    }
  }

  private async lookupCached(cacheKey: string): Promise<
    | {
        payloadHash: string;
        responseBody: unknown;
        statusCode: number;
      }
    | null
  > {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.payloadHash !== 'string' ||
        typeof parsed?.statusCode !== 'number'
      ) {
        return null;
      }
      return {
        payloadHash: parsed.payloadHash,
        responseBody: parsed.responseBody ?? null,
        statusCode: parsed.statusCode,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to read idempotency cache (${cacheKey}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async persist(input: {
    cacheKey: string;
    recordKey: string;
    scope: string;
    userId: string | null;
    payloadHash: string;
    statusCode: number;
    responseBody: unknown;
  }): Promise<void> {
    const {
      cacheKey,
      recordKey,
      scope,
      userId,
      payloadHash,
      statusCode,
      responseBody,
    } = input;

    const serialised = JSON.stringify({
      payloadHash,
      statusCode,
      responseBody: responseBody ?? null,
    });

    if (this.redis) {
      try {
        await this.redis.set(
          cacheKey,
          serialised,
          IdempotencyInterceptor.TTL_SECONDS,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to write idempotency cache (${cacheKey}): ${(err as Error).message}`,
        );
      }
    }

    if (this.prisma) {
      const expiresAt = new Date(
        Date.now() + IdempotencyInterceptor.TTL_SECONDS * 1000,
      );
      try {
        await this.prisma.idempotencyRecord.upsert({
          where: { key: recordKey },
          create: {
            key: recordKey,
            scope,
            userId: userId ?? null,
            responseHash: payloadHash,
            responseBody: this.toJsonInput(responseBody),
            statusCode,
            expiresAt,
          },
          update: {
            responseHash: payloadHash,
            responseBody: this.toJsonInput(responseBody),
            statusCode,
            expiresAt,
          },
        });
      } catch (err) {
        if (this.isTransientHttpError(err)) {
          throw err;
        }
        this.logger.warn(
          `Failed to persist IdempotencyRecord (${recordKey}): ${(err as Error).message}`,
        );
      }
    }
  }

  private toJsonInput(value: unknown): any {
    // Prisma Json column accepts plain JSON-serialisable values.
    if (value === undefined) return null;
    return value as any;
  }

  private isTransientHttpError(err: unknown): err is HttpException {
    return err instanceof HttpException;
  }
}
