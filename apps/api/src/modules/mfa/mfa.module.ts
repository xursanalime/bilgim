import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { AdminModule } from '../admin/admin.module';
import { UsersRepository } from '../auth/repositories/users.repository';
import { TokensService } from '../auth/tokens.service';
import { MfaController } from './mfa.controller';
import { MfaEncryption } from './mfa.encryption';
import { MfaService } from './mfa.service';

/**
 * `MfaModule` — TOTP + WebAuthn/FIDO2 + backup codes (Task 29.1).
 *
 * REST surface (see `MfaController`):
 *   - `POST   /mfa/totp/setup`                       [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/totp/verify`                      [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/totp/disable`                     [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/webauthn/registration-options`    [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/webauthn/registration-finish`     [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/webauthn/authentication-options`  [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/webauthn/authentication-finish`   [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/backup-codes/generate`            [STUDENT, TEACHER, ADMIN]
 *   - `POST   /mfa/backup-codes/use`                 [STUDENT, TEACHER, ADMIN]
 *   - `GET    /mfa/credentials`                      [STUDENT, TEACHER, ADMIN]
 *   - `DELETE /mfa/credentials/:id`                  [STUDENT, TEACHER, ADMIN]
 *
 * The MFA challenge endpoint (`POST /auth/mfa/challenge`) lives in
 * `AuthModule` because it pivots straight into session creation —
 * keeping that controller close to the rest of the auth surface
 * avoids cross-module re-exports of `TokensService` machinery.
 *
 * `UsersRepository` and `TokensService` are provided locally rather
 * than imported from `AuthModule` to break a would-be circular
 * dependency: `AuthModule` imports `MfaModule` so the login flow
 * can call `MfaService.assertRoleEnforcement` and `issueMfaToken`.
 *
 * Module-local `JwtModule` is registered so we can mint short-lived
 * MFA challenge tokens without coupling to the broader auth module's
 * configuration.
 *
 * `AdminModule` is imported so `MfaService` can write `mfa.*` rows
 * to `AdminAuditLog` for every enable/disable/registration/backup-code
 * use (Task 29.1 audit logging requirement).
 */
@Module({
  imports: [
    ConfigModule,
    AdminModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256', expiresIn: '5m' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [MfaController],
  providers: [
    MfaService,
    MfaEncryption,
    UsersRepository,
    TokensService,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [MfaService, MfaEncryption],
})
export class MfaModule {}
