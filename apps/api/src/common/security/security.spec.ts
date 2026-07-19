import {
  ArgumentsHost,
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Post,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import request from 'supertest';

import {
  AllExceptionsFilter,
  redactString,
  scrubSensitive,
} from '../filters/all-exceptions.filter';
import { Public } from '../decorators/public.decorator';
import { RedisService } from '../../infra/redis/redis.service';
import { RateLimitInterceptor } from '../interceptors/rate-limit.interceptor';
import { envSchema } from '../../config/env.schema';
import { configureSecurity } from './configure-security';

/**
 * Task 24.1 — security baseline guarantees that aren't covered by the
 * existing `configure-security.spec.ts` (which exercises helmet / CORS
 * happy-paths). This spec narrows in on:
 *
 *   1. Boot-time JWT secret length guard (`envSchema` rejects < 32 bytes)
 *   2. Sensitive-field scrubbing (filter + helpers)
 *   3. CORS hard-rejection of unconfigured origins (cross-origin POST)
 */

// ---------------------------------------------------------------------------
// 1. Boot-time JWT secret length guard
// ---------------------------------------------------------------------------

const validBaseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
};

describe('envSchema — JWT secret minimum length (Task 24.1)', () => {
  it('refuses to start when JWT_SECRET is shorter than 32 bytes', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'short-dev-secret', // 16 bytes
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.path.join('.'));
      expect(issues).toContain('JWT_SECRET');
    }
  });

  it('accepts a 32-byte JWT_SECRET', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(32),
    });

    expect(parsed.success).toBe(true);
  });

  it('refuses to start when JWT_ACCESS_SECRET is shorter than 32 bytes', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(64),
      JWT_ACCESS_SECRET: 'too-short',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.path.join('.'));
      expect(issues).toContain('JWT_ACCESS_SECRET');
    }
  });

  it('refuses to start when JWT_REFRESH_SECRET is shorter than 32 bytes', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'still-too-short-refresh',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.path.join('.'));
      expect(issues).toContain('JWT_REFRESH_SECRET');
    }
  });

  it('accepts split-secret deployments when both keys meet the minimum', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(64),
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
    });

    expect(parsed.success).toBe(true);
  });
});

describe('envSchema — MASTER_ENCRYPTION_KEY validation (Task 28.1)', () => {
  it('accepts a missing MASTER_ENCRYPTION_KEY (optional, dev/test fallback)', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an MASTER_ENCRYPTION_KEY shorter than 32 chars', () => {
    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(32),
      MASTER_ENCRYPTION_KEY: 'too-short',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.path.join('.'));
      expect(issues).toContain('MASTER_ENCRYPTION_KEY');
    }
  });

  it('accepts a base64-encoded 32-byte MASTER_ENCRYPTION_KEY (44 chars padded)', () => {
    // 32 bytes -> 44-char base64 with `=` padding
    const validKey = Buffer.alloc(32, 7).toString('base64');
    expect(validKey.length).toBeGreaterThanOrEqual(32);

    const parsed = envSchema.safeParse({
      ...validBaseEnv,
      JWT_SECRET: 'a'.repeat(32),
      MASTER_ENCRYPTION_KEY: validKey,
    });
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Sensitive-field scrub patterns
// ---------------------------------------------------------------------------

describe('AllExceptionsFilter sensitive scrubbing (Task 24.1)', () => {
  describe('scrubSensitive — recursive object redaction', () => {
    it('redacts password / token / secret / authorization / cookie keys', () => {
      const out = scrubSensitive({
        email: 't@example.com',
        password: 'p@ssw0rd!',
        token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
        secret: 'shhh',
        authorization: 'Bearer xyz',
        cookie: 'session=abc',
        nested: {
          newPassword: 'rotated',
          refreshToken: 'opaque-32b',
          ok: 'visible',
        },
      });

      expect(out).toMatchObject({
        email: 't@example.com',
        password: '[REDACTED]',
        token: '[REDACTED]',
        secret: '[REDACTED]',
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        nested: {
          newPassword: '[REDACTED]',
          refreshToken: '[REDACTED]',
          ok: 'visible',
        },
      });
    });

    it('redacts inside arrays and is case-insensitive', () => {
      const out = scrubSensitive({
        items: [
          { Password: 'a', label: 'one' },
          { TOKEN: 'b', label: 'two' },
        ],
      }) as any;

      expect(out.items[0]).toEqual({ Password: '[REDACTED]', label: 'one' });
      expect(out.items[1]).toEqual({ TOKEN: '[REDACTED]', label: 'two' });
    });

    it('does not mutate the input object', () => {
      const input = { password: 'plain', email: 't@example.com' };
      scrubSensitive(input);
      expect(input.password).toBe('plain');
    });
  });

  describe('redactString — inline secret substitution', () => {
    it('rewrites Bearer tokens', () => {
      expect(redactString('Authorization header was Bearer abc.def.ghi'))
        .toBe('Authorization header was Bearer [REDACTED]');
    });

    it('rewrites Basic auth', () => {
      expect(redactString('header=Basic dXNlcjpwYXNz')).toBe(
        'header=Basic [REDACTED]',
      );
    });

    it('rewrites password=… key/value fragments', () => {
      expect(redactString('failed payload password=hunter2 keep=this')).toBe(
        'failed payload password=[REDACTED] keep=this',
      );
    });

    it('rewrites token= fragments', () => {
      expect(redactString('refresh_token=abc.def&other=ok')).toBe(
        'refresh_token=[REDACTED]&other=ok',
      );
    });

    it('returns the original string when no secrets are present', () => {
      expect(redactString('user not found')).toBe('user not found');
    });
  });

  describe('AllExceptionsFilter — runtime behaviour', () => {
    it('scrubs request.body in the structured log payload', () => {
      const filter = new AllExceptionsFilter();
      const errorSpy = jest
        .spyOn((filter as any).logger, 'error')
        .mockImplementation(() => undefined);

      const responseStub = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const requestStub = {
        traceId: 'trace-1',
        body: {
          email: 't@example.com',
          password: 'p@ssw0rd!',
          token: 'should-not-leak',
        },
        query: { secret: 'shhh' },
        params: {},
      };
      const host: ArgumentsHost = {
        switchToHttp: () => ({
          getRequest: <T>() => requestStub as unknown as T,
          getResponse: <T>() => responseStub as unknown as T,
          getNext: () => ({}) as any,
        }),
      } as any;

      filter.catch(new Error('boom Bearer secret-token'), host);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(logged.body).toMatchObject({
        email: 't@example.com',
        password: '[REDACTED]',
        token: '[REDACTED]',
      });
      expect(logged.query).toMatchObject({ secret: '[REDACTED]' });
      expect(logged.error).toBe('boom Bearer [REDACTED]');

      expect(responseStub.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 3. CORS — reject unconfigured origin
// ---------------------------------------------------------------------------

@Controller('v1')
class CorsTestController {
  @Public()
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Public()
  @Post('echo')
  echo(@Body() body: unknown) {
    return { ok: true, body };
  }
}

function makeFakeRedisService(): RedisService {
  // Minimal stub so RateLimitInterceptor doesn't throw on missing client.
  // The CORS specs never trip the limiter, but the interceptor is wired
  // globally to mirror the real bootstrap order.
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
            counters.set(k, { ...cur, ttl: ttlSeconds });
            return 1;
          });
          return api;
        },
        ttl: (k: string) => {
          queue.push(() => counters.get(k)?.ttl ?? 60);
          return api;
        },
        exec: async () => queue.map((fn) => [null, fn()]),
      };
      return api;
    },
    expire: async () => 1,
  };
  return { getClient: () => client } as unknown as RedisService;
}

function makeConfigService(
  overrides: Partial<Record<string, unknown>> = {},
): ConfigService {
  const env: Record<string, unknown> = {
    NODE_ENV: 'test',
    HELMET_CSP: false,
    WEB_ORIGIN: 'http://localhost:3000',
    CORS_CREDENTIALS: true,
    BODY_LIMIT_BYTES: 1024 * 1024,
    REQUEST_TIMEOUT_MS: 30_000,
    ...overrides,
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

async function bootstrap(
  configOverrides: Partial<Record<string, unknown>> = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [CorsTestController],
    providers: [
      Reflector,
      { provide: RedisService, useValue: makeFakeRedisService() },
      { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 'loopback');
  configureSecurity(app, makeConfigService(configOverrides) as any, {
    helmet,
    compression,
  });
  await app.init();
  return app;
}

describe('CORS — reject unconfigured origin (Task 24.1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({
      WEB_ORIGIN: 'https://app.edubridge.uz,https://www.edubridge.uz',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not echo Access-Control-Allow-Origin for an unlisted origin (preflight)', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/echo')
      .set('Origin', 'http://attacker.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.headers['access-control-allow-origin']).not.toBe(
      'http://attacker.example.com',
    );
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not echo Access-Control-Allow-Origin for an unlisted origin (simple POST)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/echo')
      .set('Origin', 'http://attacker.example.com')
      .send({ ok: true });

    expect(res.headers['access-control-allow-origin']).not.toBe(
      'http://attacker.example.com',
    );
  });

  it('echoes Access-Control-Allow-Origin for a configured origin', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/echo')
      .set('Origin', 'https://app.edubridge.uz')
      .send({ ok: true });

    // Nest's default POST status is 201; the assertion that matters is
    // the CORS header, but we still want the request to succeed (no 4xx).
    expect(res.status).toBeLessThan(400);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.edubridge.uz',
    );
  });

  it('still allows requests without an Origin header (curl, server-to-server)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
