import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { createPrismaClient } from './infra/prisma';
import { RedisModule } from './infra/redis';
import { CacheModule } from './infra/cache';
import { BullMqModule } from './infra/bullmq';
import { OutboxModule } from './infra/outbox';
import { R2Module } from './infra/r2';
import { MetricsModule } from './infra/metrics';
import { SentryModule } from './infra/sentry';
import { CryptoModule } from './common/crypto';
import { AiModule } from './modules/ai';
import { AdminModule } from './modules/admin';
import { AuthModule } from './modules/auth';
import { BillingModule } from './modules/billing';
import { CatalogModule } from './modules/catalog';
import { DiscoveryModule as PublicDiscoveryModule } from './modules/discovery';
import { DmModule } from './modules/dm';
import { EnrollmentModule } from './modules/enrollment';
import { HomeworkModule } from './modules/homework';
import { LevelingModule } from './modules/leveling/leveling.module';
import { LiveModule } from './modules/live';
import { MediaModule } from './modules/media';
import { MfaModule } from './modules/mfa';
import { NotificationsModule } from './modules/notifications';
import { PlacementModule } from './modules/placement/placement.module';
import { ProtectionModule } from './modules/protection';
import { GamificationModule } from './modules/gamification/gamification.module';
import { ReportsModule } from './modules/reports';
import { ScheduleModule } from './modules/schedule';
import { SpeakingModule } from './modules/speaking/speaking.module';
import { TeacherModule } from './modules/teacher';
import { ThreatProtectionModule } from './modules/threat-protection';
import { UsersModule } from './modules/users/users.module';
import { ThreatProtectionGuard } from './modules/threat-protection/threat-protection.guard';
import {
  SecurityModule,
  SecurityRateLimitGuard,
  SecurityWafMiddleware,
  IpBlocklistGuard,
  TlsEnforcementMiddleware,
} from './modules/security';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { BodyLimitGuard } from './common/guards/body-limit.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RateLimitInterceptor } from './common/interceptors/rate-limit.interceptor';
import { HttpCacheInterceptor } from './common/interceptors/http-cache.interceptor';
import { CacheResponseInterceptor } from './common/interceptors/cache-response.interceptor';
import { ResponseCacheInterceptor } from './common/interceptors/response-cache.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  AdminIpAllowlistMiddleware,
  DdosGuard,
  DdosProtectionService,
  WafMiddleware,
} from './common/security/waf';
import { TieredRateLimiterService } from './common/security/threat-protection';
import { HmacGuard, HmacSignatureService } from './common/security/hmac';
import { SanitizePipe } from './common/security/sanitize';
import { SecureResponseInterceptor } from './common/security/response';

@Module({
  imports: [
    AppConfigModule,
    DiscoveryModule,
    HealthModule,
    CryptoModule,
    RedisModule,
    CacheModule,
    BullMqModule,
    OutboxModule,
    R2Module,
    MetricsModule,
    SentryModule,
    AuthModule,
    BillingModule,
    TeacherModule,
    EnrollmentModule,
    CatalogModule,
    HomeworkModule,
    AiModule,
    PublicDiscoveryModule,
    DmModule,
    LiveModule,
    MediaModule,
    MfaModule,
    NotificationsModule,
    GamificationModule,
    ScheduleModule,
    AdminModule,
    ReportsModule,
    ThreatProtectionModule,
    UsersModule,
    SecurityModule,
    LevelingModule,
    PlacementModule,
    SpeakingModule,
    ProtectionModule,
  ],
  controllers: [],
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
    WafMiddleware,
    DdosProtectionService,
    AdminIpAllowlistMiddleware,
    TieredRateLimiterService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: IpBlocklistGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DdosGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SecurityRateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThreatProtectionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BodyLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: HmacGuard,
    },
    HmacSignatureService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SecureResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpCacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseCacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RateLimitInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    {
      provide: APP_PIPE,
      useClass: SanitizePipe,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(WafMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'health/(.*)', method: RequestMethod.ALL },
        { path: 'metrics', method: RequestMethod.ALL },
        { path: 'metrics/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');

    consumer
      .apply(SecurityWafMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'health/(.*)', method: RequestMethod.ALL },
        { path: 'metrics', method: RequestMethod.ALL },
        { path: 'metrics/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');

    consumer
      .apply(AdminIpAllowlistMiddleware)
      .forRoutes(
        { path: 'admin/*', method: RequestMethod.ALL },
        { path: 'api/v1/admin/*', method: RequestMethod.ALL },
      );

    consumer
      .apply(TlsEnforcementMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'health/(.*)', method: RequestMethod.ALL },
        { path: 'metrics', method: RequestMethod.ALL },
        { path: 'metrics/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
