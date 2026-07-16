import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

// Mock the SimpleWebAuthn server library so we can drive deterministic
// happy-path / failure paths without producing real CBOR attestations.
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import { MfaService } from './mfa.service';
import { MfaEncryption } from './mfa.encryption';

/**
 * WebAuthn-focused unit tests for `MfaService` (Task 29.1).
 *
 *  - registration options carry an opaque challenge that is stored
 *    server-side until it is consumed
 *  - register-finish persists the credentialId, encrypted public key,
 *    and counter
 *  - authentication options are issued only when at least one
 *    verified WebAuthn credential exists for the user
 *  - auth-finish increments `counter` after a successful verify and
 *    rejects unknown credential ids with 401
 *
 * The SimpleWebAuthn server is mocked because real attestations would
 * require generating valid COSE keys + signatures.
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
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        credentials.find((c) => {
          if (where.userId && c.userId !== where.userId) return false;
          if (where.type && c.type !== where.type) return false;
          if (where.credentialId && c.credentialId !== where.credentialId)
            return false;
          if (
            where.verifiedAt &&
            where.verifiedAt.not !== undefined &&
            c.verifiedAt === null
          ) {
            return false;
          }
          return true;
        }) ?? null
      );
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
        if (
          where.credentialId &&
          where.credentialId.not !== undefined &&
          c.credentialId === null
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
    count: jest.fn(async () => credentials.length),
    delete: jest.fn(async ({ where }: any) => {
      const idx = credentials.findIndex((c) => c.id === where.id);
      if (idx >= 0) credentials.splice(idx, 1);
      return { id: where.id };
    }),
  };

  return {
    mfaCredential,
    mfaBackupCode: {
      count: jest.fn(async () => 0),
    },
    $transaction: jest.fn(),
    _credentials: credentials,
  };
}

describe('MfaService — WebAuthn', () => {
  let service: MfaService;
  let prisma: any;
  let configService: ConfigService;
  let jwtService: JwtService;
  let usersRepo: { findById: jest.Mock };
  let encryption: MfaEncryption;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation(async (fn: any) =>
      typeof fn === 'function' ? fn(prisma) : Promise.all(fn),
    );

    configService = {
      get: jest.fn((k: string) => {
        if (k === 'MFA_WEBAUTHN_RP_ID') return 'edu.test';
        if (k === 'MFA_WEBAUTHN_RP_NAME') return 'Bilgim Test';
        if (k === 'MFA_WEBAUTHN_ORIGIN') return 'https://edu.test';
        if (k === 'MFA_CHALLENGE_TTL_SEC') return 300;
        return undefined;
      }),
      getOrThrow: jest.fn(),
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

    encryption = new MfaEncryption(configService);

    service = new MfaService(
      prisma,
      { generateRandomToken: jest.fn(), hashToken: jest.fn() } as any,
      usersRepo as any,
      jwtService,
      configService,
      encryption,
    );
  });

  describe('generateWebAuthnRegistrationOptions', () => {
    it('returns the options produced by SimpleWebAuthn and stashes the challenge', async () => {
      const options = {
        challenge: 'challenge-base64',
        rp: { id: 'edu.test', name: 'Bilgim Test' },
      };
      (generateRegistrationOptions as jest.Mock).mockResolvedValue(options);

      const result = await service.generateWebAuthnRegistrationOptions('user-1');

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'edu.test',
          rpName: 'Bilgim Test',
          userName: 'user-1@edu.test',
          attestationType: 'none',
        }),
      );
      expect(result).toEqual(options);
    });

    it('refuses if the user does not exist', async () => {
      usersRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.generateWebAuthnRegistrationOptions('ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('finishWebAuthnRegistration', () => {
    it('persists credentialId / publicKey (encrypted) / counter on success', async () => {
      const options = { challenge: 'reg-challenge' };
      (generateRegistrationOptions as jest.Mock).mockResolvedValue(options);
      (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'webauthn-cred-1',
            publicKey: Buffer.from('pubkey-bytes'),
            counter: 0,
          },
          aaguid: 'aaguid-uuid',
          fmt: 'none',
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      });

      // First trigger a challenge so the consume() sees it.
      await service.generateWebAuthnRegistrationOptions('user-2');

      const fakeResponse: any = {
        id: 'webauthn-cred-1',
        rawId: 'webauthn-cred-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'cdj',
          attestationObject: 'ao',
          transports: ['usb'],
        },
      };

      const result = await service.finishWebAuthnRegistration(
        'user-2',
        fakeResponse,
        'YubiKey 5C',
      );

      expect(result.credentialId).toBeDefined();
      expect(verifyRegistrationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          response: fakeResponse,
          expectedChallenge: 'reg-challenge',
          expectedRPID: 'edu.test',
        }),
      );

      const persisted = prisma._credentials[0];
      expect(persisted.type).toBe('WEBAUTHN');
      expect(persisted.label).toBe('YubiKey 5C');
      expect(persisted.credentialId).toBe('webauthn-cred-1');
      expect(persisted.counter).toBe(0n);
      // Encrypted blob stored, not raw bytes.
      expect(persisted.secret).not.toBe('pubkey-bytes');
      expect(encryption.decrypt(persisted.secret)).toBe(
        Buffer.from('pubkey-bytes').toString('base64'),
      );
      expect(persisted.verifiedAt).toBeInstanceOf(Date);
    });

    it('rejects when the challenge cache is empty', async () => {
      await expect(
        service.finishWebAuthnRegistration('user-3', {} as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('surfaces a 400 if SimpleWebAuthn throws', async () => {
      (generateRegistrationOptions as jest.Mock).mockResolvedValue({
        challenge: 'reg-challenge',
      });
      (verifyRegistrationResponse as jest.Mock).mockRejectedValue(
        new Error('bad attestation'),
      );

      await service.generateWebAuthnRegistrationOptions('user-4');

      await expect(
        service.finishWebAuthnRegistration('user-4', {
          id: 'x',
          rawId: 'x',
          type: 'public-key',
          response: { clientDataJSON: 'a', attestationObject: 'b' },
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('generateWebAuthnAuthenticationOptions', () => {
    it('returns options when a verified credential exists', async () => {
      // Seed a verified credential.
      prisma._credentials.push({
        id: 'cred-x',
        userId: 'user-5',
        type: 'WEBAUTHN',
        label: 'Key',
        secret: encryption.encrypt(
          Buffer.from('pubkey-bytes').toString('base64'),
        ),
        counter: 0n,
        credentialId: 'webauthn-id',
        deviceInfo: { transports: ['usb'] },
        verifiedAt: new Date(),
        lastUsedAt: null,
        createdAt: new Date(),
      });

      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'auth-challenge',
      });

      const result = await service.generateWebAuthnAuthenticationOptions(
        'user-5',
      );
      expect(result).toEqual({ challenge: 'auth-challenge' });
    });

    it('returns 404 when nothing is enrolled', async () => {
      await expect(
        service.generateWebAuthnAuthenticationOptions('user-6'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('finishWebAuthnAuthentication', () => {
    it('updates counter + lastUsedAt on success', async () => {
      const credentialRow: FakeRow = {
        id: 'cred-y',
        userId: 'user-7',
        type: 'WEBAUTHN',
        label: 'Key',
        secret: encryption.encrypt(
          Buffer.from('pubkey-bytes').toString('base64'),
        ),
        counter: 1n,
        credentialId: 'webauthn-id-7',
        deviceInfo: { transports: ['usb'] },
        verifiedAt: new Date(),
        lastUsedAt: null,
        createdAt: new Date(),
      };
      prisma._credentials.push(credentialRow);

      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'auth-challenge',
      });
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 7 },
      });

      await service.generateWebAuthnAuthenticationOptions('user-7');

      const result = await service.finishWebAuthnAuthentication('user-7', {
        id: 'webauthn-id-7',
        rawId: 'webauthn-id-7',
        type: 'public-key',
        response: {
          clientDataJSON: 'a',
          authenticatorData: 'b',
          signature: 'c',
        },
      } as any);

      expect(result.credentialId).toBe('cred-y');
      expect(credentialRow.counter).toBe(7n);
      expect(credentialRow.lastUsedAt).toBeInstanceOf(Date);
    });

    it('rejects an unknown credential id with 401', async () => {
      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'auth-challenge',
      });
      // Seed a registered credential so the options call passes.
      prisma._credentials.push({
        id: 'cred-z',
        userId: 'user-8',
        type: 'WEBAUTHN',
        label: 'Key',
        secret: encryption.encrypt(
          Buffer.from('pubkey-bytes').toString('base64'),
        ),
        counter: 0n,
        credentialId: 'real-id',
        deviceInfo: {},
        verifiedAt: new Date(),
        lastUsedAt: null,
        createdAt: new Date(),
      });

      await service.generateWebAuthnAuthenticationOptions('user-8');

      await expect(
        service.finishWebAuthnAuthentication('user-8', {
          id: 'wrong-id',
          rawId: 'wrong-id',
          type: 'public-key',
          response: {
            clientDataJSON: 'a',
            authenticatorData: 'b',
            signature: 'c',
          },
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when verifyAuthenticationResponse returns verified: false', async () => {
      prisma._credentials.push({
        id: 'cred-w',
        userId: 'user-9',
        type: 'WEBAUTHN',
        label: 'Key',
        secret: encryption.encrypt(
          Buffer.from('pubkey-bytes').toString('base64'),
        ),
        counter: 0n,
        credentialId: 'cred-id-9',
        deviceInfo: {},
        verifiedAt: new Date(),
        lastUsedAt: null,
        createdAt: new Date(),
      });
      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'auth-challenge',
      });
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: false,
      });

      await service.generateWebAuthnAuthenticationOptions('user-9');

      await expect(
        service.finishWebAuthnAuthentication('user-9', {
          id: 'cred-id-9',
          rawId: 'cred-id-9',
          type: 'public-key',
          response: {
            clientDataJSON: 'a',
            authenticatorData: 'b',
            signature: 'c',
          },
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('verifyMfaChallenge — WebAuthn path', () => {
    it('completes MFA when a valid assertion is provided', async () => {
      prisma._credentials.push({
        id: 'cred-wa',
        userId: 'user-10',
        type: 'WEBAUTHN',
        label: 'Key',
        secret: encryption.encrypt(
          Buffer.from('pubkey-bytes').toString('base64'),
        ),
        counter: 0n,
        credentialId: 'cred-id-10',
        deviceInfo: {},
        verifiedAt: new Date(),
        lastUsedAt: null,
        createdAt: new Date(),
      });
      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'auth-challenge',
      });
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-10',
        scope: 'mfa-challenge',
      });

      await service.generateWebAuthnAuthenticationOptions('user-10');

      const result = await service.verifyMfaChallenge({
        mfaToken: 'jwt',
        webauthn: {
          response: {
            id: 'cred-id-10',
            rawId: 'cred-id-10',
            type: 'public-key',
            response: {
              clientDataJSON: 'a',
              authenticatorData: 'b',
              signature: 'c',
            },
          } as any,
        },
      });

      expect(result).toEqual({ userId: 'user-10', method: 'webauthn' });
    });
  });
});
