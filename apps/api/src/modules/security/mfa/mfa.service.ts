import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import {
  BackupCodesResult,
  CredentialView,
  IssueMfaTokenResult,
  MfaService as CoreMfaService,
  VerifyMfaResult,
} from '../../mfa/mfa.service';
import { SecurityTotpService } from './totp.service';
import { SecurityWebAuthnService } from './webauthn.service';

/**
 * `SecurityMfaService` — security-module-scoped MFA orchestrator
 * (Task 29.1).
 *
 * This service sits in `modules/security/mfa/` and provides a
 * unified facade over the core `MfaService`, `SecurityTotpService`,
 * and `SecurityWebAuthnService`. It enforces the role-based MFA
 * policy defined in Requirements 29.1 and 29.7:
 *
 *   • **ADMIN**   — WebAuthn/FIDO2 hardware key mandatory + TOTP mandatory
 *                   (faqat TOTP yetarli emas — Req 29.7)
 *   • **TEACHER** — TOTP mandatory, SMS fallback available
 *   • **STUDENT** — MFA ixtiyoriy (optional)
 *
 * Responsibilities:
 *   - Role-based MFA enforcement at login (delegates to core
 *     `MfaService.assertRoleEnforcement`)
 *   - Backup codes generation (8 one-time codes via core service)
 *   - Credential listing and revocation with role-aware guards
 *   - MFA token issuance and challenge verification
 *   - Orchestrates TOTP + WebAuthn enrollment flows
 */
@Injectable()
export class SecurityMfaService {
  private readonly logger = new Logger(SecurityMfaService.name);

  constructor(
    private readonly coreMfaService: CoreMfaService,
    private readonly totpService: SecurityTotpService,
    private readonly webauthnService: SecurityWebAuthnService,
  ) {}

  // ==================================================================
  // Role-based enforcement
  // ==================================================================

  /**
   * Enforce MFA requirements based on user role. Called during login
   * flow to ensure the user has enrolled the required factors.
   *
   * - ADMIN: must have at least one verified credential (WebAuthn
   *   required per Req 29.7)
   * - TEACHER: must have at least one verified credential (TOTP
   *   required per Req 29.1)
   * - STUDENT: no enforcement — MFA is optional
   *
   * Throws `403 MFA_REQUIRED_FOR_ROLE` if the user hasn't enrolled.
   */
  async assertRoleEnforcement(role: UserRole, userId: string): Promise<void> {
    return this.coreMfaService.assertRoleEnforcement(role, userId);
  }

  /**
   * Check whether a user has completed MFA enrollment (at least one
   * verified credential exists).
   */
  async hasVerifiedCredential(userId: string): Promise<boolean> {
    return this.coreMfaService.hasVerifiedCredential(userId);
  }

  /**
   * Determine which MFA factors are required for a given role.
   *
   * Returns an object describing the enforcement policy:
   *   - `totpRequired`: whether TOTP enrollment is mandatory
   *   - `webauthnRequired`: whether WebAuthn/FIDO2 hardware key is mandatory
   *   - `mfaOptional`: whether MFA is entirely optional
   *   - `smsFallbackAvailable`: whether SMS fallback is available
   */
  getRolePolicy(role: UserRole): MfaRolePolicy {
    switch (role) {
      case UserRole.ADMIN:
        return {
          totpRequired: true,
          webauthnRequired: true,
          mfaOptional: false,
          smsFallbackAvailable: false,
        };
      case UserRole.TEACHER:
        return {
          totpRequired: true,
          webauthnRequired: false,
          mfaOptional: false,
          smsFallbackAvailable: true,
        };
      case UserRole.STUDENT:
      default:
        return {
          totpRequired: false,
          webauthnRequired: false,
          mfaOptional: true,
          smsFallbackAvailable: false,
        };
    }
  }

  // ==================================================================
  // Backup codes
  // ==================================================================

  /**
   * Generate a fresh batch of backup codes for the user.
   * Previous unused codes are invalidated atomically.
   *
   * Returns 10 one-time codes (shown to the user exactly once).
   */
  async generateBackupCodes(userId: string): Promise<BackupCodesResult> {
    return this.coreMfaService.generateBackupCodes(userId);
  }

  // ==================================================================
  // Credential management
  // ==================================================================

  /**
   * List all MFA credentials for a user (TOTP, WebAuthn, etc.).
   */
  async listCredentials(userId: string): Promise<CredentialView[]> {
    return this.coreMfaService.listCredentials(userId);
  }

  /**
   * Revoke a specific MFA credential. Enforces role-based guards:
   * - ADMIN cannot revoke their last credential
   * - TEACHER cannot revoke their last TOTP credential
   */
  async revokeCredential(
    userId: string,
    credentialId: string,
    role: UserRole,
  ): Promise<{ revoked: true }> {
    // For teachers, ensure they keep at least one factor
    if (role === UserRole.TEACHER) {
      const credentials = await this.coreMfaService.listCredentials(userId);
      const verified = credentials.filter((c) => c.verifiedAt !== null);
      if (verified.length <= 1) {
        throw new ForbiddenException({
          code: 'MFA_REQUIRED_FOR_ROLE',
          message: 'Teachers must keep at least one MFA factor enrolled',
          details: { role },
        });
      }
    }
    return this.coreMfaService.revokeCredential(userId, credentialId);
  }

  // ==================================================================
  // Login flow integration
  // ==================================================================

  /**
   * Issue a short-lived MFA challenge token after successful password
   * verification. The token carries the user ID and login metadata
   * so the challenge verification step can finalize the session.
   */
  async issueMfaToken(
    userId: string,
    meta: { ip?: string; ua?: string },
  ): Promise<IssueMfaTokenResult> {
    return this.coreMfaService.issueMfaToken(userId, meta);
  }

  /**
   * Verify an MFA challenge (TOTP code, backup code, or WebAuthn
   * assertion) paired with the short-lived MFA token.
   */
  async verifyMfaChallenge(input: {
    mfaToken: string;
    code?: string;
    webauthn?: { response: any };
  }): Promise<VerifyMfaResult> {
    return this.coreMfaService.verifyMfaChallenge(input);
  }

  // ==================================================================
  // Convenience accessors for sub-services
  // ==================================================================

  /** Access the TOTP sub-service (setup, verify, SMS fallback). */
  get totp(): SecurityTotpService {
    return this.totpService;
  }

  /** Access the WebAuthn sub-service (registration, authentication). */
  get webauthn(): SecurityWebAuthnService {
    return this.webauthnService;
  }
}

// ==================================================================
// Types
// ==================================================================

export interface MfaRolePolicy {
  /** Whether TOTP enrollment is mandatory for this role. */
  totpRequired: boolean;
  /** Whether WebAuthn/FIDO2 hardware key is mandatory for this role. */
  webauthnRequired: boolean;
  /** Whether MFA is entirely optional for this role. */
  mfaOptional: boolean;
  /** Whether SMS fallback is available for this role. */
  smsFallbackAvailable: boolean;
}
