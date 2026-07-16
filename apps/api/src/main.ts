import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { EnvConfig } from './config/config.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LessonAccessGuard } from './common/guards/lesson-access.guard';
import { assertAuthCompleteness } from './common/auth/auth-completeness';
import { configureSecurity } from './common/security/configure-security';
import {
  GeoBlockerService,
  PrismaThreatAuditLogger,
  ThreatProtectionMiddleware,
  TieredRateLimiterService,
  makeThreatProtectionRequestHandler,
} from './common/security';
import {
  StructuredLogger,
  shouldUseJsonLogger,
} from './common/observability';

async function bootstrap() {
  // Build the structured logger BEFORE NestFactory.create so the very
  // first bootstrap log line ("Starting Nest application") is already
  // routed through the JSON pipeline in production.
  // `shouldUseJsonLogger` flips on when NODE_ENV=production OR
  // LOG_FORMAT=json — dev / test stay on the human-friendly default.
  const jsonMode = shouldUseJsonLogger();
  const bootstrapLogger = new StructuredLogger(undefined, { jsonMode });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: bootstrapLogger,
  });

  const configService = app.get(ConfigService<EnvConfig, true>);
  const port = configService.get('API_PORT', { infer: true });

  // Trust proxy = 'loopback' — only honor X-Forwarded-For from the local
  // reverse proxy (nginx ingress / traefik). Public clients can no longer
  // spoof their IP to evade IP-based rate limits (Task 24.1).
  app.set('trust proxy', 'loopback');

  // Parse incoming Cookie headers into `req.cookies` — required for the
  // refresh-token cookie fallback in AuthController.refresh() and for
  // JwtStrategy's cookie-based extraction. Without this, `req.cookies`
  // is `undefined` and browser clients relying on HttpOnly auth cookies
  // silently fail over to the JSON-body tokens instead.
  app.use(cookieParser());

  // Global hardening — helmet, CORS, body size limits, compression,
  // request timeouts (Task 24.1, Req 17.x / 21.x).
  configureSecurity(app, configService, { helmet, compression });

  // Application-layer threat-protection middleware (Task 27.1,
  // Req 27.1 / 27.2). Composes the suspicious-request detector,
  // tiered rate limiter, and geo-blocker, and writes audit entries
  // for every reject path. Wired here — before the global prefix
  // and any controller — so probes, oversized headers, and floods
  // are short-circuited as cheaply as possible.
  const geoBlocker = new GeoBlockerService(configService);
  const tieredRateLimiter = app.get(TieredRateLimiterService, {
    strict: false,
  });
  const threatAuditLogger = new PrismaThreatAuditLogger(
    app.get(PrismaClient, { strict: false }),
  );
  const threatProtection = new ThreatProtectionMiddleware(
    geoBlocker,
    tieredRateLimiter,
    threatAuditLogger,
    configService,
  );
  app.use(makeThreatProtectionRequestHandler(threatProtection));

  // Global prefix for all routes (health is still at /health via prefix
  // exclusion). Task 27.5 honeypot endpoints (`/admin-backup`,
  // `/wp-login.php`, `/.env`, …) MUST also live at the bare path —
  // scanners look for these exact strings, not `/api/v1/...` — so they
  // are explicitly excluded from the prefix here. The
  // `HoneypotController` decorates each route with `@Public()` so the
  // global JWT guard skips them.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health',
      // Honeypot endpoints (Task 27.5, Req 27.8). Each path is the
      // exact string the corresponding scanner family probes for.
      'admin-backup',
      'admin-backup.zip',
      'admin-backup.tar.gz',
      'wp-login.php',
      'wp-admin',
      'wp-content/uploads',
      '.env',
      '.git/config',
      'phpmyadmin',
      'xmlrpc.php',
    ],
  });

  // Auth completeness — fail closed if a controller route is neither @Public()
  // nor protected by JwtAuthGuard + an explicit `@Roles(STUDENT|TEACHER|ADMIN)`
  // declaration (Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6).
  await app.init();
  assertAuthCompleteness(app, [JwtAuthGuard], {
    authGuardNames: [LessonAccessGuard.name],
    requireRoles: true,
  });

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Bilgim API running on http://localhost:${port}`);
  logger.log(`📋 Health check: http://localhost:${port}/health`);
}

bootstrap();
