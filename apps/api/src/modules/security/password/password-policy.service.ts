import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { HibpService } from './hibp.service';

/**
 * Password complexity validation result.
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Zod schema for password complexity rules (Requirement 29.5):
 *  - Minimum 12 characters
 *  - At least one uppercase letter
 *  - At least one lowercase letter
 *  - At least one digit
 *  - At least one special character
 */
export const PasswordComplexitySchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(
    /[^A-Za-z0-9]/,
    'Password must contain at least one special character',
  );

/**
 * Common passwords that should always be rejected regardless of complexity.
 * This is a minimal set — the HIBP check covers the broader case.
 */
const COMMON_PASSWORDS = new Set([
  'password1234!A',
  'Password1234!',
  'Qwerty123456!',
  'Admin12345678!',
]);

/**
 * PasswordPolicyService — enforces password complexity rules and
 * checks against the HaveIBeenPwned breached passwords database.
 *
 * Task 29.3, Requirements 29.5, 29.6, 29.8.
 *
 * Validation pipeline:
 *   1. Zod schema complexity check (length, uppercase, lowercase, digit, special)
 *   2. Common password rejection
 *   3. HaveIBeenPwned k-anonymity API check (optional, fail-open)
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);

  /** Maximum number of times a password can appear in breaches before rejection. */
  static readonly HIBP_THRESHOLD = 0;

  constructor(private readonly hibpService: HibpService) {}

  /**
   * Validate password against all policy rules.
   *
   * @param password - The plaintext password to validate
   * @param opts.skipHibp - Skip the HIBP check (useful for tests or offline mode)
   * @returns Validation result with errors array
   */
  async validate(
    password: string,
    opts: { skipHibp?: boolean } = {},
  ): Promise<PasswordValidationResult> {
    const errors: string[] = [];

    // Step 1: Complexity rules via Zod
    const complexityResult = PasswordComplexitySchema.safeParse(password);
    if (!complexityResult.success) {
      for (const issue of complexityResult.error.issues) {
        errors.push(issue.message);
      }
    }

    // Step 2: Common password check
    if (COMMON_PASSWORDS.has(password)) {
      errors.push('This password is too common and cannot be used');
    }

    // Step 3: HaveIBeenPwned breach check (fail-open)
    if (!opts.skipHibp && errors.length === 0) {
      try {
        const breachCount = await this.hibpService.getBreachCount(password);
        if (breachCount > PasswordPolicyService.HIBP_THRESHOLD) {
          errors.push(
            `This password has appeared in ${breachCount} data breach(es) and cannot be used`,
          );
        }
      } catch (err) {
        // Fail-open: if HIBP is unreachable, allow the password
        this.logger.warn(
          'HIBP check failed (fail-open), skipping breach validation',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Quick synchronous complexity-only check (no HIBP).
   * Useful for real-time UI feedback.
   */
  validateComplexity(password: string): PasswordValidationResult {
    const result = PasswordComplexitySchema.safeParse(password);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: result.error.issues.map((i) => i.message),
    };
  }

  /**
   * Calculate password strength score (0-100).
   * Used for UI strength meter feedback.
   */
  calculateStrength(password: string): number {
    let score = 0;

    // Length scoring (up to 30 points)
    score += Math.min(password.length * 2, 30);

    // Character variety (up to 40 points)
    if (/[a-z]/.test(password)) score += 10;
    if (/[A-Z]/.test(password)) score += 10;
    if (/[0-9]/.test(password)) score += 10;
    if (/[^A-Za-z0-9]/.test(password)) score += 10;

    // Bonus for length beyond minimum (up to 20 points)
    if (password.length > 12) {
      score += Math.min((password.length - 12) * 2, 20);
    }

    // Penalty for repeated characters
    const repeats = password.length - new Set(password).size;
    score -= Math.min(repeats * 2, 10);

    return Math.max(0, Math.min(100, score));
  }
}
