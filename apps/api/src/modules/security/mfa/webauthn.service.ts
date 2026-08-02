import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

import { MfaService as CoreMfaService } from '../../mfa/mfa.service';

/**
 * `SecurityWebAuthnService` — security-module-scoped WebAuthn/FIDO2
 * orchestration (Task 29.1).
 *
 * Responsibilities:
 *   - Delegates core WebAuthn operations to the existing `MfaService`
 *   - Enforces role-based WebAuthn requirements (Req 29.7):
 *       • ADMIN  — WebAuthn/FIDO2 hardware key mandatory
 *                   (faqat TOTP yetarli emas — Admin panelga kirish
 *                   uchun hardware kalit shart)
 *       • TEACHER — WebAuthn optional (TOTP yetarli)
 *       • STUDENT — WebAuthn optional
 *   - Provides role-aware guards for credential revocation
 *
 * The actual cryptographic verification (COSE key parsing, challenge
 * validation, counter checks) lives in the core `MfaService`. This
 * service adds the security-policy layer on top.
 */
@Injectable()
export class SecurityWebAuthnService {
  private readonly logger = new Logger(SecurityWebAuthnService.name);

  constructor(private readonly coreMfaService: CoreMfaService) {}

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  /**
   * Generate WebAuthn registration options for a user.
   * Returns the challenge and RP configuration for the browser's
   * `navigator.credentials.create()` call.
   */
  async generateRegistrationOptions(userId: string): Promise<unknown> {
    return this.coreMfaService.generateWebAuthnRegistrationOptions(userId);
  }

  /**
   * Complete WebAuthn registration by verifying the attestation
   * response from the browser.
   *
   * On success, persists the credential (encrypted public key,
   * credentialId, counter) and marks it as verified.
   */
  async finishRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    label?: string,
  ): Promise<{ credentialId: string }> {
    return this.coreMfaService.finishWebAuthnRegistration(
      userId,
      response,
      label,
    );
  }

  // ------------------------------------------------------------------
  // Authentication
  // ------------------------------------------------------------------

  /**
   * Generate WebAuthn authentication options for a user.
   * Returns the challenge and allowed credentials for the browser's
   * `navigator.credentials.get()` call.
   *
   * Throws `404 WEBAUTHN_NOT_ENROLLED` if no verified WebAuthn
   * credentials exist for the user.
   */
  async generateAuthenticationOptions(userId: string): Promise<unknown> {
    return this.coreMfaService.generateWebAuthnAuthenticationOptions(userId);
  }

  /**
   * Complete WebAuthn authentication by verifying the assertion
   * response from the browser.
   *
   * On success, updates the credential counter and lastUsedAt.
   */
  async finishAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ credentialId: string }> {
    return this.coreMfaService.finishWebAuthnAuthentication(userId, response);
  }

  // ------------------------------------------------------------------
  // Role-based enforcement
  // ------------------------------------------------------------------

  /**
   * Check whether WebAuthn/FIDO2 is required for a given role.
   *
   * Per Requirement 29.7:
   *   - ADMIN: hardware key mandatory (faqat TOTP yetarli emas)
   *   - TEACHER: not required (TOTP is sufficient)
   *   - STUDENT: not required (MFA is optional)
   */
  isWebAuthnRequired(role: UserRole): boolean {
    return role === UserRole.ADMIN;
  }

  /**
   * Assert that an Admin user has enrolled at least one WebAuthn
   * credential. Called during the enrollment enforcement flow to
   * ensure Admins cannot bypass the hardware key requirement.
   *
   * Throws `403 MFA_REQUIRED_FOR_ROLE` with
   * `details.requiresHardwareKey = true` if no WebAuthn credential
   * is enrolled.
   */
  async assertAdminWebAuthnEnrollment(userId: string): Promise<void> {
    const credentials = await this.coreMfaService.listCredentials(userId);
    const hasWebAuthn = credentials.some(
      (c) => c.type === 'WEBAUTHN' && c.verifiedAt !== null,
    );
    if (!hasWebAuthn) {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED_FOR_ROLE',
        message:
          'Administrators must enrol a WebAuthn/FIDO2 hardware key before logging in',
        details: { role: 'ADMIN', requiresHardwareKey: true },
      });
    }
  }

  /**
   * Guard credential revocation for Admins — they cannot remove
   * their last WebAuthn credential since hardware key is mandatory.
   *
   * This is called before `coreMfaService.revokeCredential` for
   * Admin users when the credential being revoked is of type WEBAUTHN.
   */
  async assertCanRevokeWebAuthn(
    userId: string,
    credentialId: string,
  ): Promise<void> {
    const credentials = await this.coreMfaService.listCredentials(userId);
    const webauthnCredentials = credentials.filter(
      (c) => c.type === 'WEBAUTHN' && c.verifiedAt !== null,
    );
    // If this is the last WebAuthn credential, block revocation
    if (
      webauthnCredentials.length <= 1 &&
      webauthnCredentials.some((c) => c.id === credentialId)
    ) {
      throw new ForbiddenException({
        code: 'MFA_REQUIRED_FOR_ROLE',
        message:
          'Administrators must keep at least one WebAuthn/FIDO2 hardware key enrolled',
        details: { role: 'ADMIN', requiresHardwareKey: true },
      });
    }
  }
}
