import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

import { BruteForceService } from '../../common/security/brute-force.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BillingService } from '../billing/billing.service';
import { MfaService } from '../mfa/mfa.service';
import {
  BruteForceService as SecurityBruteForceService,
  HCaptchaService,
  ImpossibleTravelService,
} from '../security';
import { AuthHardeningService } from './auth-hardening.service';
import { BruteForceProtectionService } from './brute-force-protection.service';
import {
  CredentialStuffingDetector,
  LoginProtectionService,
} from './protection';
import { UsersRepository } from './repositories/users.repository';
import { TokensService } from './tokens.service';
import {
  RegisterDto,
  LoginDto,
  VerifyEmailDto,
  RefreshDto,
  PasswordResetRequestDto,
  PasswordResetConfirmDto,
  ResendVerificationDto,
  AccountUnlockDto,
} from './dto';

export interface RegisterResult {
  userId: string;
  message: string;
  /**
   * False when the account is already ACTIVE and the user can log in
   * immediately (dev `AUTH_SKIP_EMAIL_VERIFICATION` mode). True in the
   * normal flow where a verification email was sent.
   */
  verificationRequired: boolean;
}

export interface VerifyEmailResult {
  message: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    fullName: string;
  };
}

/**
 * Result returned by `AuthService.login` when the user has at least
 * one verified MFA credential. The client must call
 * `/auth/mfa/challenge` with the `mfaToken` plus the second factor
 * (TOTP / backup / WebAuthn) to receive the real access + refresh
 * tokens.
 */
export interface MfaChallengeRequiredResult {
  requiresMfa: true;
  mfaToken: string;
  expiresIn: number;
  methods: Array<'totp' | 'webauthn' | 'backup'>;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface PasswordResetRequestResult {
  message: string;
}

export interface PasswordResetConfirmResult {
  message: string;
}

export interface ResendVerificationResult {
  message: string;
}

export interface AccountUnlockResult {
  message: string;
  unlocked: boolean;
}

/**
 * AuthService — business logic for authentication operations.
 * Handles registration, password hashing, email verification token creation,
 * and outbox event emission for downstream processing.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly usersRepository: UsersRepository,
    private readonly tokensService: TokensService,
    private readonly outboxService: OutboxService,
    private readonly billingService: BillingService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly bruteForceService?: BruteForceService,
    @Optional() private readonly mfaService?: MfaService,
    @Optional() private readonly loginProtection?: LoginProtectionService,
    @Optional()
    private readonly credentialStuffingDetector?: CredentialStuffingDetector,
    @Optional() private readonly authHardening?: AuthHardeningService,
    @Optional()
    private readonly bruteForceProtection?: BruteForceProtectionService,
    @Optional()
    private readonly securityBruteForce?: SecurityBruteForceService,
    @Optional() private readonly hCaptcha?: HCaptchaService,
    @Optional()
    private readonly impossibleTravel?: ImpossibleTravelService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /**
   * Register a new user.
   *
   * Flow:
   * 1. Check if email already exists → 409 CONFLICT
   * 2. Hash password with Argon2id (m=19MiB, t=2, p=1)
   * 3. Create User(status=PENDING_VERIFY) in DB
   * 4. Generate email verification token
   * 5. Store hashed token in EmailVerification table
   * 6. Create OutboxEvent(topic='user.registered')
   * 7. Return { userId, message }
   *
   * All DB operations are wrapped in a single transaction for atomicity.
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    // 1. Check for existing user (email)
    const existingUser = await this.usersRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'A user with this email already exists',
      });
    }

    // 1b. Check for existing username
    const existingUsername = await this.usersRepository.findByUsername(
      dto.username,
    );
    if (existingUsername) {
      throw new ConflictException({
        code: 'USERNAME_ALREADY_EXISTS',
        message: 'A user with this username already exists',
      });
    }

    // 1c. Password strength — the DTO only enforces a minimum length; a
    // string of 8+ digits or letters alone would otherwise pass. Require
    // at least one letter AND one digit (NIST 800-63B favours length +
    // basic composition over mandatory-symbol rules that just frustrate
    // users without materially improving entropy).
    if (!isPasswordStrongEnough(dto.password)) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message:
          'Password must contain at least one letter and one number',
      });
    }

    // 2. Hash password with Argon2id
    const passwordHash = await this.hashPassword(dto.password);

    // Dev/test bypass: when AUTH_SKIP_EMAIL_VERIFICATION is on, the user is
    // created ACTIVE and the verification token + email are skipped entirely.
    const skipVerification =
      this.configService?.get<boolean>('AUTH_SKIP_EMAIL_VERIFICATION') ?? false;

    // 3-6. Atomic transaction: create user + verification token + outbox event
    const result = await this.prisma.$transaction(async (tx) => {
      // Create user
      const user = await this.usersRepository.create(
        {
          email: dto.email,
          username: dto.username,
          passwordHash,
          fullName: dto.fullName,
          role: dto.role,
          ...(skipVerification ? { status: 'ACTIVE' as const } : {}),
        },
        tx,
      );

      if (skipVerification) {
        // Mirror the post-verification side effects so a TEACHER still
        // gets their trial subscription without the email round-trip.
        if (user.role === UserRole.TEACHER) {
          await this.billingService.startTrial(user.id, tx);
          await this.assignEnglishSpecialty(user.id, user.fullName, tx);
        }
        this.logger.warn(
          `User registered with verification SKIPPED (dev): ${user.id} (${user.email})`,
        );
        return { userId: user.id, verificationRequired: false };
      }

      // Generate verification token
      const rawToken = this.tokensService.generateRandomToken();
      const tokenHash = this.tokensService.hashToken(rawToken);

      // Store hashed token in EmailVerification table (expires in 24h)
      await tx.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // Create outbox event for downstream processing (email sending)
      await this.outboxService.create(tx, {
        topic: 'user.registered',
        payload: {
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          token: rawToken,
        },
        idempotencyKey: `user.registered:${user.id}`,
      });

      this.logger.log(`User registered: ${user.id} (${user.email})`);

      return { userId: user.id, verificationRequired: true };
    });

    return {
      userId: result.userId,
      verificationRequired: result.verificationRequired,
      message: result.verificationRequired
        ? 'Verification email sent'
        : 'Account created and activated',
    };
  }

  /**
   * Hash a password using Argon2id with the specified parameters:
   * - memoryCost: 19456 KiB (19 MiB)
   * - timeCost: 2 iterations
   * - parallelism: 1
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MiB in KiB
      timeCost: 2,
      parallelism: 1,
    });
  }

  /**
   * Provision the single English specialty for a freshly-activated teacher.
   *
   * Bilgim is an English-only platform, so there is no onboarding quiz:
   * every teacher teaches English. We assign the seeded `english` specialty
   * and stamp `onboardingCompletedAt` so downstream guards
   * (group creation, homework modules — `ONBOARDING_REQUIRED`) pass without
   * the teacher ever visiting an onboarding screen.
   *
   * Idempotent and best-effort: if the profile already has a specialty we do
   * nothing, and a missing `english` row (un-seeded DB) is logged rather than
   * aborting registration.
   */
  private async assignEnglishSpecialty(
    teacherUserId: string,
    fullName: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const existing = await tx.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });
    if (existing?.specialtyId) return;

    const english = await tx.specialty.findUnique({
      where: { slug: 'english' },
    });
    if (!english) {
      this.logger.warn(
        `Cannot assign specialty to teacher ${teacherUserId}: "english" specialty not seeded`,
      );
      return;
    }

    await tx.teacherProfile.upsert({
      where: { userId: teacherUserId },
      create: {
        userId: teacherUserId,
        specialtyId: english.id,
        onboardingCompletedAt: new Date(),
        fullName,
      },
      update: {
        specialtyId: english.id,
        onboardingCompletedAt: new Date(),
      },
    });
  }

  /**
   * Verify a password against a stored hash.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /**
   * Verify email using the token sent during registration.
   *
   * Flow:
   * 1. Hash the incoming token with SHA-256
   * 2. Find EmailVerification by tokenHash where consumedAt is null and expiresAt > now
   * 3. If not found → 400 INVALID_OR_EXPIRED_TOKEN
   * 4. Mark EmailVerification.consumedAt = now
   * 5. Update User.status = ACTIVE
   * 6. If the user is a TEACHER, call BillingService.startTrial(userId, tx)
   *    inside the same transaction so that verifyEmail + trial creation are
   *    atomic (Requirements 2.1, 3.2, 3.3). The trial is idempotent — replays
   *    return the existing subscription rather than creating a duplicate.
   * 7. Return success message
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<VerifyEmailResult> {
    const tokenHash = this.tokensService.hashToken(dto.token);
    const now = new Date();

    const verification = await this.prisma.emailVerification.findFirst({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (!verification) {
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'The verification token is invalid or has expired',
      });
    }

    // Atomic: mark token as consumed + activate user + (teachers only) start trial
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerification.update({
        where: { id: verification.id },
        data: { consumedAt: now },
      });

      const user = await this.usersRepository.updateStatus(
        verification.userId,
        'ACTIVE',
        tx,
      );

      // Requirement 2.1: every newly verified teacher gets a 14-day trial
      // subscription. Started inside the same transaction so verifyEmail and
      // startTrial commit together (or roll back together).
      if (user.role === UserRole.TEACHER) {
        await this.billingService.startTrial(user.id, tx);
        await this.assignEnglishSpecialty(user.id, user.fullName, tx);
      }
    });

    this.logger.log(`Email verified for user: ${verification.userId}`);

    return { message: 'Email verified successfully' };
  }

  /**
   * Login with email and password.
   *
   * Flow:
   * 1. Brute-force gate: reject early when `(email, ip)` is currently
   *    locked out (Task 27.2 / Property 16). Runs BEFORE any DB
   *    lookup so the response time of a locked-out attempt does
   *    not leak whether the email exists.
   * 2. Find user by email
   * 3. If not found → record failure + 401 UNAUTHENTICATED (don't reveal if email exists)
   * 4. If user.status !== ACTIVE → 401 ACCOUNT_NOT_VERIFIED
   * 5. Verify password with Argon2id
   * 6. If wrong → record failure + 401 UNAUTHENTICATED
   * 7. **MFA gate (Task 29.1, Property 23)**:
   *    - TEACHER / ADMIN with no enrolled factor → 403
   *      `MFA_REQUIRED_FOR_ROLE`
   *    - any user with at least one verified factor → return
   *      `{ requiresMfa, mfaToken, methods }` and DEFER token
   *      issuance until the client completes
   *      `/auth/mfa/challenge`
   * 8. Generate accessToken (JWT, 15min TTL)
   * 9. Generate refreshToken (opaque, crypto.randomBytes(32).toString('hex'))
   * 10. Hash refreshToken and store in Session table (expiresAt = now + 30 days)
   * 11. Reset the brute-force counter on success
   * 12. Return { accessToken, refreshToken, user }
   */
  async login(
    dto: LoginDto,
    meta: {
      userAgent?: string;
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    },
  ): Promise<LoginResult | MfaChallengeRequiredResult> {
    const ip = meta.ip ?? 'unknown';

    // 1. Brute-force gate — runs first so the response time is
    //    independent of whether the account exists.
    if (this.loginProtection) {
      await this.loginProtection.assertNotLocked(dto.email, ip);
    }
    if (this.bruteForceService) {
      await this.bruteForceService.assertNotLocked(dto.email, ip);
    }
    if (this.authHardening) {
      await this.authHardening.assertNotLocked(dto.email, ip);
    }
    if (this.bruteForceProtection) {
      await this.bruteForceProtection.assertNotLocked(dto.email, ip);
    }

    // 1b. Task 27.2 BruteForceService — checks per-account state
    //     machine (NORMAL / TEMP_LOCKED / PERM_LOCKED) and
    //     per-IP credential-stuffing block. When `captchaRequired`
    //     is set, the request must carry a valid `hCaptchaToken`
    //     even before we touch the password (Req 27.4 / 27.5 / 27.9).
    if (this.securityBruteForce) {
      await this.securityBruteForce.assertNotBlocked(dto.email, ip);
      const accStatus = await this.securityBruteForce.checkAccountStatus(
        dto.email,
      );
      if (accStatus.captchaRequired && this.hCaptcha) {
        await this.hCaptcha.assertValid(dto.hCaptchaToken, ip);
      }
    }

    // 2. Find user by email
    const user = await this.usersRepository.findByEmail(dto.email);

    // 3. User not found — generic error to prevent email enumeration.
    //    We still record the failure so attackers spraying invalid
    //    emails get rate-limited the same way as wrong-password
    //    attempts.
    if (!user) {
      const bfResult = await this.recordLoginFailure(dto.email, ip, undefined);
      throw this.buildLoginUnauthorizedException(bfResult);
    }

    // 4. Check if account is verified (skip — email verification not required)
    // Allow ACTIVE and PENDING_VERIFICATION users to log in

    // 5. Verify password
    const isPasswordValid = await this.verifyPassword(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      const bfResult = await this.recordLoginFailure(dto.email, ip, {
        userId: user.id,
        email: user.email,
      });
      throw this.buildLoginUnauthorizedException(bfResult);
    }

    // 5b. Impossible-travel check — Task 27.3 / Req 27.3.
    //     After a confirmed password match (so we never leak geo
    //     state to attackers spraying invalid passwords) but BEFORE
    //     token issuance / MFA pivot. The service is fail-open: a
    //     missing geo signal returns `{ allowed: true }` so a
    //     Cloudflare / mmdb outage cannot lock real users out.
    //     A blocked decision raises `403 IMPOSSIBLE_TRAVEL` with
    //     `requiresMfa: true` so the client can route the user
    //     into MFA re-verification rather than retrying the login.
    if (this.impossibleTravel) {
      const decision = await this.impossibleTravel.checkAndRecord(
        user.id,
        ip,
        meta.headers,
      );
      if (!decision.allowed) {
        throw new HttpException(
          {
            code: 'IMPOSSIBLE_TRAVEL',
            message:
              decision.reason ??
              'Login blocked due to a suspicious geographic anomaly. Please complete MFA verification.',
            details: {
              distance: decision.distance,
              distanceKm: decision.distanceKm ?? decision.distance,
              elapsedMs: decision.elapsedMs,
              currentCountry: decision.currentCountry,
              previousCountry: decision.previousCountry,
              prevCountry: decision.prevCountry ?? decision.previousCountry,
              requiresMfa: true,
            },
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 6. MFA gate — enforce role policy + pivot into challenge flow
    //    when at least one factor is enrolled. Both branches treat
    //    the password check as "step 1" so we still record success
    //    against brute-force only after the factor verifies.
    if (this.mfaService) {
      // Role policy: ADMIN / TEACHER without an enrolled factor are
      // blocked at login (Property 23 / Req 29.1, 29.7).
      await this.mfaService.assertRoleEnforcement(user.role, user.id);

      const hasMfa = await this.mfaService.hasVerifiedCredential(user.id);
      if (hasMfa) {
        const tokenMeta: { ip?: string; ua?: string } = {};
        if (meta.ip !== undefined) tokenMeta.ip = meta.ip;
        if (meta.userAgent !== undefined) tokenMeta.ua = meta.userAgent;
        const issued = await this.mfaService.issueMfaToken(user.id, tokenMeta);

        // Reset brute-force only after the password step. The MFA
        // step has its own independent rate-limit counter
        // (`mfa:totp:rl:<userId>`) that gates code entry.
        await this.recordLoginSuccess(dto.email, ip);

        this.logger.log(
          `MFA challenge issued for user: ${user.id} (${user.email})`,
        );
        return {
          requiresMfa: true,
          mfaToken: issued.mfaToken,
          expiresIn: issued.expiresIn,
          methods: issued.methods,
        };
      }
    }

    // 7. No MFA enrolled (or service not wired) — issue tokens directly.
    return this.finalizeLogin(user.id, meta, dto.email, ip);
  }

  /**
   * Complete the login after a successful MFA challenge — issues the
   * access + refresh token pair and creates the Session row. Called
   * from both the no-MFA path of `login` and `mfaChallenge`.
   */
  private async finalizeLogin(
    userId: string,
    meta: { userAgent?: string; ip?: string },
    email?: string,
    ip?: string,
  ): Promise<LoginResult> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'User not found',
      });
    }

    const accessToken = await this.tokensService.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      publicId: user.publicId ?? undefined,
    });

    const refreshToken = this.tokensService.generateRandomToken();
    const refreshTokenHash = this.tokensService.hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt,
      },
    });

    if (email && ip) {
      await this.recordLoginSuccess(email, ip);
    }

    // Emit auth.login event for gamification (Task 38)
    await this.outboxService.create(this.prisma, {
      topic: 'auth.login',
      payload: { userId: user.id },
      idempotencyKey: `auth.login:${user.id}:${new Date().toISOString().split('T')[0]}`,
    });

    this.logger.log(`User logged in: ${user.id} (${user.email})`);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
    };
  }

  /**
   * Complete the MFA challenge issued by `login`. Verifies the
   * supplied factor (TOTP / backup / WebAuthn) and finalises the
   * session by issuing access + refresh tokens.
   */
  async mfaChallenge(
    input: {
      mfaToken: string;
      code?: string;
      webauthn?: { response: any };
    },
    meta: { userAgent?: string; ip?: string },
  ): Promise<LoginResult> {
    if (!this.mfaService) {
      throw new HttpException(
        {
          code: 'MFA_NOT_AVAILABLE',
          message: 'MFA is not configured for this deployment',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const { userId } = await this.mfaService.verifyMfaChallenge(input);
    return this.finalizeLogin(userId, meta);
  }

  /**
   * Refresh token rotation (Req 1.4, 1.6).
   *
   * Flow:
   * 1. Hash the incoming refreshToken with SHA-256
   * 2. Find Session by refreshTokenHash where revokedAt is null and expiresAt > now
   * 3. If not found → check if this token was previously revoked (family detection)
   * 4. Token Family Detection (Req 1.6):
   *    - If the hashed token matches a REVOKED session → token was stolen/replayed
   *    - Revoke ALL sessions for that userId (set revokedAt = now on all)
   *    - Throw 401 TOKEN_FAMILY_COMPROMISED
   * 5. If valid session found:
   *    - Revoke the current session (set revokedAt = now) — rotation
   *    - Generate new accessToken + refreshToken pair
   *    - Create new Session with new refreshTokenHash
   *    - Return { accessToken, refreshToken }
   */
  async refresh(
    dto: RefreshDto,
    meta: { userAgent?: string; ip?: string },
  ): Promise<RefreshResult> {
    if (!dto.refreshToken) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }
    const tokenHash = this.tokensService.hashToken(dto.refreshToken);
    const now = new Date();

    // 1. Look for a valid (non-revoked, non-expired) session
    const validSession = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash: tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (!validSession) {
      // 2. Token family detection: check if this token belongs to a revoked session
      const revokedSession = await this.prisma.session.findFirst({
        where: {
          refreshTokenHash: tokenHash,
          revokedAt: { not: null },
        },
      });

      if (revokedSession) {
        // Token reuse detected — revoke ALL sessions for this user (Req 1.6)
        await this.prisma.session.updateMany({
          where: { userId: revokedSession.userId },
          data: { revokedAt: now },
        });

        this.logger.warn(
          `Token family compromised for user: ${revokedSession.userId}. All sessions revoked.`,
        );

        throw new UnauthorizedException({
          code: 'TOKEN_FAMILY_COMPROMISED',
          message: 'Refresh token reuse detected. All sessions have been revoked.',
        });
      }

      // Token not found at all — invalid token
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }

    // 3. Rotate: revoke old session, create new one
    const user = await this.usersRepository.findById(validSession.userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'User not found',
      });
    }

    // Generate new token pair
    const accessToken = await this.tokensService.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      publicId: user.publicId ?? undefined,
    });

    const newRefreshToken = this.tokensService.generateRandomToken();
    const newRefreshTokenHash = this.tokensService.hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Atomic: revoke old session + create new session
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: validSession.id },
        data: { revokedAt: now },
      });

      await tx.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: newRefreshTokenHash,
          userAgent: meta.userAgent ?? null,
          ip: meta.ip ?? null,
          expiresAt,
        },
      });
    });

    this.logger.log(`Token refreshed for user: ${user.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Revoke the session backing a refresh token (Req 21.3 logout).
   * Best-effort: an already-invalid/expired token is treated as a no-op
   * so logout always succeeds from the client's point of view.
   */
  async logout(refreshToken: string | undefined): Promise<{ message: string }> {
    if (refreshToken) {
      const tokenHash = this.tokensService.hashToken(refreshToken);
      await this.prisma.session.updateMany({
        where: { refreshTokenHash: tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logged out' };
  }

  /**
   * Password reset request (Req 1.7).
   *
   * Flow:
   * 1. Find user by email (if not found, still return 200 — no email enumeration)
   * 2. Generate reset token (crypto.randomBytes(32))
   * 3. Store hashed token in PasswordReset table (expires in 1 hour)
   * 4. Emit OutboxEvent(topic='password.reset.requested')
   * 5. Return generic success message
   */
  async passwordResetRequest(dto: PasswordResetRequestDto): Promise<PasswordResetRequestResult> {
    const user = await this.usersRepository.findByEmail(dto.email);

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If the email exists, a reset link has been sent' };
    }

    const rawToken = this.tokensService.generateRandomToken();
    const tokenHash = this.tokensService.hashToken(rawToken);

    await this.prisma.$transaction(async (tx) => {
      // Store hashed token in PasswordReset table (expires in 1 hour)
      await tx.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // Emit outbox event for downstream processing (email sending)
      await this.outboxService.create(tx, {
        topic: 'password.reset.requested',
        payload: {
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          token: rawToken,
        },
        idempotencyKey: `password.reset.requested:${user.id}:${Date.now()}`,
      });
    });

    this.logger.log(`Password reset requested for user: ${user.id}`);

    return { message: 'If the email exists, a reset link has been sent' };
  }

  /**
   * Password reset confirm.
   *
   * Flow:
   * 1. Hash incoming token, find valid PasswordReset record
   * 2. If not found → 400 INVALID_OR_EXPIRED_TOKEN
   * 3. Hash new password with Argon2id
   * 4. Update user's passwordHash
   * 5. Mark PasswordReset.consumedAt = now
   * 6. Revoke all user's sessions (force re-login)
   * 7. Return success message
   */
  async passwordResetConfirm(dto: PasswordResetConfirmDto): Promise<PasswordResetConfirmResult> {
    const tokenHash = this.tokensService.hashToken(dto.token);
    const now = new Date();

    const resetRecord = await this.prisma.passwordReset.findFirst({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (!resetRecord) {
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'The reset token is invalid or has expired',
      });
    }

    if (!isPasswordStrongEnough(dto.newPassword)) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: 'Password must contain at least one letter and one number',
      });
    }

    // Hash new password with Argon2id
    const passwordHash = await this.hashPassword(dto.newPassword);

    // Atomic: update password + consume token + revoke all sessions
    await this.prisma.$transaction(async (tx) => {
      // Update user's password
      await this.usersRepository.updatePassword(resetRecord.userId, passwordHash, tx);

      // Mark reset token as consumed
      await tx.passwordReset.update({
        where: { id: resetRecord.id },
        data: { consumedAt: now },
      });

      // Revoke all user's sessions (force re-login)
      await tx.session.updateMany({
        where: { userId: resetRecord.userId },
        data: { revokedAt: now },
      });
    });

    this.logger.log(`Password reset completed for user: ${resetRecord.userId}`);

    return { message: 'Password reset successfully' };
  }

  /**
   * Resend the email-verification link (Design — Auth API: POST
   * /auth/resend-verification).
   *
   * Flow:
   * 1. Per-email rate limit (1 request / hour) using Redis SETNX. If a
   *    second request comes in within an hour we throw 429 RATE_LIMITED.
   *    The same generic 200 response is otherwise returned regardless
   *    of whether the email exists, so the endpoint cannot be used to
   *    enumerate accounts.
   * 2. Look up the user. Missing / already-verified users are silently
   *    accepted (still return 200) — no information leak.
   * 3. Inside a transaction:
   *      - invalidate (consume) any pending email-verification tokens
   *        for the user so only the freshest one works
   *      - create a new EmailVerification (24h TTL) with a fresh
   *        random token
   *      - emit `user.registered` outbox event so the existing email
   *        worker re-uses the registration template
   * 4. Returns a generic message.
   */
  async resendVerification(
    dto: ResendVerificationDto,
  ): Promise<ResendVerificationResult> {
    const genericResult = {
      message: 'If the email is registered and pending verification, a new link has been sent',
    } as const;

    // Per-email throttle (1 / hour). Implemented with SETNX so the first
    // request wins and subsequent calls within the window get 429.
    if (this.redis) {
      const lockKey = `auth:resend-verification:${dto.email}`;
      const acquired = await this.redis.setnx(lockKey, '1', 60 * 60);
      if (!acquired) {
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message:
              'Verification email already sent recently. Please check your inbox or try again later.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const user = await this.usersRepository.findByEmail(dto.email);

    // Silently accept unknown emails to prevent enumeration.
    if (!user) {
      return genericResult;
    }

    // If the user is already verified, skip the email but still return
    // the generic success response.
    if (user.status === 'ACTIVE') {
      return genericResult;
    }

    const rawToken = this.tokensService.generateRandomToken();
    const tokenHash = this.tokensService.hashToken(rawToken);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Invalidate any pending tokens so only the latest one is valid.
      await tx.emailVerification.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      await tx.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // Reuse the existing `user.registered` topic so the email worker
      // sends out the same template. Idempotency key includes the
      // current timestamp to avoid colliding with the original
      // registration event.
      await this.outboxService.create(tx, {
        topic: 'user.registered',
        payload: {
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          token: rawToken,
          resend: true,
        },
        idempotencyKey: `user.registered:${user.id}:resend:${Date.now()}`,
      });
    });

    this.logger.log(`Verification email re-sent for user: ${user.id}`);
    return genericResult;
  }

  /**
   * Consume an account-unlock token issued by the hardening service.
   * Returns a generic 200 even on invalid tokens so the endpoint can
   * not be used to confirm whether a token exists.
   */
  async accountUnlock(dto: AccountUnlockDto): Promise<AccountUnlockResult> {
    if (!this.authHardening) {
      // Hardening service not wired (legacy deployments) — return the
      // generic success path so this endpoint is always callable.
      return {
        message: 'If the token is valid, your account has been unlocked',
        unlocked: false,
      };
    }

    const { unlocked, userId } = await this.authHardening.consumeUnlockToken(
      dto.token,
    );
    if (unlocked && userId) {
      this.logger.log(`Account unlocked via email token: ${userId}`);
    }
    return {
      message: 'If the token is valid, your account has been unlocked',
      unlocked,
    };
  }

  /**
   * Bridge helper — calls every wired login-failure recorder
   * (legacy `BruteForceService` + new `LoginProtectionService` +
   * spec-aligned `AuthHardeningService` + Task 27.2's
   * `BruteForceProtectionService`) and the credential-stuffing
   * detector. The call is best-effort: any single recorder failing
   * must not propagate, since the surrounding `login()` flow is
   * already returning an `UNAUTHENTICATED` error.
   *
   * `userMeta` is the resolved user (when the email matched a real
   * account) so the hardening service can issue an unlock email on
   * the hard-lock crossing.
   *
   * Returns the new `BruteForceProtectionService` result (or `null`
   * when the service is not wired) so the caller can shape the 401
   * response with the lockout state.
   */
  private async recordLoginFailure(
    email: string,
    ip: string,
    userMeta: { userId: string; email: string } | undefined,
  ): Promise<{ locked: boolean; lockedUntil?: Date } | null> {
    const tasks: Array<Promise<unknown>> = [];
    let bfProtectionResult: {
      locked: boolean;
      lockedUntil?: Date;
    } | null = null;

    if (this.bruteForceService) {
      tasks.push(
        this.bruteForceService.recordFailure(email, ip).catch((err) => {
          this.logger.warn(
            `recordLoginFailure: BruteForceService.recordFailure failed: ${(err as Error).message}`,
          );
        }),
      );
    }

    if (this.loginProtection) {
      tasks.push(
        this.loginProtection.recordFailure(email, ip).catch((err) => {
          this.logger.warn(
            `recordLoginFailure: LoginProtectionService.recordFailure failed: ${(err as Error).message}`,
          );
        }),
      );
    }

    if (this.credentialStuffingDetector) {
      tasks.push(
        this.credentialStuffingDetector
          .recordAttempt(email, ip)
          .catch((err) => {
            this.logger.warn(
              `recordLoginFailure: CredentialStuffingDetector.recordAttempt failed: ${(err as Error).message}`,
            );
          }),
      );
    }

    if (this.authHardening) {
      tasks.push(
        this.authHardening
          .recordFailure(email, ip, userMeta ?? {})
          .catch((err) => {
            this.logger.warn(
              `recordLoginFailure: AuthHardeningService.recordFailure failed: ${(err as Error).message}`,
            );
          }),
      );
    }

    if (this.bruteForceProtection) {
      // Capture the result so the 401 response can carry the
      // lockout state (Task 27.2 — `code: ACCOUNT_LOCKED` when
      // locked, otherwise the standard generic 401).
      tasks.push(
        this.bruteForceProtection
          .recordFailure(email, ip)
          .then((res) => {
            bfProtectionResult = res;
          })
          .catch((err) => {
            this.logger.warn(
              `recordLoginFailure: BruteForceProtectionService.recordFailure failed: ${(err as Error).message}`,
            );
          }),
      );
    }

    if (this.securityBruteForce) {
      // Task 27.2 — drives the NORMAL → TEMP_LOCKED → PERM_LOCKED
      // state machine and the per-IP credential-stuffing detector.
      // The result is also surfaced through `bfProtectionResult` so
      // the 401 response stays consistent with the existing
      // brute-force-protection branch when the new service is wired.
      tasks.push(
        this.securityBruteForce
          .recordFailedAttempt(email, ip)
          .then((res) => {
            if (res.status !== 'NORMAL') {
              // Promote to ACCOUNT_LOCKED on the response. PERM_LOCKED
              // has no `lockedUntil` so we surface a far-future date so
              // the existing exception builder still renders a coherent
              // 401 — the assertion path will turn the next attempt
              // into a 403.
              const lockedUntil =
                res.remainingMs !== undefined
                  ? new Date(Date.now() + res.remainingMs)
                  : new Date(Date.now() + 30 * 60 * 1000);
              if (!bfProtectionResult || !bfProtectionResult.locked) {
                bfProtectionResult = { locked: true, lockedUntil };
              }
            }
          })
          .catch((err) => {
            this.logger.warn(
              `recordLoginFailure: SecurityBruteForceService.recordFailedAttempt failed: ${(err as Error).message}`,
            );
          }),
      );
    }

    await Promise.all(tasks);

    return bfProtectionResult;
  }

  /**
   * Build the 401 thrown after a wrong-password / unknown-user
   * attempt. Generic by default — the message MUST NOT reveal
   * whether the email exists. When the new
   * `BruteForceProtectionService` reports a freshly-applied
   * lockout, the response code switches to `ACCOUNT_LOCKED` and
   * the lockout state is included under `details` so the client
   * can render a countdown without parsing the response date
   * header. Task 27.2 keeps the message generic for security
   * even on the locked branch — only the code + details change.
   */
  private buildLoginUnauthorizedException(
    bfResult: { locked: boolean; lockedUntil?: Date } | null,
  ): UnauthorizedException {
    if (bfResult?.locked && bfResult.lockedUntil) {
      const retryAfter = Math.max(
        1,
        Math.ceil((bfResult.lockedUntil.getTime() - Date.now()) / 1000),
      );
      return new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Invalid email or password',
        details: {
          lockedUntil: bfResult.lockedUntil.toISOString(),
          retryAfter,
        },
      });
    }
    return new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
  }

  /**
   * Bridge helper — clears the failure counters for every wired
   * recorder on a successful login. Mirrors `recordLoginFailure`.
   */
  private async recordLoginSuccess(email: string, ip: string): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];

    if (this.bruteForceService) {
      tasks.push(
        this.bruteForceService.recordSuccess(email, ip).catch((err) => {
          this.logger.warn(
            `recordLoginSuccess: BruteForceService.recordSuccess failed: ${(err as Error).message}`,
          );
        }),
      );
    }

    if (this.loginProtection) {
      tasks.push(
        this.loginProtection.recordSuccess(email, ip).catch((err) => {
          this.logger.warn(
            `recordLoginSuccess: LoginProtectionService.recordSuccess failed: ${(err as Error).message}`,
          );
        }),
      );
    }

    if (this.authHardening) {
      tasks.push(
        this.authHardening.recordSuccess(email, ip).catch((err) => {
          this.logger.warn(
            `recordLoginSuccess: AuthHardeningService.recordSuccess failed: ${(err as Error).message}`,
          );
        }),
      );
    }

    if (this.bruteForceProtection) {
      tasks.push(
        this.bruteForceProtection.recordSuccess(email, ip).catch((err) => {
          this.logger.warn(
            `recordLoginSuccess: BruteForceProtectionService.recordSuccess failed: ${(err as Error).message}`,
          );
        }),
      );
    }

    if (this.securityBruteForce) {
      tasks.push(
        this.securityBruteForce
          .recordSuccessfulLogin(email, ip)
          .catch((err) => {
            this.logger.warn(
              `recordLoginSuccess: SecurityBruteForceService.recordSuccessfulLogin failed: ${(err as Error).message}`,
            );
          }),
      );
    }

    await Promise.all(tasks);
  }

  /**
   * POST /auth/change-password — change password for an authenticated user.
   * Verifies the current password before updating to the new one.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new BadRequestException({
        code: 'WRONG_CURRENT_PASSWORD',
        message: 'Joriy parol noto\'g\'ri',
      });
    }

    if (!isPasswordStrongEnough(newPassword)) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: 'Password must contain at least one letter and one number',
      });
    }

    const newHash = await this.hashPassword(newPassword);
    await this.usersRepository.updatePassword(userId, newHash);

    this.logger.log(`Password changed for user: ${userId}`);
    return { message: 'Parol muvaffaqiyatli yangilandi' };
  }
}

/**
 * Minimum password complexity: at least one letter and one digit. Length
 * is already enforced by the Zod DTOs (min 8) — this only rejects
 * all-digit ("12345678") or all-letter ("password") strings that would
 * otherwise pass on length alone.
 */
export function isPasswordStrongEnough(password: string): boolean {
  return /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}
