import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import fc from 'fast-check';

import { SecurityMfaService, MfaRolePolicy } from './mfa.service';
import { SecurityTotpService } from './totp.service';
import { SecurityWebAuthnService } from './webauthn.service';

/**
 * Unit tests for `SecurityMfaService` — the security-module-scoped
 * MFA orchestrator (Task 29.1).
 *
 * Tests cover:
 *   - Role-based policy resolution (ADMIN, TEACHER, STUDENT)
 *   - Delegation to core MfaService for enforcement
 *   - Credential revocation guards for TEACHER role
 *   - Backup codes generation delegation
 */

function buildCoreMfaServiceMock() {
  return {
    assertRoleEnforcement: jest.fn(),
    hasVerifiedCredential: jest.fn(),
    generateBackupCodes: jest.fn(),
    listCredentials: jest.fn(),
    revokeCredential: jest.fn(),
    issueMfaToken: jest.fn(),
    verifyMfaChallenge: jest.fn(),
  };
}

describe('SecurityMfaService', () => {
  let service: SecurityMfaService;
  let coreMfa: ReturnType<typeof buildCoreMfaServiceMock>;
  let totpService: SecurityTotpService;
  let webauthnService: SecurityWebAuthnService;

  beforeEach(() => {
    coreMfa = buildCoreMfaServiceMock();
    totpService = {} as any;
    webauthnService = {} as any;

    service = new SecurityMfaService(
      coreMfa as any,
      totpService,
      webauthnService,
    );
  });

  describe('getRolePolicy', () => {
    it('Property 23: returns a valid policy for any known UserRole', () => {
      const allRoles = Object.values(UserRole);
      fc.assert(
        fc.property(fc.constantFrom(...allRoles), (role) => {
          const policy = service.getRolePolicy(role);
          expect(policy).toHaveProperty('totpRequired');
          expect(policy).toHaveProperty('webauthnRequired');
          expect(policy).toHaveProperty('mfaOptional');
          expect(policy).toHaveProperty('smsFallbackAvailable');

          // Business logic constraint: cannot be both optional and required
          if (!policy.mfaOptional) {
            expect(policy.totpRequired || policy.webauthnRequired).toBe(true);
          }
        }),
      );
    });

    it('ADMIN requires both TOTP and WebAuthn, no SMS fallback', () => {
      const policy = service.getRolePolicy(UserRole.ADMIN);
      expect(policy).toEqual<MfaRolePolicy>({
        totpRequired: true,
        webauthnRequired: true,
        mfaOptional: false,
        smsFallbackAvailable: false,
      });
    });

    it('TEACHER requires TOTP, SMS fallback available, WebAuthn optional', () => {
      const policy = service.getRolePolicy(UserRole.TEACHER);
      expect(policy).toEqual<MfaRolePolicy>({
        totpRequired: true,
        webauthnRequired: false,
        mfaOptional: false,
        smsFallbackAvailable: true,
      });
    });

    it('STUDENT has MFA optional, nothing required', () => {
      const policy = service.getRolePolicy(UserRole.STUDENT);
      expect(policy).toEqual<MfaRolePolicy>({
        totpRequired: false,
        webauthnRequired: false,
        mfaOptional: true,
        smsFallbackAvailable: false,
      });
    });
  });

  describe('assertRoleEnforcement', () => {
    it('delegates to core MfaService', async () => {
      coreMfa.assertRoleEnforcement.mockResolvedValue(undefined);
      await service.assertRoleEnforcement(UserRole.ADMIN, 'user-1');
      expect(coreMfa.assertRoleEnforcement).toHaveBeenCalledWith(
        UserRole.ADMIN,
        'user-1',
      );
    });

    it('propagates ForbiddenException from core', async () => {
      coreMfa.assertRoleEnforcement.mockRejectedValue(
        new ForbiddenException({
          code: 'MFA_REQUIRED_FOR_ROLE',
          message: 'test',
        }),
      );
      await expect(
        service.assertRoleEnforcement(UserRole.TEACHER, 'user-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('revokeCredential', () => {
    it('allows STUDENT to revoke any credential', async () => {
      coreMfa.revokeCredential.mockResolvedValue({ revoked: true });
      const result = await service.revokeCredential(
        'user-1',
        'cred-1',
        UserRole.STUDENT,
      );
      expect(result).toEqual({ revoked: true });
    });

    it('blocks TEACHER from revoking their last credential', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'TOTP', verifiedAt: new Date() },
      ]);
      await expect(
        service.revokeCredential('user-2', 'cred-1', UserRole.TEACHER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows TEACHER to revoke if they have multiple credentials', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'TOTP', verifiedAt: new Date() },
        { id: 'cred-2', type: 'TOTP', verifiedAt: new Date() },
      ]);
      coreMfa.revokeCredential.mockResolvedValue({ revoked: true });
      const result = await service.revokeCredential(
        'user-3',
        'cred-1',
        UserRole.TEACHER,
      );
      expect(result).toEqual({ revoked: true });
    });
  });

  describe('generateBackupCodes', () => {
    it('delegates to core MfaService', async () => {
      const codes = { codes: ['abc-def', 'ghi-jkl'], remaining: 2 };
      coreMfa.generateBackupCodes.mockResolvedValue(codes);
      const result = await service.generateBackupCodes('user-1');
      expect(result).toEqual(codes);
      expect(coreMfa.generateBackupCodes).toHaveBeenCalledWith('user-1');
    });
  });

  describe('issueMfaToken', () => {
    it('delegates to core MfaService', async () => {
      const tokenResult = {
        mfaToken: 'jwt',
        expiresIn: 300,
        methods: ['totp'],
      };
      coreMfa.issueMfaToken.mockResolvedValue(tokenResult);
      const result = await service.issueMfaToken('user-1', {
        ip: '1.2.3.4',
        ua: 'test',
      });
      expect(result).toEqual(tokenResult);
    });
  });

  describe('verifyMfaChallenge', () => {
    it('delegates to core MfaService', async () => {
      coreMfa.verifyMfaChallenge.mockResolvedValue({
        userId: 'user-1',
        method: 'totp',
      });
      const result = await service.verifyMfaChallenge({
        mfaToken: 'jwt',
        code: '123456',
      });
      expect(result).toEqual({ userId: 'user-1', method: 'totp' });
    });
  });

  describe('convenience accessors', () => {
    it('exposes totp sub-service', () => {
      expect(service.totp).toBe(totpService);
    });

    it('exposes webauthn sub-service', () => {
      expect(service.webauthn).toBe(webauthnService);
    });
  });
});
