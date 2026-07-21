import {
  HttpStatus,
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';

import { HealthController } from './health.controller';
import { QUEUE_NAMES } from '../infra/bullmq/queue.constants';
import { OutboxDispatcher } from '../infra/outbox/outbox.dispatcher';
import { RedisService } from '../infra/redis/redis.service';

/**
 * Health endpoint tests (Task 24.3).
 *
 *   - `/health`       — full readiness-style probe with the component
 *                       breakdown for Prisma + Redis + BullMQ + outbox.
 *                       200 when all up; 503 with the structured
 *                       envelope when any subsystem is down.
 *   - `/health/live`  — liveness-only; no dependency checks.
 *   - `/health/ready` — same payload as `/health` (kept as a stable URL
 *                       for ingress configs).
 */
describe('HealthController', () => {
  let app: INestApplication;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { getClient: jest.Mock };
  let redisClient: { ping: jest.Mock };
  let outbox: { isHealthy: jest.Mock };
  let bullmqClient: { ping: jest.Mock };
  let bullmqQueue: { client: Promise<{ ping: jest.Mock }> };

  async function buildApp() {
    redisClient = { ping: jest.fn().mockResolvedValue('PONG') };
    redis = { getClient: jest.fn(() => redisClient) };
    outbox = { isHealthy: jest.fn().mockReturnValue(true) };
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]) };
    bullmqClient = { ping: jest.fn().mockResolvedValue('PONG') };
    bullmqQueue = { client: Promise.resolve(bullmqClient) };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaClient, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: OutboxDispatcher, useValue: outbox },
        {
          provide: getQueueToken(QUEUE_NAMES.NOTIFICATION_FANOUT),
          useValue: bullmqQueue,
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }

  beforeEach(async () => {
    await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------
  // /health/live — liveness only
  // ------------------------------------------------------------------

  it('GET /health/live returns 200 even when Prisma is broken', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({ status: 'ok', service: 'edubridge-api' });
    // Liveness must NOT touch Prisma.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // /health — full check with component breakdown
  // ------------------------------------------------------------------

  it('GET /health returns 200 with the component breakdown when every probe succeeds', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'edubridge-api',
      checks: {
        prisma: { status: 'up' },
        redis: { status: 'up' },
        bullmq: { status: 'up' },
        outbox: { status: 'up' },
      },
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redisClient.ping).toHaveBeenCalled();
    expect(bullmqClient.ping).toHaveBeenCalled();
    expect(outbox.isHealthy).toHaveBeenCalled();
  });

  it('GET /health returns 503 with the breakdown when Prisma is down', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    // Nest serialises the ServiceUnavailableException's payload into
    // the response body — the structured report lives under `message`.
    const payload =
      (res.body?.message as Record<string, unknown> | undefined) ?? res.body;
    expect(payload).toMatchObject({
      status: 'degraded',
      checks: {
        prisma: { status: 'down' },
        redis: { status: 'up' },
        bullmq: { status: 'up' },
        outbox: { status: 'up' },
      },
    });
  });

  it('GET /health returns 503 when Redis is down', async () => {
    redisClient.ping.mockRejectedValueOnce(new Error('redis offline'));
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    const payload =
      (res.body?.message as Record<string, unknown> | undefined) ?? res.body;
    expect(payload).toMatchObject({
      status: 'degraded',
      checks: {
        redis: { status: 'down' },
      },
    });
  });

  it('GET /health returns 503 when BullMQ Redis connection is broken', async () => {
    bullmqClient.ping.mockRejectedValueOnce(new Error('bullmq disconnected'));
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    const payload =
      (res.body?.message as Record<string, unknown> | undefined) ?? res.body;
    expect(payload).toMatchObject({
      status: 'degraded',
      checks: {
        bullmq: { status: 'down' },
      },
    });
  });

  it('GET /health returns 503 when outbox dispatcher reports unhealthy', async () => {
    outbox.isHealthy.mockReturnValueOnce(false);
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    const payload =
      (res.body?.message as Record<string, unknown> | undefined) ?? res.body;
    expect(payload).toMatchObject({
      status: 'degraded',
      checks: {
        outbox: { status: 'down' },
      },
    });
  });

  // ------------------------------------------------------------------
  // /health/ready — alias kept for ingress configs
  // ------------------------------------------------------------------

  it('GET /health/ready returns the same payload shape as /health', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: {
        prisma: { status: 'up' },
        redis: { status: 'up' },
        bullmq: { status: 'up' },
        outbox: { status: 'up' },
      },
    });
  });
});

/**
 * Independent unit-level coverage that doesn't require booting Nest:
 * verifies the controller's `check()` method directly so we know the
 * subsystem fan-out + 503 envelope are wired regardless of the global
 * exception filter.
 */
describe('HealthController.check (direct)', () => {
  it('throws ServiceUnavailableException with the report payload when Prisma fails', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const redis = { getClient: () => ({ ping: () => Promise.resolve('PONG') }) };
    const outbox = { isHealthy: () => true };
    const bullmqQueue = {
      client: Promise.resolve({ ping: () => Promise.resolve('PONG') }),
    } as unknown as Queue;
    const controller = new HealthController(
      prisma as unknown as PrismaClient,
      redis as unknown as RedisService,
      outbox as unknown as OutboxDispatcher,
      bullmqQueue,
    );

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    try {
      await controller.check();
    } catch (err) {
      const response = (err as ServiceUnavailableException).getResponse() as {
        checks?: { prisma?: { status?: string } };
      };
      expect(response.checks?.prisma?.status).toBe('down');
    }
  });

  it('treats unwired probes as up so dev / test stacks do not flap', async () => {
    const controller = new HealthController();
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.checks.prisma.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.bullmq.status).toBe('up');
    expect(result.checks.outbox.status).toBe('up');
  });
});
