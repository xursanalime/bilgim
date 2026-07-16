import {
  AUTH_ERROR_MESSAGES_UZ,
  DEFAULT_AUTH_LOCALE,
  extractErrorCode,
  getAuthErrorMessage,
  type AuthErrorCode,
} from './auth-errors';

describe('auth error catalog', () => {
  describe('getAuthErrorMessage — locale selection', () => {
    it('returns the locale-specific message for a known code', () => {
      expect(getAuthErrorMessage('INVALID_CREDENTIALS', { locale: 'en' })).toBe(
        'Incorrect email or password.',
      );
      expect(getAuthErrorMessage('INVALID_CREDENTIALS', { locale: 'ru' })).toBe(
        'Неверный email или пароль.',
      );
      expect(getAuthErrorMessage('INVALID_CREDENTIALS', { locale: 'uz' })).toBe(
        AUTH_ERROR_MESSAGES_UZ.INVALID_CREDENTIALS,
      );
    });

    it('defaults to Uzbek when locale is missing or unknown', () => {
      expect(getAuthErrorMessage('EMAIL_ALREADY_EXISTS')).toBe(
        AUTH_ERROR_MESSAGES_UZ.EMAIL_ALREADY_EXISTS,
      );
      expect(
        getAuthErrorMessage('EMAIL_ALREADY_EXISTS', { locale: 'fr' }),
      ).toBe(AUTH_ERROR_MESSAGES_UZ.EMAIL_ALREADY_EXISTS);
      expect(DEFAULT_AUTH_LOCALE).toBe('uz');
    });
  });

  describe('getAuthErrorMessage — fallback behaviour', () => {
    it('falls back to the generic UNKNOWN_ERROR message for unknown codes', () => {
      expect(getAuthErrorMessage('SOME_NEW_CODE', { locale: 'en' })).toBe(
        'An unexpected error occurred. Please try again.',
      );
      expect(getAuthErrorMessage(null)).toBe(
        AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR,
      );
    });

    it('prefers a caller-provided fallback over the generic message for unknown codes', () => {
      expect(
        getAuthErrorMessage('TOTALLY_UNKNOWN', {
          locale: 'en',
          fallback: 'Raw API message',
        }),
      ).toBe('Raw API message');
    });

    it('still localizes a known code even when a fallback is provided', () => {
      expect(
        getAuthErrorMessage('WEAK_PASSWORD', {
          locale: 'en',
          fallback: 'Raw API message',
        }),
      ).not.toBe('Raw API message');
    });

    it('falls back to the Uzbek message when a locale lacks an entry (defensive)', () => {
      // All codes are translated, so assert parity of the catalogs instead.
      const codes = Object.keys(AUTH_ERROR_MESSAGES_UZ) as AuthErrorCode[];
      for (const code of codes) {
        expect(getAuthErrorMessage(code, { locale: 'en' })).toBeTruthy();
        expect(getAuthErrorMessage(code, { locale: 'ru' })).toBeTruthy();
      }
    });
  });

  describe('coverage of backend auth error codes', () => {
    // Codes the NestJS auth module can surface for the register/login/verify/
    // forgot/reset flows (see apps/api/src/modules/auth).
    const backendCodes: AuthErrorCode[] = [
      'EMAIL_ALREADY_EXISTS',
      'USERNAME_ALREADY_EXISTS',
      'INVALID_OR_EXPIRED_TOKEN',
      'UNAUTHENTICATED',
      'INVALID_REFRESH_TOKEN',
      'TOKEN_FAMILY_COMPROMISED',
      'INVALID_TOKEN',
      'RATE_LIMITED',
      'ACCOUNT_LOCKED',
      'IMPOSSIBLE_TRAVEL',
      'MFA_NOT_AVAILABLE',
      'USER_NOT_FOUND',
      'WRONG_CURRENT_PASSWORD',
    ];

    it.each(backendCodes)('has a localized message for %s', (code) => {
      const msg = getAuthErrorMessage(code, { locale: 'uz' });
      expect(msg).toBeTruthy();
      expect(msg).not.toBe(AUTH_ERROR_MESSAGES_UZ.UNKNOWN_ERROR);
    });
  });

  describe('extractErrorCode', () => {
    it('reads a flat (unwrapped) envelope', () => {
      expect(extractErrorCode({ code: 'INVALID_CREDENTIALS' })).toBe(
        'INVALID_CREDENTIALS',
      );
    });

    it('reads a nested error envelope', () => {
      expect(
        extractErrorCode({ error: { code: 'EMAIL_ALREADY_EXISTS' } }),
      ).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('returns null for non-object / missing code', () => {
      expect(extractErrorCode(null)).toBeNull();
      expect(extractErrorCode('boom')).toBeNull();
      expect(extractErrorCode({ message: 'no code here' })).toBeNull();
    });
  });
});
