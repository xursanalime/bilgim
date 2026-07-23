import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  MfaCredential,
  MfaType,
  Prisma,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { toDataURL as qrToDataURL } from 'qrcode';

import { RedisService } from '../../infra/redis/redis.service';
import {
  AdminAuditService,
  AUDIT_ACTIONS,
} from '../admin/admin-audit.service';
import { UsersRepository } from '../auth/repositories/users.repository';
import { TokensService } from '../auth/tokens.service';
import { MfaEncryption } from './mfa.encryption';

// ---------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------

export interface TotpSetupResult {
  /** MfaCredential row id (use this to revoke before verifying). */
  credentialId: string;
  /** Plain base32 secret for manual entry. Only returned during setup. */
  secret: string;
  /** `otpauth://totp/...` provisioning URI. */
  otpauthUrl: string;
  /** `data:image/png;base64,...` rendering of the QR code. */
  qrDataUrl: string;
}

export interface TotpVerifyResult {
  credentialId: string;
  enabled: true;
}

export interface BackupCodesResult {
  /** Plaintext codes — shown to the user exactly once. */
  codes: string[];
  /** Number of single-use codes that remain valid. */
  remaining: number;
}

export interface UseBackupCodeResult {
  remaining: number;
}

export interface CredentialView {
  id: string;
  type: MfaType;
  label: string | null;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface IssueMfaTokenResult {
  mfaToken: string;
  expiresIn: number;
  /** Methods enrolled by the user, surfaced to the client UI. */
  methods: Array<'totp' | 'webauthn' | 'backup'>;
}

export interface VerifyMfaResult {
  userId: string;
  method: 'totp' | 'webauthn' | 'backup';
}

export interface MfaTokenPayload {
  /** Always the user id. */
  sub: string;
  /** Marker — distinguishes from regular access tokens. */
  scope: 'mfa-challenge';
  /** Login metadata propagated for downstream session creation. */
  ip?: string;
  ua?: string;
  /** Issued-at, in seconds. */
  iat?: number;
  /** Expiry, in seconds. */
  exp?: number;
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

/**
 * `MfaService` — TOTP + WebAuthn/FIDO2 + backup codes (Task 29.1).
 *
 * Design notes:
 *
 *   * **TOTP secrets are NEVER stored in plaintext.** `MfaEncryption`
 *     wraps the base32 string with AES-256-GCM and the resulting
 *     base64 blob lives in `MfaCredential.secret`. Decryption only
 *     happens inside `verify*` methods.
 *
 *   * **WebAuthn challenges are kept in Redis** keyed by
 *     `mfa:challenge:<scope>:<userId>` with a 5-minute TTL. The
 *     scope is `register` for enrollment and `auth` for the
 *     assertion phase, so the two flows can't accidentally race
 *     each other.
 *
 *   * **TOTP rate limiting** is implemented in
 *     `assertTotpRateLimit` — Redis INCR counter with a 5-minute
 *     window. After 5 failures the user is locked out from TOTP
 *     verification for 5 minutes. Also covers the unauth challenge
 *     flow so credential stuffing on the second factor is bounded.
 *
 *   * **Backup codes** are stored as SHA-256 hashes (single round —
 *     we generate 80-bit random codes, so brute-force resistance is
 *     dictated by entropy, not the hash). On consumption the row is
 *     marked `usedAt` rather than deleted so we keep an audit trail.
 *
 *   * **Login flow integration** lives in `issueMfaToken` /
 *     `verifyMfaChallenge`: AuthService.login calls these to pivot
 *     into the second-factor step before issuing access/refresh
 *     tokens.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  static readonly TOTP_RATE_LIMIT_WINDOW_SEC = 5 * 60;
  static readonly TOTP_RATE_LIMIT_MAX_ATTEMPTS = 5;
  static readonly WEBAUTHN_CHALLENGE_TTL_SEC = 5 * 60;
  static readonly DEFAULT_BACKUP_CODE_COUNT = 10;
  static readonly BACKUP_CODE_BYTES = 5; // 40 random bits → 8 b32 chars
  static readonly BACKUP_CODE_TTL_DAYS = 365;
  static readonly DEFAULT_TOTP_PERIOD_SEC = 30;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokensService: TokensService,
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly encryption: MfaEncryption,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly adminAudit?: AdminAuditService,
  ) {}

  /**
   * Best-effort audit log writer — never throws into the caller.
   * Audit failures must not roll back the MFA mutation that triggered
   * them; the underlying `AdminAuditService.log` already throws when
   * the row cannot be written, but here we explicitly swallow so
   * external observers (Datadog, Sentry) catch it without impacting
   * the user-facing flow.
   */
  private async audit(
    actorId: string | null,
    action: string,
    target: string | null,
    payload: unknown,
  ): Promise<void> {
    if (!this.adminAudit) return;
    try {
      await this.adminAudit.log(actorId, action, target, payload);
    } catch (err) {
      this.logger.warn(
        `audit(${action}) failed: ${(err as Error).message}`,
      );
    }
  }

  // ====================================================================
  // TOTP
  // ====================================================================

  /**
   * Generate a fresh TOTP secret and persist a non-verified
   * `MfaCredential` for the user. The plaintext secret + QR code are
   * returned to the client so the user can register the entry in
   * Google Authenticator / 1Password / etc, then call `verifyTotp`
   * with the first code from the app.
   */
  async setupTotp(userId: string, label?: string): Promise<TotpSetupResult> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const issuer = this.configService.get<string>('MFA_TOTP_ISSUER') ?? 'Bilgim';
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      issuer,
      label: `${issuer}:${user.email}`,
      secret,
    });
    const qrDataUrl = await qrToDataURL(otpauthUrl);

    const credential = await this.prisma.mfaCredential.create({
      data: {
        userId,
        type: MfaType.TOTP,
        label: label ?? 'Authenticator',
        secret: this.encryption.encrypt(secret),
      },
    });

    return {
      credentialId: credential.id,
      secret,
      otpauthUrl,
      qrDataUrl,
    };
  }

  /**
   * Verify the first TOTP code submitted by the user. On success we
   * mark the credential `verifiedAt` so subsequent logins recognise
   * it as enabled. On failure we INCR the rate limit counter and
   * surface a `401 INVALID_TOTP_CODE`.
   */
  async verifyTotpEnrollment(
    userId: string,
    code: string,
  ): Promise<TotpVerifyResult> {
    await this.assertTotpRateLimit(userId);

    const credential = await this.prisma.mfaCredential.findFirst({
      where: { userId, type: MfaType.TOTP, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!credential) {
      throw new BadRequestException({
        code: 'TOTP_NOT_INITIALISED',
        message: 'Call /mfa/totp/setup first',
      });
    }

    const ok = await this.verifyTotpCode(credential, code);
    if (!ok) {
      await this.recordTotpFailure(userId);
      throw new UnauthorizedException({
        code: 'INVALID_TOTP_CODE',
        message: 'Invalid TOTP code',
      });
    }

    const now = new Date();
    await this.prisma.mfaCredential.update({
      where: { id: credential.id },
      data: { verifiedAt: now, lastUsedAt: now },
    });
    await this.resetTotpRateLimit(userId);

    await this.audit(
      userId,
      AUDIT_ACTIONS.MFA_TOTP_ENABLED,
      `MfaCredential/${credential.id}`,
      { credentialId: credential.id, type: 'TOTP', label: credential.label },
    );

    return { credentialId: credential.id, enabled: true };
  }

  /**
   * Disable the user's TOTP factor. The user MUST provide their
   * current password AND a fresh TOTP code so a stolen access token
   * cannot silently disable the second factor.
   */
  async disableTotp(
    userId: string,
    password: string,
    code: string,
  ): Promise<{ disabled: true }> {
    await this.assertTotpRateLimit(userId);

    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // Argon2 password verification — pull from auth via direct require
    // to avoid a circular module import. The hash format is the same.
    // `argon2.verify` throws when the hash is not in argon2 format
    // (e.g. legacy hashes or corrupted rows); treat any such failure
    // the same as a wrong password so the response shape is uniform.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const argon2 = require('argon2');
    let ok = false;
    try {
      ok = await argon2.verify(user.passwordHash, password);
    } catch (err) {
      this.logger.warn(
        `disableTotp: argon2.verify rejected for ${userId}: ${(err as Error).message}`,
      );
      ok = false;
    }
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const credential = await this.prisma.mfaCredential.findFirst({
      where: { userId, type: MfaType.TOTP, verifiedAt: { not: null } },
    });
    if (!credential) {
      throw new BadRequestException({
        code: 'TOTP_NOT_ENABLED',
        message: 'TOTP is not enabled for this user',
      });
    }

    const okCode = await this.verifyTotpCode(credential, code);
    if (!okCode) {
      await this.recordTotpFailure(userId);
      throw new UnauthorizedException({
        code: 'INVALID_TOTP_CODE',
        message: 'Invalid TOTP code',
      });
    }

    if (user.role === UserRole.ADMIN) {
      // Defence in depth — schema-level trigger keeps mfaRequired = TRUE
      // for admins anyway, but we surface a clearer error here.
      throw new ForbiddenException({
        code: 'MFA_REQUIRED_FOR_ROLE',
        message: 'Administrators must keep at least one MFA factor enrolled',
      });
    }

    await this.prisma.mfaCredential.delete({
      where: { id: credential.id },
    });
    await this.resetTotpRateLimit(userId);

    await this.audit(
      userId,
      AUDIT_ACTIONS.MFA_TOTP_DISABLED,
      `MfaCredential/${credential.id}`,
      { credentialId: credential.id, type: 'TOTP' },
    );

    return { disabled: true };
  }

  // ====================================================================
  // WebAuthn
  // ====================================================================

  /** RP id for WebAuthn — defaults to `localhost`. */
  private rpID(): string {
    return (
      this.configService.get<string>('MFA_WEBAUTHN_RP_ID') ?? 'localhost'
    );
  }

  /** RP display name. */
  private rpName(): string {
    return (
      this.configService.get<string>('MFA_WEBAUTHN_RP_NAME') ?? 'Bilgim'
    );
  }

  /** Permitted origins for WebAuthn responses. */
  private rpOrigins(): string[] {
    const raw =
      this.configService.get<string>('MFA_WEBAUTHN_ORIGIN') ??
      this.configService.get<string>('APP_URL') ??
      'http://localhost:3000';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async generateWebAuthnRegistrationOptions(
    userId: string,
  ): Promise<unknown> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // Exclude credentials already enrolled to prevent duplicates.
    const existing = await this.prisma.mfaCredential.findMany({
      where: { userId, type: MfaType.WEBAUTHN, verifiedAt: { not: null } },
      select: { credentialId: true, deviceInfo: true },
    });

    const opts = await generateRegistrationOptions({
      rpName: this.rpName(),
      rpID: this.rpID(),
      userName: user.email,
      userID: Buffer.from(user.id, 'utf8'),
      userDisplayName: user.fullName,
      attestationType: 'none',
      excludeCredentials: existing
        .filter((c): c is { credentialId: string; deviceInfo: any } =>
          Boolean(c.credentialId),
        )
        .map((c) => {
          const transports = this.readTransports(c.deviceInfo);
          return transports
            ? { id: c.credentialId, transports }
            : { id: c.credentialId };
        }),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.storeChallenge('register', userId, opts.challenge);
    return opts;
  }

  async finishWebAuthnRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    label?: string,
  ): Promise<{ credentialId: string }> {
    const expectedChallenge = await this.consumeChallenge('register', userId);
    if (!expectedChallenge) {
      throw new BadRequestException({
        code: 'WEBAUTHN_CHALLENGE_EXPIRED',
        message: 'Registration challenge expired or missing',
      });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.rpOrigins(),
        expectedRPID: this.rpID(),
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn(
        `WebAuthn registration verification failed for ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException({
        code: 'WEBAUTHN_VERIFICATION_FAILED',
        message: 'WebAuthn registration failed',
      });
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException({
        code: 'WEBAUTHN_VERIFICATION_FAILED',
        message: 'WebAuthn registration failed',
      });
    }

    const info = verification.registrationInfo;
    const transports = response.response?.transports ?? [];

    // Persist — `secret` holds the encrypted base64 public key, the
    // raw bytes are never stored.
    const publicKeyBlob = Buffer.from(info.credential.publicKey).toString('base64');
    const credential = await this.prisma.mfaCredential.create({
      data: {
        userId,
        type: MfaType.WEBAUTHN,
        label: label ?? 'Security key',
        secret: this.encryption.encrypt(publicKeyBlob),
        credentialId: info.credential.id,
        counter: BigInt(info.credential.counter ?? 0),
        deviceInfo: {
          aaguid: info.aaguid ?? null,
          fmt: info.fmt ?? null,
          credentialDeviceType: info.credentialDeviceType ?? null,
          credentialBackedUp: info.credentialBackedUp ?? null,
          transports,
        } as Prisma.JsonObject,
        verifiedAt: new Date(),
      },
    });

    await this.audit(
      userId,
      AUDIT_ACTIONS.MFA_WEBAUTHN_REGISTERED,
      `MfaCredential/${credential.id}`,
      {
        credentialId: credential.id,
        webauthnCredentialId: info.credential.id,
        aaguid: info.aaguid ?? null,
        label: credential.label,
      },
    );

    return { credentialId: credential.id };
  }

  async generateWebAuthnAuthenticationOptions(userId: string): Promise<unknown> {
    const credentials = await this.prisma.mfaCredential.findMany({
      where: {
        userId,
        type: MfaType.WEBAUTHN,
        verifiedAt: { not: null },
        credentialId: { not: null },
      },
      select: { credentialId: true, deviceInfo: true },
    });
    if (credentials.length === 0) {
      throw new NotFoundException({
        code: 'WEBAUTHN_NOT_ENROLLED',
        message: 'No WebAuthn credentials enrolled',
      });
    }

    const opts = await generateAuthenticationOptions({
      rpID: this.rpID(),
      allowCredentials: credentials
        .filter((c): c is { credentialId: string; deviceInfo: any } =>
          Boolean(c.credentialId),
        )
        .map((c) => {
          const transports = this.readTransports(c.deviceInfo);
          return transports
            ? { id: c.credentialId, transports }
            : { id: c.credentialId };
        }),
      userVerification: 'preferred',
    });

    await this.storeChallenge('auth', userId, opts.challenge);
    return opts;
  }

  async finishWebAuthnAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ credentialId: string }> {
    const expectedChallenge = await this.consumeChallenge('auth', userId);
    if (!expectedChallenge) {
      throw new UnauthorizedException({
        code: 'WEBAUTHN_CHALLENGE_EXPIRED',
        message: 'Authentication challenge expired or missing',
      });
    }

    const credential = await this.prisma.mfaCredential.findFirst({
      where: {
        userId,
        type: MfaType.WEBAUTHN,
        verifiedAt: { not: null },
        credentialId: response.id,
      },
    });
    if (!credential || !credential.credentialId) {
      throw new UnauthorizedException({
        code: 'WEBAUTHN_CREDENTIAL_UNKNOWN',
        message: 'Credential not registered for this user',
      });
    }

    const publicKey = Buffer.from(this.encryption.decrypt(credential.secret), 'base64');
    let verification;
    try {
      const transports = this.readTransports(credential.deviceInfo);
      const credentialArg = transports
        ? {
            id: credential.credentialId,
            publicKey,
            counter: Number(credential.counter ?? 0n),
            transports,
          }
        : {
            id: credential.credentialId,
            publicKey,
            counter: Number(credential.counter ?? 0n),
          };
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.rpOrigins(),
        expectedRPID: this.rpID(),
        credential: credentialArg,
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn(
        `WebAuthn authentication verification failed for ${userId}: ${(err as Error).message}`,
      );
      throw new UnauthorizedException({
        code: 'WEBAUTHN_VERIFICATION_FAILED',
        message: 'WebAuthn authentication failed',
      });
    }

    if (!verification.verified) {
      throw new UnauthorizedException({
        code: 'WEBAUTHN_VERIFICATION_FAILED',
        message: 'WebAuthn authentication failed',
      });
    }

    await this.prisma.mfaCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter ?? 0),
        lastUsedAt: new Date(),
      },
    });

    return { credentialId: credential.id };
  }

  // ====================================================================
  // Backup codes
  // ====================================================================

  /**
   * Issue a fresh batch of backup codes. Any previously unused codes
   * are invalidated atomically so a user cannot accidentally
   * accumulate more codes than the policy allows.
   */
  async generateBackupCodes(userId: string): Promise<BackupCodesResult> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const codes: string[] = [];
    const expiresAt = new Date(
      Date.now() + MfaService.BACKUP_CODE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      // Drop unused codes — we keep used ones for audit / rate limit.
      await tx.mfaBackupCode.deleteMany({
        where: { userId, usedAt: null },
      });
      for (let i = 0; i < MfaService.DEFAULT_BACKUP_CODE_COUNT; i += 1) {
        const code = this.generateBackupCode();
        const codeHash = this.hashBackupCode(code);
        await tx.mfaBackupCode.create({
          data: { userId, codeHash, expiresAt },
        });
        codes.push(code);
      }
    });

    await this.audit(
      userId,
      AUDIT_ACTIONS.MFA_BACKUP_CODES_GENERATED,
      `User/${userId}`,
      { count: codes.length, expiresAt },
    );

    return { codes, remaining: codes.length };
  }

  async consumeBackupCode(
    userId: string,
    code: string,
  ): Promise<UseBackupCodeResult> {
    const normalized = code.trim().toLowerCase().replace(/-/g, '');
    const codeHash = this.hashBackupCode(normalized);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.mfaBackupCode.findFirst({
        where: {
          userId,
          codeHash,
          usedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (!row) {
        return null;
      }
      await tx.mfaBackupCode.update({
        where: { id: row.id },
        data: { usedAt: now },
      });
      const remaining = await tx.mfaBackupCode.count({
        where: {
          userId,
          usedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      return { remaining };
    });

    if (!result) {
      throw new UnauthorizedException({
        code: 'INVALID_BACKUP_CODE',
        message: 'Invalid or already-used backup code',
      });
    }

    await this.audit(
      userId,
      AUDIT_ACTIONS.MFA_BACKUP_CODE_USED,
      `User/${userId}`,
      { remaining: result.remaining },
    );

    return result;
  }

  // ====================================================================
  // Credential management
  // ====================================================================

  async listCredentials(userId: string): Promise<CredentialView[]> {
    const rows = await this.prisma.mfaCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        label: true,
        verifiedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return rows;
  }

  async revokeCredential(userId: string, credentialId: string): Promise<{ revoked: true }> {
    const credential = await this.prisma.mfaCredential.findFirst({
      where: { id: credentialId, userId },
    });
    if (!credential) {
      throw new NotFoundException({
        code: 'MFA_CREDENTIAL_NOT_FOUND',
        message: 'Credential not found',
      });
    }

    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.role === UserRole.ADMIN) {
      const remaining = await this.prisma.mfaCredential.count({
        where: {
          userId,
          verifiedAt: { not: null },
          NOT: { id: credentialId },
        },
      });
      if (remaining === 0) {
        throw new ForbiddenException({
          code: 'MFA_REQUIRED_FOR_ROLE',
          message: 'Administrators must keep at least one MFA factor enrolled',
        });
      }
    }

    await this.prisma.mfaCredential.delete({ where: { id: credentialId } });

    await this.audit(
      userId,
      AUDIT_ACTIONS.MFA_CREDENTIAL_REVOKED,
      `MfaCredential/${credentialId}`,
      { credentialId, type: credential.type },
    );

    return { revoked: true };
  }

  // ====================================================================
  // Login flow integration — issue / verify the short-lived MFA token
  // ====================================================================

  /**
   * Returns whether the user has at least one verified MFA credential.
   * Used by `AuthService.login` to decide between issuing tokens
   * directly and pivoting into the MFA challenge flow.
   */
  async hasVerifiedCredential(userId: string): Promise<boolean> {
    const count = await this.prisma.mfaCredential.count({
      where: { userId, verifiedAt: { not: null } },
    });
    return count > 0;
  }

  /**
   * Mint a 5-minute JWT scoped to `mfa-challenge`. Carries enough
   * metadata for `verifyMfaChallenge` to recreate the post-login
   * session (IP / UA).
   */
  async issueMfaToken(
    userId: string,
    meta: { ip?: string; ua?: string },
  ): Promise<IssueMfaTokenResult> {
    const ttl =
      Number(this.configService.get('MFA_CHALLENGE_TTL_SEC')) || 5 * 60;
    const payload: MfaTokenPayload = {
      sub: userId,
      scope: 'mfa-challenge',
    };
    if (meta.ip !== undefined) payload.ip = meta.ip;
    if (meta.ua !== undefined) payload.ua = meta.ua;
    const mfaToken = await this.jwtService.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn: ttl,
    });

    const methods = await this.enrolledMethods(userId);
    return { mfaToken, expiresIn: ttl, methods };
  }

  /**
   * Validate a `mfaToken` + verify the supplied factor. On success
   * returns `{ userId, method }` so `AuthService` can finalise the
   * login (issue access/refresh tokens, create the Session row).
   *
   * `code` may be either a TOTP code or a backup code — we try TOTP
   * first (cheaper), then fall back to the single-use backup table.
   */
  async verifyMfaChallenge(input: {
    mfaToken: string;
    code?: string;
    webauthn?: { response: AuthenticationResponseJSON };
  }): Promise<VerifyMfaResult> {
    const payload = await this.parseMfaToken(input.mfaToken);

    if (input.webauthn) {
      await this.finishWebAuthnAuthentication(payload.sub, input.webauthn.response);
      return { userId: payload.sub, method: 'webauthn' };
    }

    if (!input.code) {
      throw new BadRequestException({
        code: 'MFA_FACTOR_REQUIRED',
        message: 'Provide either a TOTP/backup code or a WebAuthn assertion',
      });
    }

    await this.assertTotpRateLimit(payload.sub);

    // Try TOTP first.
    const totp = await this.prisma.mfaCredential.findFirst({
      where: {
        userId: payload.sub,
        type: MfaType.TOTP,
        verifiedAt: { not: null },
      },
    });
    if (totp && /^\d{6}$/.test(input.code.trim())) {
      const ok = await this.verifyTotpCode(totp, input.code);
      if (ok) {
        await this.prisma.mfaCredential.update({
          where: { id: totp.id },
          data: { lastUsedAt: new Date() },
        });
        await this.resetTotpRateLimit(payload.sub);
        return { userId: payload.sub, method: 'totp' };
      }
    }

    // Backup-code path.
    try {
      await this.consumeBackupCode(payload.sub, input.code);
      await this.resetTotpRateLimit(payload.sub);
      return { userId: payload.sub, method: 'backup' };
    } catch (err) {
      await this.recordTotpFailure(payload.sub);
      if (err instanceof HttpException) throw err;
      throw new UnauthorizedException({
        code: 'INVALID_MFA_CODE',
        message: 'Invalid MFA code',
      });
    }
  }

  /**
   * Role-based MFA enforcement (Property 23 / Req 29.1, 29.7). Called
   * by `AuthService.login` immediately after the password check. If
   * the user's role mandates a second factor and they haven't
   * enrolled one, return `403 MFA_REQUIRED_FOR_ROLE` so the client
   * can redirect to the enrollment flow.
   */
  async assertRoleEnforcement(role: UserRole, userId: string): Promise<void> {
    if (role !== UserRole.ADMIN && role !== UserRole.TEACHER) return;
    const enrolled = await this.hasVerifiedCredential(userId);
    if (enrolled) return;

    const requiresHardwareKey = role === UserRole.ADMIN;
    throw new ForbiddenException({
      code: 'MFA_REQUIRED_FOR_ROLE',
      message: requiresHardwareKey
        ? 'Administrators must enrol a WebAuthn/FIDO2 hardware key before logging in'
        : 'Teachers must enrol a TOTP authenticator before logging in',
      details: { role, requiresHardwareKey },
    });
  }

  // ====================================================================
  // Internals
  // ====================================================================

  private async enrolledMethods(
    userId: string,
  ): Promise<Array<'totp' | 'webauthn' | 'backup'>> {
    const [totp, webauthn, backup] = await Promise.all([
      this.prisma.mfaCredential.count({
        where: { userId, type: MfaType.TOTP, verifiedAt: { not: null } },
      }),
      this.prisma.mfaCredential.count({
        where: { userId, type: MfaType.WEBAUTHN, verifiedAt: { not: null } },
      }),
      this.prisma.mfaBackupCode.count({
        where: { userId, usedAt: null },
      }),
    ]);
    const methods: Array<'totp' | 'webauthn' | 'backup'> = [];
    if (totp > 0) methods.push('totp');
    if (webauthn > 0) methods.push('webauthn');
    if (backup > 0) methods.push('backup');
    return methods;
  }

  private async parseMfaToken(token: string): Promise<MfaTokenPayload> {
    let payload: MfaTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<MfaTokenPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch (err) {
      throw new UnauthorizedException({
        code: 'INVALID_MFA_TOKEN',
        message: 'MFA challenge token is invalid or expired',
      });
    }
    if (!payload || typeof payload !== 'object' || payload.scope !== 'mfa-challenge') {
      throw new UnauthorizedException({
        code: 'INVALID_MFA_TOKEN',
        message: 'MFA challenge token is invalid or expired',
      });
    }
    return payload;
  }

  private async verifyTotpCode(
    credential: MfaCredential,
    code: string,
  ): Promise<boolean> {
    const secret = this.encryption.decrypt(credential.secret);
    try {
      const result = await verifyTotp({
        secret,
        token: code.trim(),
        epochTolerance: MfaService.DEFAULT_TOTP_PERIOD_SEC,
      });
      return Boolean(result?.valid);
    } catch (err) {
      this.logger.warn(
        `verifyTotpCode: error for credential ${credential.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async assertTotpRateLimit(userId: string): Promise<void> {
    if (!this.redis) return;
    const key = this.totpRateLimitKey(userId);
    let count: number;
    try {
      count = Number((await this.redis.get(key)) ?? '0');
    } catch (err) {
      this.logger.warn(
        `assertTotpRateLimit: GET failed for ${userId}: ${(err as Error).message}`,
      );
      return;
    }
    if (count >= MfaService.TOTP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException(
        {
          code: 'MFA_RATE_LIMITED',
          message: 'Too many MFA attempts. Please wait before trying again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordTotpFailure(userId: string): Promise<void> {
    if (!this.redis) return;
    const key = this.totpRateLimitKey(userId);
    try {
      const next = await this.redis.incr(key);
      if (next === 1) {
        await this.redis.expire(key, MfaService.TOTP_RATE_LIMIT_WINDOW_SEC);
      }
    } catch (err) {
      this.logger.warn(
        `recordTotpFailure: INCR failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async resetTotpRateLimit(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.totpRateLimitKey(userId));
    } catch (err) {
      this.logger.warn(
        `resetTotpRateLimit: DEL failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async storeChallenge(
    scope: 'register' | 'auth',
    userId: string,
    challenge: string,
  ): Promise<void> {
    if (!this.redis) {
      // Fallback path: persist on the most recent credential for
      // dev/testing without Redis. Production deployments always
      // have Redis wired so this branch is a soft fallback.
      this.challengeMemory.set(`${scope}:${userId}`, {
        challenge,
        expiresAt: Date.now() + MfaService.WEBAUTHN_CHALLENGE_TTL_SEC * 1000,
      });
      return;
    }
    await this.redis.set(
      this.challengeKey(scope, userId),
      challenge,
      MfaService.WEBAUTHN_CHALLENGE_TTL_SEC,
    );
  }

  private async consumeChallenge(
    scope: 'register' | 'auth',
    userId: string,
  ): Promise<string | null> {
    if (!this.redis) {
      const k = `${scope}:${userId}`;
      const entry = this.challengeMemory.get(k);
      if (!entry) return null;
      this.challengeMemory.delete(k);
      if (entry.expiresAt < Date.now()) return null;
      return entry.challenge;
    }
    const key = this.challengeKey(scope, userId);
    const value = await this.redis.get(key);
    if (value) await this.redis.del(key);
    return value;
  }

  private readonly challengeMemory = new Map<
    string,
    { challenge: string; expiresAt: number }
  >();

  private challengeKey(scope: 'register' | 'auth', userId: string): string {
    return `mfa:challenge:${scope}:${userId}`;
  }

  private totpRateLimitKey(userId: string): string {
    return `mfa:totp:rl:${userId}`;
  }

  private generateBackupCode(): string {
    const left = randomBytes(MfaService.BACKUP_CODE_BYTES).toString('hex');
    const right = randomBytes(MfaService.BACKUP_CODE_BYTES).toString('hex');
    return `${left}-${right}`;
  }

  private hashBackupCode(code: string): string {
    const normalized = code.trim().toLowerCase().replace(/-/g, '');
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  private readTransports(deviceInfo: unknown): AuthenticatorTransportFuture[] | undefined {
    if (!deviceInfo || typeof deviceInfo !== 'object') return undefined;
    const arr = (deviceInfo as Record<string, unknown>)['transports'];
    if (!Array.isArray(arr)) return undefined;
    const valid = new Set([
      'usb',
      'ble',
      'nfc',
      'internal',
      'hybrid',
      'cable',
      'smart-card',
    ]);
    const out = arr.filter(
      (v): v is AuthenticatorTransportFuture =>
        typeof v === 'string' && valid.has(v),
    );
    return out.length ? out : undefined;
  }

  /** Constant-time comparison helper retained for backup-code paths. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private constantTimeEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }
}
