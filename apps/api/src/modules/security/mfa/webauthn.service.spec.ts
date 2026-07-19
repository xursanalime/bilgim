import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { SecurityWebAuthnService } from './webauthn.service';

/**
 * Unit tests for `SecurityWebAuthnService` — security-module-scoped
 * WebAuthn/FIDO2 orchestration (Task 29.1).
 *
 * Tests cover:
 *   - Role-based WebAuthn requirement check (Req 29.7)
 *   - Admin WebAuthn enrollment assertion
 *   - Admin credential revocation guard
 *   - Delegation to core MfaService for registration/authentication
 */

function buildCoreMfaServiceMock() {
  return {
    generateWebAuthnRegistrationOptions: jest.fn(),
    finishWebAuthnRegistration: jest.fn(),
    generateWebAuthnAuthenticationOptions: jest.fn(),
    finishWebAuthnAuthentication: jest.fn(),
    listCredentials: jest.fn(),
    revokeCredential: jest.fn(),
  };
}

describe('SecurityWebAuthnService', () => {
  let service: SecurityWebAuthnService;
  let coreMfa: ReturnType<typeof buildCoreMfaServiceMock>;

  beforeEach(() => {
    coreMfa = buildCoreMfaServiceMock();
    service = new SecurityWebAuthnService(coreMfa as any);
  });

  describe('isWebAuthnRequired', () => {
    it('returns true for ADMIN (Req 29.7)', () => {
      expect(service.isWebAuthnRequired(UserRole.ADMIN)).toBe(true);
    });

    it('returns false for TEACHER', () => {
      expect(service.isWebAuthnRequired(UserRole.TEACHER)).toBe(false);
    });

    it('returns false for STUDENT', () => {
      expect(service.isWebAuthnRequired(UserRole.STUDENT)).toBe(false);
    });
  });

  describe('assertAdminWebAuthnEnrollment', () => {
    it('passes when admin has a verified WebAuthn credential', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'WEBAUTHN', verifiedAt: new Date() },
      ]);
      await expect(
        service.assertAdminWebAuthnEnrollment('admin-1'),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when admin has no WebAuthn credential', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'TOTP', verifiedAt: new Date() },
      ]);
      await expect(
        service.assertAdminWebAuthnEnrollment('admin-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws when admin has only unverified WebAuthn credential', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'WEBAUTHN', verifiedAt: null },
      ]);
      await expect(
        service.assertAdminWebAuthnEnrollment('admin-3'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('includes requiresHardwareKey: true in error details', async () => {
      coreMfa.listCredentials.mockResolvedValue([]);
      try {
        await service.assertAdminWebAuthnEnrollment('admin-4');
        fail('expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const response = (err as ForbiddenException).getResponse() as any;
        expect(response.code).toBe('MFA_REQUIRED_FOR_ROLE');
        expect(response.details.requiresHardwareKey).toBe(true);
      }
    });
  });

  describe('assertCanRevokeWebAuthn', () => {
    it('allows revocation when admin has multiple WebAuthn credentials', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'WEBAUTHN', verifiedAt: new Date() },
        { id: 'cred-2', type: 'WEBAUTHN', verifiedAt: new Date() },
      ]);
      await expect(
        service.assertCanRevokeWebAuthn('admin-1', 'cred-1'),
      ).resolves.toBeUndefined();
    });

    it('blocks revocation of the last WebAuthn credential', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'WEBAUTHN', verifiedAt: new Date() },
        { id: 'cred-2', type: 'TOTP', verifiedAt: new Date() },
      ]);
      await expect(
        service.assertCanRevokeWebAuthn('admin-2', 'cred-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows revocation of non-WebAuthn credential even if only one WebAuthn exists', async () => {
      coreMfa.listCredentials.mockResolvedValue([
        { id: 'cred-1', type: 'WEBAUTHN', verifiedAt: new Date() },
        { id: 'cred-2', type: 'TOTP', verifiedAt: new Date() },
      ]);
      // Revoking cred-2 (TOTP) should be fine
      await expect(
        service.assertCanRevokeWebAuthn('admin-3', 'cred-2'),
      ).resolves.toBeUndefined();
    });
  });

  describe('generateRegistrationOptions', () => {
    it('delegates to core MfaService', async () => {
      const options = { challenge: 'test-challenge', rp: { id: 'test' } };
      coreMfa.generateWebAuthnRegistrationOptions.mockResolvedValue(options);
      const result = await service.generateRegistrationOptions('user-1');
      expect(result).toEqual(options);
      expect(
        coreMfa.generateWebAuthnRegistrationOptions,
      ).toHaveBeenCalledWith('user-1');
    });
  });

  describe('finishRegistration', () => {
    it('delegates to core MfaService', async () => {
      coreMfa.finishWebAuthnRegistration.mockResolvedValue({
        credentialId: 'cred-new',
      });
      const result = await service.finishRegistration(
        'user-1',
        { id: 'x' } as any,
        'YubiKey',
      );
      expect(result).toEqual({ credentialId: 'cred-new' });
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('delegates to core MfaService', async () => {
      const options = { challenge: 'auth-challenge' };
      coreMfa.generateWebAuthnAuthenticationOptions.mockResolvedValue(options);
      const result = await service.generateAuthenticationOptions('user-1');
      expect(result).toEqual(options);
    });
  });

  describe('finishAuthentication', () => {
    it('delegates to core MfaService', async () => {
      coreMfa.finishWebAuthnAuthentication.mockResolvedValue({
        credentialId: 'cred-1',
      });
      const result = await service.finishAuthentication('user-1', {
        id: 'cred-1',
      } as any);
      expect(result).toEqual({ credentialId: 'cred-1' });
    });
  });
});
