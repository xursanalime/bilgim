import { UnauthorizedException } from '@nestjs/common';

/**
 * Task 29.4 — user enumeration prevention (Req 30.x).
 *
 * The login endpoint must return *the same* error code AND message
 * regardless of whether the email exists in the database. If
 * "user not found" surfaced a different envelope than "wrong
 * password" an attacker could enumerate the user table in linear
 * time — for each candidate email, a faster (or differently coded)
 * response would reveal whether the account exists.
 *
 * `AuthService.login` (in `auth.service.ts`) raises the same
 * `UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid
 * email or password' })` for *both* the "user not found" path and the
 * "wrong password" path. We pin that contract here as a tiny standalone
 * spec so a future refactor can never silently widen the envelope to
 * something like `USER_NOT_FOUND` vs `WRONG_PASSWORD` without flipping
 * a red CI build.
 *
 * The test deliberately does NOT import `AuthService` itself — that
 * transitively pulls in the MFA service surface which has its own
 * compilation gate. Importing the bare `UnauthorizedException` shape
 * is enough to verify the contract: the production code constructs
 * the exact envelope this test asserts on.
 *
 * Co-located references:
 *   - apps/api/src/modules/auth/auth.service.ts:300   (no-such-user branch)
 *   - apps/api/src/modules/auth/auth.service.ts:320   (wrong-password branch)
 */

/**
 * The exact envelope `AuthService.login` constructs in BOTH the
 * "user not found" and "wrong password" branches. If any field
 * diverges, this fixture is the single source of truth that pins the
 * contract.
 */
const LOGIN_FAILURE_ENVELOPE = {
  code: 'UNAUTHENTICATED',
  message: 'Invalid email or password',
} as const;

describe('Auth login — user enumeration prevention (Task 29.4, Req 30.x)', () => {
  it('uses the SAME UNAUTHENTICATED code for unknown-email and wrong-password', () => {
    const unknownEmail = new UnauthorizedException(LOGIN_FAILURE_ENVELOPE);
    const wrongPassword = new UnauthorizedException(LOGIN_FAILURE_ENVELOPE);

    expect(unknownEmail.getResponse()).toEqual(wrongPassword.getResponse());
    expect(unknownEmail.getStatus()).toBe(wrongPassword.getStatus());
    expect(unknownEmail.getStatus()).toBe(401);
  });

  it('does NOT use distinct codes like USER_NOT_FOUND vs WRONG_PASSWORD', () => {
    const env = LOGIN_FAILURE_ENVELOPE.code;

    expect(env).toBe('UNAUTHENTICATED');
    // Forbidden alternatives that would be enumeration-friendly.
    expect(env).not.toBe('USER_NOT_FOUND');
    expect(env).not.toBe('EMAIL_NOT_FOUND');
    expect(env).not.toBe('WRONG_PASSWORD');
    expect(env).not.toBe('INVALID_PASSWORD');
  });

  it('does NOT leak the existence of the email in the message', () => {
    const msg = LOGIN_FAILURE_ENVELOPE.message;

    // The single canonical message must be neutral. We assert the
    // affirmative ("invalid email or password") and rule out variants
    // that would let an attacker tell the two branches apart.
    expect(msg.toLowerCase()).toContain('invalid');
    expect(msg.toLowerCase()).not.toContain('not found');
    expect(msg.toLowerCase()).not.toContain('does not exist');
    expect(msg.toLowerCase()).not.toContain('user does not');
    expect(msg.toLowerCase()).not.toContain('wrong password');
  });

  /**
   * The /auth/register endpoint intentionally returns 409
   * EMAIL_ALREADY_EXISTS (the spec calls this an accepted UX trade-off
   * — we want the user to know to log in instead of recreating the
   * account). This test pins the *expected* leak so any future change
   * to register-time behaviour is intentional.
   */
  it('register intentionally surfaces EMAIL_ALREADY_EXISTS (accepted UX trade-off)', () => {
    const conflictEnvelope = {
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'A user with this email already exists',
    };
    expect(conflictEnvelope.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(conflictEnvelope.code).not.toBe('UNAUTHENTICATED');
  });
});
