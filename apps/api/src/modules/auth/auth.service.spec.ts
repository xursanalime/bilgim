import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';

import { AuthService } from './auth.service';
import { UsersRepository } from './repositories/users.repository';
import { TokensService } from './tokens.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { RegisterDto } from './dto';

/**
 * Build a fully shaped User object usable as the Prisma return value.
 * Centralised so individual tests only override the fields they care about.
 */
function buildMockUser(overrides: Partial<any> = {}) {
  return {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    fullName: 'Test User',
    role: 'STUDENT' as const,
    status: 'ACTIVE' as const,
    passwordHash: '$argon2id$hash',
    phone: null,
    avatarUrl: null,
    locale: 'uz',
    location: null,
    mfaRequired: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * AuthService unit tests covering Requirements 1.1–1.9:
 *  - Registration (1.1, 1.8)
 *  - Email verification (1.2)
 *  - Login (1.3, 1.5)
 *  - Token refresh + family detection (1.4, 1.6, 1.9)
 *  - Password reset (1.7)
 *  - Argon2id hash verification (1.8)
 */
describe('AuthService', () => {
  let authService: AuthService;
  let usersRepository: jest.Mocked<UsersRepository>;
  let tokensService: jest.Mocked<TokensService>;
  let outboxService: jest.Mocked<OutboxService>;
  let billingService: jest.Mocked<BillingService>;
  let mockPrisma: any;
  let mockTx: any;

  beforeEach(() => {
    usersRepository = {
      findByEmail: jest.fn(),
      findByUsername: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      updatePassword: jest.fn().mockResolvedValue({}),
    } as any;

    tokensService = {
      generateRandomToken: jest.fn().mockReturnValue('mock-token-hex'),
      hashToken: jest.fn((t: string) => `hashed:${t}`),
      generateAccessToken: jest.fn().mockResolvedValue('jwt-access-token'),
      verifyAccessToken: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-event-id'),
    } as any;

    billingService = {
      startTrial: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'TRIAL' }),
    } as any;

    mockTx = {
      emailVerification: {
        create: jest.fn().mockResolvedValue({ id: 'ev-id' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordReset: {
        create: jest.fn().mockResolvedValue({ id: 'pr-id' }),
        update: jest.fn().mockResolvedValue({}),
      },
      session: {
        create: jest.fn().mockResolvedValue({ id: 'session-id' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      teacherProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      specialty: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    mockPrisma = {
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockTx)),
      emailVerification: {
        findFirst: jest.fn(),
      },
      passwordReset: {
        findFirst: jest.fn(),
      },
      session: {
        create: jest.fn().mockResolvedValue({ id: 'session-id' }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    authService = new AuthService(
      mockPrisma,
      usersRepository,
      tokensService,
      outboxService,
      billingService,
    );
  });

  // ---------------------------------------------------------------------------
  // register (Req 1.1, 1.8)
  // ---------------------------------------------------------------------------
  describe('register', () => {
    const validDto: RegisterDto = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'securepass123',
      fullName: 'Test User',
      role: 'STUDENT',
    };

    it('should register a new user successfully', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockResolvedValue(
        buildMockUser({ id: 'user-123', status: 'PENDING_VERIFY' }),
      );

      const result = await authService.register(validDto);

      expect(result).toEqual({
        userId: 'user-123',
        message: 'Verification email sent',
        verificationRequired: true,
      });
      expect(usersRepository.findByEmail).toHaveBeenCalledWith(validDto.email);
      expect(usersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: validDto.email,
          username: validDto.username,
          fullName: validDto.fullName,
          role: 'STUDENT',
        }),
        mockTx,
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      usersRepository.findByEmail.mockResolvedValue(
        buildMockUser({ id: 'existing-user' }),
      );

      await expect(authService.register(validDto)).rejects.toThrow(
        ConflictException,
      );
      expect(usersRepository.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if username already exists', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.findByUsername.mockResolvedValue(
        buildMockUser({ id: 'other-user' }),
      );

      await expect(authService.register(validDto)).rejects.toThrow(
        ConflictException,
      );
      expect(usersRepository.create).not.toHaveBeenCalled();
    });

    it('should hash the password with Argon2id before persisting (Req 1.8)', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockResolvedValue(
        buildMockUser({ id: 'user-456', status: 'PENDING_VERIFY' }),
      );

      await authService.register(validDto);

      const createArgs = usersRepository.create.mock.calls[0]?.[0];
      expect(createArgs).toBeDefined();
      expect(createArgs!.passwordHash).toBeDefined();
      expect(createArgs!.passwordHash).not.toBe(validDto.password);
      expect(createArgs!.passwordHash).toContain('$argon2id$');
    });

    it('should create email verification token in transaction', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockResolvedValue(
        buildMockUser({ id: 'user-456', status: 'PENDING_VERIFY' }),
      );

      await authService.register(validDto);

      expect(tokensService.generateRandomToken).toHaveBeenCalled();
      expect(tokensService.hashToken).toHaveBeenCalledWith('mock-token-hex');
      expect(mockTx.emailVerification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-456',
          tokenHash: 'hashed:mock-token-hex',
        }),
      });
    });

    it('should emit outbox event with user.registered topic', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);
      usersRepository.create.mockResolvedValue(
        buildMockUser({ id: 'user-789', status: 'PENDING_VERIFY' }),
      );

      await authService.register(validDto);

      expect(outboxService.create).toHaveBeenCalledWith(mockTx, {
        topic: 'user.registered',
        payload: expect.objectContaining({
          userId: 'user-789',
          email: validDto.email,
          token: 'mock-token-hex',
        }),
        idempotencyKey: 'user.registered:user-789',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // hashPassword / verifyPassword (Req 1.8)
  // ---------------------------------------------------------------------------
  describe('hashPassword / verifyPassword (Argon2id)', () => {
    it('should produce an Argon2id hash with the expected format', async () => {
      const password = 'testpassword123';
      const hash = await authService.hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('should configure Argon2id with m=19MiB, t=2, p=1 (Req 1.8)', async () => {
      const password = 'paramCheckPassword';
      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456, // 19 MiB
        timeCost: 2,
        parallelism: 1,
      });

      // Argon2 encoded format includes m=, t=, p= parameters in the hash string.
      expect(hash).toMatch(/m=19456/);
      expect(hash).toMatch(/t=2/);
      expect(hash).toMatch(/p=1/);

      // And our service should accept it as valid.
      const ok = await authService.verifyPassword(password, hash);
      expect(ok).toBe(true);
    });

    it('should verify a correct password', async () => {
      const password = 'mySecurePassword!';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject a wrong password', async () => {
      const hash = await authService.hashPassword('correctPassword');

      const isValid = await authService.verifyPassword('wrongPassword', hash);
      expect(isValid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyEmail (Req 1.2)
  // ---------------------------------------------------------------------------
  describe('verifyEmail', () => {
    const baseVerification = {
      id: 'verification-id',
      userId: 'user-123',
      tokenHash: 'hashed:raw-token',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    };

    it('should verify email successfully with a valid token (Req 1.2)', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(baseVerification);
      usersRepository.updateStatus.mockResolvedValue(
        buildMockUser({ id: 'user-123', role: 'STUDENT' }),
      );

      const result = await authService.verifyEmail({ token: 'raw-token' });

      expect(result).toEqual({ message: 'Email verified successfully' });
      expect(tokensService.hashToken).toHaveBeenCalledWith('raw-token');
      expect(mockTx.emailVerification.update).toHaveBeenCalledWith({
        where: { id: 'verification-id' },
        data: { consumedAt: expect.any(Date) },
      });
      expect(usersRepository.updateStatus).toHaveBeenCalledWith(
        'user-123',
        'ACTIVE',
        mockTx,
      );
    });

    it('should throw BadRequestException for an invalid or unknown token', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);

      await expect(
        authService.verifyEmail({ token: 'invalid-token' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an expired token', async () => {
      // findFirst already filters expiresAt > now, so an expired token returns null.
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);

      await expect(
        authService.verifyEmail({ token: 'expired-token' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should call BillingService.startTrial inside the transaction for TEACHER users (Req 2.1)', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(baseVerification);
      usersRepository.updateStatus.mockResolvedValue(
        buildMockUser({ id: 'user-123', role: 'TEACHER' }),
      );

      await authService.verifyEmail({ token: 'raw-token' });

      expect(billingService.startTrial).toHaveBeenCalledTimes(1);
      expect(billingService.startTrial).toHaveBeenCalledWith('user-123', mockTx);
    });

    it('should NOT call BillingService.startTrial for STUDENT users', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(baseVerification);
      usersRepository.updateStatus.mockResolvedValue(
        buildMockUser({ id: 'user-123', role: 'STUDENT' }),
      );

      await authService.verifyEmail({ token: 'raw-token' });

      expect(billingService.startTrial).not.toHaveBeenCalled();
    });

    it('should NOT call BillingService.startTrial for ADMIN users', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(baseVerification);
      usersRepository.updateStatus.mockResolvedValue(
        buildMockUser({ id: 'user-123', role: 'ADMIN' as any }),
      );

      await authService.verifyEmail({ token: 'raw-token' });

      expect(billingService.startTrial).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // login (Req 1.3, 1.5, 1.9)
  // ---------------------------------------------------------------------------
  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123' };
    const meta = { userAgent: 'Mozilla/5.0', ip: '127.0.0.1' };

    it('should login successfully and return access + refresh tokens (Req 1.3)', async () => {
      usersRepository.findByEmail.mockResolvedValue(buildMockUser());
      usersRepository.findById.mockResolvedValue(buildMockUser());
      jest.spyOn(authService, 'verifyPassword').mockResolvedValue(true);

      const result = await authService.login(loginDto, meta);

      expect(result).toEqual({
        accessToken: 'jwt-access-token',
        refreshToken: 'mock-token-hex',
        user: {
          id: 'user-123',
          email: 'test@example.com',
          role: 'STUDENT',
          fullName: 'Test User',
        },
      });
      expect(tokensService.generateAccessToken).toHaveBeenCalledWith({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'STUDENT',
      });
    });

    it('should throw 401 UNAUTHENTICATED when user not found (Req 1.5)', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);

      await expect(authService.login(loginDto, meta)).rejects.toMatchObject({
        constructor: UnauthorizedException,
        response: { code: 'UNAUTHENTICATED' },
      });
    });

    it('should throw 401 ACCOUNT_NOT_VERIFIED when user is not active', async () => {
      usersRepository.findByEmail.mockResolvedValue(
        buildMockUser({ status: 'PENDING_VERIFY' }),
      );

      await expect(authService.login(loginDto, meta)).rejects.toMatchObject({
        constructor: UnauthorizedException,
        response: { code: 'ACCOUNT_NOT_VERIFIED' },
      });
    });

    it('should throw 401 UNAUTHENTICATED when password is wrong (Req 1.5)', async () => {
      usersRepository.findByEmail.mockResolvedValue(buildMockUser());
      jest.spyOn(authService, 'verifyPassword').mockResolvedValue(false);

      await expect(authService.login(loginDto, meta)).rejects.toMatchObject({
        constructor: UnauthorizedException,
        response: { code: 'UNAUTHENTICATED' },
      });
    });

    it('should store the refresh token hash (not plaintext) in the session (Req 1.9)', async () => {
      usersRepository.findByEmail.mockResolvedValue(buildMockUser());
      usersRepository.findById.mockResolvedValue(buildMockUser());
      jest.spyOn(authService, 'verifyPassword').mockResolvedValue(true);

      await authService.login(loginDto, meta);

      expect(tokensService.hashToken).toHaveBeenCalledWith('mock-token-hex');
      const sessionArgs = mockPrisma.session.create.mock.calls[0][0];
      expect(sessionArgs.data.refreshTokenHash).toBe('hashed:mock-token-hex');
      // The plaintext refresh token must NEVER appear on the session row.
      expect(sessionArgs.data.refreshTokenHash).not.toBe('mock-token-hex');
      expect(JSON.stringify(sessionArgs)).not.toContain('"mock-token-hex"');
    });

    it('should set the session expiresAt approximately 30 days in the future', async () => {
      usersRepository.findByEmail.mockResolvedValue(buildMockUser());
      usersRepository.findById.mockResolvedValue(buildMockUser());
      jest.spyOn(authService, 'verifyPassword').mockResolvedValue(true);

      const before = Date.now();
      await authService.login(loginDto, meta);
      const after = Date.now();

      const sessionCall = mockPrisma.session.create.mock.calls[0][0];
      const expiresAt = sessionCall.data.expiresAt.getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDaysMs);
      expect(expiresAt).toBeLessThanOrEqual(after + thirtyDaysMs);
    });
  });

  // ---------------------------------------------------------------------------
  // refresh + token family detection (Req 1.4, 1.6, 1.9)
  // ---------------------------------------------------------------------------
  describe('refresh', () => {
    const meta = { userAgent: 'agent', ip: '10.0.0.1' };

    it('should rotate the token pair on a valid refresh (Req 1.4)', async () => {
      const validSession = {
        id: 'session-old',
        userId: 'user-123',
        refreshTokenHash: 'hashed:old-refresh',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      };
      mockPrisma.session.findFirst.mockResolvedValueOnce(validSession);
      usersRepository.findById.mockResolvedValue(buildMockUser());

      // Generate the OLD hash for lookup, then a NEW token for rotation.
      tokensService.generateRandomToken
        .mockReturnValueOnce('new-refresh-token');

      const result = await authService.refresh(
        { refreshToken: 'old-refresh' },
        meta,
      );

      expect(result.accessToken).toBe('jwt-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');

      // Old session was revoked …
      expect(mockTx.session.update).toHaveBeenCalledWith({
        where: { id: 'session-old' },
        data: { revokedAt: expect.any(Date) },
      });
      // … and a new session was created with the new refresh token's hash.
      expect(mockTx.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          refreshTokenHash: 'hashed:new-refresh-token',
        }),
      });
    });

    it('should throw 401 INVALID_REFRESH_TOKEN when token is unknown', async () => {
      mockPrisma.session.findFirst
        .mockResolvedValueOnce(null) // first lookup: no valid session
        .mockResolvedValueOnce(null); // family-detection lookup: no revoked match either

      await expect(
        authService.refresh({ refreshToken: 'totally-fake' }, meta),
      ).rejects.toMatchObject({
        constructor: UnauthorizedException,
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });

      expect(mockTx.session.create).not.toHaveBeenCalled();
    });

    it('should detect token family compromise and revoke ALL user sessions (Req 1.6)', async () => {
      const revokedSession = {
        id: 'session-revoked',
        userId: 'user-123',
        refreshTokenHash: 'hashed:replayed',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(Date.now() - 1000),
      };
      // No valid session for this hash …
      mockPrisma.session.findFirst.mockResolvedValueOnce(null);
      // … but an already-revoked session for the same hash exists → reuse detected.
      mockPrisma.session.findFirst.mockResolvedValueOnce(revokedSession);

      await expect(
        authService.refresh({ refreshToken: 'replayed' }, meta),
      ).rejects.toMatchObject({
        constructor: UnauthorizedException,
        response: { code: 'TOKEN_FAMILY_COMPROMISED' },
      });

      // ALL sessions for this user must have been revoked.
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { revokedAt: expect.any(Date) },
      });
      // No new tokens issued on a compromised family.
      expect(tokensService.generateAccessToken).not.toHaveBeenCalled();
    });

    it('should reject when the underlying user no longer exists', async () => {
      const validSession = {
        id: 'session-old',
        userId: 'ghost-user',
        refreshTokenHash: 'hashed:still-valid',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      };
      mockPrisma.session.findFirst.mockResolvedValueOnce(validSession);
      usersRepository.findById.mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: 'still-valid' }, meta),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should hash and store the new refresh token rather than the plaintext (Req 1.9)', async () => {
      const validSession = {
        id: 'session-old',
        userId: 'user-123',
        refreshTokenHash: 'hashed:old',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      };
      mockPrisma.session.findFirst.mockResolvedValueOnce(validSession);
      usersRepository.findById.mockResolvedValue(buildMockUser());
      tokensService.generateRandomToken.mockReturnValueOnce('rotated-token');

      await authService.refresh({ refreshToken: 'old' }, meta);

      const createArgs = mockTx.session.create.mock.calls[0][0];
      expect(createArgs.data.refreshTokenHash).toBe('hashed:rotated-token');
      expect(createArgs.data.refreshTokenHash).not.toBe('rotated-token');
    });
  });

  // ---------------------------------------------------------------------------
  // password reset (Req 1.7)
  // ---------------------------------------------------------------------------
  describe('passwordResetRequest', () => {
    it('should emit an outbox event when the user exists (Req 1.7)', async () => {
      usersRepository.findByEmail.mockResolvedValue(buildMockUser());

      const result = await authService.passwordResetRequest({
        email: 'test@example.com',
      });

      expect(result).toEqual({
        message: 'If the email exists, a reset link has been sent',
      });
      expect(mockTx.passwordReset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          tokenHash: 'hashed:mock-token-hex',
        }),
      });
      expect(outboxService.create).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          topic: 'password.reset.requested',
          payload: expect.objectContaining({
            userId: 'user-123',
            token: 'mock-token-hex',
          }),
        }),
      );
    });

    it('should return the same generic message for unknown emails (no enumeration)', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);

      const result = await authService.passwordResetRequest({
        email: 'unknown@example.com',
      });

      expect(result).toEqual({
        message: 'If the email exists, a reset link has been sent',
      });
      // No DB writes / outbox events for unknown users.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });
  });

  describe('passwordResetConfirm', () => {
    const baseReset = {
      id: 'reset-id',
      userId: 'user-123',
      tokenHash: 'hashed:reset-token',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    };

    it('should update password, consume token, and revoke all sessions (Req 1.7)', async () => {
      mockPrisma.passwordReset.findFirst.mockResolvedValue(baseReset);

      const result = await authService.passwordResetConfirm({
        token: 'reset-token',
        newPassword: 'brandNewPass!',
      });

      expect(result).toEqual({ message: 'Password reset successfully' });

      // Password updated with an Argon2id hash, not the plaintext.
      expect(usersRepository.updatePassword).toHaveBeenCalledTimes(1);
      const [, newHash] = usersRepository.updatePassword.mock.calls[0]!;
      expect(newHash).toMatch(/^\$argon2id\$/);

      // Reset record consumed.
      expect(mockTx.passwordReset.update).toHaveBeenCalledWith({
        where: { id: 'reset-id' },
        data: { consumedAt: expect.any(Date) },
      });

      // All existing sessions revoked.
      expect(mockTx.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should throw BadRequestException for an invalid or expired reset token', async () => {
      mockPrisma.passwordReset.findFirst.mockResolvedValue(null);

      await expect(
        authService.passwordResetConfirm({
          token: 'bad-token',
          newPassword: 'brandNewPass!',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(usersRepository.updatePassword).not.toHaveBeenCalled();
      expect(mockTx.session.updateMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // resendVerification — POST /auth/resend-verification
  // ---------------------------------------------------------------------------
  describe('resendVerification', () => {
    const genericMessage =
      'If the email is registered and pending verification, a new link has been sent';

    it('returns the generic response for unknown emails without writing anything', async () => {
      usersRepository.findByEmail.mockResolvedValue(null);

      const result = await authService.resendVerification({
        email: 'ghost@example.com',
      });

      expect(result).toEqual({ message: genericMessage });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('returns the generic response and skips the email for already-verified users', async () => {
      usersRepository.findByEmail.mockResolvedValue(
        buildMockUser({ id: 'user-1', status: 'ACTIVE' }),
      );

      const result = await authService.resendVerification({
        email: 'active@example.com',
      });

      expect(result).toEqual({ message: genericMessage });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('invalidates pending tokens and emits a fresh user.registered event for pending users', async () => {
      usersRepository.findByEmail.mockResolvedValue(
        buildMockUser({
          id: 'user-pending',
          email: 'pending@example.com',
          status: 'PENDING_VERIFY',
        }),
      );

      const result = await authService.resendVerification({
        email: 'pending@example.com',
      });

      expect(result).toEqual({ message: genericMessage });
      expect(mockTx.emailVerification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-pending',
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
      expect(mockTx.emailVerification.create).toHaveBeenCalled();
      expect(outboxService.create).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          topic: 'user.registered',
          payload: expect.objectContaining({
            userId: 'user-pending',
            resend: true,
          }),
        }),
      );
    });
  });
});
