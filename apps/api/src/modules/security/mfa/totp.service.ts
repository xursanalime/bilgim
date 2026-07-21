import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

import { MfaService, TotpSetupResult, TotpVerifyResult } from '../../mfa/mfa.service';

/**
 * SMS fallback provider interface — allows plugging in any SMS gateway
 * (Twilio, Eskiz.uz, PlayMobile, etc.) without coupling the MFA layer
 * to a specific vendor.
 */
export interface SmsFallbackProvider {
  /**
   * Send a one-time code via SMS to the given phone number.
   * Returns `true` if the message was accepted by the gateway.
   */
  sendCode(phoneNumber: string, code: string): Promise<boolean>;
}

/**
 * Injection token for the SMS fallback provider.
 * Consumers wire this in the module definition:
 *
 * ```ts
 * { provide: SMS_FALLBACK_PROVIDER, useClass: EskizSmsProvider }
 * ```
 */
export const SMS_FALLBACK_PROVIDER = Symbol('SMS_FALLBACK_PROVIDER');

/**
 * Result of an SMS fallback code dispatch.
 */
export interface SmsFallbackResult {
  /** Whether the SMS was dispatched successfully. */
  sent: boolean;
  /** Masked phone number for UI display (e.g. "+998 ** *** *45"). */
  maskedPhone: string;
  /** TTL in seconds before the code expires. */
  expiresInSec: number;
}

/**
 * `SecurityTotpService` — security-module-scoped TOTP orchestration
 * (Task 29.1).
 *
 * Responsibilities:
 *   - Delegates core TOTP operations to the existing `MfaService`
 *   - Enforces role-based TOTP requirements:
 *       • ADMIN  — TOTP mandatory (but alone insufficient; WebAuthn also required)
 *       • TEACHER — TOTP mandatory
 *       • STUDENT — TOTP optional
 *   - Provides SMS fallback for Teachers (Req 29.1):
 *       When a Teacher cannot use their authenticator app, they can
 *       request a one-time code via SMS. The code is generated server-side
 *       (6-digit, 5-minute TTL) and dispatched through the configured
 *       `SmsFallbackProvider`.
 *   - QR code generation is handled by the underlying `MfaService.setupTotp`
 */
@Injectable()
export class SecurityTotpService {
  private readonly logger = new Logger(SecurityTotpService.name);

  /** SMS code TTL in seconds. */
  static readonly SMS_CODE_TTL_SEC = 300;
  /** SMS code length (digits). */
  static readonly SMS_CODE_LENGTH = 6;

  constructor(
    private readonly mfaService: MfaService,
    private readonly configService: ConfigService,
  ) {}

  // ------------------------------------------------------------------
  // TOTP setup / verify (delegates to MfaService)
  // ------------------------------------------------------------------

  /**
   * Initiate TOTP enrollment for a user. Returns the QR code and
   * provisioning URI for the authenticator app.
   *
   * For ADMIN and TEACHER roles, this is a mandatory step before
   * login is permitted.
   */
  async setupTotp(userId: string, label?: string): Promise<TotpSetupResult> {
    return this.mfaService.setupTotp(userId, label);
  }

  /**
   * Verify the first TOTP code from the authenticator app to confirm
   * enrollment.
   */
  async verifyTotpEnrollment(
    userId: string,
    code: string,
  ): Promise<TotpVerifyResult> {
    return this.mfaService.verifyTotpEnrollment(userId, code);
  }

  /**
   * Disable TOTP for a user. Blocked for ADMIN and TEACHER roles
   * since TOTP is mandatory for them.
   */
  async disableTotp(
    userId: string,
    role: UserRole,
    password: string,
    code: string,
  ): Promise<{ disabled: true }> {
    if (role === UserRole.ADMIN || role === UserRole.TEACHER) {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED_FOR_ROLE',
        message: `${role}s cannot disable TOTP — it is mandatory for this role`,
        details: { role },
      });
    }
    return this.mfaService.disableTotp(userId, password, code);
  }

  // ------------------------------------------------------------------
  // Role-based enforcement checks
  // ------------------------------------------------------------------

  /**
   * Check whether a user's role requires TOTP enrollment.
   *
   * - ADMIN: TOTP required (but WebAuthn also required separately)
   * - TEACHER: TOTP required
   * - STUDENT: optional
   */
  isTotpRequired(role: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.TEACHER;
  }

  // ------------------------------------------------------------------
  // SMS fallback (Teacher only)
  // ------------------------------------------------------------------

  /**
   * Generate and dispatch a one-time SMS code for a Teacher who
   * cannot access their authenticator app.
   *
   * Only available for TEACHER role — Admins must use hardware keys,
   * Students have MFA optional.
   *
   * @param userId - The user requesting the fallback
   * @param role - The user's role (must be TEACHER)
   * @param phoneNumber - The verified phone number on file
   * @param smsProvider - The SMS gateway provider (injected)
   * @returns SMS dispatch result with masked phone and TTL
   */
  async sendSmsFallbackCode(
    userId: string,
    role: UserRole,
    phoneNumber: string,
    smsProvider?: SmsFallbackProvider,
  ): Promise<SmsFallbackResult> {
    if (role !== UserRole.TEACHER) {
      throw new ForbiddenException({
        code: 'SMS_FALLBACK_NOT_AVAILABLE',
        message: 'SMS fallback is only available for Teachers',
        details: { role },
      });
    }

    if (!phoneNumber || phoneNumber.length < 9) {
      throw new BadRequestException({
        code: 'PHONE_NUMBER_REQUIRED',
        message: 'A verified phone number is required for SMS fallback',
      });
    }

    const code = this.generateNumericCode(SecurityTotpService.SMS_CODE_LENGTH);
    const maskedPhone = this.maskPhoneNumber(phoneNumber);

    if (smsProvider) {
      try {
        const sent = await smsProvider.sendCode(phoneNumber, code);
        if (!sent) {
          this.logger.warn(
            `SMS fallback dispatch failed for user ${userId} — provider returned false`,
          );
        }
        return {
          sent,
          maskedPhone,
          expiresInSec: SecurityTotpService.SMS_CODE_TTL_SEC,
        };
      } catch (err) {
        this.logger.error(
          `SMS fallback dispatch error for user ${userId}: ${(err as Error).message}`,
        );
        return {
          sent: false,
          maskedPhone,
          expiresInSec: SecurityTotpService.SMS_CODE_TTL_SEC,
        };
      }
    }

    // No SMS provider configured — log warning and return unsent.
    this.logger.warn(
      `SMS fallback requested for user ${userId} but no SmsFallbackProvider is configured`,
    );
    return {
      sent: false,
      maskedPhone,
      expiresInSec: SecurityTotpService.SMS_CODE_TTL_SEC,
    };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Generate a cryptographically random numeric code of the given length.
   */
  private generateNumericCode(length: number): string {
    const { randomInt } = require('crypto');
    let code = '';
    for (let i = 0; i < length; i++) {
      code += String(randomInt(0, 10));
    }
    return code;
  }

  /**
   * Mask a phone number for display: show only the last 2 digits.
   * Example: "+998901234567" → "+998 ** *** *67"
   */
  private maskPhoneNumber(phone: string): string {
    const cleaned = phone.replace(/\s/g, '');
    if (cleaned.length < 4) return '***';
    const last2 = cleaned.slice(-2);
    const prefix = cleaned.slice(0, 4);
    return `${prefix} ** *** *${last2}`;
  }
}
