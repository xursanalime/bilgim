import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Optional,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import type { EnvConfig } from '../../config/config.module';
import { MetricsService } from './metrics.service';

/**
 * `/metrics` — Prometheus scrape endpoint (Task 24.3, Req 26.2).
 *
 * Public by design: cluster scrape jobs run unauthenticated. In
 * production the endpoint is firewalled to the in-cluster
 * Prometheus IP range; the `@Public()` decorator only bypasses our
 * JWT gate, not the upstream network policy.
 *
 * **Soft auth** (Task 24.3): when `METRICS_TOKEN` is configured, the
 * caller MUST pass it as either the `?token=` query param or the
 * `X-Metrics-Token` header. The check is *defense-in-depth* — a
 * misconfigured ingress is still the primary failure mode — but
 * stops accidental public exposure of metric cardinality. When
 * `METRICS_TOKEN` is unset (default in dev), the endpoint stays
 * unrestricted so `curl localhost:4000/metrics` keeps working.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Optional()
    private readonly config?: ConfigService<EnvConfig, true>,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(
    @Req() request: Request,
    @Res() res: Response,
    @Query('token') queryToken?: string,
  ): Promise<void> {
    this.assertTokenAuthorised(request, queryToken);
    const { contentType, body } = await this.metrics.render();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }

  /**
   * When `METRICS_TOKEN` is configured, require it as `?token=...`
   * or `X-Metrics-Token: ...`. Otherwise allow unauthenticated scrapes.
   */
  private assertTokenAuthorised(
    request: Request,
    queryToken: string | undefined,
  ): void {
    const expected = this.config?.get('METRICS_TOKEN', { infer: true });
    if (!expected) return;
    const headerToken = readHeaderToken(request.headers['x-metrics-token']);
    const provided = queryToken ?? headerToken;
    if (provided !== expected) {
      throw new ForbiddenException({
        code: 'METRICS_TOKEN_INVALID',
        message: 'Valid metrics token required',
      });
    }
  }
}

function readHeaderToken(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === 'string' && v.length > 0);
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}
