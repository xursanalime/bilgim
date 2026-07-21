import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { RedisService } from '../../infra/redis/redis.service';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

export interface RateLimitDefaults {
  /** Per-IP limit applied to anonymous traffic. */
  perIp: RateLimitOptions;
  /** Per-user limit applied to authenticated traffic. */
  perUser: RateLimitOptions;
}

export const DEFAULT_RATE_LIMITS: RateLimitDefaults = {
  perIp: { limit: 100, windowSeconds: 60 },
  perUser: { limit: 300, windowSeconds: 60 },
};

interface BucketResult {
  count: number;
  ttlSeconds: number;
  exceeded: boolean;
}

/**
 * Redis-backed token-bucket rate limiter (Requirement 21.5).
 *
 * Strategy: per-route counter with INCR + EXPIRE on first hit (atomic via
 * pipeline). When the configured limit is exceeded the interceptor throws
 * 429 TOO_MANY_REQUESTS with a `Retry-After` header. Two buckets run in
 * parallel:
 *   - per-IP (always)
 *   - per-user (when an authenticated principal is on the request)
 * The `@RateLimit()` decorator overrides both buckets for a single route.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly defaults: RateLimitDefaults = DEFAULT_RATE_LIMITS,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    if (context.getType() !== 'http' || !this.redis) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const override = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const ip = this.extractIp(request);
    const userId: string | undefined =
      request.user?.sub ?? request.user?.id ?? undefined;
    const routeKey = this.buildRouteKey(context);

    const checks: Array<Promise<BucketResult & { kind: string }>> = [];

    if (override) {
      const subject = userId ?? ip;
      checks.push(
        this.bumpAndCheck(
          `ratelimit:override:${routeKey}:${subject}`,
          override,
        ).then((r) => ({ ...r, kind: 'override' })),
      );
    } else {
      checks.push(
        this.bumpAndCheck(
          `ratelimit:ip:${routeKey}:${ip}`,
          this.defaults.perIp,
        ).then((r) => ({ ...r, kind: 'ip' })),
      );
      if (userId) {
        checks.push(
          this.bumpAndCheck(
            `ratelimit:user:${routeKey}:${userId}`,
            this.defaults.perUser,
          ).then((r) => ({ ...r, kind: 'user' })),
        );
      }
    }

    return from(Promise.all(checks)).pipe(
      switchMap((results) => {
        const breached = results.find((r) => r.exceeded);
        if (breached) {
          this.applyHeaders(response, breached.ttlSeconds);
          throw new HttpException(
            {
              code: 'TOO_MANY_REQUESTS',
              message: `Rate limit exceeded (${breached.kind})`,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        return next.handle();
      }),
    );
  }

  // ---------------------------------------------------------------------------

  private extractIp(request: any): string {
    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0];
      if (first && first.trim()) return first.trim();
    }
    return (
      request.ip ??
      request.connection?.remoteAddress ??
      request.socket?.remoteAddress ??
      'unknown'
    );
  }

  private buildRouteKey(context: ExecutionContext): string {
    const className = context.getClass()?.name ?? 'Unknown';
    const handlerName = context.getHandler()?.name ?? 'unknown';
    return `${className}.${handlerName}`;
  }

  private async bumpAndCheck(
    bucketKey: string,
    options: RateLimitOptions,
  ): Promise<BucketResult> {
    if (!this.redis) {
      return { count: 0, ttlSeconds: options.windowSeconds, exceeded: false };
    }

    try {
      const client = this.redis.getClient();
      // Atomic INCR + EXPIRE-if-new via pipeline. ioredis returns
      // [[null, count], [null, ttlOrSetResult]].
      const pipeline = client.multi();
      pipeline.incr(bucketKey);
      pipeline.expire(bucketKey, options.windowSeconds, 'NX' as any);
      pipeline.ttl(bucketKey);
      const replies = await pipeline.exec();

      const count = this.parseReply<number>(replies, 0) ?? 0;
      let ttl = this.parseReply<number>(replies, 2) ?? options.windowSeconds;
      if (ttl < 0) {
        // Fallback if the EXPIRE NX option is not supported by this Redis version.
        await client.expire(bucketKey, options.windowSeconds);
        ttl = options.windowSeconds;
      }

      return {
        count,
        ttlSeconds: ttl,
        exceeded: count > options.limit,
      };
    } catch (err) {
      // Fail-open on Redis outages: don't block legitimate traffic.
      this.logger.warn(
        `Rate limit check failed for ${bucketKey}: ${(err as Error).message}`,
      );
      return { count: 0, ttlSeconds: options.windowSeconds, exceeded: false };
    }
  }

  private parseReply<T>(replies: any, index: number): T | null {
    if (!Array.isArray(replies) || !Array.isArray(replies[index])) {
      return null;
    }
    const tuple = replies[index];
    return (tuple[1] as T) ?? null;
  }

  private applyHeaders(response: any, ttlSeconds: number): void {
    if (response && typeof response.setHeader === 'function') {
      try {
        response.setHeader('Retry-After', String(Math.max(1, ttlSeconds)));
      } catch {
        /* response already sent */
      }
    }
  }
}
