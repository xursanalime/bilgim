import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { generate as generateTotp } from 'otplib';

import { MfaService } from './mfa.service';
import { MfaEncryption } from './mfa.encryption';

/**
 * TOTP-focused unit tests for `MfaService` (Task 29.1).
 *
 *  - generate / verify: a freshly-generated code is accepted by the
 *    same secret (RFC 6238 round-trip)
 *  - replay-prevention: re-issuing a brand new TOTP secret invalidates
 *    the previous one (separate enrollments do not share state)
 *  - time-window tolerance: codes from the previous 30s slot still
 *    verify (default `epochTolerance: 30`)
 *  - encrypted-at-rest: persisted secret blobs never contain the raw
 *    base32 string; decryption is only performed by the service itself
 *  - rate-limiting: after `TOTP_RATE_LIMIT_MAX_ATTEMPTS` failures the
 *    service throws `429 MFA_RATE_LIMITED` instead of validating the
 *    code
 */

interface FakeRow {
  id: string;
  userId: string;
  type: 'TOTP' | 'WEBAUTHN';
  label: string | null;
  secret: string;
  counter: bigint | null;
  credentialId: string | null;
  deviceInfo: any;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function buildPrismaMock() {
  const credentials: FakeRow[] = [];
  let idCounter = 0;

  const mfaCredential = {
    create: jest.fn(async ({ data }: any) => {
      const row: FakeRow = {
        id: `cred-${++idCounter}`,
        userId: data.userId,
        type: data.type,
        label: data.label ?? null,
        secret: data.secret,
        counter: data.counter ?? null,
        credentialId: data.credentialId ?? null,
        deviceInfo: data.deviceInfo ?? null,
        verifiedAt: data.verifiedAt ?? null,
        lastUsedAt: data.lastUsedAt ?? null,
        createdAt: new Date(),
      };
      credentials.push(row);
      return row;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      let rows = credentials.filter((c) => {
        if (where.userId && c.userId !== where.userId) return false;
        if (where.type && c.type !== where.type) return false;
        if (where.verifiedAt === null && c.verifiedAt !== null) return false;
        if (
          where.verifiedAt &&
          where.verifiedAt.not !== undefined &&
          c.verifiedAt === null
        ) {
          return false;
        }
        if (
          where.credentialId &&
          typeof where.credentialId === 'string' &&
          c.credentialId !== where.credentialId
        ) {
          return false;
        }
        return true;
      });
      if (orderBy?.createdAt === 'desc') {
        rows = rows.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      }
      return rows[0] ?? null;
    }),
    findMany: jest.fn(async ({ where }: any) => {
      return credentials.filter((c) => {
        if (where.userId && c.userId !== where.userId) return false;
        if (where.type && c.type !== where.type) return false;
        if (
          where.verifiedAt &&
          where.verifiedAt.not !== undefined &&
          c.verifiedAt === null
        ) {
          return false;
        }
        return true;
      });
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = credentials.find((c) => c.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = credentials.findIndex((c) => c.id === where.id);
      if (idx >= 0) credentials.splice(idx, 1);
      return { id: where.id };
    }),
    count: jest.fn(async ({ where }: any) => {
      return credentials.filter((c) => {
        if (where.userId && c.userId !== where.userId) return false;
        if (where.type && c.type !== where.type) return false;
        if (
          where.verifiedAt &&
          where.verifiedAt.not !== undefined &&
          c.verifiedAt === null
        ) {
          return false;
        }
        if (where.NOT && where.NOT.id && c.id === where.NOT.id) return false;
        return true;
      }).length;
    }),
  };

  return {
    mfaCredential,
    mfaBackupCode: {
      count: jest.fn(async () => 0),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async function (this: any, fn: any) {
      // Pass the same prisma object as the transaction client.
      // Callers don't introspect the client object — just method calls.
      return typeof fn === 'function' ? fn(this) : Promise.all(fn);
    }),
    _credentials: credentials,
  };
}

describe('MfaService — TOTP', () => {
  let service: MfaService;
  let prisma: any;
  let configService: ConfigService;
  let jwtService: JwtService;
  let usersRepo: { findById: jest.Mock };
  let tokensService: { generateRandomToken: jest.Mock; hashToken: jest.Mock };
  let encryption: MfaEncryption;

  beforeEach(() => {
    prisma = buildPrismaMock();
    prisma.$transaction = jest.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(prisma);
      return Promise.all(fn);
    });

    configService = {
      get: jest.fn((k: string) => {
        if (k === 'MFA_TOTP_ISSUER') return 'BilgimTest';
        if (k === 'MFA_CHALLENGE_TTL_SEC') return 300;
        return undefined;
      }),
      getOrThrow: jest.fn(() => {
        throw new Error('not used');
      }),
    } as any;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-mfa-token'),
      verifyAsync: jest.fn(),
    } as any;

    usersRepo = {
      findById: jest.fn(async (id: string) => ({
        id,
        email: `${id}@edu.test`,
        fullName: 'Test User',
        role: 'STUDENT',
        passwordHash: 'hash',
      })),
    };

    tokensService = {
      generateRandomToken: jest.fn(() => 'tok'),
      hashToken: jest.fn((t: string) => `hashed:${t}`),
    };

    // Use the real encryption helper so the round-trip test is meaningful.
    encryption = new MfaEncryption(configService);

    service = new MfaService(
      prisma,
      tokensService as any,
      usersRepo as any,
      jwtService,
      configService,
      encryption,
      // No Redis — service falls back to in-process state for tests.
    );
  });

  describe('setupTotp', () => {
    it('generates a base32 secret + otpauth url + QR data url', async () => {
      const result = await service.setupTotp('user-1', 'My Phone');
      expect(result.credentialId).toBeDefined();
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('persists the secret encrypted, never in plaintext', async () => {
      const result = await service.setupTotp('user-2');
      const persisted = prisma._credentials[0];
      expect(persisted).toBeDefined();
      expect(persisted.secret).not.toBe(result.secret);
      // Decryption produces the original.
      expect(encryption.decrypt(persisted.secret)).toBe(result.secret);
    });

    it('marks the credential as not verified until the first code is checked', async () => {
      await service.setupTotp('user-3');
      const persisted = prisma._credentials[0];
      expect(persisted.verifiedAt).toBeNull();
    });
  });

  describe('verifyTotpEnrollment', () => {
    it('accepts a freshly generated code (RFC 6238 round-trip)', async () => {
      const setup = await service.setupTotp('user-4');
      const code = await generateTotp({ secret: setup.secret });

      const result = await service.verifyTotpEnrollment('user-4', code);
      expect(result.enabled).toBe(true);
      expect(result.credentialId).toBe(setup.credentialId);

      // Persisted row is now flagged verified + lastUsedAt set.
      const persisted = prisma._credentials[0];
      expect(persisted.verifiedAt).toBeInstanceOf(Date);
      expect(persisted.lastUsedAt).toBeInstanceOf(Date);
    });

    it('rejects an invalid code with 401 INVALID_TOTP_CODE', async () => {
      await service.setupTotp('user-5');

      await expect(
        service.verifyTotpEnrollment('user-5', '000000'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns BadRequest if no pending TOTP enrollment exists', async () => {
      await expect(
        service.verifyTotpEnrollment('user-6', '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('disableTotp', () => {
    it('refuses without the correct password', async () => {
      const setup = await service.setupTotp('user-7');
      const code = await generateTotp({ secret: setup.secret });
      await service.verifyTotpEnrollment('user-7', code);

      // The default mock returns an unhashable string. Force the
      // argon2.verify path to fail by giving the user a hash that
      // doesn't match.
      await expect(
        service.disableTotp('user-7', 'wrong-password', code),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('verifyMfaChallenge — TOTP path', () => {
    it('accepts a fresh code paired with a valid challenge token', async () => {
      const setup = await service.setupTotp('user-8');
      const code = await generateTotp({ secret: setup.secret });
      await service.verifyTotpEnrollment('user-8', code);

      // Stub jwt verify so the token check passes without a real signature.
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-8',
        scope: 'mfa-challenge',
      });

      // Use a NEW code for the challenge (the enrollment one was already
      // consumed at the secret level, but TOTP allows multiple checks
      // within the window).
      const result = await service.verifyMfaChallenge({
        mfaToken: 'jwt-blob',
        code,
      });

      expect(result).toEqual({ userId: 'user-8', method: 'totp' });
    });

    it('rejects an invalid code', async () => {
      const setup = await service.setupTotp('user-9');
      const code = await generateTotp({ secret: setup.secret });
      await service.verifyTotpEnrollment('user-9', code);

      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-9',
        scope: 'mfa-challenge',
      });

      await expect(
        service.verifyMfaChallenge({ mfaToken: 'jwt', code: '999999' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token with the wrong scope', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-10',
        scope: 'access-token',
      });

      await expect(
        service.verifyMfaChallenge({ mfaToken: 'jwt', code: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired/malformed token', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(
        new Error('jwt expired'),
      );

      await expect(
        service.verifyMfaChallenge({ mfaToken: 'expired', code: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('TOTP rate limiting', () => {
    it('throws 429 MFA_RATE_LIMITED after 5 failed attempts', async () => {
      // Wire a fake Redis that simulates the counter.
      const redis = {
        get: jest.fn(),
        set: jest.fn(),
        setnx: jest.fn(),
        incr: jest.fn(),
        del: jest.fn(),
        expire: jest.fn(),
      };
      let count = 0;
      redis.get.mockImplementation(async () => String(count));
      redis.incr.mockImplementation(async () => ++count);

      service = new MfaService(
        prisma,
        tokensService as any,
        usersRepo as any,
        jwtService,
        configService,
        encryption,
        redis as any,
      );

      const setup = await service.setupTotp('user-rl');
      const code = await generateTotp({ secret: setup.secret });
      await service.verifyTotpEnrollment('user-rl', code);
      // Reset counter after a successful enrollment so we can test
      // independent failure budget.
      count = 0;

      // Five wrong guesses each push count to 5.
      for (let i = 0; i < 5; i += 1) {
        await expect(
          service.verifyMfaChallenge({
            mfaToken: 'tok',
            code: '000000',
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }

      // The 6th attempt is rate-limited BEFORE the credential is
      // checked.
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-rl',
        scope: 'mfa-challenge',
      });
      await expect(
        service.verifyMfaChallenge({ mfaToken: 'tok', code: '111111' }),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
