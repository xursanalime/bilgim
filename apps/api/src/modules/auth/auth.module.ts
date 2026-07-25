import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';
import { EncryptionService } from '../../common/crypto';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthHardeningService } from './auth-hardening.service';
import { BruteForceProtectionService } from './brute-force-protection.service';
import { TokensService } from './tokens.service';
import { UsersRepository } from './repositories/users.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionValidatorService } from './session-validator.service';
import { BillingModule } from '../billing/billing.module';
import { AdminModule } from '../admin/admin.module';
import { SecurityModule } from '../security/security.module';
import { BruteForceService } from '../../common/security/brute-force.service';
import { RedisModule } from '../../infra/redis';
import {
  LoginProtectionService,
  CredentialStuffingDetector,
} from './protection';

/**
 * AuthModule — handles registration, login, JWT tokens, email verification,
 * password reset, and session management.
 *
 * Registers the Passport `jwt` strategy so the global JwtAuthGuard can
 * verify access tokens on protected routes.
 *
 * Imports BillingModule so that `verifyEmail` can call
 * `BillingService.startTrial(userId, tx)` for newly verified teachers
 * (Requirements 2.1, 3.2, 3.3).
 *
 * Imports AdminModule so that `BruteForceService` can write
 * `auth.lockout.email` / `auth.lockout.ip` rows to `AdminAuditLog`
 * via `AdminAuditService` (Task 27.2, Req 27.4 / 27.5 / 27.9).
 *
 * The `PrismaClient` provider is wrapped with the encryption
 * extension (Task 28.1) — `User.phone` is auto-encrypted on every
 * write and auto-decrypted on every read so callers operate on
 * plaintext while the column stores `v1:...` envelopes at rest.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        // Task 24.1: pin signing/verification to HS256 with secret from env.
        signOptions: {
          algorithm: 'HS256',
          expiresIn: configService.get<string>('JWT_ACCESS_TTL') ?? '15m',
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    BillingModule,
    forwardRef(() => AdminModule),
    SecurityModule,
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    UsersRepository,
    JwtStrategy,
    SessionValidatorService,
    BruteForceService,
    LoginProtectionService,
    CredentialStuffingDetector,
    AuthHardeningService,
    BruteForceProtectionService,
    {
      provide: PrismaClient,
      // The injected `EncryptionService` is provided globally by
      // `EncryptionModule` (registered in `app.module.ts`). When the
      // module is unavailable (e.g. legacy unit tests that don't bring
      // it up), we fall back to a non-extended client so existing
      // fixtures keep working.
      useFactory: (encryption?: EncryptionService) =>
        createPrismaClient(
          encryption ? { encryption: { service: encryption } } : {},
        ),
      inject: [{ token: EncryptionService, optional: true }],
    },
  ],
  exports: [
    AuthService,
    UsersRepository,
    TokensService,
    SessionValidatorService,
    BruteForceService,
    LoginProtectionService,
    CredentialStuffingDetector,
    AuthHardeningService,
    BruteForceProtectionService,
  ],
})
export class AuthModule {}
