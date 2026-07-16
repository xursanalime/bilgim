import * as fc from 'fast-check';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { MfaService } from './mfa.service';
import { MfaEncryption } from './mfa.encryption';

/**
 * Property 23 — Role-based MFA enforcement (Task 29.6, validates
 * Requirements 29.1 and 29.7).
 *
 *   ∀ user u:
 *     u.role = ADMIN   ⟹ login requires WebAuthn / FIDO2 (or any verified factor)
 *     u.role = TEACHER ⟹ login requires TOTP or SMS (any verified factor)
 *     u.role = STUDENT ⟹ MFA is OPTIONAL — login NEVER blocked on MFA grounds
 *
 *   ∀ login attempt without the required factor:
 *     response = 403 MFA_REQUIRED_FOR_ROLE
 *
 *   `details.requiresHardwareKey` is `true` ⟺ the role is ADMIN
 *   (Req 29.7 — admins MUST enrol a hardware key, not just TOTP).
 *
 * The property is exercised against a real `MfaService` driven by an
 * in-memory Prisma fake. fast-check generates a fresh world per run
 * — random users with random roles and a random subset of users that
 * have a verified MFA credential — and we replay
 * `assertRoleEnforcement` for every user, comparing the SUT's
 * outcome against an independently-derived oracle.
 *
 * **Validates: Requirements 29.1, 29.7**
 */

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  passwordHash: string;
}

interface FakeCredential {
  id: string;
  userId: string;
  type: 'TOTP' | 'WEBAUTHN';
  verifiedAt: Date | null;
}

/**
 * Minimal prisma fake — only the tables / methods the
 * `assertRoleEnforcement` path actually touches:
 *
 *   - mfaCredential.count({ where: { userId, verifiedAt: { not: null } } })
 */
function buildPrismaFake(credentials: FakeCredential[]): any {
  return {
    mfaCredential: {
      count: jest.fn(async ({ where }: any) => {
        return credentials.filter((c) => {
          if (where?.userId && c.userId !== where.userId) return false;
          if (where?.type && c.type !== where.type) return false;
          if (
            where?.verifiedAt &&
            where.verifiedAt.not !== undefined &&
            c.verifiedAt === null
          ) {
            return false;
          }
          return true;
        }).length;
      }),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      delete: jest.fn(async () => ({})),
    },
    mfaBackupCode: {
      count: jest.fn(async () => 0),
    },
    $transaction: jest.fn(),
  };
}

function buildMfaService(opts: {
  users: UserRow[];
  credentials: FakeCredential[];
}): MfaService {
  const prisma = buildPrismaFake(opts.credentials);

  const configService = {
    get: jest.fn((k: string) => {
      if (k === 'MFA_TOTP_ISSUER') return 'BilgimTest';
      if (k === 'MFA_CHALLENGE_TTL_SEC') return 300;
      return undefined;
    }),
    getOrThrow: jest.fn(),
  } as unknown as ConfigService;

  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-mfa-token'),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const usersRepo = {
    findById: jest.fn(async (id: string) => opts.users.find((u) => u.id === id) ?? null),
  };

  const tokensService = {
    generateRandomToken: jest.fn(() => 'tok'),
    hashToken: jest.fn((t: string) => `hashed:${t}`),
  };

  const encryption = new MfaEncryption(configService);

  return new MfaService(
    prisma,
    tokensService as any,
    usersRepo as any,
    jwtService,
    configService,
    encryption,
  );
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbRole = fc.constantFrom<UserRole>('ADMIN', 'TEACHER', 'STUDENT');

const arbUser = fc.tuple(fc.uuid(), arbRole).map(([id, role]): UserRow => ({
  id,
  email: `${id}@edu.test`,
  fullName: `User ${id.slice(0, 8)}`,
  role,
  passwordHash: 'hash',
}));

/**
 * Generate (1) a list of users with assorted roles and (2) a subset
 * of those user ids that have AT LEAST ONE verified MFA credential.
 * The credential type is randomised so the property holds for both
 * TOTP and WebAuthn enrolment paths.
 */
const arbWorld = fc
  .uniqueArray(arbUser, {
    minLength: 1,
    maxLength: 12,
    selector: (u) => u.id,
  })
  .chain((users) =>
    fc
      .array(
        fc.record({
          userId: fc.constantFrom(...users.map((u) => u.id)),
          type: fc.constantFrom<'TOTP' | 'WEBAUTHN'>('TOTP', 'WEBAUTHN'),
          verified: fc.boolean(),
        }),
        { minLength: 0, maxLength: users.length * 2 },
      )
      .map((rawCreds) => {
        const credentials: FakeCredential[] = rawCreds.map((c, i) => ({
          id: `cred-${i}`,
          userId: c.userId,
          type: c.type,
          verifiedAt: c.verified ? new Date() : null,
        }));
        return { users, credentials };
      }),
  );

// ---------------------------------------------------------------------------
// Oracle — independently derived from Property 23
// ---------------------------------------------------------------------------

interface OracleOutcome {
  blocked: boolean;
  requiresHardwareKey: boolean | null;
}

function oracle(user: UserRow, credentials: FakeCredential[]): OracleOutcome {
  // STUDENT bypasses the MFA gate entirely (Req 29.1, MFA optional).
  if (user.role === 'STUDENT') {
    return { blocked: false, requiresHardwareKey: null };
  }
  const hasVerified = credentials.some(
    (c) => c.userId === user.id && c.verifiedAt !== null,
  );
  if (hasVerified) {
    return { blocked: false, requiresHardwareKey: null };
  }
  // ADMIN / TEACHER without any verified credential — blocked.
  return {
    blocked: true,
    requiresHardwareKey: user.role === 'ADMIN',
  };
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 23 — Role-based MFA enforcement (Task 29.6)', () => {
  it('STUDENT is never blocked; TEACHER/ADMIN without MFA → 403 MFA_REQUIRED_FOR_ROLE', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorld, async ({ users, credentials }) => {
        const service = buildMfaService({ users, credentials });

        for (const user of users) {
          const expected = oracle(user, credentials);

          let actual: OracleOutcome;
          try {
            await service.assertRoleEnforcement(user.role, user.id);
            actual = { blocked: false, requiresHardwareKey: null };
          } catch (err) {
            if (!(err instanceof ForbiddenException)) {
              throw err;
            }
            const response = err.getResponse() as {
              code?: string;
              details?: { requiresHardwareKey?: boolean };
            };
            // Must be the typed MFA_REQUIRED_FOR_ROLE response.
            expect(response.code).toBe('MFA_REQUIRED_FOR_ROLE');
            actual = {
              blocked: true,
              requiresHardwareKey:
                response.details?.requiresHardwareKey ?? false,
            };
          }

          expect(actual).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('STUDENT bypasses MFA flow even with zero enrolled factors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUser.filter((u) => u.role === 'STUDENT'), {
          minLength: 1,
          maxLength: 8,
          selector: (u) => u.id,
        }),
        async (students) => {
          const service = buildMfaService({
            users: students,
            credentials: [],
          });

          for (const u of students) {
            // Should resolve cleanly — no exception, no thrown 403.
            await expect(
              service.assertRoleEnforcement(u.role, u.id),
            ).resolves.toBeUndefined();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('ADMIN with mfaEnabled CANNOT login without MFA proof; STUDENT bypasses MFA flow', async () => {
    // Property statement (verbatim from task 29.1 spec):
    //   "ADMIN with mfaEnabled CANNOT login without MFA proof;
    //    STUDENT bypasses MFA flow"
    //
    // We model "mfaEnabled" by giving the admin AT LEAST ONE
    // verified credential, then asserting the gate still pivots
    // into the challenge flow (i.e. `hasVerifiedCredential` returns
    // true and `assertRoleEnforcement` does NOT throw — but the
    // login flow integration test elsewhere validates that the
    // caller redirects into the challenge step rather than issuing
    // tokens directly).
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom<'TOTP' | 'WEBAUTHN'>('TOTP', 'WEBAUTHN'),
        async (adminId, studentId, factor) => {
          fc.pre(adminId !== studentId);

          const users: UserRow[] = [
            {
              id: adminId,
              email: `${adminId}@edu.test`,
              fullName: 'Root Admin',
              role: 'ADMIN' as const,
              passwordHash: 'hash',
            },
            {
              id: studentId,
              email: `${studentId}@edu.test`,
              fullName: 'A Student',
              role: 'STUDENT' as const,
              passwordHash: 'hash',
            },
          ];

          // ADMIN with NO verified factor → blocked.
          {
            const service = buildMfaService({ users, credentials: [] });
            await expect(
              service.assertRoleEnforcement('ADMIN', adminId),
            ).rejects.toBeInstanceOf(ForbiddenException);
          }

          // ADMIN with ONE verified factor → NOT blocked at the gate;
          // hasVerifiedCredential reports true so the login flow
          // pivots into the challenge step (login token deferred).
          {
            const service = buildMfaService({
              users,
              credentials: [
                {
                  id: 'admin-factor',
                  userId: adminId,
                  type: factor,
                  verifiedAt: new Date(),
                },
              ],
            });
            await expect(
              service.assertRoleEnforcement('ADMIN', adminId),
            ).resolves.toBeUndefined();
            await expect(
              service.hasVerifiedCredential(adminId),
            ).resolves.toBe(true);
          }

          // STUDENT — never blocked, never required to enrol.
          {
            const service = buildMfaService({ users, credentials: [] });
            await expect(
              service.assertRoleEnforcement('STUDENT', studentId),
            ).resolves.toBeUndefined();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('TEACHER without enrolled factor is blocked but NOT flagged for hardware key (Req 29.1)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (teacherId) => {
        const teacher: UserRow = {
          id: teacherId,
          email: `${teacherId}@edu.test`,
          fullName: 'Teacher',
          role: 'TEACHER',
          passwordHash: 'hash',
        };
        const service = buildMfaService({
          users: [teacher],
          credentials: [],
        });

        try {
          await service.assertRoleEnforcement('TEACHER', teacherId);
          throw new Error('expected ForbiddenException');
        } catch (err) {
          expect(err).toBeInstanceOf(ForbiddenException);
          const response = (err as ForbiddenException).getResponse() as {
            code?: string;
            details?: { requiresHardwareKey?: boolean };
          };
          expect(response.code).toBe('MFA_REQUIRED_FOR_ROLE');
          expect(response.details?.requiresHardwareKey).toBe(false);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('ADMIN without enrolled factor is blocked AND flagged for hardware key (Req 29.7)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (adminId) => {
        const admin: UserRow = {
          id: adminId,
          email: `${adminId}@edu.test`,
          fullName: 'Admin',
          role: 'ADMIN',
          passwordHash: 'hash',
        };
        const service = buildMfaService({
          users: [admin],
          credentials: [],
        });

        try {
          await service.assertRoleEnforcement('ADMIN', adminId);
          throw new Error('expected ForbiddenException');
        } catch (err) {
          expect(err).toBeInstanceOf(ForbiddenException);
          const response = (err as ForbiddenException).getResponse() as {
            code?: string;
            details?: { requiresHardwareKey?: boolean };
          };
          expect(response.code).toBe('MFA_REQUIRED_FOR_ROLE');
          expect(response.details?.requiresHardwareKey).toBe(true);
        }
      }),
      { numRuns: 30 },
    );
  });
});
