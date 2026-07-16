import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';

import { Public } from '../common/decorators/public.decorator';
import { QUEUE_NAMES } from '../infra/bullmq/queue.constants';
import {
  OutboxDispatcher,
  type OutboxDispatcherHealth,
} from '../infra/outbox/outbox.dispatcher';
import { RedisService } from '../infra/redis/redis.service';

interface SubsystemStatus {
  status: 'up' | 'down';
  details?: string;
}

interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  service: 'bilgim-api';
  checks: {
    prisma: SubsystemStatus;
    redis: SubsystemStatus;
    bullmq: SubsystemStatus;
    outbox: SubsystemStatus;
  };
}

/**
 * Health endpoints (Task 24.3, Req 26.x).
 *
 *   - `GET /health`         — full readiness-style probe with the
 *                              component breakdown for Prisma, Redis,
 *                              the BullMQ Redis connection and the
 *                              outbox dispatcher. Returns 200 when all
 *                              subsystems report up; returns 503 with
 *                              the structured envelope (under
 *                              `message.checks`) when any one is down.
 *   - `GET /health/live`    — kubelet liveness probe; returns 200 as
 *                              long as the Node process is responsive.
 *                              Never touches the database / Redis.
 *   - `GET /health/ready`   — kubelet readiness probe. Same payload as
 *                              `GET /health` — kept as a stable URL for
 *                              ingress configs that already point at it.
 *
 * The probes are intentionally permissive about adapters that are
 * missing in dev / test (`@Optional()`) — only adapters that are wired
 * into the container are checked. This prevents the endpoint from
 * flapping when, for example, the outbox dispatcher is disabled in an
 * integration suite.
 *
 * BullMQ probe contract: the controller asks the
 * `notification-fanout` queue for its underlying ioredis client (via
 * `Queue.client`, which is a `Promise<Redis>` since BullMQ v4) and
 * round-trips one PING. A reply other than `PONG` is treated as down
 * because BullMQ workers cannot dequeue jobs without a healthy
 * connection.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Optional() private readonly prisma?: PrismaClient,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly outbox?: OutboxDispatcher,
    @Optional()
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_FANOUT)
    private readonly bullmqProbeQueue?: Queue,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthReport> {
    return this.runProbes();
  }

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'bilgim-api',
    };
  }

  @Public()
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<HealthReport> {
    return this.runProbes();
  }

  // ------------------------------------------------------------------
  // Probe orchestration
  // ------------------------------------------------------------------

  /**
   * Fan-out every subsystem probe in parallel, collect the
   * results, and either return the report (200) or bundle it into a
   * `ServiceUnavailableException` (503) so the load balancer pulls
   * the pod out of rotation while operators can still scrape the
   * failure breakdown.
   */
  private async runProbes(): Promise<HealthReport> {
    const [prisma, redis, bullmq, outbox] = await Promise.all([
      this.checkPrisma(),
      this.checkRedis(),
      this.checkBullMq(),
      this.checkOutbox(),
    ]);

    const allUp =
      prisma.status === 'up' &&
      redis.status === 'up' &&
      bullmq.status === 'up' &&
      outbox.status === 'up';

    const report: HealthReport = {
      status: allUp ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'bilgim-api',
      checks: { prisma, redis, bullmq, outbox },
    };

    if (!allUp) {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }

  // ------------------------------------------------------------------
  // Subsystem probes
  // ------------------------------------------------------------------

  private async checkPrisma(): Promise<SubsystemStatus> {
    if (!this.prisma) {
      return { status: 'up', details: 'not wired (skipped)' };
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up' };
    } catch (error) {
      this.logger.warn(
        `Health: Prisma probe failed: ${(error as Error).message}`,
      );
      return { status: 'down', details: (error as Error).message };
    }
  }

  private async checkRedis(): Promise<SubsystemStatus> {
    if (!this.redis) {
      return { status: 'up', details: 'not wired (skipped)' };
    }
    try {
      const client = this.redis.getClient();
      // ioredis exposes `.ping()` which round-trips one PING/PONG.
      const reply = await (client as unknown as { ping(): Promise<string> }).ping();
      if (reply !== 'PONG') {
        return { status: 'down', details: `unexpected ping reply: ${reply}` };
      }
      return { status: 'up' };
    } catch (error) {
      this.logger.warn(
        `Health: Redis probe failed: ${(error as Error).message}`,
      );
      return { status: 'down', details: (error as Error).message };
    }
  }

  /**
   * BullMQ connection probe — verifies the worker queue's underlying
   * Redis client is healthy. Without this, a reachable Redis primary
   * could still leave BullMQ workers idle if their connection pool was
   * disconnected.
   */
  private async checkBullMq(): Promise<SubsystemStatus> {
    if (!this.bullmqProbeQueue) {
      return { status: 'up', details: 'not wired (skipped)' };
    }
    try {
      // BullMQ v4: `Queue.client` is a Promise<Redis>. Await it and
      // round-trip one PING — the worker side uses the same connection
      // pool so a successful PING here implies the workers can dequeue.
      const client = (await (
        this.bullmqProbeQueue as unknown as {
          client: Promise<{ ping(): Promise<string> }>;
        }
      ).client) as { ping(): Promise<string> };
      const reply = await client.ping();
      if (reply !== 'PONG') {
        return { status: 'down', details: `unexpected ping reply: ${reply}` };
      }
      return { status: 'up' };
    } catch (error) {
      this.logger.warn(
        `Health: BullMQ probe failed: ${(error as Error).message}`,
      );
      return { status: 'down', details: (error as Error).message };
    }
  }

  private async checkOutbox(): Promise<SubsystemStatus> {
    if (!this.outbox) {
      return { status: 'up', details: 'not wired (skipped)' };
    }
    try {
      const probe: OutboxDispatcherHealth = this.outbox;
      const healthy = probe.isHealthy();
      return healthy
        ? { status: 'up' }
        : { status: 'down', details: 'outbox dispatcher reports not running' };
    } catch (error) {
      return { status: 'down', details: (error as Error).message };
    }
  }
}
