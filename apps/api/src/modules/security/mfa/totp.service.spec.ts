import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

import { SecurityTotpService, SmsFallbackProvider } from './totp.service';

/**
 * Unit tests for `SecurityTotpService` — security-module-scoped TOTP
 * orchestration with SMS fallback (Task 29.1).
 *
 * Tests cover:
 *   - Role-based TOTP requirement check
 *   - TOTP disable guard for ADMIN/TEACHER
 *   - SMS fallback: Teacher-only access, phone validation, provider dispatch
 *   - SMS fallback: graceful handling when no provider configured
 */

function buildCoreMfaServiceMock() {
  return {
    setupTotp: jest.fn(),
    verifyTotpEnrollment: jest.fn(),
    disableTotp: jest.fn(),
  };
}

describe('SecurityTotpService', () => {
  let service: SecurityTotpService;
  let coreMfa: ReturnType<typeof buildCoreMfaServiceMock>;
  let configService: ConfigService;

  beforeEach(() => {
    coreMfa = buildCoreMfaServiceMock();
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as any;

    service = new SecurityTotpService(coreMfa as any, configService);
  });

  describe('isTotpRequired', () => {
    it('returns true for ADMIN', () => {
      expect(service.isTotpRequired(UserRole.ADMIN)).toBe(true);
    });

    it('returns true for TEACHER', () => {
      expect(service.isTotpRequired(UserRole.TEACHER)).toBe(true);
    });

    it('returns false for STUDENT', () => {
      expect(service.isTotpRequired(UserRole.STUDENT)).toBe(false);
    });
  });

  describe('setupTotp', () => {
    it('delegates to core MfaService', async () => {
      const result = {
        credentialId: 'cred-1',
        secret: 'SECRET',
        otpauthUrl: 'otpauth://totp/...',
        qrDataUrl: 'data:image/png;base64,...',
      };
      coreMfa.setupTotp.mockResolvedValue(result);
      const actual = await service.setupTotp('user-1', 'My Phone');
      expect(actual).toEqual(result);
      expect(coreMfa.setupTotp).toHaveBeenCalledWith('user-1', 'My Phone');
    });
  });

  describe('disableTotp', () => {
    it('blocks ADMIN from disabling TOTP', async () => {
      await expect(
        service.disableTotp('user-1', UserRole.ADMIN, 'pass', '123456'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks TEACHER from disabling TOTP', async () => {
      await expect(
        service.disableTotp('user-2', UserRole.TEACHER, 'pass', '123456'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows STUDENT to disable TOTP', async () => {
      coreMfa.disableTotp.mockResolvedValue({ disabled: true });
      const result = await service.disableTotp(
        'user-3',
        UserRole.STUDENT,
        'pass',
        '123456',
      );
      expect(result).toEqual({ disabled: true });
      expect(coreMfa.disableTotp).toHaveBeenCalledWith(
        'user-3',
        'pass',
        '123456',
      );
    });
  });

  describe('sendSmsFallbackCode', () => {
    it('only allows TEACHER role', async () => {
      await expect(
        service.sendSmsFallbackCode('user-1', UserRole.ADMIN, '+998901234567'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        service.sendSmsFallbackCode(
          'user-2',
          UserRole.STUDENT,
          '+998901234567',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires a valid phone number', async () => {
      await expect(
        service.sendSmsFallbackCode('user-1', UserRole.TEACHER, ''),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.sendSmsFallbackCode('user-1', UserRole.TEACHER, '123'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dispatches code via SMS provider when configured', async () => {
      const provider: SmsFallbackProvider = {
        sendCode: jest.fn().mockResolvedValue(true),
      };
      const result = await service.sendSmsFallbackCode(
        'user-1',
        UserRole.TEACHER,
        '+998901234567',
        provider,
      );
      expect(result.sent).toBe(true);
      expect(result.maskedPhone).toContain('67');
      expect(result.expiresInSec).toBe(300);
      expect(provider.sendCode).toHaveBeenCalledWith(
        '+998901234567',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('returns sent=false when provider dispatch fails', async () => {
      const provider: SmsFallbackProvider = {
        sendCode: jest.fn().mockRejectedValue(new Error('gateway error')),
      };
      const result = await service.sendSmsFallbackCode(
        'user-1',
        UserRole.TEACHER,
        '+998901234567',
        provider,
      );
      expect(result.sent).toBe(false);
      expect(result.maskedPhone).toBeDefined();
    });

    it('returns sent=false when no provider is configured', async () => {
      const result = await service.sendSmsFallbackCode(
        'user-1',
        UserRole.TEACHER,
        '+998901234567',
      );
      expect(result.sent).toBe(false);
      expect(result.expiresInSec).toBe(300);
    });

    it('masks phone number correctly', async () => {
      const provider: SmsFallbackProvider = {
        sendCode: jest.fn().mockResolvedValue(true),
      };
      const result = await service.sendSmsFallbackCode(
        'user-1',
        UserRole.TEACHER,
        '+998901234567',
        provider,
      );
      // Should show prefix and last 2 digits
      expect(result.maskedPhone).toMatch(/^\+998.*67$/);
    });
  });
});
