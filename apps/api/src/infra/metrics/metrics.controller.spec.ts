import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * `/metrics` end-to-end tests (Task 24.3).
 *
 * Boots a thin Nest app with just `MetricsController` + `MetricsService`,
 * disables the global JWT guard with a `Reflector`-driven bypass, and
 * asserts:
 *   - the Prometheus exposition body returns 200 with the right
 *     `Content-Type`,
 *   - the soft `METRICS_TOKEN` check is honoured when configured,
 *   - cache headers are no-store so scrapers always get fresh values.
 */
describe('GET /metrics', () => {
  async function bootstrap(metricsToken?: string): Promise<{
    app: INestApplication;
    metrics: MetricsService;
  }> {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        Reflector,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'METRICS_TOKEN' ? metricsToken : undefined,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const metrics = moduleRef.get(MetricsService);
    metrics.observeHttpRequest('GET', '/health', 200, 0.005);
    return { app, metrics };
  }

  describe('without METRICS_TOKEN', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await bootstrap(undefined));
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 200 with Prometheus exposition format', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('# HELP http_request_duration_seconds');
      expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
      expect(res.text).toContain('# TYPE http_requests_total counter');
      expect(res.text).toContain('# TYPE notifications_dispatched_total counter');
      expect(res.text).toContain('# TYPE bilgim_notification_failed_total counter');
      expect(res.text).toContain('# TYPE payme_transitions_total counter');
      expect(res.text).toContain('# TYPE outbox_pending_events gauge');
      expect(res.text).toContain('# TYPE bilgim_outbox_pending gauge');
      expect(res.text).toContain('# TYPE ai_calls_total counter');
      expect(res.text).toContain('# TYPE bilgim_ai_call_duration_seconds histogram');
    });

    it('sets Cache-Control: no-store so scrapers always get fresh values', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('with METRICS_TOKEN configured', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await bootstrap('s3cret-token'));
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects scrape without token (403)', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');
      expect(res.status).toBe(403);
    });

    it('rejects scrape with wrong token (403)', async () => {
      const res = await request(app.getHttpServer()).get('/metrics?token=nope');
      expect(res.status).toBe(403);
    });

    it('accepts scrape with valid ?token= query param', async () => {
      const res = await request(app.getHttpServer()).get(
        '/metrics?token=s3cret-token',
      );
      expect(res.status).toBe(200);
      expect(res.text).toContain('http_request_duration_seconds');
    });

    it('accepts scrape with valid X-Metrics-Token header', async () => {
      const res = await request(app.getHttpServer())
        .get('/metrics')
        .set('X-Metrics-Token', 's3cret-token');
      expect(res.status).toBe(200);
    });
  });
});
