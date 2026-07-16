import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  INestApplication,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import helmet from 'helmet';
import compression from 'compression';

import { Public } from '../decorators/public.decorator';
import { RateLimit } from '../decorators/rate-limit.decorator';
import { RedisService } from '../../infra/redis/redis.service';
import { RateLimitInterceptor } from '../interceptors/rate-limit.interceptor';
import { configureSecurity } from './configure-security';

/**
 * Task 24.1 — security baseline tests.
 *
 * Boots a minimal Nest app wired with `configureSecurity()` and the
 * existing `RateLimitInterceptor` so the production middleware order
 * is exercised end-to-end (helmet → CORS → body parser → compression
 * → timeout → header redaction → interceptors → controller).
 */

// -----------------------------------------------------------------------------
// Test controller
// -----------------------------------------------------------------------------

@Controller('v1')
class HardeningTestController {
  @Public()
  @Post('echo')
  @HttpCode(HttpStatus.OK)
  echo(@Body() body: unknown) {
    return { ok: true, size: JSON.stringify(body ?? {}).length };
  }

  @Public()
  @RateLimit(10, '1m')
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: unknown) {
    return { ok: true, body };
  }

  @Public()
  @Get('introspect')
  introspect(@Req() req: any) {
    return {
      original: req.headers.authorization,
      safe: req.safeHeaders?.authorization,
      cookieOriginal: req.headers.cookie,
      cookieSafe: req.safeHeaders?.cookie,
    };
  }
}

// -----------------------------------------------------------------------------
// Stubs
// -----------------------------------------------------------------------------

/** Minimal in-memory ioredis stub that supports the RateLimitInterceptor. */
function makeFakeRedisService(): RedisService {
  const counters = new Map<string, { count: number; ttl: number }>();
  const client: any = {
    multi: () => {
      const queue: Array<() => any> = [];
      const api: any = {
        incr: (k: string) => {
          queue.push(() => {
            const cur = counters.get(k);
            const next = (cur?.count ?? 0) + 1;
            counters.set(k, { count: next, ttl: cur?.ttl ?? -1 });
            return next;
          });
          return api;
        },
        expire: (k: string, ttlSeconds: number) => {
          queue.push(() => {
            const cur = counters.get(k);
            if (!cur) return 0;
            if (cur.ttl === -1) {
              counters.set(k, { ...cur, ttl: ttlSeconds });
              return 1;
            }
            return 0;
          });
          return api;
        },
        ttl: (k: string) => {
          queue.push(() => counters.get(k)?.ttl ?? -2);
          return api;
        },
        exec: async () => queue.map((fn) => [null, fn()]),
      };
      return api;
    },
    expire: async (k: string, ttlSeconds: number) => {
      const cur = counters.get(k);
      if (cur) counters.set(k, { ...cur, ttl: ttlSeconds });
      return 1;
    },
  };
  return { getClient: () => client } as unknown as RedisService;
}

/**
 * `ConfigService` stub that always returns the test env so we don't have
 * to bootstrap the real config module.
 */
function makeConfigService(
  overrides: Partial<Record<string, unknown>> = {},
): ConfigService {
  const env: Record<string, unknown> = {
    NODE_ENV: 'test',
    HELMET_CSP: false,
    WEB_ORIGIN: 'http://allowed.example.com,http://localhost:3000',
    CORS_CREDENTIALS: true,
    BODY_LIMIT_BYTES: 1024 * 1024, // 1 MB
    REQUEST_TIMEOUT_MS: 30_000,
    ...overrides,
  };
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

// -----------------------------------------------------------------------------
// Bootstrap helper
// -----------------------------------------------------------------------------

async function bootstrap(
  fakeRedis: RedisService,
  configOverrides: Partial<Record<string, unknown>> = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HardeningTestController],
    providers: [
      Reflector,
      { provide: RedisService, useValue: fakeRedis },
      { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureSecurity(app, makeConfigService(configOverrides) as any, {
    helmet,
    compression,
  });
  await app.init();
  return app;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('configureSecurity (Task 24.1)', () => {
  describe('helmet headers', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap(makeFakeRedisService());
    });
    afterAll(async () => {
      await app.close();
    });

    it('sets X-DNS-Prefetch-Control and X-Frame-Options on every response', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .send({ ping: 'pong' });

      expect(res.status).toBe(200);
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      // Task 29.4: helmet's frameguard is forced to DENY (Req 30.3).
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('emits Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .send({});

      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });

    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .send({});

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('emits Permissions-Policy locking down camera/microphone/geolocation', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .send({});

      const policy = res.headers['permissions-policy'] as string | undefined;
      expect(policy).toBeDefined();
      expect(policy).toMatch(/camera=\(\)/);
      expect(policy).toMatch(/microphone=\(\)/);
      expect(policy).toMatch(/geolocation=\(\)/);
      expect(policy).toMatch(/payment=\(\)/);
    });

    it('omits HSTS outside of production', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .send({});

      expect(res.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('helmet HSTS in production', () => {
    let prodApp: INestApplication;

    beforeAll(async () => {
      prodApp = await bootstrap(makeFakeRedisService(), {
        NODE_ENV: 'production',
        // Disable CSP so the test controller still responds normally.
        HELMET_CSP: false,
      });
    });
    afterAll(async () => {
      await prodApp.close();
    });

    it('emits Strict-Transport-Security with preload + includeSubDomains', async () => {
      const res = await request(prodApp.getHttpServer())
        .post('/v1/echo')
        .send({});

      expect(res.status).toBe(200);
      expect(res.headers['strict-transport-security']).toMatch(
        /max-age=\d+; includeSubDomains; preload/,
      );
    });
  });

  describe('CORS allow-list', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap(makeFakeRedisService());
    });
    afterAll(async () => {
      await app.close();
    });

    it('allows requests from an allow-listed origin', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .set('Origin', 'http://allowed.example.com')
        .send({});

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://allowed.example.com',
      );
    });

    it('does NOT echo Access-Control-Allow-Origin for an unlisted origin', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .set('Origin', 'http://evil.example.com')
        .send({});

      // The Nest CORS handler will fail the preflight via the cb(err, false)
      // contract; on a simple POST it omits the ACAO header so the browser
      // blocks the response. Either way, the origin must not be reflected.
      expect(res.headers['access-control-allow-origin']).not.toBe(
        'http://evil.example.com',
      );
    });
  });

  describe('body size limit', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap(makeFakeRedisService());
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 413 when the JSON body exceeds 1 MB', async () => {
      // ~1.1 MB JSON payload — well above the 1 MB cap.
      const oversized = { blob: 'a'.repeat(1.1 * 1024 * 1024) };

      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .set('Content-Type', 'application/json')
        .send(oversized);

      expect(res.status).toBe(413);
    });

    it('accepts a body comfortably under the limit', async () => {
      const ok = { blob: 'a'.repeat(64 * 1024) }; // 64 KB
      const res = await request(app.getHttpServer())
        .post('/v1/echo')
        .send(ok);
      expect(res.status).toBe(200);
    });
  });

  describe('auth-route rate limiting', () => {
    let app: INestApplication;
    let redis: RedisService;

    beforeAll(async () => {
      redis = makeFakeRedisService();
      app = await bootstrap(redis);
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 429 after 10 attempts to /v1/auth/login from the same IP', async () => {
      const server = app.getHttpServer();
      const ip = '203.0.113.7';

      // 10 requests below the cap should pass.
      for (let i = 0; i < 10; i += 1) {
        const ok = await request(server)
          .post('/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: 't@example.com', password: 'pw' });
        expect(ok.status).toBe(200);
      }

      // 11th request exceeds the @RateLimit(10, '1m') cap → 429.
      const blocked = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 't@example.com', password: 'pw' });

      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
    });
  });

  describe('sensitive header redaction', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap(makeFakeRedisService());
    });
    afterAll(async () => {
      await app.close();
    });

    it('redacts Authorization on req.safeHeaders without breaking the original header', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/introspect')
        .set('Authorization', 'Bearer super-secret-token')
        .set('Cookie', 'session=abcdef');

      expect(res.status).toBe(200);
      expect(res.body.original).toBe('Bearer super-secret-token');
      expect(res.body.safe).toBe('[REDACTED]');
      expect(res.body.cookieOriginal).toBe('session=abcdef');
      expect(res.body.cookieSafe).toBe('[REDACTED]');
    });
  });
});
