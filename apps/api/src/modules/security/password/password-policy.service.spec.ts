import { PasswordPolicyService, PasswordComplexitySchema } from './password-policy.service';
import { HibpService } from './hibp.service';
import fc from 'fast-check';

/**
 * Unit tests for `PasswordPolicyService` (Task 29.3, Req 29.5).
 *
 * Covers:
 *   - Minimum 12 characters enforcement
 *   - Uppercase letter requirement
 *   - Lowercase letter requirement
 *   - Digit requirement
 *   - Special character requirement
 *   - Common password rejection
 *   - HIBP breach check integration (mocked)
 *   - Fail-open when HIBP is unreachable
 *   - Password strength scoring
 */

function createMockHibpService(breachCount = 0, shouldThrow = false) {
  return {
    getBreachCount: jest.fn(async () => {
      if (shouldThrow) throw new Error('HIBP unreachable');
      return breachCount;
    }),
  } as unknown as HibpService;
}

describe('PasswordPolicyService', () => {
  describe('validate — complexity rules', () => {
    it('Property 25: identifies complex passwords matching policy', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);
      
      // Helper to ensure password has at least one from each required class
      const validPassArb = fc.string({ minLength: 12 })
        .filter(p => /[A-Z]/.test(p))
        .filter(p => /[a-z]/.test(p))
        .filter(p => /[0-9]/.test(p))
        .filter(p => /[!@#$%^&*(),.?":{}|<>]/.test(p));

      await fc.assert(
        fc.asyncProperty(validPassArb, async (pass) => {
          const result = await service.validate(pass);
          // Note: some random strings might still hit the "too common" list,
          // but complexity should pass.
          if (result.valid === false) {
             expect(result.errors[0]).toMatch(/too common|data breach/);
          }
          expect(result.errors).not.toContain('Password must be at least 12 characters long');
          expect(result.errors).not.toContain('Password must contain at least one uppercase letter');
          expect(result.errors).not.toContain('Password must contain at least one lowercase letter');
          expect(result.errors).not.toContain('Password must contain at least one digit');
          expect(result.errors).not.toContain('Password must contain at least one special character');
        }),
      );
    });

    it('accepts a valid password meeting all criteria', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('SecurePass1!xy');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects password shorter than 12 characters', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('Short1!A');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must be at least 12 characters long',
      );
    });

    it('rejects password without uppercase letter', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('nouppercase1!x');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter',
      );
    });

    it('rejects password without lowercase letter', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('NOLOWERCASE1!X');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one lowercase letter',
      );
    });

    it('rejects password without digit', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('NoDigitHere!xx');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one digit',
      );
    });

    it('rejects password without special character', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('NoSpecial1234A');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one special character',
      );
    });

    it('returns multiple errors for password violating several rules', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('short');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('validate — common password rejection', () => {
    it('rejects known common passwords', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('Password1234!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'This password is too common and cannot be used',
      );
    });
  });

  describe('validate — HIBP breach check', () => {
    it('rejects password found in breaches', async () => {
      const hibp = createMockHibpService(42);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('ValidPass123!x');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('data breach');
      expect(hibp.getBreachCount).toHaveBeenCalledWith('ValidPass123!x');
    });

    it('accepts password not found in breaches', async () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('UniquePass99!z');
      expect(result.valid).toBe(true);
    });

    it('skips HIBP check when skipHibp option is true', async () => {
      const hibp = createMockHibpService(100);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('ValidPass123!x', {
        skipHibp: true,
      });
      expect(result.valid).toBe(true);
      expect(hibp.getBreachCount).not.toHaveBeenCalled();
    });

    it('fails open when HIBP service throws', async () => {
      const hibp = createMockHibpService(0, true);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('ValidPass123!x');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('skips HIBP check when complexity fails', async () => {
      const hibp = createMockHibpService(100);
      const service = new PasswordPolicyService(hibp);

      const result = await service.validate('short');
      expect(result.valid).toBe(false);
      // HIBP should not be called if complexity already failed
      expect(hibp.getBreachCount).not.toHaveBeenCalled();
    });
  });

  describe('validateComplexity — synchronous check', () => {
    it('returns valid for a compliant password', () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = service.validateComplexity('GoodPass123!x');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors for non-compliant password', () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const result = service.validateComplexity('weak');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('calculateStrength', () => {
    it('returns 0 for empty password', () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      expect(service.calculateStrength('')).toBe(0);
    });

    it('returns higher score for complex passwords', () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const weak = service.calculateStrength('aaa');
      const strong = service.calculateStrength('MyStr0ng!Pass99');

      expect(strong).toBeGreaterThan(weak);
    });

    it('score is capped at 100', () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const score = service.calculateStrength(
        'VeryLongAndC0mplex!Password#2024xyz',
      );
      expect(score).toBeLessThanOrEqual(100);
    });

    it('penalizes repeated characters', () => {
      const hibp = createMockHibpService(0);
      const service = new PasswordPolicyService(hibp);

      const varied = service.calculateStrength('Abcdefgh1!xy');
      const repeated = service.calculateStrength('Aaaaaaaaa1!x');

      expect(varied).toBeGreaterThan(repeated);
    });
  });

  describe('PasswordComplexitySchema — zod schema', () => {
    it('parses valid password', () => {
      const result = PasswordComplexitySchema.safeParse('ValidPass1!xy');
      expect(result.success).toBe(true);
    });

    it('fails for empty string', () => {
      const result = PasswordComplexitySchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('accepts exactly 12 characters meeting all rules', () => {
      const result = PasswordComplexitySchema.safeParse('Abcdefgh1!xy');
      expect(result.success).toBe(true);
    });
  });
});
